import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalReferencesWorkerClient } from '../../src/renderer/localReferencesWorkerClient';
import { analyzeSqliteLocalRename } from '../../src/shared/sqliteLocalRename';

const source = 'SELECT s.id FROM subject s';
/** 运行两个真实浏览器bundle，确认路由与SQLite产物没有引入MySQL解析器。 */
it.each(['mysql', 'sqlite'] as const)('%s实际Worker准备和编辑不带URI或数据库端口', dialect => {
  const build = buildSync({ entryPoints: [dialect === 'mysql' ? 'src/renderer/completion.worker.ts' : 'src/renderer/sqliteLocalReferences.worker.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022', logLevel: 'silent', metafile: true });
  if (dialect === 'sqlite') expect(Object.keys(build.metafile.inputs).some(name => name.includes('dt-sql-parser') || name.includes('completionAnalysis.ts'))).toBe(false);
  const messages: any[] = [], port: any = { postMessage: (value: unknown) => messages.push(structuredClone(value)) };
  runInNewContext(build.outputFiles[0].text, { self: port, console: { log() {}, warn() {}, error() { throw Error('不得回显正文'); } }, setTimeout, clearTimeout }, { timeout: 8000 });
  for (const [index, name] of [undefined, 'next'].entries()) {
    port.onmessage({ data: { id: index + 1, source, offset: 8, intent: 'rename', ...(name === undefined ? {} : { newName: name }), ...(dialect === 'mysql' ? { mode: {}, capabilities: {} } : {}) } });
    expect(messages.at(-1)).toMatchObject({ id: index + 1, result: { status: 'ready', kind: 'alias', name: 's', edits: name ? [{ text: dialect === 'mysql' ? '`next`' : '"next"' }, { text: dialect === 'mysql' ? '`next`' : '"next"' }] : [] } });
  }
});
/** 模拟消息端口及期限，结果仍由真实SQLite绑定分析产生。 */
function fixture() {
  const workers: any[] = [], create = vi.fn(() => { const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null }; workers.push(worker); return worker; });
  const client = new LocalReferencesWorkerClient(create, 'sqlite'), signal = new AbortController();
  return { client, create, workers, signal, run: () => client.rename(source, 8, {}, signal.signal, {}, 'next'), ready: (index = 0) => workers[index].onmessage({ data: { type: 'dbark-sqlite-local-references-ready', version: 1 } }), reply: (value: unknown = analyzeSqliteLocalRename(source, 8, 'next'), index = 0) => workers[index].onmessage?.({ data: { id: 1, result: value } }) };
}
afterEach(() => vi.useRealTimers());
it('握手后只发送固定本地rename请求，完成清理原线程', async () => {
  const f = fixture(), result = f.run(); expect(f.workers[0].postMessage).not.toHaveBeenCalled(); f.ready(); expect(f.workers[0].postMessage).toHaveBeenCalledWith({ id: 1, source, offset: 8, intent: 'rename', newName: 'next' }); f.reply(); expect(await result).toMatchObject({ status: 'ready' }); expect(f.workers[0].terminate).toHaveBeenCalledOnce(); f.client.dispose(); expect(f.workers[0].terminate).toHaveBeenCalledOnce();
});
it.each(['startup', 'analysis', 'cancel', 'replace', 'forged', 'error'] as const)('%s不交付半份修改并终止准确线程', async action => {
  vi.useFakeTimers(); const f = fixture(), result = f.run();
  if (action === 'startup') await vi.advanceTimersByTimeAsync(8000);
  else if (action === 'cancel') f.signal.abort();
  else if (action === 'replace') { const next = f.run(); f.ready(1); f.reply(analyzeSqliteLocalRename(source, 8, 'next'), 1); expect(await next).toMatchObject({ status: 'ready' }); }
  else { f.ready(); if (action === 'analysis') await vi.advanceTimersByTimeAsync(2000); else if (action === 'error') f.workers[0].onmessageerror(); else f.reply({ status: 'ready', edits: [], uri: 'file:///other' }); }
  expect(await result).toMatchObject({ status: 'blocked' }); expect(f.workers[0].terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0); f.client.dispose();
});
