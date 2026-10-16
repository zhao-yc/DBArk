import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { tableGridZh as text } from '../../src/renderer/locales/tableGrid.zh-CN';
import { installNativeFindMessageGate, type NativeFindMessageGate, type NativeFindMessageSummary } from '../helpers/pageFindNativeMessageGate';

interface DraftSignals { dirtyMarks: number; transitions: number; dirty: boolean; }
type ProbeWindow = typeof window & { __d06NativeMessages: NativeFindMessageGate; __d06NativeDrafts: { snapshot(): DraftSignals; dispose(): void }; __pageFindCalls: string[] };
let server: ViteDevServer | undefined, app: ElectronApplication | undefined, page: Page, directory: string | undefined, url: string;
const errors: string[] = [], before = '😀old前old后old';
const panel = () => page.getByRole('region', { name: text.find, exact: true });
const replacement = () => panel().getByRole('textbox', { name: text.replacement, exact: true });
const query = () => panel().getByRole('textbox', { name: text.query, exact: true });
/** 固定夹具第一处替换的独立文本预期，不用它生成Worker回包。 */
const expectedAfter = (value = 'NEW') => '😀' + value + '前old后old';

/** 只读旁观真实store通知，不替换React、setDirty、setRows或写稿处理器。 */
async function observeDrafts() {
  await page.evaluate(async () => {
    const modulePath = '/src/renderer/store.ts', { useWorkspace } = await import(modulePath);
    const state: DraftSignals = { dirtyMarks: 0, transitions: 0, dirty: !!useWorkspace.getState().dirtyTabs['offline-table'] };
    const dispose = useWorkspace.subscribe((current: { dirtyTabs: Record<string, boolean> }, previous: { dirtyTabs: Record<string, boolean> }) => {
      const dirty = !!current.dirtyTabs['offline-table']; if (current.dirtyTabs !== previous.dirtyTabs && dirty) state.dirtyMarks++; if (dirty && !state.dirty) state.transitions++; state.dirty = dirty;
    });
    (window as ProbeWindow).__d06NativeDrafts = { snapshot: () => ({ ...state }), dispose };
  });
}
/** 只读原消息时序副本。 */
async function workers() { return page.evaluate(() => (window as ProbeWindow).__d06NativeMessages.snapshot()); }
/** 只读真实store通知计数。 */
async function signals() { return page.evaluate(() => (window as ProbeWindow).__d06NativeDrafts.snapshot()); }
/** 通过原夹具真实网格的ARIA坐标定位，不从生产状态读取或回写草稿。 */
async function cell(key = 'note', row = 2) {
  const header = page.getByRole('columnheader').filter({ hasText: key }).first(); await expect(header).toBeVisible(); const column = await header.getAttribute('aria-colindex'); if (!column) throw Error('缺少真实可见列坐标');
  return page.locator(`[role=row][aria-rowindex="${row}"] [role=gridcell][aria-colindex="${column}"]`);
}
/** 首屏实际查找第一处，默认捕获开关必须关闭。 */
async function prepareCurrent() {
  await page.getByRole('button', { name: text.find, exact: true }).click(); await panel().getByRole('combobox', { name: text.column, exact: true }).selectOption('note'); await query().fill('old'); await expect(panel().getByRole('status')).toContainText('0 / 3 处');
  await panel().getByRole('button', { name: text.next, exact: true }).click(); await expect(panel().locator('.page-find-current')).toContainText('格内第 1 处'); await replacement().fill('NEW'); await expect(panel().getByRole('checkbox', { name: text.captureReplacement, exact: true })).not.toBeChecked(); await unchanged();
}
/** 真实脏通知捕获瞬时变化；不把通知数量当作setRows精确调用次数。 */
async function unchanged() {
  expect(await signals()).toEqual({ dirtyMarks: 0, transitions: 0, dirty: false }); await expect(page.locator('.row-modified')).toHaveCount(0); await expect(page.locator('.grid-input')).toHaveCount(0);
  await expect(await cell()).toHaveText(before); await expect(await cell('id')).toHaveText('9007199254740993123'); await expect(await cell('other')).toHaveText('OLD'); await expect(await cell('binary')).toHaveText('0x6f6c64'); await expect(await cell('nil')).toHaveText('NULL');
}
/** 必须由实际Worker计算并产生原MessageEvent，门里不制造或重算任何match/plan。 */
async function heldResponse(operation: 'find' | 'preview'): Promise<NativeFindMessageSummary> {
  await expect.poll(async () => (await workers()).filter(worker => worker.held && !worker.delivered).at(-1)?.received).toBe(true);
  const state = (await workers()).filter(worker => worker.held && !worker.delivered).at(-1)!; expect(state.operation).toBe(operation); expect(state.nativeTerminated, '意图变化前不能已因超时结束').toBe(false); return state;
}
async function holdPreview(value = 'NEW') {
  await page.evaluate(() => (window as ProbeWindow).__d06NativeMessages.arm()); await replacement().press('Enter'); const held = await heldResponse('preview'); expect(held).toMatchObject({ status: 'ready', after: expectedAfter(value), captureReplacement: false }); return held;
}
/** 1秒是本新用例的证据窗口，早于原1.5秒运行期限，不能用产品超时充当意图撤销通过。 */
function promptWitness(state: NativeFindMessageSummary, point: 'terminatedAt' | 'deliveredAt') {
  expect(state.sentAt).toBeDefined(); expect(state[point]).toBeDefined(); expect(state[point]! - state.sentAt!, '本例证据窗口过长，不能排除运行超时').toBeLessThan(1000);
}
/** 先验证真实终止/未终止条件，再交付缓存的原生事件；不合成终止确认Promise。 */
async function releaseOriginal(held: NativeFindMessageSummary, cancelled: boolean) {
  if (cancelled) { await expect.poll(async () => (await workers())[held.id].nativeTerminated).toBe(true); promptWitness((await workers())[held.id], 'terminatedAt'); }
  else expect((await workers())[held.id].nativeTerminated).toBe(false);
  await page.evaluate(id => (window as ProbeWindow).__d06NativeMessages.release(id), held.id);
  if (!cancelled) promptWitness((await workers())[held.id], 'deliveredAt');
  await expect.poll(async () => (await workers())[held.id].nativeTerminated).toBe(true); expect((await workers())[held.id].terminateCalls).toBe(1);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
/** 仍从真实输入发出新明确命令，原生Worker正常计算后才允许形成草稿。 */
async function recover(value = 'NEW') {
  await expect(replacement()).toHaveValue(value); await replacement().press('Enter'); await expect(await cell()).toHaveText(expectedAfter(value)); await expect(panel().getByRole('status')).toContainText('1 / 2 处'); await expect(page.locator('.row-modified')).toHaveCount(1);
  expect((await signals()).dirtyMarks).toBeGreaterThan(0); expect((await signals()).transitions).toBe(1); await expect.poll(async () => (await workers()).every(worker => worker.nativeTerminated)).toBe(true);
}
/** 正则查找必须经实际输入和显式按钮发起，不直接调用生产扫描函数。 */
async function realSearch(value: string) { await query().fill(value); await panel().getByRole('button', { name: text.search, exact: true }).click(); }

test.describe('D06仅延迟真实原消息的原生组件回归准备', () => {
  test.skip(process.env.DBARK_D06_NATIVE_LATE_UI !== '1', '由ROOT独占执行，默认不启动Electron或Vite');
  test.beforeAll(async () => {
    if (process.env.DBARK_INTEGRATION_ENABLED === '1' || process.env.DBARK_TEST_HOST || process.env.DBARK_TEST_PORT) throw Error('迟到原消息用例须与200/实库环境隔离');
    server = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' }); await server.listen(); const address = server.httpServer!.address(); if (!address || typeof address === 'string') throw Error('未取得原离线夹具端口'); url = `http://127.0.0.1:${address.port}/tests/fixtures/page-find-replace/index.html`;
  });
  test.afterAll(async () => { await server?.close(); });
  test.beforeEach(async () => {
    errors.length = 0; app = undefined; directory = await mkdtemp(join(tmpdir(), 'dbark-native-late-e2e-')); const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, DBARK_FIND_FIXTURE_URL: url, DBARK_FIND_FIXTURE_DATA: directory }).filter((entry): entry is [string, string] => entry[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: ['tests/fixtures/page-find-replace/electron.cjs'], env, chromiumSandbox: true }); page = await app.firstWindow(); page.on('pageerror', reason => errors.push(reason.message)); await expect(page.getByRole('button', { name: text.find, exact: true })).toBeEnabled({ timeout: 30000 }); await page.evaluate(installNativeFindMessageGate); await observeDrafts();
  });
  test.afterEach(async ({}, result) => {
    try {
      if (app && page && !page.isClosed()) try {
        if (await panel().count()) await page.getByRole('button', { name: text.find, exact: true }).click();
        const evidence = { 测试: result.title, 状态: result.status, 草稿: await signals(), 原消息与实际终止: await workers(), 页面错误: errors, 禁止命令: await page.evaluate(() => (window as ProbeWindow).__pageFindCalls.filter(command => ['table.preview', 'table.apply', 'query.execute'].includes(command))) };
        await result.attach('D06原消息迟到控制链摘要', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' }); expect(evidence.禁止命令).toEqual([]); expect(errors).toEqual([]);
      } finally { await page.evaluate(() => { (window as Partial<ProbeWindow>).__d06NativeDrafts?.dispose(); (window as Partial<ProbeWindow>).__d06NativeMessages?.restore(); }); }
    } finally { try { await app?.close(); } finally { if (directory) { if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('dbark-native-late-e2e-')) throw Error('拒绝清理本例目录以外的路径'); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); directory = undefined; } } }
  });

  for (const [id, kind] of [['01', '输入ABA'], ['02', '组合开始结束'], ['03', '网格行列选择ABA'], ['04', '导航回退']] as const) {
    test(`D06-NATIVE-LATE-UI-${id}：${kind}后真实旧计划零次改变草稿，新命令有效`, async () => {
      await prepareCurrent(); const held = await holdPreview();
      if (kind === '输入ABA') { await replacement().fill('其它'); await replacement().fill('NEW'); }
      else if (kind === '组合开始结束') { await replacement().dispatchEvent('compositionstart', { bubbles: true, composed: true, data: '' }); await replacement().dispatchEvent('compositionend', { bubbles: true, composed: true, data: '' }); }
      else if (kind === '网格行列选择ABA') { const other = await cell('other', 3), original = await cell(); await other.click(); await expect(other).toHaveAttribute('aria-selected', 'true'); await original.click(); await expect(original).toHaveAttribute('aria-selected', 'true'); await expect(other).toHaveAttribute('aria-selected', 'false'); await replacement().focus(); }
      else { await query().press('Enter'); await expect(panel().locator('.page-find-current')).toContainText('格内第 2 处'); await query().press('Shift+Enter'); await expect(panel().locator('.page-find-current')).toContainText('格内第 1 处'); }
      await releaseOriginal(held, kind !== '网格行列选择ABA'); await unchanged(); if (kind === '网格行列选择ABA') await expect(panel().getByRole('alert')).toContainText(text.changed); await recover();
    });
  }
  test('D06-NATIVE-LATE-UI-05：真实翻页代次使旧原值计划失效，不能覆盖新页同值数据', async () => {
    await prepareCurrent(); const held = await holdPreview(), pages = await page.evaluate(() => (window as ProbeWindow).__pageFindCalls.filter(command => command === 'table.page').length); await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as ProbeWindow).__pageFindCalls.filter(command => command === 'table.page').length)).toBe(pages + 1); await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeEnabled(); await expect(panel().getByRole('status')).toContainText('0 / 3 处');
    await releaseOriginal(held, true); await unchanged(); await panel().getByRole('button', { name: text.next, exact: true }).click(); await recover(); const latest = (await workers()).filter(worker => worker.operation === 'preview').at(-1)!; expect(latest.generation).toBeGreaterThan(held.generation!);
  });
  test('D06-NATIVE-LATE-UI-06：大小写正则保持实际匹配，默认捕获关闭仍按美元字面替换', async () => {
    await prepareCurrent(); await panel().getByRole('checkbox', { name: text.regex, exact: true }).check(); await panel().getByRole('combobox', { name: text.column, exact: true }).selectOption(''); await realSearch('(?<词>old)'); await expect(panel().getByRole('status')).toContainText('0 / 5 处');
    await panel().getByRole('checkbox', { name: text.case, exact: true }).check(); await panel().getByRole('button', { name: text.search, exact: true }).click(); await expect(panel().getByRole('status')).toContainText('0 / 4 处'); await panel().getByRole('checkbox', { name: text.case, exact: true }).uncheck(); await panel().getByRole('combobox', { name: text.column, exact: true }).selectOption('note'); await panel().getByRole('button', { name: text.search, exact: true }).click(); await expect(panel().getByRole('status')).toContainText('0 / 3 处');
    await expect(panel().getByRole('checkbox', { name: text.captureReplacement, exact: true })).not.toBeChecked(); await panel().getByRole('button', { name: text.next, exact: true }).click(); const literal = '$1/$&/$$/$<词>'; await replacement().fill(literal); const held = await holdPreview(literal); expect(held).toMatchObject({ regex: true, caseSensitive: false, captureReplacement: false }); expect((await workers()).some(worker => worker.regex && worker.caseSensitive)).toBe(true);
    await replacement().fill('其它'); await replacement().fill(literal); await releaseOriginal(held, true); await unchanged(); await recover(literal); await expect(await cell('other')).toHaveText('OLD');
  });
  test('D06-NATIVE-LATE-UI-07：明确取消后原响应迟到，取消原文保留且新命令可恢复', async () => {
    await prepareCurrent(); const held = await holdPreview(); await panel().getByRole('button', { name: text.cancelSearch, exact: true }).click(); await expect(panel().getByRole('alert')).toContainText(text.cancelled); await releaseOriginal(held, true); await expect(panel().getByRole('alert')).toContainText(text.cancelled); await unchanged(); await recover();
  });
  test('D06-NATIVE-LATE-UI-08：真实错误照常显示，随后迟到旧错误不能覆盖新查询与恢复', async () => {
    await prepareCurrent(); await panel().getByRole('checkbox', { name: text.regex, exact: true }).check(); await query().fill('['); await page.evaluate(() => (window as ProbeWindow).__d06NativeMessages.arm('find')); await panel().getByRole('button', { name: text.search, exact: true }).click(); const first = await heldResponse('find'); expect(first).toMatchObject({ status: 'blocked', reason: 'invalid' }); await unchanged(); await releaseOriginal(first, false); await expect(panel().getByRole('alert')).toContainText(text.regexInvalid);
    await realSearch('old'); await expect(panel().getByRole('status')).toContainText('0 / 3 处'); await query().fill('['); await page.evaluate(() => (window as ProbeWindow).__d06NativeMessages.arm('find')); await panel().getByRole('button', { name: text.search, exact: true }).click(); const stale = await heldResponse('find'); expect(stale).toMatchObject({ status: 'blocked', reason: 'invalid' });
    await realSearch('old'); await expect(panel().getByRole('status')).toContainText('0 / 3 处'); await releaseOriginal(stale, true); await expect(panel().getByRole('alert')).toHaveCount(0); await unchanged(); await panel().getByRole('button', { name: text.next, exact: true }).click(); await recover();
  });
});
