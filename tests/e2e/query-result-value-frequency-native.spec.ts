import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { queryResultValueOptionsZh as text } from '../../src/renderer/locales/queryResultValueOptions.zh-CN';
import { queryResultFilterZh as filterText } from '../../src/renderer/locales/queryResultFilter.zh-CN';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list=')), active = !listing && process.env.DBARK_RESULT_FREQUENCY_NATIVE === '1';
test.skip(!active, '已返回结果次数排序原生组件专项默认关闭');
test.use({ trace: 'off', screenshot: 'off', video: 'off' }); test.describe.configure({ timeout: 120000, retries: 0 });
let server: Awaited<ReturnType<typeof createServer>>, address: string, environment: string;
/** 独立组件拒绝外部认证、模块注入及其它 renderer／配置，不提供真实驱动入口。 */
function assertEnvironment() {
  const forbidden = Object.keys(process.env).filter(key => /^(?:DBARK_TEST_|MYSQL_|MARIADB_|POSTGRES_|PG|SSH_AUTH_SOCK$|SSH_AGENT_PID$|DATABASE_URL$|NODE_PATH$|NODE_OPTIONS$|ELECTRON_RUN_AS_NODE$)/i.test(key) || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].includes(key));
  if (process.env.DBARK_RESULT_FREQUENCY_NATIVE !== '1' || process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length || !['win32', 'darwin'].includes(process.platform)) throw Error('结果次数排序组件环境无效；拒绝字段：' + forbidden.join('、'));
  for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('结果次数排序组件禁止自动trace');
  const current = JSON.stringify(Object.keys(process.env).filter(key => /^(DBARK_|NODE_|ELECTRON_)/i.test(key)).sort().map(key => [key, process.env[key]]));
  if (environment !== undefined && current !== environment) throw Error('原组件环境已变化'); return current;
}
test.beforeAll(async () => {
  if (!active) return;
  const before = JSON.parse(assertEnvironment()) as [string, string][];
  server = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' }); await server.listen();
  // Vite 只可在未指定 NODE_ENV 时初始化 development；窗口启动前冻结全部原环境，随后不再接纳变化。
  if (!before.some(([key]) => key === 'NODE_ENV')) before.push(['NODE_ENV', 'development']);
  const initialized = assertEnvironment(); if (JSON.stringify(before.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) !== initialized) throw Error('组件初始化发生非预期环境变更'); environment = initialized;
  const value = server.httpServer!.address(); if (!value || typeof value === 'string') throw Error('组件地址未知'); address = 'http://127.0.0.1:' + value.port;
});
test.afterAll(async () => { if (server) await server.close(); });

