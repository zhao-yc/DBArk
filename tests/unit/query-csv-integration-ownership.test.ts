import { readFileSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { stringify } from 'csv-stringify/sync';
import * as policy from '../helpers/queryCsvIntegration';
import { assertQcsvOutput } from '../helpers/queryCsvIntegrationAssertions';

const source = readFileSync(new URL('../integration/query-csv-delimiter-live.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('live.ts', source, ts.ScriptTarget.Latest, true);
const functions = new Map<string, string>(), hooks = new Map<string, string>(); let factory = '', driverSpy = '', creationSpy = '';
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(tree));
  if (ts.isBinaryExpression(node) && /^io\./.test(node.left.getText(tree)) && ts.isArrowFunction(node.right)) hooks.set(node.left.getText(tree).slice(3), node.right.getText(tree));
  if (ts.isCallExpression(node)) {
    if (node.expression.getText(tree) === 'vi.mock') factory = node.arguments[1].getText(tree);
    if (node.expression.getText(tree) === "vi.spyOn(driver, 'connect').mockImplementation") driverSpy = node.arguments[0].getText(tree);
    if (node.expression.getText(tree) === "vi.spyOn(mysql, 'createConnection').mockImplementation") creationSpy = node.arguments[0].getText(tree);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
const compile = (text: string) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const scenario = policy.qcsvCases[0], before = policy.qcsvRows().map(row => ({ ...row.expected, doc_hex: row.values[10] === null ? null : Buffer.from(String(row.values[10])).toString('hex') }));
const fields = before.map(policy.qcsvExpectedFields), bytes = Buffer.from(stringify([policy.qcsvHeaders, ...fields], { delimiter: ',', record_delimiter: '\r\n', quoted_empty: true }));

/** 正式文件函数/IO观察器在RAM原句柄上运行；没有真实文件、Engine或数据库模块。 */
function files() {
  const plan = policy.qcsvPlan(scenario, 'b'.repeat(32), 'c'.repeat(64)), directory = resolve('C:/RAM', plan.directory), target = join(directory, plan.file), partial = target + '.dbark-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.partial';
  type Entry = { ino: number; bytes: Buffer; closed: boolean };
  const entries = new Map<string, Entry>([[target, { ino: 11, bytes: Buffer.from('old'), closed: true }]]), calls: string[] = [], handles: any[] = [];
  let clock = 1, halted = true;
  const life = policy.qcsvLifetime({ task: { id: 'RAM', timeout: 120000, result: { startTime: 0, state: 'run' } } }, { assertCurrent() {} }, () => { halted = true; }, () => clock);
  const missing = () => Object.assign(Error('不存在'), { code: 'ENOENT' });
  const stat = (entry: Entry) => ({ dev: 1, ino: entry.ino, size: entry.bytes.length, nlink: 1, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false });
  const actualFs = {
    lstat: vi.fn(async (path: string): Promise<any> => { if (path === directory) return { dev: 1, ino: 7, isDirectory: (): boolean => true, isSymbolicLink: (): boolean => false }; const entry = entries.get(path); if (!entry) throw missing(); return stat(entry); }),
    realpath: async (path: string) => path,
    readFile: async (path: string) => { const entry = entries.get(path); if (!entry) throw missing(); return entry.bytes; },
    open: vi.fn(async (path: string, ...args: unknown[]) => { calls.push('open'); expect(args).toEqual(['wx']); const entry = { ino: 22, bytes: Buffer.from(bytes), closed: false }; entries.set(path, entry); const handle = { stat: vi.fn(async () => stat(entry)), close: vi.fn(async () => { entry.closed = true; }), protectOwnership: vi.fn() }; handles.push(handle); return handle; }),
    rename: vi.fn(async (from: string, to: string) => { calls.push('rename'); const entry = entries.get(from); if (!entry) throw missing(); entries.set(to, entry); entries.delete(from); }),
    rm: vi.fn(async (path: string) => { calls.push('rm'); entries.delete(path); }),
    unlink: vi.fn(async (path: string) => { calls.push('unlink'); entries.delete(path); }),
  };
  const original = entries.get(target)!;
  const scope: any = { exports: {}, Buffer, Number, Object, Error, dirname, basename, resolve, hash, actualFs, directory, directoryId: '1:7', target, plan, partials: new Set<string>(), partialObject: undefined, publication: undefined, published: false, targetIdentity: { dev: '1', ino: '11', size: original.bytes.length, hash: hash(original.bytes) }, check: () => life.check(), record: vi.fn(async () => {}), io: {}, qcsvUsingHandle: policy.qcsvUsingHandle, before, qcsvExpectedFields: policy.qcsvExpectedFields, scenario, assertQcsvOutput, step: async (action: () => Promise<unknown>) => life.step(action), ids: [73], noPartial: async () => {}, sql: vi.fn(async () => {}) };
  const definitions = ['ownedDirectory', 'file', 'openedObject'].map(name => functions.get(name)).join('\n');
  const bindings = [...hooks].map(([name, code]) => 'io.' + name + '=' + code + ';').join('\n');
  const read = source.split('\n').find(line => line.includes('const saved = await file(target, publication'))!;
  const cleanup = source.split('\n').find(line => line.includes("record('cleanup-verified'"))!;
  runInNewContext(compile(definitions + '\n' + bindings + '\nexports.factory=' + factory + ';exports.file=file;exports.read=async()=>{' + read + '\nreturn saved;};exports.cleanup=async()=>{' + cleanup + '\nawait sql("DROP DATABASE");};'), scope);
  return { scope, life, entries, calls, handles, actualFs, partial, target, setClock(value: number) { clock = value; }, get halted() { return halted; }, async port() { return scope.exports.factory(async () => actualFs); }, async pipeline(action: () => Promise<unknown>) { try { return await action(); } catch (reason) { life.stop(); throw reason; } } };
}

it('F1正常链从原open句柄绑定partial，经真实rename原对象发布，最终路径不重签', async () => {
  const f = files(), port = await f.port(), handle = await port.open(f.partial, 'wx');
  expect(handle).toBe(f.handles[0]); expect(f.scope.partialObject).toEqual({ dev: '1', ino: '22' });
  await handle.close(); await port.rename(f.partial, f.target);
  expect(f.scope.published).toBe(true); expect(f.scope.publication.ino).toBe('22');
  const publication = f.scope.publication; expect((await f.scope.exports.read()).identity).toEqual(publication); expect(f.scope.targetIdentity).toBe(publication);
  await f.scope.exports.cleanup(); expect(f.actualFs.unlink).toHaveBeenCalledOnce(); expect(f.scope.sql).toHaveBeenCalledOnce(); expect(f.handles[0].protectOwnership).not.toHaveBeenCalled();
});

it.each(['发布前partial替换', 'rename回执前目标替换', '首次读取前目标替换'])('F1同字节异inode：%s拒绝且不unlink/DROP/后续动作', async mode => {
  const f = files(), port = await f.port(), handle = await port.open(f.partial, 'wx'); await handle.close();
  const replace = (path: string) => f.entries.set(path, { ino: 99, bytes: Buffer.from(bytes), closed: true });
  if (mode === '发布前partial替换') replace(f.partial);
  if (mode === 'rename回执前目标替换') f.actualFs.rename.mockImplementationOnce(async (from, to) => { f.entries.delete(from); replace(to); });
  if (mode === '首次读取前目标替换') { await port.rename(f.partial, f.target); replace(f.target); }
  await expect(f.pipeline(async () => { if (mode !== '首次读取前目标替换') await port.rename(f.partial, f.target); await f.scope.exports.read(); await f.scope.exports.cleanup(); })).rejects.toThrow();
  expect(f.actualFs.unlink).not.toHaveBeenCalled(); expect(f.scope.sql).not.toHaveBeenCalled(); expect(f.scope.publication?.ino).not.toBe('99'); expect(f.halted).toBe(true);
  const next = vi.fn(async () => {}); await expect(f.life.step(next)).rejects.toThrow(); expect(next).not.toHaveBeenCalled();
  if (mode === '发布前partial替换') { await expect(port.rm(f.partial, { force: true })).rejects.toThrow(); expect(f.actualFs.rm).not.toHaveBeenCalled(); }
});

it('F1在未失效时也不替产品删除被替换partial，正常缺席仅透传原rm', async () => {
  const f = files(), port = await f.port(), handle = await port.open(f.partial, 'wx'); await handle.close();
  f.entries.set(f.partial, { ino: 99, bytes: Buffer.from(bytes), closed: true }); await expect(port.rm(f.partial, { force: true })).rejects.toThrow(); expect(f.actualFs.rm).not.toHaveBeenCalled();
  f.entries.delete(f.partial); await port.rm(f.partial, { force: true }); expect(f.actualFs.rm).toHaveBeenCalledExactlyOnceWith(f.partial, { force: true });
});

it.each(['登记失败', '原期限晚回'])('F1原open后%s只关闭原句柄，不交给产品或认领替代对象', async mode => {
  const f = files(), port = await f.port(), first = Error('登记失败');
  f.scope.record.mockImplementation(async (stage: string) => { if (stage === 'partial-opened') { if (mode === '登记失败') throw first; f.setClock(120000); f.life.check(); } });
  await expect(port.open(f.partial, 'wx')).rejects.toThrow(); expect(f.handles[0].close).toHaveBeenCalledOnce(); expect(f.actualFs.rename).not.toHaveBeenCalled(); expect(f.actualFs.rm).not.toHaveBeenCalled(); expect(f.scope.sql).not.toHaveBeenCalled();
});

it('F1登记与原句柄关闭都失败时保留两个原错误，不删除任何路径', async () => {
  const f = files(), port = await f.port(), first = Error('原登记失败'), closing = Error('原关闭失败');
  const handle = { stat: async () => ({ dev: 1, ino: 22, nlink: 1, isFile: () => true }), close: vi.fn(async () => { throw closing; }) };
  f.actualFs.open.mockResolvedValueOnce(handle as any); f.scope.record.mockImplementation(async (stage: string) => { if (stage === 'partial-opened') throw first; });
  let caught: any; try { await port.open(f.partial, 'wx'); } catch (reason) { caught = reason; }
  expect(caught.errors).toEqual([first, closing]); expect(caught.cause).toBe(first); expect(handle.close).toHaveBeenCalledOnce(); expect(f.actualFs.rm).not.toHaveBeenCalled();
});

/** 实际connect spy和mysql构造观察在RAM驱动上执行；原初始化可扣留，回执不提供任何恢复许可。 */
function connections(mode: 'normal' | 'failure' | 'handshake' | 'late' | 'stream' | 'receipt', upstream?: (value: unknown) => void) {
  let clock = 1, release!: () => void, created!: () => void, failedToCreate!: (reason: unknown) => void;
  const started = new Promise<void>((done, fail) => { created = done; failedToCreate = fail; });
  const wait = new Promise<void>(done => { release = done; }), failure = Error('原初始化失败'), profile = {}, native: any = Object.assign(new EventEmitter(), { threadId: 0, stream: { closed: false, remoteAddress: '192.168.31.200', remotePort: 13384 }, query: vi.fn(), execute: vi.fn() });
  const originalStream = native.stream, life = policy.qcsvLifetime({ task: { id: 'RAM', timeout: 120000, result: { startTime: 0, state: 'run' } } }, { assertCurrent() {} }, () => {}, () => clock);
  const recover = vi.fn(() => { throw Error('禁止恢复'); }), receipt = { snapshot: () => ({ confirmedClosed: originalStream.closed }), recover };
  const close = vi.fn(async () => { originalStream.closed = true; }); const managed = { profile, connection: native, resources: receipt, broken: false, close };
  const scope: any = { exports: {}, mysql: {}, life, owned: [], initializations: [], initializing: undefined, binding: { profile }, source: undefined, closingEngine: false, connectAttempts: 1, connectRole: 'source-session', sourceSql: '', exporting: false, exportCommands: [], record: vi.fn(async () => {}), originalCreate: vi.fn(() => native) };
  scope.original = vi.fn(async (actualProfile: object, database: unknown, signal: unknown, callback: (value: object) => void) => {
    expect(actualProfile).toBe(profile); expect(database).toBeUndefined(); expect(signal).toBeUndefined(); callback(receipt);
    scope.exports.create({ host: 'RAM' }); native.threadId = 73; if (mode !== 'handshake') native.emit('connect'); created();
    await wait; if (mode === 'failure' || mode === 'handshake') throw failure;
    if (mode === 'stream') native.stream = { ...originalStream };
    if (mode === 'receipt') callback({ ...receipt });
    return managed;
  });
  runInNewContext(compile(['check', 'observeNative', 'captureNative', 'initializationEvidence'].map(name => functions.get(name)).join('\n') + ';exports.connect=' + driverSpy + ';exports.create=' + creationSpy + ';exports.evidence=initializationEvidence;'), scope);
  const pending = scope.exports.connect(profile, undefined, undefined, upstream); void pending.catch(failedToCreate);
  return { scope, life, native, originalStream, receipt, recover, close, failure, managed, pending, started, release() { if (mode === 'late') { clock = 120000; life.end(); } release(); } };
}

it.each(['normal', 'failure', 'handshake', 'late', 'stream', 'receipt'] as const)('F2原初始化%s：构造时已留原native/stream/receipt，不recover/新连/重签', async mode => {
  const f = connections(mode); await f.started;
  expect(f.scope.owned).toHaveLength(1); expect(f.scope.owned[0].native).toBe(f.native); expect(f.scope.owned[0].stream).toBe(f.originalStream); expect(f.scope.owned[0].thread).toBe(mode === 'handshake' ? 0 : 73);
  const attempt = f.scope.initializations[0]; expect(attempt.receipt).toBe(f.receipt); expect(attempt.returned).toBe(false); expect(f.scope.record.mock.calls.map((call: any[]) => call[0])).toEqual(['connection-planned']);
  f.release();
  if (mode === 'normal') { expect(await f.pending).toBe(f.managed); await f.managed.close(); expect(f.close).toHaveBeenCalledWith({ strict: true }); }
  else { await expect(f.pending).rejects.toThrow(); expect(attempt.failed).toBe(true); expect(f.close).not.toHaveBeenCalled(); const next = vi.fn(async () => {}); await expect(f.life.step(next)).rejects.toThrow(); expect(next).not.toHaveBeenCalled(); }
  expect(attempt.receipt).toBe(f.receipt); expect(f.scope.owned[0].stream).toBe(f.originalStream); expect(f.scope.originalCreate).toHaveBeenCalledOnce(); expect(f.recover).not.toHaveBeenCalled();
  const evidence = f.scope.exports.evidence(attempt); expect(evidence.receiptAvailable).toBe(true); expect(evidence.natives[0].thread).toBe(mode === 'handshake' ? 0 : 73); expect(evidence.natives[0].observedThread).toBe(73); if (mode === 'late') expect(evidence.late).toBe(true);
});

it('F2上游原资源回执收到同一对象恰一次，真实构造参数和this仍透传', async () => {
  const upstream = vi.fn(), f = connections('normal', upstream); await f.started;
  expect(upstream).toHaveBeenCalledExactlyOnceWith(f.receipt); expect(upstream.mock.contexts[0]).toBeUndefined(); expect(f.scope.originalCreate).toHaveBeenCalledExactlyOnceWith({ host: 'RAM' }); expect(f.scope.originalCreate.mock.contexts[0]).toBe(f.scope.mysql);
  f.release(); expect(await f.pending).toBe(f.managed); expect(f.recover).not.toHaveBeenCalled();
});

it('F2原receipt快照抛错只保留unknown位，不覆盖原初始化首因', async () => {
  const f = connections('failure'); await f.started; const original = f.receipt.snapshot; f.receipt.snapshot = () => { throw Error('未知资源'); };
  f.release(); await expect(f.pending).rejects.toBe(f.failure); expect(f.scope.exports.evidence(f.scope.initializations[0]).resources).toEqual({ inventoryUnknown: true }); expect(f.recover).not.toHaveBeenCalled(); f.receipt.snapshot = original;
});
