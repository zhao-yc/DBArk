import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { binaryCellZh as text } from '../../src/renderer/locales/binaryCell.zh-CN';
let server: ViteDevServer, app: ElectronApplication, page: Page, directory: string, url: string;
const errors: string[] = [];
const viewer = () => page.getByRole('region', { name: text.title, exact: true });
test.beforeAll(async () => {
  // 沿用员工224a2fe的固定夹具策略，不依赖热更新，避免Windows目录监听阻塞启动。
  server = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
  await server.listen(); const address = server.httpServer!.address(); if (!address || typeof address === 'string') throw new Error('未取得离线端口'); url = `http://127.0.0.1:${address.port}/tests/fixtures/binary-cell/index.html`;
});
test.afterAll(async () => { await server?.close(); });
test.beforeEach(async () => {
  errors.length = 0; directory = await mkdtemp(join(tmpdir(), 'dbark-binary-e2e-'));
  const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, DBARK_BINARY_FIXTURE_DATA: directory, DBARK_BINARY_FIXTURE_URL: url }).filter((entry): entry is [string, string] => entry[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['tests/fixtures/binary-cell/electron.cjs'], env, chromiumSandbox: true }); page = await app.firstWindow(); page.on('pageerror', reason => errors.push(reason.message)); await expect(page.locator('.results-grid')).toBeVisible({ timeout: 30000 }); await expect(page.locator('.loading-overlay')).toHaveCount(0);
  // 仅旁观真实 Blob URL 的创建与撤销，不替代图像加载、格式判断或解码。
  await page.evaluate(() => { const active = new Set<string>(); Object.defineProperty(window, '__binaryUrls', { value: active }); const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL); URL.createObjectURL = value => { const url = create(value); active.add(url); return url; }; URL.revokeObjectURL = url => { active.delete(url); revoke(url); }; });
});
test.afterEach(async () => { await app?.close(); if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('dbark-binary-e2e-')) throw new Error('拒绝清理测试目录之外的路径'); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });
/** 坐标来自当前实际列头，支持大字段位于水平滚动区域外的情况。 */
async function cell(key: string) {
  const grid = page.locator('.results-grid'), header = page.getByRole('columnheader').filter({ hasText: new RegExp('^' + key) }).first();
  await grid.evaluate(node => { node.scrollLeft = 0; });
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    if (await header.count()) break;
    await grid.evaluate(node => { node.scrollLeft += node.clientWidth; });
  }
  const index = await header.getAttribute('aria-colindex'); return page.locator(`[role=row][aria-rowindex="2"] [role=gridcell][aria-colindex="${index}"]`);
}
async function open(key: string) { const target = await cell(key); await target.scrollIntoViewIfNeeded(); await target.click(); await page.getByRole('button', { name: '单元格', exact: true }).click(); await expect(viewer()).toBeVisible(); }
async function writes() { return page.evaluate(() => (window as unknown as { __binaryCalls: string[] }).__binaryCalls.filter(value => ['table.apply', 'table.preview', 'query.execute'].includes(value))); }
async function urls() { return page.evaluate(() => (window as unknown as { __binaryUrls: Set<string> }).__binaryUrls.size); }

