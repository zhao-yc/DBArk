import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { tableGridZh as text } from '../../src/renderer/locales/tableGrid.zh-CN';

let server: ViteDevServer, app: ElectronApplication, page: Page, directory: string, url: string;
const errors: string[] = [];
const panel = () => page.getByRole('region', { name: text.find, exact: true });
const preview = () => page.getByRole('dialog', { name: text.replaceTitle, exact: true });
test.beforeAll(async () => {
  server = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen(); const address = server.httpServer!.address();
  if (!address || typeof address === 'string') throw new Error('未取得离线测试端口');
  url = `http://127.0.0.1:${address.port}/tests/fixtures/page-find-replace/index.html`;
});
test.afterAll(async () => { await server?.close(); });
test.beforeEach(async () => {
  errors.length = 0; directory = await mkdtemp(join(tmpdir(), 'dbark-find-e2e-'));
  const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, DBARK_FIND_FIXTURE_URL: url, DBARK_FIND_FIXTURE_DATA: directory }).filter((entry): entry is [string, string] => entry[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['tests/fixtures/page-find-replace/electron.cjs'], env, chromiumSandbox: true });
  page = await app.firstWindow(); page.on('pageerror', reason => errors.push(reason.message));
  await expect(page.getByRole('button', { name: text.find, exact: true })).toBeEnabled({ timeout: 30000 });
});
test.afterEach(async () => {
  await app?.close();
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('dbark-find-e2e-')) throw new Error('拒绝清理夹具目录之外的路径');
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
/** 所有查找选项来自实际输入控件；没有直接调用扫描函数或伪造 Worker 响应。 */
async function find(query: string, regex = false) {
  if (!await panel().isVisible()) await page.getByRole('button', { name: text.find, exact: true }).click();
  await panel().getByRole('combobox', { name: text.column, exact: true }).selectOption('note');
  await panel().getByRole('checkbox', { name: text.regex, exact: true }).setChecked(regex);
  await panel().getByRole('textbox', { name: text.query, exact: true }).fill(query);
  if (regex) await panel().getByRole('button', { name: text.search, exact: true }).click();
}
/** 读取网格的真实可见单元格，只通过 UI 修改草稿。 */
async function cell(key = 'note', row = 2) {
  const header = page.getByRole('columnheader').filter({ hasText: key }).first();
  const index = await header.getAttribute('aria-colindex');
  return page.locator(`[role=row][aria-rowindex="${row}"] [role=gridcell][aria-colindex="${index}"]`);
}
async function calls() { return page.evaluate(() => (window as unknown as { __pageFindCalls: string[] }).__pageFindCalls.filter(value => ['table.preview', 'table.apply', 'query.execute'].includes(value))); }

test('最小窗口同格逐处导航、单处替换及整批预览仅形成草稿', async ({}, result) => {
  await find('old'); await expect(panel().getByRole('status')).toContainText('0 / 3 处');
  await panel().getByRole('button', { name: text.next, exact: true }).click(); await panel().getByRole('button', { name: text.next, exact: true }).click();
  await expect(panel().locator('.page-find-current')).toContainText('第 1 行 · 列 note · 格内第 2 处 · UTF-16 位置 7');
  await expect(panel().locator('mark')).toHaveText('old'); await panel().getByRole('textbox', { name: text.replacement, exact: true }).fill('$1/$&');
  await panel().getByRole('button', { name: text.replaceOne, exact: true }).click(); await expect(await cell()).toHaveText('😀old前$1/$&后old');
  await expect(panel().getByRole('status')).toContainText('0 / 2 处'); await panel().getByRole('button', { name: text.previous, exact: true }).click(); await expect(panel().locator('.page-find-current')).toContainText('格内第 2 处');
  await panel().getByRole('button', { name: text.preview, exact: true }).click(); await expect(preview()).toBeVisible();
  await preview().getByRole('button', { name: text.apply, exact: true }).click(); await expect(await cell()).toHaveText('😀$1/$&前$1/$&后$1/$&');
  expect(await calls()).toEqual([]); expect(errors).toEqual([]); await page.screenshot({ path: result.outputPath('最小窗口单处与整批草稿.png') });
});

test('真实Worker正则支持Unicode零宽、整格与字面美元符号，非法语法可恢复', async () => {
  await find('(?=old)', true); await expect(panel().getByRole('status')).toContainText('0 / 3 处');
  await panel().getByRole('button', { name: text.next, exact: true }).click(); await expect(panel().locator('mark')).toHaveText(text.zeroWidth);
  await panel().getByRole('textbox', { name: text.replacement, exact: true }).fill('$1'); await panel().getByRole('button', { name: text.replaceOne, exact: true }).click(); await expect(await cell()).toHaveText('😀$1old前old后old');
  await find('[', true); await expect(panel().getByRole('alert')).toContainText(text.regexInvalid);
  await find('😀.*old', true); await panel().getByRole('checkbox', { name: text.whole, exact: true }).check(); await panel().getByRole('button', { name: text.search, exact: true }).click(); await expect(panel().getByRole('status')).toContainText('0 / 1 处');
  expect(await calls()).toEqual([]); expect(errors).toEqual([]);
});

test('外部结构变化撤销旧预览，可靠键缺失仍可查找', async () => {
  await find('old'); await expect(panel().getByRole('status')).toContainText('0 / 3 处'); await panel().getByRole('textbox', { name: text.replacement, exact: true }).fill('新');
  await panel().getByRole('button', { name: text.preview, exact: true }).click(); await expect(preview()).toBeVisible();
  await page.evaluate(() => (document.querySelector('button') as HTMLButtonElement).click()); await expect(preview()).toHaveCount(0); await expect(panel().getByRole('button', { name: text.preview, exact: true })).toBeDisabled();
  await page.goto(url + '?readonly'); await find('old'); await expect(panel().getByRole('status')).toContainText('0 / 3 处'); await expect(panel().getByRole('button', { name: text.preview, exact: true })).toBeDisabled();
  await panel().getByRole('button', { name: text.next, exact: true }).click(); await expect(panel().getByRole('button', { name: text.replaceOne, exact: true })).toBeDisabled();
  expect(await calls()).toEqual([]); expect(errors).toEqual([]);
});

test('翻页、排序、筛选、编辑及连接变化均取消正在执行的旧页查找', async () => {
  test.setTimeout(90000);
  const mutations: [string, () => Promise<unknown>][] = [
    ['翻页', () => page.getByRole('button', { name: '下一页', exact: true }).click()],
    ['排序', () => page.getByRole('columnheader').filter({ hasText: 'id' }).first().click()],
    ['筛选', async () => { await panel().getByRole('button', { name: text.filter, exact: true }).click(); await page.getByRole('combobox', { name: '条件匹配方式', exact: true }).selectOption('any'); }],
    ['编辑', async () => { await (await cell('other')).dblclick(); const input = page.getByRole('textbox', { name: '编辑 other', exact: true }); await input.fill('页面已编辑'); await input.press('Enter'); }],
    ['连接', () => page.getByRole('button', { name: '夹具连接变化', exact: true }).click()],
  ];
  for (const [name, mutate] of mutations) {
    await page.goto(url + '?malicious');
    await page.evaluate(() => {
      const stats = { sent: 0, terminated: 0 }; Object.defineProperty(window, '__findWorkerStats', { value: stats });
      const Original = Worker; window.Worker = class extends Original { postMessage(value: unknown) { stats.sent++; super.postMessage(value); } terminate() { super.terminate(); stats.terminated++; } };
    });
    const stats = () => page.evaluate(() => (window as unknown as { __findWorkerStats: { sent: number; terminated: number } }).__findWorkerStats);
    await find('^(a+)+$', true); await expect.poll(async () => (await stats()).sent, { message: name + '前应实际开始匹配' }).toBe(1);
    await mutate(); await expect.poll(async () => (await stats()).terminated, { message: name + '必须终止旧线程' }).toBe(1);
    await expect(panel().getByRole('button', { name: text.preview, exact: true })).toBeDisabled();
    expect(await calls()).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test('恶意回溯可超时或取消，编辑及关闭查找会终止旧线程并允许正常恢复', async ({}, result) => {
  await page.goto(url + '?malicious');
  // 仅旁观真实 Web Worker 的创建、发送与终止，不替代扫描或返回结果。
  await page.evaluate(() => {
    const stats = { created: 0, sent: 0, terminated: 0 }; Object.defineProperty(window, '__findWorkerStats', { value: stats });
    const Original = Worker; window.Worker = class extends Original { constructor(...args: ConstructorParameters<typeof Worker>) { super(...args); stats.created++; } postMessage(value: unknown) { stats.sent++; super.postMessage(value); } terminate() { super.terminate(); stats.terminated++; } };
  });
  const stats = () => page.evaluate(() => (window as unknown as { __findWorkerStats: { created: number; sent: number; terminated: number } }).__findWorkerStats);
  await find('^(a+)+$', true); await expect(panel().getByRole('alert')).toContainText(text.timeout); expect((await stats()).terminated).toBe((await stats()).created);
  await panel().getByRole('button', { name: text.search, exact: true }).click(); await expect.poll(async () => (await stats()).sent).toBe(2); await panel().getByRole('button', { name: text.cancelSearch, exact: true }).click(); await expect(panel().getByRole('alert')).toContainText(text.cancelled); expect((await stats()).terminated).toBe(2);
  await panel().getByRole('button', { name: text.search, exact: true }).click(); await expect.poll(async () => (await stats()).sent).toBe(3); await panel().getByRole('textbox', { name: text.query, exact: true }).fill('!'); await expect.poll(async () => (await stats()).terminated).toBe(3);
  await panel().getByRole('button', { name: text.search, exact: true }).click(); await expect(panel().getByRole('status')).toContainText('0 / 1 处');
  await panel().getByRole('textbox', { name: text.query, exact: true }).fill('^(a+)+$'); await panel().getByRole('button', { name: text.search, exact: true }).click(); await expect.poll(async () => (await stats()).sent).toBe(5); await page.getByRole('button', { name: text.find, exact: true }).click(); await expect.poll(async () => (await stats()).terminated).toBe(5);
  expect(await calls()).toEqual([]); expect(errors).toEqual([]); await page.screenshot({ path: result.outputPath('恶意回溯取消并关闭面板.png') });
});
