import { buildSync } from 'esbuild';
import { createContext, runInContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalReferencesWorkerClient } from '../../src/renderer/localReferencesWorkerClient';
import { checkMysqlSyntax } from '../../src/shared/mysqlSyntaxCheck';

const source = 'SELECT * FROM;', mode = { ansiQuotes: false, noBackslashEscapes: false };
/** 实际浏览器产物只给self端口，不赋予任何文件、网络或数据库能力。 */
it('真实MySQL Worker路由整份语法检查，未知字段及错误offset拒绝', () => {
  const bundle = buildSync({ entryPoints: ['src/renderer/completion.worker.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022', logLevel: 'silent' });
  const messages: any[] = [], self: any = { postMessage: (value: unknown) => messages.push(structuredClone(value)) };
  const context = createContext({ self, TextEncoder, TextDecoder, setTimeout, clearTimeout, console: { log() { throw Error('不得输出SQL'); }, warn() {}, error() { throw Error('不得输出SQL'); } } });
  runInContext(bundle.outputFiles[0].text, context, { timeout: 8000 });
  // 浏览器消息在Worker本域反序列化；不能把测试宿主域Object原型冒充真实结构化克隆。
  const send = (value: unknown) => { context.requestJson = JSON.stringify(value); runInContext('self.onmessage({ data: JSON.parse(requestJson) })', context, { timeout: 2000 }); };
  expect(messages).toEqual([{ type: 'dbark-completion-ready', version: 1 }]);
  const request = { id: 1, source, offset: 0, intent: 'syntax', mode, capabilities: {} }; send(request); expect(messages.at(-1)).toEqual({ id: 1, result: checkMysqlSyntax(source, mode) });
  for (const extra of [{ sql: 'DROP TABLE subject' }, { uri: 'command:run' }, { offset: 1 }]) { send({ ...request, ...extra }); expect(messages.at(-1)).toEqual({ id: 1, result: { status: 'blocked', reason: 'input' } }); }
});
/** Worker端口仅模拟传输和时钟，实际问题仍由生产解析器产生。 */
function fixture(dialect: 'mysql' | 'sqlite' = 'mysql') {
  const workers: any[] = [], create = vi.fn(() => { const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null }; workers.push(worker); return worker; });
  const client = new LocalReferencesWorkerClient(create, dialect), abort = new AbortController();
  return { client, abort, workers, create, run: () => client.syntax(source, mode, abort.signal), ready: (index = 0, extra = {}) => workers[index].onmessage?.({ data: { type: 'dbark-completion-ready', version: 1, ...extra } }), reply: (result: unknown = checkMysqlSyntax(source, mode), index = 0, extra = {}) => workers[index].onmessage?.({ data: { id: 1, result, ...extra } }) };
}
afterEach(() => vi.useRealTimers());
it('握手前不发送原文，完成后立即准确清理线程和监听', async () => {
  const f = fixture(), work = f.run(); expect(f.workers[0].postMessage).not.toHaveBeenCalled(); f.ready(); expect(f.workers[0].postMessage).toHaveBeenCalledExactlyOnceWith({ id: 1, source, offset: 0, mode, capabilities: { lateralDerivedTables: false, windowFunctions: false, insertRowAliases: false }, intent: 'syntax' }); f.reply(); expect(await work).toEqual(checkMysqlSyntax(source, mode)); expect(f.workers[0].terminate).toHaveBeenCalledOnce(); expect(f.workers[0].onmessage).toBeNull(); f.client.dispose(); expect(f.workers[0].terminate).toHaveBeenCalledOnce();
});
it('SQLite调用明确拒绝，不创建MySQL线程或猜测SQL方言', async () => { const f = fixture('sqlite'); expect(await f.run()).toEqual({ status: 'blocked', reason: 'unsupported' }); expect(f.create).not.toHaveBeenCalled(); });
it.each(['startup', 'analysis', 'cancel', 'replace', 'envelope', 'ready-extra', 'source-extra', 'error'] as const)('%s失败整份拒绝，原期限和准确终止保持', async action => {
  vi.useFakeTimers(); const f = fixture(), work = f.run();
  if (action === 'startup') await vi.advanceTimersByTimeAsync(8000);
  else if (action === 'cancel') f.abort.abort();
  else if (action === 'replace') { const next = f.run(); f.ready(1); f.reply(undefined, 1); expect((await next).status).toBe('ready'); }
  else if (action === 'ready-extra') f.ready(0, { source });
  else { f.ready(); if (action === 'analysis') await vi.advanceTimersByTimeAsync(2000); else if (action === 'error') f.workers[0].onmessageerror(); else if (action === 'envelope') f.reply(undefined, 0, { source }); else f.reply({ ...checkMysqlSyntax(source, mode), sql: source }); }
  expect((await work).status).toBe('blocked'); expect(f.workers[0].terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0); f.client.dispose();
});
