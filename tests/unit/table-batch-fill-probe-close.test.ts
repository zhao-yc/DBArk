import { readFileSync } from 'node:fs';
import { Duplex } from 'node:stream';
import { runInNewContext } from 'node:vm';
import mysql from 'mysql2';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { closeMysqlConnection } from '../../src/engine/connection';

/** 提取专项真实探针函数；关闭仍用原engine实现，桌面及数据库端口均不加载。 */
function probe(open: (options: mysql.ConnectionOptions) => mysql.Connection) {
  const source = readFileSync(new URL('../e2e/table-batch-fill-live.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'withBatchFillProbe');
  if (!declaration) throw Error('未找到真实探针');
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(declaration.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports, mysql: { createConnection: open }, closeMysqlConnection });
  return exports.withBatchFillProbe as typeof import('../e2e/table-batch-fill-live').withBatchFillProbe;
}

/** 两个真实mysql2通过内存Duplex握手；不联网、不替换end/destroy或关闭结果。 */
function memoryPair(late = false) {
  const events: string[] = []; let release = () => {}, ready!: () => void;
  const connected = new Promise<void>(resolve => { ready = resolve; });
  const stream = new Duplex({ read() {}, write(chunk, _encoding, done) { serverStream.push(chunk); done(); }, final(done) { serverStream.push(null); done(); } });
  const serverStream = new Duplex({ read() {}, write(chunk, _encoding, done) { stream.push(chunk); done(); }, final(done) { stream.push(null); done(); } });
  stream.on('close', () => events.push('原物理流close'));
  const server = mysql.createConnection({ stream: serverStream, isServer: true, connectTimeout: 0 }); server.on('error', () => undefined);
  server.on('quit', () => { events.push('真实对端收到QUIT'); stream.push(null); });
  server.serverHandshake({ protocolVersion: 10, serverVersion: '8.4.11', connectionId: 7, statusFlags: 2, characterSet: 45, capabilityFlags: 0x00088200, authCallback(_params: unknown, done: () => void) { done(); (server as unknown as { _resetSequenceId(): void })._resetSequenceId(); } });
  let native!: mysql.Connection;
  const open = vi.fn((options: mysql.ConnectionOptions) => {
    native = mysql.createConnection({ ...options, stream, connectTimeout: 0 }); native.on('error', () => undefined);
    const connect = native.connect.bind(native);
    vi.spyOn(native, 'connect').mockImplementation(callback => {
      // 内存握手必须接收真实回调；缺失时明确失败，不能静默跳过握手断言。
      if (!callback) throw Error('内存对端缺少建连回调');
      return connect(error => {
        release = () => callback(error);
        if (late) ready(); else release();
      });
    });
    return native;
  });
  return { open, stream, connected, events, release: () => release(), native: () => native, cleanup() { native?.destroy(); stream.destroy(); server.destroy(); serverStream.destroy(); } };
}

it('正常探针沿原mysql2写出QUIT，原物理流close后才返回，不以Promise end充当关闭证明', async () => {
  const f = memoryPair(), body = vi.fn(async (observer: unknown) => { expect((observer as { connection?: unknown }).connection).toBe(f.native()); });
  try {
    await probe(f.open)({}, () => {}, body); f.events.push('探针返回');
    expect(body).toHaveBeenCalledOnce(); expect(f.open).toHaveBeenCalledOnce(); expect(f.stream.closed).toBe(true);
    expect(f.events).toEqual(['真实对端收到QUIT', '原物理流close', '探针返回']);
  } finally { f.cleanup(); }
});

it('建连晚回包时原句柄已登记；门失效不进入正文，仍严格关闭自己的原连接及原流', async () => {
  const f = memoryPair(true), body = vi.fn(); let valid = true;
  const current = () => { if (!valid) throw Error('合成原期限失效'); };
  const work = probe(f.open)({}, current, body), rejected = expect(work).rejects.toThrow('合成原期限失效');
  try {
    await f.connected; const original = f.native(); expect(original).toBeDefined(); expect(f.stream.closed).toBe(false);
    valid = false; f.release(); await rejected;
    expect(body).not.toHaveBeenCalled(); expect(f.open).toHaveBeenCalledOnce(); expect(f.native()).toBe(original); expect(f.stream.closed).toBe(true);
    expect(f.events).toEqual(['真实对端收到QUIT', '原物理流close']);
  } finally { f.cleanup(); }
});

it('真实握手失败走已有broken关闭路径，不发送QUIT、不建替代连接，并等待原流close', async () => {
  const stream = new Duplex({ read() {}, write(_chunk, _encoding, done) { done(); } }); let native!: mysql.Connection;
  const body = vi.fn(), open = vi.fn((options: mysql.ConnectionOptions) => {
    native = mysql.createConnection({ ...options, stream, connectTimeout: 0 }); native.on('error', () => undefined);
    queueMicrotask(() => stream.destroy(Error('合成握手失败'))); return native;
  });
  try {
    const work = probe(open)({}, () => {}, body), end = vi.spyOn(native, 'end');
    await expect(work).rejects.toThrow('合成握手失败');
    expect(end).not.toHaveBeenCalled(); expect(open).toHaveBeenCalledOnce(); expect(body).not.toHaveBeenCalled(); expect(stream.closed).toBe(true);
  } finally { native?.destroy(); stream.destroy(); }
});
