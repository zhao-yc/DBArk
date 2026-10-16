import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { tableGridZh as text } from '../../src/renderer/locales/tableGrid.zh-CN';
import { installPageFindLateWorkerGate, type PageFindGateMode, type PageFindGateSummary, type PageFindLateWorkerGate } from '../helpers/pageFindLateWorkerGate';

interface DraftSignals { dirtyMarks: number; transitions: number; dirty: boolean; }
type ProbeWindow = typeof window & { __d06LateWorker: PageFindLateWorkerGate; __d06Drafts: { snapshot(): DraftSignals; dispose(): void }; __pageFindCalls: string[] };
let server: ViteDevServer | undefined, app: ElectronApplication | undefined, page: Page, directory: string | undefined, url: string;
const errors: string[] = [], before = '😀old前old后old', after = '😀NEW前old后old';
const panel = () => page.getByRole('region', { name: text.find, exact: true });

/** 快照仅包含线程时序摘要，不暴露或重写Worker的原响应对象。 */
async function workers() { return page.evaluate(() => (window as ProbeWindow).__d06LateWorker.snapshot()); }
async function signals() { return page.evaluate(() => (window as ProbeWindow).__d06Drafts.snapshot()); }
/** 只旁观真实Zustand状态通知；不替换setRows、setDirty、React hooks或最终应用函数。 */
async function observeDraftSignals() {
  await page.evaluate(async () => {
    const modulePath = '/src/renderer/store.ts', { useWorkspace } = await import(modulePath);
    const state: DraftSignals = { dirtyMarks: 0, transitions: 0, dirty: !!useWorkspace.getState().dirtyTabs['offline-table'] };
    const dispose = useWorkspace.subscribe((current: { dirtyTabs: Record<string, boolean> }, previous: { dirtyTabs: Record<string, boolean> }) => {
      const dirty = !!current.dirtyTabs['offline-table'];
      if (current.dirtyTabs !== previous.dirtyTabs && dirty) state.dirtyMarks++;
      if (dirty && !state.dirty) state.transitions++;
      state.dirty = dirty;
    });
    (window as ProbeWindow).__d06Drafts = { snapshot: () => ({ ...state }), dispose };
  });
}
/** 沿用原离线TableTab夹具的可见列坐标，选择回退通过实际网格点击产生。 */
async function cell(key = 'note', row = 2) {
  const header = page.getByRole('columnheader').filter({ hasText: key }).first();
  await expect(header).toBeVisible(); const index = await header.getAttribute('aria-colindex'); if (!index) throw Error('缺少当前实际列坐标');
  return page.locator(`[role=row][aria-rowindex="${row}"] [role=gridcell][aria-colindex="${index}"]`);
}
/** 完成实际查找并定位第一处；后面的Enter始终来自真实替换输入框。 */
async function prepareCurrent() {
  await page.getByRole('button', { name: text.find, exact: true }).click();
  await panel().getByRole('combobox', { name: text.column, exact: true }).selectOption('note');
  await panel().getByRole('textbox', { name: text.query, exact: true }).fill('old'); await expect(panel().getByRole('status')).toContainText('0 / 3 处');
  await panel().getByRole('button', { name: text.next, exact: true }).click(); await expect(panel().locator('.page-find-current')).toContainText('格内第 1 处');
  await panel().getByRole('textbox', { name: text.replacement, exact: true }).fill('NEW'); await expect(await cell()).toHaveText(before);
}
/** 等到真实Worker已经算出原计划，再让UI产生其它意图；不靠超时碰运气阻止写稿。 */
async function holdPreview(mode: PageFindGateMode): Promise<PageFindGateSummary> {
  await page.evaluate(mode => (window as ProbeWindow).__d06LateWorker.arm(mode), mode);
  await panel().getByRole('textbox', { name: text.replacement, exact: true }).press('Enter');
  await expect.poll(async () => (await workers()).find(worker => worker.mode === mode)?.received).toBe(true);
  if (mode === 'termination') await expect.poll(async () => (await workers()).find(worker => worker.mode === mode)?.nativeTerminated).toBe(true);
  const held = (await workers()).find(worker => worker.mode === mode)!;
  expect(held).toMatchObject({ operation: 'preview', status: 'ready', after, delivered: mode === 'termination', acknowledged: false });
  await expect(panel().getByRole('button', { name: text.cancelSearch, exact: true })).toBeVisible(); await unchanged(); return held;
}
/** 零次脏标记及转换覆盖瞬时写稿；最终网格和值域核对避免只用最终文本推断。 */
async function unchanged() {
  expect(await signals()).toEqual({ dirtyMarks: 0, transitions: 0, dirty: false }); await expect(page.locator('.row-modified')).toHaveCount(0);
  await expect(await cell()).toHaveText(before); await expect(await cell('id')).toHaveText('9007199254740993123'); await expect(await cell('other')).toHaveText('OLD'); await expect(page.locator('.grid-input')).toHaveCount(0);
}
/** 新明确命令仍由原面板、真实React和新原生Worker生成草稿，不因取消永久锁死。 */
async function recover() {
  await panel().getByRole('textbox', { name: text.replacement, exact: true }).press('Enter'); await expect(await cell()).toHaveText(after);
  await expect(panel().getByRole('status')).toContainText('1 / 2 处'); await expect(page.locator('.row-modified')).toHaveCount(1);
  const state = await signals(); expect(state.dirtyMarks).toBeGreaterThan(0); expect(state.transitions).toBe(1); expect(state.dirty).toBe(true);
  await expect.poll(async () => (await workers()).every(worker => worker.nativeTerminated && worker.acknowledged)).toBe(true);
}
/** 允许原生消息和React提交完成，使用帧边界而非扩大产品运行期限。 */
async function frames() { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }

test.describe('D06真实React与Worker迟到预览回归准备', () => {
  test.skip(process.env.DBARK_D06_LATE_PREVIEW_UI !== '1', '仅由ROOT安排原生组件窗口，默认不启动Electron或Vite');
  test.beforeAll(async () => {
    if (process.env.DBARK_INTEGRATION_ENABLED === '1' || process.env.DBARK_TEST_HOST || process.env.DBARK_TEST_PORT) throw Error('D06迟到组件用例必须与200及实库环境隔离');
    server = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' }); await server.listen();
    const address = server.httpServer!.address(); if (!address || typeof address === 'string') throw Error('未取得离线夹具端口'); url = `http://127.0.0.1:${address.port}/tests/fixtures/page-find-replace/index.html`;
  });
  test.afterAll(async () => { await server?.close(); });
  test.beforeEach(async () => {
    errors.length = 0; app = undefined; directory = await mkdtemp(join(tmpdir(), 'dbark-late-find-e2e-'));
    const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, DBARK_FIND_FIXTURE_URL: url, DBARK_FIND_FIXTURE_DATA: directory }).filter((entry): entry is [string, string] => entry[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: ['tests/fixtures/page-find-replace/electron.cjs'], env, chromiumSandbox: true }); page = await app.firstWindow(); page.on('pageerror', reason => errors.push(reason.message));
    await expect(page.getByRole('button', { name: text.find, exact: true })).toBeEnabled({ timeout: 30000 }); await page.evaluate(installPageFindLateWorkerGate); await observeDraftSignals();
  });
  test.afterEach(async ({}, result) => {
    try {
      if (app && page && !page.isClosed()) {
        // 不制造清理时的迟到写稿：先经真实工具栏卸载面板，再释放测试侧的确认门。
        try {
          if (await panel().count()) await page.getByRole('button', { name: text.find, exact: true }).click();
          const evidence = { 测试: result.title, 状态: result.status, 草稿: await signals(), 线程: await workers(), 页面错误: errors, 禁止命令: await page.evaluate(() => (window as ProbeWindow).__pageFindCalls.filter(command => ['table.preview', 'table.apply', 'query.execute'].includes(command))) };
          await result.attach('D06迟到真实控制链摘要', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' }); expect(evidence.禁止命令).toEqual([]); expect(errors).toEqual([]);
        } finally { await page.evaluate(() => { (window as Partial<ProbeWindow>).__d06Drafts?.dispose(); (window as Partial<ProbeWindow>).__d06LateWorker?.restore(); }); }
      }
    } finally {
      try { await app?.close(); } finally {
        if (directory) { if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('dbark-late-find-e2e-')) throw Error('拒绝清理本例目录之外的路径'); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); directory = undefined; }
      }
    }
  });

  for (const [id, kind] of [['01', '替换文字ABA'], ['02', 'IME开始结束'], ['03', '网格行列选择ABA'], ['04', '导航下一处再回退']] as const) {
    test(`D06-LATE-PREVIEW-UI-${id}：${kind}撤销已计算的旧计划，新明确命令可恢复`, async () => {
      await prepareCurrent(); const held = await holdPreview('termination'), replacement = panel().getByRole('textbox', { name: text.replacement, exact: true });
      if (kind === '替换文字ABA') { await replacement.fill('其它'); await replacement.fill('NEW'); }
      else if (kind === 'IME开始结束') { await replacement.dispatchEvent('compositionstart', { data: '', bubbles: true, composed: true }); await replacement.dispatchEvent('compositionend', { data: '', bubbles: true, composed: true }); await expect(replacement).toHaveValue('NEW'); }
      else if (kind === '网格行列选择ABA') { const other = await cell('other', 3), original = await cell(); await other.click(); await expect(other).toBeFocused(); await expect(other).toHaveAttribute('aria-selected', 'true'); await original.click(); await expect(original).toBeFocused(); await expect(original).toHaveAttribute('aria-selected', 'true'); await expect(other).toHaveAttribute('aria-selected', 'false'); await replacement.focus(); }
      else { const query = panel().getByRole('textbox', { name: text.query, exact: true }); await query.press('Enter'); await expect(panel().locator('.page-find-current')).toContainText('格内第 2 处'); await query.press('Shift+Enter'); await expect(panel().locator('.page-find-current')).toContainText('格内第 1 处'); }
      await page.evaluate(id => (window as ProbeWindow).__d06LateWorker.acknowledge(id), held.id); await expect(panel().getByRole('button', { name: text.cancelSearch, exact: true })).toHaveCount(0); await frames(); await unchanged();
      if (kind === '网格行列选择ABA') await expect(panel().getByRole('alert')).toContainText(text.changed);
      await recover();
    });
  }
  for (const [id, mode] of [['05', 'response'], ['06', 'termination']] as const) {
    test(`D06-LATE-PREVIEW-UI-${id}：显式取消${mode === 'response' ? '原响应后到' : '终止确认未定'}不落稿，恢复仍可替换`, async () => {
      await prepareCurrent(); const held = await holdPreview(mode); await panel().getByRole('button', { name: text.cancelSearch, exact: true }).click();
      if (mode === 'response') { await expect(panel().getByRole('alert')).toContainText(text.cancelled); await page.evaluate(id => (window as ProbeWindow).__d06LateWorker.releaseResponse(id), held.id); }
      else { await expect(panel().getByRole('button', { name: text.cancelSearch, exact: true })).toBeVisible(); await unchanged(); await page.evaluate(id => (window as ProbeWindow).__d06LateWorker.acknowledge(id), held.id); }
      await expect(panel().getByRole('alert')).toContainText(text.cancelled); await frames(); await unchanged(); await recover();
    });
  }
  test('D06-LATE-PREVIEW-UI-07：真实非法正则错误不能当作未命中或成功，确认后原错误可见且能恢复', async () => {
    await prepareCurrent(); await panel().getByRole('checkbox', { name: text.regex, exact: true }).check(); await panel().getByRole('textbox', { name: text.query, exact: true }).fill('[');
    await page.evaluate(() => (window as ProbeWindow).__d06LateWorker.arm('termination', 'find')); await panel().getByRole('button', { name: text.search, exact: true }).click();
    await expect.poll(async () => (await workers()).find(worker => worker.mode === 'termination')?.nativeTerminated).toBe(true); const held = (await workers()).find(worker => worker.mode === 'termination')!;
    expect(held).toMatchObject({ operation: 'find', received: true, delivered: true, status: 'blocked', reason: 'invalid', acknowledged: false }); await expect(panel().getByRole('button', { name: text.cancelSearch, exact: true })).toBeVisible(); await unchanged();
    await page.evaluate(id => (window as ProbeWindow).__d06LateWorker.acknowledge(id), held.id); await expect(panel().getByRole('alert')).toContainText(text.regexInvalid); await unchanged();
    await panel().getByRole('textbox', { name: text.query, exact: true }).fill('old'); await panel().getByRole('button', { name: text.search, exact: true }).click(); await expect(panel().getByRole('status')).toContainText('0 / 3 处'); await panel().getByRole('button', { name: text.next, exact: true }).click(); await recover();
  });
});