test('真实次数排序下拉跨页保留勾选，父条件分步应用，SQLite同显示类型及明暗主题', async ({}, info) => {
  const clock = bindEditorIndentNativeCase(info, { assertCurrent() { assertEnvironment(); if (info.config.workers !== 1 || info.retry !== 0 || info.repeatEachIndex !== 0) throw Error('组件须原单worker与零重试'); } }, () => test.info());
  const directory = await mkdtemp(join(tmpdir(), 'dbark-result-frequency-')), application = await electron.launch({ args: ['tests/fixtures/result-value-frequency/electron.cjs'], env: { ...process.env, DBARK_RESULT_FREQUENCY_FIXTURE_DATA: directory, DBARK_RESULT_FREQUENCY_FIXTURE_URL: address + '/tests/fixtures/result-value-frequency/index.html' }, chromiumSandbox: true });
  const original = application.process(), pid = original.pid, exit = new Promise(resolve => original.once('exit', (code, signal) => resolve({ code, signal }))), page = await application.firstWindow(), frame = page.mainFrame(), errors: string[] = []; page.on('pageerror', reason => errors.push(reason.message)); let closed = false, accepted = false;
  const check = () => { clock.assertCurrent(); if (application.process() !== original || page.mainFrame() !== frame || frame.isDetached() || closed || page.isClosed()) throw Error('原组件窗口身份已变化'); };
  const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); const value = await action(); check(); return value; };
  const evidence = () => step(() => page.evaluate(() => { const port = (window as Window & { __resultFrequencyEvidence?: () => { kind: string; indices: number[]; proposals: { kind: string; indices: number[] }[]; denied: string[]; sourceUnchanged: boolean } }).__resultFrequencyEvidence; if (!port) throw Error('原只读观察端口不存在'); return port(); }));
  const panel = page.getByRole('region', { name: filterText.title, exact: true }), picker = panel.getByRole('region', { name: text.title, exact: true });
  /** 宿主只打开父面板；值选择与外层应用均使用真实产品动作。 */
  const open = async () => { await step(() => page.getByRole('button', { name: filterText.open, exact: true }).click()); await step(() => panel.getByRole('button', { name: text.openCondition(1), exact: true }).click()); await step(() => expect(picker.getByRole('checkbox')).toHaveCount(50)); };
  const write = async () => { await step(() => picker.getByLabel(text.search, { exact: true }).focus()); await step(() => page.keyboard.press((process.platform === 'darwin' ? 'Meta' : 'Control') + '+Enter')); await step(() => expect(picker).toHaveCount(0)); await step(() => expect(panel).toBeVisible()); };
  await info.attach('结果次数排序原窗口归属', { body: JSON.stringify({ pid, directory }), contentType: 'application/json' });
  try {
    await step(() => expect(page.getByRole('heading', { name: '已返回结果次数排序', exact: true })).toBeVisible());
    expect((await evidence()).indices).toEqual([0]); await open(); await step(() => picker.getByRole('button', { name: text.next, exact: true }).click()); await step(() => expect(picker.getByRole('checkbox')).toHaveCount(10));
    await step(() => picker.getByLabel(text.value('hot'), { exact: true }).check()); await step(() => picker.getByLabel(text.order, { exact: true }).selectOption('count-desc')); await step(() => expect(picker.getByRole('checkbox').first()).toHaveAttribute('aria-label', text.value('hot'))); await step(() => expect(picker.getByLabel(text.value('hot'), { exact: true })).toBeChecked()); await step(() => expect(picker).toContainText(text.occurrences(100)));
    await step(() => picker.getByLabel(text.order, { exact: true }).selectOption('count-asc')); await step(() => expect(picker.getByRole('checkbox').first()).toHaveAttribute('aria-label', text.value('rare0'))); await step(() => picker.getByLabel(text.order, { exact: true }).selectOption('count-desc'));
    await step(() => picker.getByLabel(text.search, { exact: true }).fill('warm')); await step(() => picker.getByRole('button', { name: text.selectMatches, exact: true }).click()); await step(() => picker.getByLabel(text.search, { exact: true }).fill('')); await step(() => expect(picker).toContainText(text.counts(168, 60, 60, 2))); expect((await evidence()).proposals).toEqual([]); expect((await evidence()).indices).toEqual([0]);
    await info.attach('结果次数排序深色', { body: await step(() => picker.screenshot()), contentType: 'image/png' }); await write(); expect((await evidence()).proposals).toEqual([]); expect((await evidence()).indices).toEqual([0]); await step(() => panel.getByRole('button', { name: filterText.apply, exact: true }).click()); await step(() => expect(panel).toHaveCount(0)); expect((await evidence()).indices).toEqual(Array.from({ length: 109 }, (_, i) => i + 55)); expect((await evidence()).sourceUnchanged).toBe(true);
    await step(() => page.getByRole('button', { name: '切换主题', exact: true }).click()); await step(() => page.getByLabel('测试结果来源', { exact: true }).selectOption('sqlite')); expect((await evidence()).indices).toEqual([0]); await open(); await step(() => picker.getByLabel(text.order, { exact: true }).selectOption('count-desc')); await step(() => expect(picker.getByRole('checkbox').nth(2)).toHaveAttribute('aria-label', text.sqliteValue('2', 'text')));
    await step(() => picker.getByLabel(text.search, { exact: true }).fill('REAL')); await step(() => picker.getByLabel(text.order, { exact: true }).selectOption('count-asc')); await step(() => expect(picker.getByRole('checkbox')).toHaveCount(1)); await step(() => picker.getByLabel(text.sqliteValue('2', 'real'), { exact: true }).check()); await info.attach('结果次数排序浅色SQLite', { body: await step(() => picker.screenshot()), contentType: 'image/png' }); await write(); expect((await evidence()).indices).toEqual([0]); await step(() => panel.getByRole('button', { name: filterText.apply, exact: true }).click()); await step(() => expect(panel).toHaveCount(0));
    const final = await evidence(); expect(final.indices).toEqual([170]); expect(final.proposals.map(value => value.kind)).toEqual(['mysql', 'sqlite']); expect(final.denied).toEqual([]); expect(final.sourceUnchanged).toBe(true); expect(errors).toEqual([]); await info.attach('结果次数排序组件终态', { body: JSON.stringify(final), contentType: 'application/json' }); check(); await application.close(); closed = true; expect(await exit).toEqual({ code: 0, signal: null }); expect(original.killed).toBe(false); accepted = true;
  } finally {
    if (!closed && original.exitCode === null && original.signalCode === null) { await application.close(); closed = true; expect(await exit).toEqual({ code: 0, signal: null }); }
    await info.attach('结果次数排序原窗口收尾', { body: JSON.stringify({ pid, directory, accepted, exitCode: original.exitCode, signal: original.signalCode, forced: original.killed, directoryRetained: !accepted }), contentType: 'application/json' });
    if (accepted) { if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('dbark-result-frequency-')) throw Error('独占目录越界'); await rm(directory, { recursive: true }); }
  }
});
