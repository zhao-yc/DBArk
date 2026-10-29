import { test, expect, desktop } from './desktop-fixture';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { Page } from '@playwright/test';
import { objectUri } from '../../src/shared/workbench';

/** 在本次 Electron 的额外沙箱窗口运行生产组件；只延迟核验回包，不访问数据库。 */
test('真实收藏与链接组件的倒序导航、关闭和卸载不复活旧请求', async ({}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'dbark-workbench-ui-')); let windowId: number | undefined;
  try {
    await build({ absWorkingDir: process.cwd(), entryPoints: ['tests/e2e/workbench-navigation.fixture.tsx'], outfile: join(directory, 'fixture.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'silent' });
    await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="UTF-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>');
    const nextWindow = desktop.waitForEvent('window');
    windowId = await desktop.evaluate(async ({ BrowserWindow }, file) => {
      const fixture = new BrowserWindow({ width: 1024, height: 720, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await fixture.loadFile(file); return fixture.id;
    }, join(directory, 'index.html'));
    const ui: Page = await nextWindow; const errors: string[] = []; ui.on('pageerror', error => errors.push(error.message));
    const shelf = ui.getByRole('region', { name: '对象收藏', exact: true });
    const production = shelf.getByRole('button', { name: /打开对象：users · 正式 \/ 生产环境 \[production\]/ });
    const testing = shelf.getByRole('button', { name: /打开对象：users · 开发 \/ 测试环境 \[testing\]/ });
    await expect(production).toContainText('生产环境'); await expect(testing).toContainText('测试环境');
    await expect(production.locator('.workbench-connection-color')).toHaveCSS('background-color', 'rgb(225, 75, 75)');
    await expect(testing.locator('.workbench-connection-color')).toHaveCSS('background-color', 'rgb(60, 157, 101)');
    await expect(production).toHaveAttribute('title', /\[production\].*"app"\."users"/);
    await ui.screenshot({ path: testInfo.outputPath('workbench-connection-identity.png') });
    await production.click(); await expect.poll(() => ui.evaluate(() => window.workbenchNavigationFixture.pending())).toEqual([1]);
    await (await (await import('./navigation-menu')).navigationMenuItem(ui, { name: '粘贴对象链接', exact: true })).click();
    let link = ui.getByRole('dialog', { name: '粘贴对象链接', exact: true });
    await link.getByLabel('DBArk 对象链接', { exact: true }).fill(objectUri({ connectionId: 'testing', database: 'app', kind: 'table', name: 'users' }));
    await (await (await import('./navigation-menu')).navigationMenuItem(link, { name: '打开链接', exact: true })).click();
    await expect.poll(() => ui.evaluate(() => window.workbenchNavigationFixture.pending())).toEqual([1, 2]);
    await ui.evaluate(() => window.workbenchNavigationFixture.finish(2)); await expect(link).toBeHidden();
    await expect(ui.getByLabel('当前连接', { exact: true })).toHaveText('testing');
    await ui.evaluate(() => window.workbenchNavigationFixture.finish(1));
    expect(await ui.evaluate(() => window.workbenchNavigationFixture.state())).toEqual({ connection: 'testing', tabs: ['testing'] });
    // 管理弹窗在导航等待期间可以关闭，迟到成功不能打开目标或重新关闭其它窗口。
    await (await (await import('./navigation-menu')).navigationMenuItem(ui, { name: '收藏与虚拟分组', exact: true })).click();
    const manager = ui.getByRole('dialog', { name: '收藏与虚拟分组', exact: true });
    await manager.getByRole('button', { name: '打开对象：users', exact: true }).first().click();
    await expect.poll(() => ui.evaluate(() => window.workbenchNavigationFixture.pending())).toEqual([3]);
    await (await (await import('./navigation-menu')).navigationMenuItem(manager, { name: '关闭对话框', exact: true })).click(); await expect(manager).toBeHidden();
    await ui.evaluate(() => window.workbenchNavigationFixture.finish(3));
    await expect(ui.getByLabel('当前连接', { exact: true })).toHaveText('testing');
    // URI 对话框关闭和单独卸载两条路径均通过所属信号废弃结果。
    for (const [index, unmount] of [false, true].entries()) {
      await (await (await import('./navigation-menu')).navigationMenuItem(ui, { name: '粘贴对象链接', exact: true })).click(); link = ui.getByRole('dialog', { name: '粘贴对象链接', exact: true });
      await link.getByLabel('DBArk 对象链接', { exact: true }).fill(objectUri({ connectionId: 'production', database: 'app', kind: 'procedure', name: 'users' }));
      await (await (await import('./navigation-menu')).navigationMenuItem(link, { name: '打开链接', exact: true })).click();
      await expect.poll(() => ui.evaluate(() => window.workbenchNavigationFixture.pending())).toEqual([4 + index]);
      if (unmount) await ui.evaluate(() => window.workbenchNavigationFixture.removeDialogs());
      else await (await (await import('./navigation-menu')).navigationMenuItem(link, { name: '取消', exact: true })).click();
      await expect(link).toBeHidden(); await ui.evaluate(id => window.workbenchNavigationFixture.finish(id), 4 + index);
      await expect(ui.getByLabel('当前定义', { exact: true })).toBeEmpty(); await expect(ui.getByLabel('当前连接', { exact: true })).toHaveText('testing');
    }
    await production.click(); await expect.poll(() => ui.evaluate(() => window.workbenchNavigationFixture.pending())).toEqual([6]);
    await ui.evaluate(() => window.workbenchNavigationFixture.unmount()); await ui.evaluate(() => window.workbenchNavigationFixture.finish(6));
    expect(await ui.evaluate(() => window.workbenchNavigationFixture.state())).toEqual({ connection: 'testing', tabs: ['testing'] }); expect(errors).toEqual([]);
  } finally {
    if (windowId !== undefined) await desktop.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), windowId);
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('dbark-workbench-ui-')) throw Error('拒绝清理协议夹具以外的目录');
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
