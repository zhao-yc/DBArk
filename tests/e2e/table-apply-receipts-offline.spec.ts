import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { zh } from '../../src/renderer/locales/zh-CN';

// 独立显式开关默认关闭；仅离线新用户目录，不读取实库.env或请求系统剪贴板。
test.skip(process.env.DBARK_TABLE_APPLY_RECEIPTS_UI !== '1', '需要ROOT独立分配原生GUI；本切片只收集列表');
test.use({ trace: 'off' });
let desktop: ElectronApplication | undefined, page: Page, directory: string;
test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dbark-receipt-ui-'));
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOME', 'DISPLAY', 'XDG_RUNTIME_DIR']) if (process.env[key]) env[key] = process.env[key]!;
  // 只在正式获准执行时解析本机Electron；列表收集不会解析或启动二进制。
  const require = createRequire(resolve('package.json'));
  desktop = await electron.launch({ executablePath: require('electron'), args: [resolve('dist/main/index.cjs')], env: { ...env, DBARK_USER_DATA: directory } });
  page = await desktop.firstWindow(); await expect(page.locator('.navigation-toolbar')).toBeVisible();
});
test.afterEach(async () => { try { await desktop?.close(); } finally { desktop = undefined; if (directory) await rm(directory, { recursive: true, force: true }); } });

test('离线任务中心可打开空提交记录及返回任务，页面明确隐私和范围', async () => {
  await (await (await import('./navigation-menu')).navigationMenuItem(page, { name: zh.common.taskCenter, exact: true })).click();
  await (await (await import('./navigation-menu')).navigationMenuItem(page, { name: '数据提交记录', exact: true })).click();
  const dialog = page.getByRole('dialog', { name: '数据提交记录', exact: true });
  await expect(dialog).toContainText('暂无提交记录'); await expect(dialog).toContainText('不保存SQL'); await expect(dialog).toContainText('不包含触发器');
  await (await (await import('./navigation-menu')).navigationMenuItem(dialog, { name: '返回任务', exact: true })).click(); await expect(page.getByRole('dialog', { name: zh.common.taskCenter, exact: true })).toBeVisible();
});

test('renderer不能借只读详情接口注入已提交标签，不产生任务或记录', async () => {
  const result = await page.evaluate(async () => {
    let rejected = false;
    try { await window.dbark.invoke('table.applyReceipt.detail', { operationId: crypto.randomUUID(), outcome: 'committed' } as any); } catch { rejected = true; }
    return { rejected, records: (await window.dbark.invoke('table.applyReceipt.list', {})).total, tasks: (await window.dbark.invoke('tasks.list', {})).length };
  });
  expect(result).toEqual({ rejected: true, records: 0, tasks: 0 });
});
