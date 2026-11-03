import { buildSync } from 'esbuild';
import { createContext, runInContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { StatementNavigationWorkerClient } from '../../src/renderer/statementNavigationWorkerClient';
import { analyzeStatementNavigation } from '../../src/shared/statementNavigation';

const source = 'SELECT 1;SELECT 2;', mode = { ansiQuotes: false, noBackslashEscapes: false };
/** 真浏览器产物不得带engine/Buffer/ANTLR/IPC依赖，原结果仍来自真正执行分段规则。 */
it('真实轻量Worker按三方言处理原文，只返回固定数字范围', () => {
  const bundle = buildSync({ entryPoints: ['src/renderer/statementNavigation.worker.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022', metafile: true, logLevel: 'silent' });
  expect(Object.keys(bundle.metafile.inputs).some(path => /src\/engine\/|dt-sql-parser|mysql2|ssh2|node:/.test(path))).toBe(false); expect(bundle.outputFiles[0].text).not.toMatch(/\bBuffer\b/);
  const messages: any[] = [], self: any = { postMessage: (value: unknown) => messages.push(structuredClone(value)) }, context = createContext({ self });
  runInContext(bundle.outputFiles[0].text, context, { timeout: 8000 }); expect(messages).toEqual([{ type: 'dbark-statement-navigation-ready', version: 1 }]);
  const send = (value: unknown) => { context.requestJson = JSON.stringify(value); runInContext('self.onmessage({ data: JSON.parse(requestJson) })', context, { timeout: 2000 }); };
  for (const dialect of ['mysql', 'mariadb', 'sqlite'] as const) { send({ id: 1, source, dialect, mode }); expect(messages.at(-1)).toEqual({ id: 1, result: analyzeStatementNavigation(source, dialect, mode) }); }
  for (const extra of [{ sql: 'DROP TABLE t' }, { uri: 'command:run' }, { dialect: 'other' }, { mode: 1 }]) { send({ id: 1, source, dialect: 'mysql', mode, ...extra }); expect(messages.at(-1)).toMatchObject({ id: 1, result: { status: 'blocked' } }); }
});
/** 可控传输和计时器只验证本轮握手、取消、替换及释放，分段结果由生产模块生成。 */
function fixture() {
  const workers: any[] = [], create = vi.fn(() => { const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null }; workers.push(worker); return worker; });
  const client = new StatementNavigationWorkerClient(create), abort = new AbortController();
  return { client, abort, workers, create, run: () => client.analyze(source, 'mysql', mode, abort.signal), ready: (index = 0, extra = {}) => workers[index].onmessage?.({ data: { type: 'dbark-statement-navigation-ready', version: 1, ...extra } }), reply: (result: unknown = analyzeStatementNavigation(source, 'mysql', mode), index = 0, extra = {}) => workers[index].onmessage?.({ data: { id: 1, result, ...extra } }) };
}
afterEach(() => vi.useRealTimers());
it('握手之前不发原文，回包后准确终止一次，销毁不再创建Worker', async () => { const f = fixture(), work = f.run(); expect(f.workers[0].postMessage).not.toHaveBeenCalled(); f.ready(); expect(f.workers[0].postMessage).toHaveBeenCalledExactlyOnceWith({ id: 1, source, dialect: 'mysql', mode }); f.reply(); expect(await work).toEqual(analyzeStatementNavigation(source, 'mysql', mode)); expect(f.workers[0].terminate).toHaveBeenCalledOnce(); f.client.dispose(); expect((await f.run()).status).toBe('blocked'); expect(f.create).toHaveBeenCalledOnce(); });
it.each(['startup', 'analysis', 'cancel', 'replace', 'envelope', 'ready-extra', 'result-extra', 'error'] as const)('%s只停止原请求并拒绝不完整目录', async action => {
  vi.useFakeTimers(); const f = fixture(), work = f.run();
  if (action === 'startup') await vi.advanceTimersByTimeAsync(8000); else if (action === 'cancel') f.abort.abort();
  else if (action === 'replace') { const next = f.run(); f.ready(1); f.reply(undefined, 1); expect((await next).status).toBe('ready'); }
  else if (action === 'ready-extra') f.ready(0, { source });
  else { f.ready(); if (action === 'analysis') await vi.advanceTimersByTimeAsync(2000); else if (action === 'error') f.workers[0].onmessageerror(); else if (action === 'envelope') f.reply(undefined, 0, { source }); else f.reply({ ...analyzeStatementNavigation(source, 'mysql', mode), source }); }
  expect((await work).status).toBe('blocked'); expect(f.workers[0].terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0); f.client.dispose();
});
