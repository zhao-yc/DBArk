import { test, expect } from '@playwright/test';
import { tableStatisticsZh as text } from '../../src/renderer/locales/tableStatistics.zh-CN';
import { tableHistogramZh as histogramText } from '../../src/renderer/locales/tableHistogram.zh-CN';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_TABLE_HISTOGRAM_NATIVE === '1';
test.skip(!enabled, '默认关闭：数值分布离线原生组件，仅独占合成统计');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ mode: 'serial', timeout: 120000, retries: 0 });
let server: Awaited<ReturnType<typeof import('vite')['createServer']>>, address: string;
test.beforeAll(async () => {
  if (!enabled) return;
  const forbidden = Object.keys(process.env).filter(key => /^DBARK_(?:TEST_|C02_|SSH_|MTLS_)/i.test(key) || /^DBARK_.*(?:PASSWORD|PASSPHRASE|PRIVATE_KEY|CREDENTIAL|DATABASE_URL)$/i.test(key) || /^(?:MYSQL_|MARIADB_|POSTGRES_|PG|SSH_AUTH_SOCK$|SSH_AGENT_PID$|DATABASE_URL$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].includes(key));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length || !['win32', 'darwin'].includes(process.platform)) throw Error('数值分布组件拒绝实库认证／用户配置；字段：' + forbidden.join(','));
  for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('数值分布组件专项禁止自动trace');
  const { createServer } = await import('vite'), react = (await import('@vitejs/plugin-react')).default;
  server = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' }); await server.listen();
  const bound = server.httpServer!.address(); if (!bound || typeof bound === 'string') throw Error('未取得本例回环端口'); address = 'http://127.0.0.1:' + bound.port + '/tests/fixtures/table-histogram/index.html';
});
test.afterAll(async () => { await server?.close(); });
interface Evidence { calls: { command: string; input: Record<string, unknown> }[]; denied: string[]; tabs: unknown[]; dirty: Record<string, boolean>; jobs: Record<string, boolean>; waitingRead: boolean; waitingCancel: boolean; }
type FixtureWindow = Window & { __histogramEvidence(): Evidence; __histogramControl: { hold(): void; reply(): void; ack(): void } };

