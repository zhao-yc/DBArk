import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve, join } from 'node:path';
import { tableForeignKeyJoinZh as text } from '../../src/renderer/locales/tableForeignKeyJoin.zh-CN';
import { navigationMenuItem } from './navigation-menu';

const enabled = process.env.DBARK_JOIN_ORDER_NATIVE === '1';
test.skip(!enabled, 'JOIN排序离线原生组件专项默认关闭，未执行');
test.describe.configure({ mode: 'serial', timeout: 120000, retries: 0 });
let server: Awaited<ReturnType<typeof createServer>>, address: string;
test.beforeAll(async () => {
  if (!enabled) return;
  const forbidden = Object.keys(process.env).filter(key => /^(?:DBARK_TEST_|MYSQL_|MARIADB_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length) throw Error('JOIN离线组件拒绝实库认证和模块注入；字段名：' + forbidden.join('、'));
  server = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' }); await server.listen(); const bound = server.httpServer!.address(); if (!bound || typeof bound === 'string') throw Error('JOIN夹具没有取得本地端口'); address = 'http://127.0.0.1:' + bound.port + '/tests/fixtures/join-order/index.html';
});
test.afterAll(async () => { await server?.close(); });
for (const theme of ['dark', 'light'] as const) test('JOIN真实菜单、双侧排序、上限及独立草稿：' + theme, async ({}, info) => {
  const directory = await mkdtemp(join(tmpdir(), 'dbark-join-order-native-')), app = await electron.launch({ args: ['tests/fixtures/join-order/electron.cjs'], env: { ...process.env, DBARK_JOIN_ORDER_FIXTURE_DATA: directory, DBARK_JOIN_ORDER_FIXTURE_URL: address + '?theme=' + theme }, chromiumSandbox: true });
  const taskProcess = app.process(), pid = taskProcess.pid, exit = new Promise<{ code: number | null; signal: string | null }>(resolve => taskProcess.once('exit', (code, signal) => resolve({ code, signal }))), page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', reason => errors.push(reason.message)); let accepted = false, closed = false;
  await info.attach('JOIN组件原窗口身份', { body: JSON.stringify({ pid, directory, theme }), contentType: 'application/json' });
  /** 全部动作仍属本例原进程、原窗口和原120秒零重试，不使用观察超时重开。 */
  function check(): void { if (info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || app.process() !== taskProcess || taskProcess.pid !== pid || closed || page.isClosed()) throw Error('JOIN原生组件原归属变化'); }
  async function step<T>(action: () => Promise<T>): Promise<T> { check(); const value = await action(); check(); return value; }
  const dialog = () => page.getByRole('dialog', { name: text.title, exact: true });
  const evidence = () => step(() => page.evaluate(() => (window as typeof window & { __joinOrderEvidence(): { calls: { command: string; input: Record<string, unknown> }[]; denied: string[]; tabs: { kind: string; sql?: string }[]; resultLimit: number; dirty: Record<string, boolean>; jobs: Record<string, unknown> } }).__joinOrderEvidence()));
  try {
    await step(() => expect(page.getByRole('grid', { name: '当前页数据网格', exact: true })).toBeVisible({ timeout: 30000 }));
    // Windows缩放会对原生客户区取整；按实际CSS视口校准本例唯一窗口，保留精确1024断言。
    const measured = await step(() => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })));
    const sizing: { width: number; height: number }[] = [], requested = { width: 1024, height: 680 };
    // 保留请求基准，避免把已经取整的getContentSize再次当作请求；只校准原窗口，最多四步。
    for (let index = 0; index < 4; index++) {
      const actual = await step(() => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))); sizing.push(actual); if (actual.width === 1024 && actual.height === 680) break;
      if (Math.abs(actual.width - 1024) > 32 || Math.abs(actual.height - 680) > 32) throw Error('JOIN原窗口尺寸无法确认'); requested.width += 1024 - actual.width; requested.height += 680 - actual.height;
      await step(() => app.evaluate(({ BrowserWindow }, requested) => { const windows = BrowserWindow.getAllWindows(); if (windows.length !== 1) throw Error('不是原唯一窗口'); windows[0].setContentSize(requested.width, requested.height); }, requested));
      await step(() => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
    }
    await info.attach('JOIN组件原尺寸请求', { body: JSON.stringify({ measured, sizing, originalRequest: { width: 1024, height: 680 } }), contentType: 'application/json' });
    await step(() => expect.poll(() => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))).toEqual({ width: 1024, height: 680 }));
    await info.attach('JOIN组件视口校准', { body: JSON.stringify({ measured, target: { width: 1024, height: 680 }, originalDpiPreserved: true }), contentType: 'application/json' });
    await step(async () => (await navigationMenuItem(page.locator('.table-tab'), { name: text.entry, exact: true }, check)).click()); await step(() => dialog().getByRole('button', { name: text.preview, exact: true }).click());
    await step(() => expect(dialog().getByLabel(text.preview, { exact: true })).toContainText('LIMIT 43;')); const before = await evidence();
    await step(() => dialog().getByRole('button', { name: text.sortAdd, exact: true }).click()); await step(() => dialog().getByLabel(text.sortSide(1), { exact: true }).selectOption('parent')); await step(() => dialog().getByLabel(text.sortDirection(1), { exact: true }).selectOption('DESC')); await step(() => dialog().getByLabel(text.sortNulls(1), { exact: true }).selectOption('LAST'));
    await step(() => dialog().getByRole('button', { name: text.sortAdd, exact: true }).click()); await step(() => dialog().getByRole('button', { name: text.sortEarlier(2), exact: true }).click()); await step(() => dialog().getByLabel(text.resultLimit, { exact: true }).fill(''));
    await step(() => expect(dialog().getByRole('button', { name: text.open, exact: true })).toBeDisabled()); await step(() => expect(dialog().getByRole('alert')).toContainText(text.limitInvalid)); await step(() => dialog().getByLabel(text.resultLimit, { exact: true }).fill('2'));
    const suffix = 'ORDER BY c.`id` ASC, (p.`id` IS NULL) ASC, p.`id` DESC\nLIMIT 2;'; await step(() => expect(dialog().getByLabel(text.preview, { exact: true })).toContainText(suffix)); const edited = await evidence(); expect(edited.calls.filter(call => call.command !== 'settings.save')).toEqual(before.calls.filter(call => call.command !== 'settings.save')); expect(edited.tabs).toEqual(before.tabs); expect(edited.resultLimit).toBe(43); expect(edited.dirty).toEqual(before.dirty);
    await step(() => dialog().getByLabel(text.sortTitle, { exact: true }).scrollIntoViewIfNeeded()); const layout = await step(() => dialog().getByLabel(text.sortTitle, { exact: true }).evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, viewport: window.innerWidth, theme: document.documentElement.dataset.theme }))); expect(layout.scroll).toBeLessThanOrEqual(layout.width); expect(layout.viewport).toBe(1024); expect(layout.theme).toBe(theme); await info.attach('JOIN排序原生窗口-' + theme, { body: await step(() => page.screenshot()), contentType: 'image/png' });
    await step(() => dialog().getByRole('button', { name: text.open, exact: true }).click()); await step(() => expect(page.getByLabel('本例独立查询SQL', { exact: true })).toContainText(suffix)); const final = await evidence(); expect(final.tabs).toHaveLength(2); expect(final.tabs.filter(tab => tab.kind === 'query')).toHaveLength(1); expect(final.resultLimit).toBe(43); expect(final.denied).toEqual([]); expect(final.dirty).toEqual(before.dirty); expect(final.jobs).toEqual(before.jobs); expect(Object.values(final.jobs).some(Boolean)).toBe(false); expect(final.calls.filter(call => call.command === 'metadata.table').map(call => call.input.table)).toEqual(['child', 'parent', 'child', 'parent']); expect(final.calls.some(call => /query\.|table\.(apply|preview)/.test(call.command))).toBe(false); expect(errors).toEqual([]);
    check(); await app.close(); closed = true; expect(await exit).toEqual({ code: 0, signal: null }); expect(taskProcess.killed).toBe(false); await info.attach('JOIN排序原生组件终态', { body: JSON.stringify({ pid, directory, theme, calls: final.calls, zeroDatabaseExecutions: true, zeroClipboardOperations: true, sourceDraftUnchanged: true, newQueryCount: 1, originalGlobalLimit: 43, normalExit: true, realDatabaseVerified: false }), contentType: 'application/json' }); accepted = true;
  } finally {
    // 失败原件保留；只请求原应用正常退出，不终止其它窗口或伪称完成清理。
    if (!closed && taskProcess.exitCode === null && taskProcess.signalCode === null) { await app.close(); closed = true; expect(await exit).toEqual({ code: 0, signal: null }); }
    await info.attach('JOIN组件原窗口收尾', { body: JSON.stringify({ pid, directory, accepted, exitCode: taskProcess.exitCode, signal: taskProcess.signalCode, forced: taskProcess.killed, directoryRetained: !accepted }), contentType: 'application/json' });
    if (accepted) { if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('dbark-join-order-native-')) throw Error('JOIN目录越界'); await rm(directory, { recursive: true }); }
  }
});
