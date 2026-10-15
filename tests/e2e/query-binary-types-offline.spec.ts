import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

// 当前只交付离线准备；统筹明确分配GUI资源后才允许启动独立开发Electron。
test.skip(process.env.DBARK_QUERY_BINARY_NATIVE_ENABLED !== '1', '默认不启动GUI，需统筹分配原生验收资源');
let server: ViteDevServer, app: ElectronApplication, page: Page, directory: string, url: string;
const errors: string[] = [];
test.beforeAll(async () => {
  server = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], cacheDir: resolve('.cache/query-binary-types-vite'), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' }); await server.listen();
  const address = server.httpServer!.address(); if (!address || typeof address === 'string') throw Error('未取得离线端口'); url = `http://127.0.0.1:${address.port}/tests/fixtures/query-binary-types/index.html`;
});
test.afterAll(async () => { await server?.close(); });
test.beforeEach(async () => {
  errors.length = 0; directory = await mkdtemp(join(tmpdir(), 'dbark-query-binary-types-'));
  const env = Object.fromEntries(Object.entries({ ...process.env, DBARK_BINARY_FIXTURE_DATA: directory, DBARK_BINARY_FIXTURE_URL: url }).filter((entry): entry is [string, string] => entry[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE;
  // 复用仅负责窗口及临时目录的离线启动器，不加载产品主进程或数据库。
  app = await electron.launch({ args: ['tests/fixtures/binary-cell/electron.cjs'], env, chromiumSandbox: true }); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await expect(page.locator('.results-grid')).toBeVisible({ timeout: 30000 });
});
test.afterEach(async () => {
  await app?.close(); if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('dbark-query-binary-types-')) throw Error('拒绝清理离线临时目录以外的路径'); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); expect(errors).toEqual([]);
});
/** 实际列头坐标包含选择列；重复显示名称不作为取值键。 */
async function cell(position: number) {
  const header = page.getByRole('columnheader').nth(position + 1), index = await header.getAttribute('aria-colindex'); if (!index) throw Error('未取得实际列坐标'); return page.locator(`[role=row][aria-rowindex="2"] [role=gridcell][aria-colindex="${index}"]`);
}
test('wire BLOB中的TEXT LONGTEXT及NULL双击和Enter均不打开字节查看器', async () => {
  for (const position of [0, 2, 4]) { const target = await cell(position); await target.dblclick(); await expect(page.getByRole('dialog')).toHaveCount(0); await target.press('Enter'); await expect(page.getByRole('dialog')).toHaveCount(0); }
  await expect(await cell(0)).toHaveText('TEXT正文'); await expect(await cell(2)).toHaveText('NULL');
});
test('真实字节及空字节保留双击Enter与只读守卫，重复别名标题按name值按key', async () => {
  await (await cell(1)).dblclick(); const modal = page.getByRole('dialog', { name: '二进制单元格：重复别名', exact: true }); await expect(modal).toBeVisible(); await expect(modal.getByRole('textbox')).toHaveValue('0x00ff80'); await expect(modal.getByRole('textbox')).toHaveJSProperty('readOnly', true); await expect(modal.getByRole('button', { name: /暂存/ })).toHaveCount(0); await modal.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await (await cell(3)).press('Enter'); const empty = page.getByRole('dialog', { name: '二进制单元格：空字节', exact: true }); await expect(empty).toContainText('0 字节'); await expect(empty.getByRole('textbox')).toHaveValue(''); await expect(empty.getByRole('textbox')).toHaveJSProperty('readOnly', true); await expect(empty.getByRole('button', { name: /暂存/ })).toHaveCount(0);
});
