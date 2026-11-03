import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalReferencesWorkerClient } from '../../src/renderer/localReferencesWorkerClient';
import { analyzeMysqlPhysicalObject } from '../../src/shared/mysqlPhysicalObject';
import { analyzeSqlitePhysicalObject } from '../../src/shared/sqlitePhysicalObject';

const source = 'SELECT s.id FROM subject s';
/** 真实浏览器bundle仅替换self传输端口；不加载GUI、IPC或数据库连接。 */
it.each(['mysql', 'sqlite'] as const)('%s实际Worker只返回物理身份并拒绝附加输入字段', dialect => {
  const build = buildSync({ entryPoints: [dialect === 'mysql' ? 'src/renderer/completion.worker.ts' : 'src/renderer/sqliteLocalReferences.worker.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022', logLevel: 'silent', metafile: true });
  if (dialect === 'sqlite') expect(Object.keys(build.metafile.inputs).some(name => name.includes('dt-sql-parser') || name.endsWith('/completionAnalysis.ts'))).toBe(false);
  const messages: any[] = [], port: any = { postMessage: (value: unknown) => messages.push(structuredClone(value)) };
  runInNewContext(build.outputFiles[0].text, { self: port, console: { log() {}, warn() {}, error() { throw Error('不得回显正文'); } }, setTimeout, clearTimeout }, { timeout: 8000 });
  const prefix = dialect === 'mysql' ? 'dbark-completion' : 'dbark-sqlite-local-references';
  expect(messages).toEqual([{ type: prefix + '-ready', version: 1 }]);
  const request = { id: 1, source, offset: 8, intent: 'object', ...(dialect === 'mysql' ? { mode: {}, capabilities: {} } : {}) };
  port.onmessage({ data: request });
  expect(messages.at(-1)).toEqual({ id: 1, result: { status: 'ready', target: { start: 7, end: 8 }, object: { table: 'subject', tableRange: { start: 17, end: 24 } } } });
  port.onmessage({ data: { ...request, id: 2, uri: 'command:run' } }); expect(messages.at(-1)).toEqual({ id: 2, result: { status: 'blocked', reason: 'input' } });
  port.onmessage({ data: { ...request, id: 3, source: 'SELECT s.id FROM (SELECT 1 AS id) s' } }); expect(messages.at(-1)).toMatchObject({ id: 3, result: { status: 'blocked' } });
});

/** 计时器与传输端口可控，正文结果使用同一生产分析器；取消只结束本请求线程。 */
function fixture(dialect: 'mysql' | 'sqlite') {
  const workers: any[] = [], create = vi.fn(() => { const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null }; workers.push(worker); return worker; });
  const client = new LocalReferencesWorkerClient(create, dialect), controller = new AbortController();
  const prefix = dialect === 'mysql' ? 'dbark-completion' : 'dbark-sqlite-local-references';
  const result = () => dialect === 'mysql' ? analyzeMysqlPhysicalObject(source, 8) : analyzeSqlitePhysicalObject(source, 8);
  return { workers, create, client, controller, prefix, result, run: () => client.object(source, 8, {}, controller.signal, {}), ready: (index = 0) => workers[index].onmessage?.({ data: { type: prefix + '-ready', version: 1 } }), reply: (value: unknown = result(), index = 0) => workers[index].onmessage?.({ data: { id: 1, result: value } }) };
}
afterEach(() => vi.useRealTimers());
it.each(['mysql', 'sqlite'] as const)('%s握手前不发正文，交付身份后终止准确线程', async dialect => {
  const f = fixture(dialect), result = f.run(), worker = f.workers[0]; expect(worker.postMessage).not.toHaveBeenCalled();
  f.ready(); expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ id: 1, source, offset: 8, intent: 'object', ...(dialect === 'mysql' ? { mode: { ansiQuotes: undefined, noBackslashEscapes: undefined }, capabilities: { lateralDerivedTables: false, windowFunctions: false, insertRowAliases: false } } : {}) });
  f.reply(); expect(await result).toMatchObject({ status: 'ready', object: { table: 'subject' } }); expect(worker.terminate).toHaveBeenCalledOnce(); expect(worker.onmessage).toBeNull();
  f.client.dispose(); expect(worker.terminate).toHaveBeenCalledOnce();
});
it.each(['startup', 'analysis', 'cancel', 'dispose', 'replace', 'error'] as const)('对象请求%s保持原8秒/2秒和owner清理', async action => {
  vi.useFakeTimers(); const f = fixture('mysql'), result = f.run();
  if (action === 'startup') await vi.advanceTimersByTimeAsync(8000);
  else if (action === 'analysis') { f.ready(); await vi.advanceTimersByTimeAsync(2000); }
  else if (action === 'cancel') f.controller.abort();
  else if (action === 'dispose') f.client.dispose();
  else if (action === 'error') f.workers[0].onmessageerror();
  else { const old = f.workers[0].onmessage!, next = f.run(); old({ data: { type: f.prefix + '-ready', version: 1 } }); expect(f.workers[1].postMessage).not.toHaveBeenCalled(); f.ready(1); f.reply(f.result(), 1); expect(await next).toMatchObject({ status: 'ready' }); }
  expect(await result).toMatchObject({ status: 'blocked' }); expect(f.workers[0].terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0); f.client.dispose();
});
it.each(['extra-result', 'extra-object', 'extra-envelope', 'extra-ready', 'cross-statement', 'wrong-name', 'early'] as const)('恶意对象回包%s不得交付', async action => {
  const f = fixture('sqlite'), promise = f.run(), value = f.result();
  if (value.status !== 'ready') throw Error('真实解析结果不就绪');
  if (action === 'extra-ready') f.workers[0].onmessage({ data: { type: f.prefix + '-ready', version: 1, uri: 'command:run' } });
  else if (action === 'early') f.reply();
  else {
    f.ready();
    if (action === 'extra-result') f.reply({ ...value, uri: 'file:///x' });
    else if (action === 'extra-object') f.reply({ ...value, object: { ...value.object, sql: source } });
    else if (action === 'extra-envelope') f.workers[0].onmessage({ data: { id: 1, result: value, command: 'execute' } });
    else if (action === 'wrong-name') f.reply({ ...value, object: { ...value.object, table: 'other' } });
    else f.reply({ ...value, object: { ...value.object, tableRange: { start: source.length + 1, end: source.length + 8 } } });
  }
  expect(await promise).toEqual({ status: 'blocked', reason: 'worker' }); expect(f.workers[0].terminate).toHaveBeenCalledOnce(); f.client.dispose();
});
it('构造器中同步取消也终止刚取得的线程，已取消和超预算不分配线程', async () => {
  const controller = new AbortController(), worker: any = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null };
  const create = vi.fn(() => { controller.abort(); return worker; }), client = new LocalReferencesWorkerClient(create);
  expect(await client.object(source, 8, {}, controller.signal, {})).toEqual({ status: 'blocked', reason: 'cancelled' }); expect(worker.terminate).toHaveBeenCalledOnce(); expect(worker.postMessage).not.toHaveBeenCalled();
  await client.object(source, 8, {}, controller.signal, {}); expect(create).toHaveBeenCalledOnce();
  expect(await client.object('x'.repeat(262145), 1, {}, new AbortController().signal, {})).toEqual({ status: 'blocked', reason: 'budget' }); expect(create).toHaveBeenCalledOnce(); client.dispose();
});
