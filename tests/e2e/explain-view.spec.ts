import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, desktop, dataDir } from './desktop-fixture';
import { createExplainNativeDiagnostics, explainDiagnosticPort } from './snippets-native-diagnostics';
import { explainDiagnosticTitle } from '../helpers/snippetsNativeDiagnostics';

/** 独立沙箱窗口渲染真实组件和样式；这里验证交互，不模拟实库结果通过。 */
test(explainDiagnosticTitle, async ({ trace }, testInfo) => {
  const diagnostic = createExplainNativeDiagnostics(trace, testInfo);
  const bundle = join(dataDir, 'explain-view.js'), html = join(dataDir, 'explain-view.html');
  await build({ entryPoints: ['tests/e2e/explain-view.fixture.tsx'], outfile: bundle, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' } });
  await writeFile(html, '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'self\' \'unsafe-inline\'; script-src \'self\';"><link rel="stylesheet" href="explain-view.css"><title>执行计划离线交互验收</title><body><div id="root" style="height:100vh;width:100vw;overflow:auto"></div><script src="explain-view.js"></script></body></html>');
  const opening = desktop.waitForEvent('window');
  const windowId = await desktop.evaluate(async ({ BrowserWindow }, path) => {
    // 本例验证真实键盘、滚动和截图；使用实际可见窗口，避免隐藏窗口合成调度阻塞取图。
    const window = new BrowserWindow({ width: 1024, height: 680, show: true, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
    await window.loadFile(path); window.focus(); return window.id;
  }, html);
  const view = await opening, errors: string[] = []; view.on('pageerror', error => errors.push(error.message));
  let failed = false;
  try {
    await diagnostic?.start(explainDiagnosticPort(desktop, view, windowId), 'initial');
    await expect(view.getByRole('tree', { name: '树形计划' })).toBeVisible();
    const root = view.getByRole('treeitem').first(); await root.focus();
    await root.press('ArrowRight'); await expect(view.getByRole('treeitem').nth(1)).toBeFocused();
    await view.keyboard.press('End'); await expect(view.getByRole('treeitem').last()).toBeFocused();
    await view.keyboard.press('Home'); await expect(root).toBeFocused();
    await root.press('ArrowLeft'); await expect(view.getByRole('treeitem')).toHaveCount(1); await root.press('ArrowRight');
    await expect(view.getByRole('treeitem')).not.toHaveCount(1);
    await root.locator('.explain-node-title > span').click(); await expect(view.getByRole('treeitem')).toHaveCount(1);
    await root.locator('.explain-node-title > span').click(); await expect(view.getByRole('treeitem')).not.toHaveCount(1);
    await view.getByRole('treeitem').filter({ hasText: 'future_operation' }).click();
    await expect(view.getByLabel('节点详情')).toContainText('future_operation');
    await view.getByRole('button', { name: '原始输出', exact: true }).click(); await expect(view.getByRole('tree')).toHaveCount(0);
    await expect(view.getByLabel('原始输出', { exact: true })).toContainText('future_operation');
    diagnostic?.mark('before-plan-table');
    await view.getByRole('button', { name: '计划结果表格', exact: true }).click(); await expect(view.getByRole('grid')).toBeVisible();
    diagnostic?.mark('after-plan-table');
    expect(await view.evaluate(() => (window as unknown as { explainFixture: { textRequests: number } }).explainFixture.textRequests)).toBe(0);
    await view.getByRole('button', { name: '获取文本计划', exact: true }).click();
    expect(await view.evaluate(() => (window as unknown as { explainFixture: { textRequests: number } }).explainFixture.textRequests)).toBe(1);

    await view.evaluate(() => (window as unknown as { explainFixture: { render(kind: string): void } }).explainFixture.render('maria'));
    const customer = view.getByRole('treeitem').filter({ hasText: '表访问 · customer' }); await customer.click();
    await expect(customer).toHaveAttribute('aria-selected', 'true');
    await expect(view.getByLabel('节点详情')).toContainText('table_name'); await expect(view.getByLabel('节点详情')).toContainText('不可用');
    await view.screenshot({ path: testInfo.outputPath('explain-minimum-maria.png') });
    // 模拟最小工作台扣除侧栏和编辑器后剩余的实际结果区域。
    await view.evaluate(() => { const root = document.getElementById('root')!; root.style.width = '720px'; root.style.height = '230px'; });
    await expect(view.getByRole('button', { name: '获取文本计划', exact: true })).toBeVisible();
    await customer.press('ArrowUp'); await view.keyboard.press('ArrowDown'); await expect(customer).toBeFocused();
    expect(await view.locator('.explain-tree-pane').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await view.screenshot({ path: testInfo.outputPath('explain-minimum-result-pane.png') });
    await view.evaluate(() => (window as unknown as { explainFixture: { render(kind: string): void } }).explainFixture.render('long'));
    await view.getByRole('treeitem').filter({ hasText: 'constructor' }).click(); await expect(view.getByLabel('节点详情')).toContainText('详情展示已截断');
    const overflow = await view.evaluate(() => document.documentElement.scrollWidth > innerWidth); expect(overflow).toBe(false);
    await view.getByRole('button', { name: '原始输出', exact: true }).click(); await expect(view.getByLabel('原始输出', { exact: true })).toContainText('中文长条件');
    await view.screenshot({ path: testInfo.outputPath('explain-minimum-long.png') });
    await view.evaluate(() => (window as unknown as { explainFixture: { render(kind: string): void } }).explainFixture.render('invalid'));
    await expect(view.getByRole('status')).toBeVisible(); await expect(view.getByLabel('原始输出', { exact: true })).toContainText('未知的计划');
    expect(errors).toEqual([]);
  } catch (error) { failed = true; throw error; }
  finally {
    // 原窗口关闭前封存自身context；诊断故障不替代原用例失败，不停止其它记录器。
    await diagnostic?.finish(failed);
    await desktop.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), windowId);
  }
});