for (const theme of ['dark', 'light']) test('正式表页菜单、精确分布、浮点、NULL及取消双终态：' + theme, async ({}, info) => {
  const { _electron } = await import('@playwright/test'), { mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os'), { join, dirname, resolve, basename } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'dbark-histogram-native-'));
  const application = await _electron.launch({ args: ['tests/fixtures/table-histogram/electron.cjs'], env: { ...process.env, DBARK_HISTOGRAM_FIXTURE_DATA: directory, DBARK_HISTOGRAM_FIXTURE_URL: address + '?theme=' + theme }, chromiumSandbox: true });
  const processHandle = application.process(), pid = processHandle.pid, page = await application.firstWindow(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let closed = false, accepted = false; const exit = new Promise<number | null>(done => processHandle.once('exit', code => done(code)));
  /** 所有步骤核准确窗口与原120秒门槛，不因观察超时重启或强退。 */
  function check() { if (closed || page.isClosed() || info.timeout !== 120000 || info.retry !== 0 || info.config.workers !== 1 || application.process() !== processHandle) throw Error('分布原生组件归属或期限变化'); }
  async function step<T>(action: () => Promise<T>): Promise<T> { check(); const result = await action(); check(); return result; }
  const evidence = () => step(() => page.evaluate(() => (window as unknown as FixtureWindow).__histogramEvidence()));
  const operations = (evidence: Evidence) => evidence.calls.filter(call => call.command !== 'settings.save');
  const modal = page.getByRole('dialog', { name: text.title, exact: true });
  await info.attach('数值分布原生owner', { body: JSON.stringify({ directory, pid, theme, platform: process.platform }), contentType: 'application/json' });
  try {
    const { navigationMenuItem } = await import('./navigation-menu');
    await step(() => expect(page.getByRole('grid')).toBeVisible({ timeout: 30000 })); const before = await evidence();
    await step(async () => (await navigationMenuItem(page.locator('.table-tab'), { name: text.title, exact: true }, check)).click()); await step(() => expect(modal).toBeVisible()); expect(operations(await evidence())).toEqual(operations(before));
    await step(() => modal.getByLabel(histogramText.column, { exact: true }).selectOption('金额<script>')); await step(() => modal.getByLabel(histogramText.bins, { exact: true }).selectOption('5')); expect(operations(await evidence())).toEqual(operations(before));
    await step(() => modal.getByRole('button', { name: text.start, exact: true }).click()); await step(() => expect(modal).toContainText(histogramText.actual(5, 5))); await step(() => expect(modal.locator('.table-histogram tbody tr')).toHaveCount(5));
    await step(() => expect(modal.locator('.table-histogram')).toContainText('0.000000000000000000000000000001')); await step(() => expect(modal.locator('.table-histogram')).toContainText('999400')); await step(() => expect(modal.locator('.table-histogram tbody tr').nth(1).locator('td').first()).toHaveText('0')); await step(() => expect(modal.locator('script')).toHaveCount(0));
    await step(() => modal.locator('.table-histogram').scrollIntoViewIfNeeded()); await info.attach('数值分布-' + theme, { body: await step(() => page.screenshot()), contentType: 'image/png' });
    const initial = await evidence(); await step(() => modal.getByLabel(histogramText.bins, { exact: true }).selectOption('10')); await step(() => expect(modal.locator('.table-histogram')).toHaveCount(0)); expect(operations(await evidence())).toEqual(operations(initial));
    await step(() => modal.getByRole('button', { name: text.start, exact: true }).click()); await step(() => expect(modal).toContainText(histogramText.actual(6, 10)));
    await step(() => modal.getByLabel(histogramText.column, { exact: true }).selectOption('floating')); await step(() => modal.getByLabel(histogramText.bins, { exact: true }).selectOption('5')); await step(() => modal.getByRole('button', { name: text.start, exact: true }).click()); await step(() => expect(modal.locator('.table-histogram')).toContainText(histogramText.approximate));
    await step(() => modal.getByLabel(histogramText.column, { exact: true }).selectOption('all_null')); await step(() => modal.getByRole('button', { name: text.start, exact: true }).click()); await step(() => expect(modal.locator('.table-histogram')).toContainText(histogramText.empty)); await step(() => expect(modal.locator('.table-histogram table')).toHaveCount(0));
    await step(() => modal.locator('.modal-footer').getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(modal).toHaveCount(0));
    await step(async () => (await navigationMenuItem(page.locator('.table-tab'), { name: text.title, exact: true }, check)).click()); await step(() => modal.getByLabel(histogramText.column, { exact: true }).selectOption('金额<script>')); await step(() => modal.getByLabel(histogramText.bins, { exact: true }).selectOption('5'));
    await step(() => page.evaluate(() => (window as unknown as FixtureWindow).__histogramControl.hold())); await step(() => modal.getByRole('button', { name: text.start, exact: true }).click()); await step(() => expect.poll(async () => (await evidence()).waitingRead).toBe(true));
    await step(() => modal.locator('.modal-footer').getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect.poll(async () => (await evidence()).waitingCancel).toBe(true));
    await step(() => page.evaluate(() => (window as unknown as FixtureWindow).__histogramControl.reply())); await step(() => expect(modal).toBeVisible()); expect(Object.values((await evidence()).jobs)).toContain(true); await step(() => expect(modal.locator('.modal-footer').getByRole('button', { name: text.close, exact: true })).toBeDisabled());
    await step(() => page.evaluate(() => (window as unknown as FixtureWindow).__histogramControl.ack())); await step(() => expect(modal).toHaveCount(0));
    const after = await evidence(), statistics = after.calls.filter(call => call.command === 'table.statistics'); expect(statistics).toHaveLength(5); expect(new Set(statistics.map(call => call.input.taskId)).size).toBe(5); expect(statistics.every(call => Array.isArray(call.input.columns) && call.input.columns.length === 0)).toBe(true);
    expect(after.denied).toEqual([]); expect(after.tabs).toEqual(before.tabs); expect(after.dirty).toEqual(before.dirty); expect(Object.values(after.jobs).every(value => value === false)).toBe(true); expect(errors).toEqual([]);
    const ids = await step(() => application.evaluate(({ app }) => app.getAppMetrics().map(value => value.pid))), closing = application.waitForEvent('close', { timeout: 12000 }); await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); }); await closing; closed = true; expect(await exit).toBe(0);
    await expect.poll(() => [...new Set([pid!, ...ids])].filter(id => { try { process.kill(id, 0); return true; } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ESRCH') return false; throw reason; } }), { timeout: 5000 }).toEqual([]);
    await info.attach('数值分布原生原件', { body: JSON.stringify({ directory, pid, theme, platform: process.platform, before, after, originalExitCode: processHandle.exitCode, normalExit: true, clipboard: 0, realDatabase: false, realMain: false, syntheticService: true }), contentType: 'application/json' }); accepted = true;
  } finally {
    if (accepted && closed) { if (resolve(directory) !== directory || dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('dbark-histogram-native-')) throw Error('数值分布成功清理路径越界'); await rm(directory, { recursive: true, force: false }); }
    else console.error('数值分布组件未完成原正常退出，保留所属目录：' + directory);
  }
});