test('Hex严格校验后只暂存原草稿，UTF8查看保真，NULL与空BLOB明确区分', async ({}, result) => {
  await (await cell('payload')).dblclick(); await expect(viewer()).toBeVisible(); await viewer().getByRole('button', { name: text.text, exact: true }).click(); await expect(viewer().getByRole('textbox', { name: text.textLabel, exact: true })).toHaveValue('中😀\x00');
  await viewer().getByRole('button', { name: text.hex, exact: true }).click(); const hex = viewer().getByRole('textbox'); await hex.fill('0x0'); await expect(viewer().getByRole('alert')).toContainText('成对'); await page.getByRole('button', { name: '暂存修改', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.locator('.row-modified')).toHaveCount(0);
  await hex.fill('0x00 ff 80'); await page.getByRole('button', { name: '暂存修改', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(await cell('payload')).toHaveText('0x00ff80'); expect(await writes()).toEqual([]);
  await open('nil'); await expect(viewer()).toContainText(text.null); await page.getByRole('button', { name: '关闭字段编辑', exact: true }).click(); await open('empty'); await expect(viewer()).toContainText(text.empty); await expect(viewer().getByRole('textbox')).toHaveValue('0x'); expect(errors).toEqual([]); await page.screenshot({ path: result.outputPath('NULL与空二进制.png') });
});

test('PNG JPEG WebP实际图片显示尺寸并释放Blob URL，脚本格式和巨大值不创建URL', async ({}, result) => {
  for (const format of ['png', 'jpeg', 'webp']) {
    if (format !== 'png') { await page.goto(url + '?format=' + format); }
    await open('picture'); await viewer().getByRole('button', { name: text.image, exact: true }).click(); await expect(viewer().getByRole('img')).toBeVisible(); await expect.poll(() => viewer().getByRole('img').evaluate((node: HTMLImageElement) => [node.naturalWidth, node.naturalHeight])).toEqual([2, 3]); await expect(viewer()).toContainText('2 × 3');
    if (format === 'png') { expect(await urls()).toBe(1); await viewer().getByRole('button', { name: text.hex, exact: true }).click(); await expect.poll(urls).toBe(0); await viewer().getByRole('button', { name: text.image, exact: true }).click(); await expect.poll(urls).toBe(1); await page.screenshot({ path: result.outputPath('PNG有界预览.png') }); }
    await page.getByRole('button', { name: '关闭字段编辑', exact: true }).click(); if (format === 'png') await expect.poll(urls).toBe(0);
  }
  await open('script'); await viewer().getByRole('button', { name: text.image, exact: true }).click(); await expect(viewer().getByRole('alert')).toContainText(text.imageUnsupported); await expect(viewer().getByRole('img')).toHaveCount(0); expect(await page.evaluate(() => (window as unknown as { __binaryExecuted?: boolean }).__binaryExecuted)).toBeUndefined(); await page.getByRole('button', { name: '关闭字段编辑', exact: true }).click();
  await open('large'); await expect(viewer()).toContainText(text.byteLimit); await expect(viewer().getByRole('textbox')).toHaveCount(0); expect(await writes()).toEqual([]); expect(errors).toEqual([]);
});

test('超编辑预算只能分页查看；结构变化使旧编辑失效并释放图像；任意SQL结果只读', async () => {
  await open('medium'); await expect(viewer()).toContainText('只读片段'); await expect(viewer().getByRole('textbox')).toHaveJSProperty('readOnly', true); await viewer().getByRole('button', { name: text.next, exact: true }).click(); await expect(viewer()).toContainText('4097'); await expect(page.getByRole('button', { name: '暂存修改', exact: true })).toBeDisabled(); await page.getByRole('button', { name: '关闭字段编辑', exact: true }).click();
  await open('picture'); await viewer().getByRole('button', { name: text.image, exact: true }).click(); await expect.poll(urls).toBe(1); await page.getByRole('button', { name: '夹具结构变化', exact: true }).evaluate((node: HTMLButtonElement) => node.click()); await expect(viewer()).toHaveCount(0); await expect.poll(urls).toBe(0); await page.getByRole('button', { name: '关闭字段编辑', exact: true }).click();
  await page.getByRole('button', { name: 'SQL只读结果', exact: true }).click(); await (await cell('payload')).dblclick(); await expect(viewer()).toContainText(text.readonly); await expect(viewer().getByRole('textbox')).toHaveJSProperty('readOnly', true); await expect(page.getByRole('button', { name: '暂存修改', exact: true })).toHaveCount(0); await page.getByRole('button', { name: '夹具结果刷新', exact: true }).evaluate((node: HTMLButtonElement) => node.click()); await expect(viewer()).toHaveCount(0); expect(await writes()).toEqual([]); expect(errors).toEqual([]);
});

test('连接版本变化使尚未暂存的Hex失效，原草稿不被迟到输入覆盖', async () => {
  await open('payload'); await viewer().getByRole('textbox').fill('0xff'); await page.getByRole('button', { name: '夹具连接变化', exact: true }).evaluate((node: HTMLButtonElement) => node.click());
  await expect(viewer()).toHaveCount(0); await expect(page.getByRole('button', { name: '暂存修改', exact: true })).toBeDisabled(); await expect(page.locator('.row-modified')).toHaveCount(0); expect(await writes()).toEqual([]); expect(errors).toEqual([]);
});

test('记录表单中的图片缓存同样随结构快照失效并释放', async () => {
  await (await cell('picture')).click(); await page.getByRole('button', { name: '记录表单', exact: true }).click();
  const form = page.getByRole('complementary', { name: '记录表单', exact: true }), field = form.getByRole('region', { name: 'picture', exact: true });
  await field.getByRole('button', { name: '编辑字段', exact: true }).click(); await viewer().getByRole('button', { name: text.image, exact: true }).click(); await expect.poll(urls).toBe(1);
  await page.getByRole('button', { name: '夹具结构变化', exact: true }).click(); await expect(viewer()).toHaveCount(0); await expect.poll(urls).toBe(0); expect(await writes()).toEqual([]); expect(errors).toEqual([]);
});

test('无前缀多一字节的Hex在最终暂存也拒绝并保留完整输入，合法上限可保真暂存', async () => {
  await open('payload'); const hex = viewer().getByRole('textbox'), oversized = 'ff'.repeat(131072);
  await hex.fill(oversized); await expect(viewer().getByRole('alert')).toContainText('完整 Hex 编辑');
  await page.getByRole('button', { name: '暂存修改', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible();
  await expect(hex).toHaveValue(oversized); await expect(page.getByRole('dialog').locator(':scope > .modal-content > .error-box')).toContainText('完整 Hex 编辑');
  await expect(page.locator('.row-modified')).toHaveCount(0); expect(await writes()).toEqual([]);
  const upper = '0x' + 'ab'.repeat(131071); await hex.fill(upper); await expect(viewer()).toContainText('Hex 校验通过：131071 字节');
  await page.getByRole('button', { name: '暂存修改', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await open('payload'); await expect(viewer().getByRole('textbox')).toHaveValue(upper); expect(await writes()).toEqual([]); expect(errors).toEqual([]);
});
