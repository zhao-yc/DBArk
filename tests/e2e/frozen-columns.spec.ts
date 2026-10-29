import { clickSidebarAction } from './sidebar-menu';
import type { Locator, TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { test, expect, desktop, page, ownedDesktopResources, retainOwnedDesktopResources, pageErrors } from './desktop-fixture';
import { tableGridZh as tableText } from '../../src/renderer/locales/tableGrid.zh-CN';
import { queryResultColumnsZh as resultText } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { queryResultPresetsZh as presetText } from '../../src/renderer/locales/queryResultPresets.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_FROZEN_COLUMNS_UI === '1';
test.skip(!enabled, '冻结列实库窗口需统筹核对200隔离实例并显式开启双门');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.setTimeout(150000);
interface Audit { commands: string[]; pending: number; serverIds: number[]; presets: Array<{ name: string; frozenThrough?: string }>; }
const table = () => page.locator('.table-tab:visible');
const query = () => page.locator('.query-tab:visible');

/** 只旁观原Main，不改变数据库或持久化响应；未知owner和在途请求禁止恢复及清理。 */
async function observed(info: TestInfo, body: () => Promise<void>) {
  const owner = ownedDesktopResources(info);
  await owner.application.evaluate(({ ipcMain, BrowserWindow }) => {
    const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, original = handlers?.get('dbark:request');
    const windows = BrowserWindow.getAllWindows(), window = windows[0], contents = window?.webContents, frame = contents?.mainFrame;
    if (root.__frozenColumnsAudit || typeof original !== 'function' || windows.length !== 1 || !frame) throw Error('冻结列Main旁观归属未知');
    const processId = frame.processId, frameToken = frame.frameToken;
    const state: Audit & { check(): void; restore(): void } = { commands: [], pending: 0, serverIds: [], presets: [], check() {}, restore() {} };
    const check = () => { const current = BrowserWindow.getAllWindows(); if (root.__frozenColumnsAudit !== state || handlers.get('dbark:request') !== wrapped || current.length !== 1 || current[0] !== window || contents.isDestroyed() || contents.mainFrame !== frame || frame.processId !== processId || frame.frameToken !== frameToken) throw Error('冻结列原窗口或旁观器已失效'); };
    const wrapped = async (event: any, payload: any) => {
      check(); if (event.sender !== contents || event.senderFrame !== frame) throw Error('冻结列旁观来源不符');
      state.commands.push(payload?.command); state.pending++;
      try {
        const response = await original(event, payload); check();
        if (payload?.command === 'connections.open' && response?.ok === true && Number.isSafeInteger(response.result?.connectionId) && response.result.connectionId > 0) state.serverIds.push(response.result.connectionId);
        if (payload?.command === 'result.presets.save' && response?.ok === true) state.presets.push({ name: payload.input.name, ...(payload.input.value?.frozenThrough ? { frozenThrough: payload.input.value.frozenThrough } : {}) });
        return response;
      } finally { state.pending--; }
    };
    state.check = check; state.restore = () => { check(); if (state.pending) throw Error('冻结列原IPC未收尾'); handlers.set('dbark:request', original); delete root.__frozenColumnsAudit; };
    root.__frozenColumnsAudit = state; handlers.set('dbark:request', wrapped);
  });
  let failed = false, original: unknown;
  try { await body(); } catch (error) { failed = true; original = error; throw error; }
  finally {
    try {
      const fact = await audit(info); await info.attach('冻结列Main旁观事实', { body: JSON.stringify(fact, null, 2), contentType: 'application/json' }); expect(fact.pending).toBe(0);
      await owner.application.evaluate(() => (globalThis as any).__frozenColumnsAudit.restore()); ownedDesktopResources(info);
    } catch (cleanup) { retainOwnedDesktopResources(info); if (failed) throw new AggregateError([original, cleanup], '原冻结列验收失败且收尾未确认', { cause: original }); throw cleanup; }
  }
}
/** 只读同一归属的命令事实，不读取连接凭据或修改产品状态。 */
async function audit(info: TestInfo): Promise<Audit> {
  const owner = ownedDesktopResources(info), result = await owner.application.evaluate(() => { const state = (globalThis as any).__frozenColumnsAudit; state.check(); return { commands: state.commands, pending: state.pending, serverIds: state.serverIds, presets: state.presets }; }); ownedDesktopResources(info); return result;
}
/** 横向滚动由真实DOM滚动容器完成，冻结列须保持坐标，不能只检查CSS类。 */
async function frozenPosition(grid: Locator, col: number) {
  await grid.evaluate(element => { element.scrollLeft = 0; });
  const header = grid.locator(`[role="columnheader"][aria-colindex="${col}"]`);
  await expect(header).toBeVisible(); const before = await header.boundingBox(); if (!before) throw Error('冻结列头缺少实际坐标');
  await grid.evaluate(element => { element.scrollLeft = 460; });
  await expect.poll(() => grid.evaluate(element => element.scrollLeft)).toBeGreaterThan(300);
  await expect(header).toBeVisible(); await expect(header).toHaveClass(/rdg-cell-frozen-start/);
  await expect.poll(async () => Math.abs((await header.boundingBox())!.x - before.x)).toBeLessThan(2);
}
/** 原对象树入口打开真实表，不向renderer注入表状态或行数据。 */
async function openTable(connectionName: string, database: string) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(connectionName, { exact: true }) });
  await connection.locator('.connection-row').hover(); await clickSidebarAction(connection, { name: '刷新连接', exact: true });
  const row = connection.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
  await (await (await import('./navigation-menu')).navigationMenuItem(row, { name: database, exact: true })).click(); await connection.locator('.object-row').getByText('frozen_subject', { exact: true }).click();
  await expect(table().locator('.results-grid')).toBeVisible(); await expect(table().locator('.loading-overlay')).toHaveCount(0); await expect(table().locator(':scope > .error-box')).toHaveCount(0);
}
/** 本例唯一导出路径只替代一次原生选择回答，仍走Main文件授权、真实写入与任务。 */
async function exportJson(info: TestInfo) {
  const owner = ownedDesktopResources(info), destination = info.outputPath('冻结结果.json');
  await owner.application.evaluate(({ dialog, BrowserWindow }, path) => {
    const root = globalThis as any, original = dialog.showSaveDialog, window = BrowserWindow.getAllWindows()[0];
    if (root.__frozenColumnsSave) throw Error('冻结列保存选择器重复占用');
    const state = { original, used: false, restore() { if (dialog.showSaveDialog !== wrapped || !state.used) throw Error('冻结列保存选择器未确认'); dialog.showSaveDialog = original; delete root.__frozenColumnsSave; } };
    const wrapped = (async (...args: any[]) => { if (state.used || args[0] !== window || args.at(-1)?.title !== '导出文件') throw Error('冻结列只允许本例一次明确导出'); state.used = true; return { canceled: false, filePath: path }; }) as typeof dialog.showSaveDialog;
    root.__frozenColumnsSave = state; dialog.showSaveDialog = wrapped;
  }, destination);
  let failed = false, original: unknown;
  try {
    await (await (await import('./navigation-menu')).navigationMenuItem(query(), { name: zh.resultExport.title, exact: true })).click(); const dialog = page.getByRole('dialog', { name: zh.resultExport.title, exact: true });
    await dialog.getByRole('combobox', { name: zh.resultExport.format, exact: true }).selectOption('json'); await dialog.locator('button.file-picker').click();
    await (await (await import('./navigation-menu')).navigationMenuItem(dialog, { name: zh.resultExport.start, exact: true })).click(); await expect(dialog.locator('.success-box')).toHaveText('已导出 2 行已返回结果。');
    const result = JSON.parse(await readFile(destination, 'utf8')); await (await (await import('./navigation-menu')).navigationMenuItem(dialog, { name: zh.common.done, exact: true })).click(); return result;
  } catch (error) { failed = true; original = error; throw error; }
  finally { try { await owner.application.evaluate(() => (globalThis as any).__frozenColumnsSave.restore()); ownedDesktopResources(info); } catch (cleanup) { retainOwnedDesktopResources(info); if (failed) throw new AggregateError([original, cleanup], '冻结列导出失败且选择器恢复未确认', { cause: original }); throw cleanup; } }
}

test('正式表页冻结持久化及编辑、重复别名结果冻结与命名方案、横向滚动及导出保序', async ({}, info) => {
  const live = await import('./live-helpers');
  if (!enabled || !['192.168.31.200', 'deve-server.yinzon.com'].includes(live.environment.DBARK_TEST_HOST ?? '') || live.environment.DBARK_TEST_PORT !== '13384') throw Error('冻结列仅允许已批准的200隔离13384');
  await live.isolatedDatabase(async context => {
    const { observer, database, connectionName, connectionId } = context;
    await info.attach('冻结列隔离资源', { body: JSON.stringify({ database, observerThreadId: (observer as unknown as { threadId?: number }).threadId }), contentType: 'application/json' });
    const pads = Array.from({ length: 10 }, (_, index) => 'w' + (index + 1));
    await observer.query(`CREATE TABLE \`${database}\`.frozen_subject(id BIGINT UNSIGNED PRIMARY KEY,note VARCHAR(64),${pads.map(name => `\`${name}\` VARCHAR(64) NOT NULL DEFAULT ''`).join(',')}) ENGINE=InnoDB`);
    await observer.query(`INSERT INTO \`${database}\`.frozen_subject(id,note) VALUES(9007199254740993,'原行一'),(9007199254740994,'原行二')`);
    await observed(info, async () => {
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 760)); await openTable(connectionName, database);
      const layout = page.getByRole('dialog', { name: tableText.preferences, exact: true });
      const target = { connectionId, database, table: 'frozen_subject' };
      const readsBefore = (await audit(info)).commands.filter(command => command === 'table.page').length;
      await (await (await import('./navigation-menu')).navigationMenuItem(table(), { name: tableText.preferences, exact: true })).click();
      await (await (await import('./navigation-menu')).navigationMenuItem(layout, { name: tableText.freezeThrough('note'), exact: true })).click(); await expect(layout).toContainText(tableText.frozenThrough('note'));
      await (await (await import('./navigation-menu')).navigationMenuItem(layout, { name: tableText.save, exact: true })).click(); await expect(layout).toContainText(tableText.saved); await (await (await import('./navigation-menu')).navigationMenuItem(layout, { name: zh.common.close, exact: true })).click();
      const saved = await page.evaluate(value => window.dbark.invoke('table.preferences.get', value), target); expect(saved?.frozenThrough).toBe('note'); expect(saved?.columns.map(column => column.name)).toEqual(['id', 'note', ...pads]);
      await frozenPosition(table().locator('.results-grid'), 2); await frozenPosition(table().locator('.results-grid'), 3);
      expect((await audit(info)).commands.filter(command => command === 'table.page')).toHaveLength(readsBefore);
      const note = table().locator('[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="3"]');
      await note.dblclick(); const input = table().getByRole('textbox', { name: '编辑 note', exact: true }); await input.fill('冻结列编辑保持'); await input.press('Enter'); await expect(note).toHaveText('冻结列编辑保持');
      await (await (await import('./navigation-menu')).navigationMenuItem(table(), { name: tableText.preferences, exact: true })).click(); await (await (await import('./navigation-menu')).navigationMenuItem(layout, { name: tableText.unfreeze, exact: true })).click(); await (await (await import('./navigation-menu')).navigationMenuItem(layout, { name: tableText.freezeThrough('note'), exact: true })).click(); await (await (await import('./navigation-menu')).navigationMenuItem(layout, { name: zh.common.close, exact: true })).click(); await expect(note).toHaveText('冻结列编辑保持');
      await (await (await import('./navigation-menu')).navigationMenuItem(table(), { name: '预览并提交', exact: true })).click(); const confirm = page.getByRole('dialog', { name: '确认数据修改', exact: true }); await expect(confirm.locator('.monaco-editor .view-lines')).toContainText('UPDATE'); await (await (await import('./navigation-menu')).navigationMenuItem(confirm, { name: '确认提交', exact: true })).click(); await expect(confirm).toHaveCount(0); await expect(table().locator('.loading-overlay')).toHaveCount(0);
      const [rows] = await observer.query<RowDataPacket[]>(`SELECT CAST(id AS CHAR) AS id,note FROM \`${database}\`.frozen_subject ORDER BY id`); expect(rows.map(row => [row.id, row.note])).toEqual([['9007199254740993', '冻结列编辑保持'], ['9007199254740994', '原行二']]);
      await page.screenshot({ path: info.outputPath('表冻结与实际编辑.png') });
      await live.openDatabaseQuery(database); await live.executeSql(`SELECT id AS repeated,note AS repeated,${pads.join(',')} FROM frozen_subject ORDER BY id DESC`);
      const grid = query().getByRole('grid'), columns = page.getByRole('dialog', { name: resultText.title, exact: true });
      await (await (await import('./navigation-menu')).navigationMenuItem(query(), { name: resultText.open, exact: true })).click(); await (await (await import('./navigation-menu')).navigationMenuItem(columns, { name: resultText.up(2), exact: true })).click(); await (await (await import('./navigation-menu')).navigationMenuItem(columns, { name: resultText.apply, exact: true })).click();
      // 与原服务器DESC相反的客户端ASC必须跨冻结保持，不能重绑列后悄悄回退原结果。
      await grid.locator('[role="columnheader"][aria-colindex="3"]').click(); await expect(grid.locator('[role="columnheader"][aria-colindex="3"]')).toHaveAttribute('aria-sort', 'ascending');
      await expect(grid.locator('[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="3"]')).toHaveText('9007199254740993');
      const executions = (await audit(info)).commands.filter(command => command === 'query.execute').length, history = await page.evaluate(async () => (await window.dbark.invoke('history.list', {})).map(row => row.id));
      await (await (await import('./navigation-menu')).navigationMenuItem(query(), { name: resultText.open, exact: true })).click(); await (await (await import('./navigation-menu')).navigationMenuItem(columns, { name: resultText.freezeThrough(1), exact: true })).click(); await (await (await import('./navigation-menu')).navigationMenuItem(columns, { name: resultText.apply, exact: true })).click();
      await frozenPosition(grid, 2); await frozenPosition(grid, 3); await expect(grid.locator('[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="2"]')).toHaveText('冻结列编辑保持'); await expect(grid.locator('[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="3"]')).toHaveText('9007199254740993');
      const presets = page.getByRole('dialog', { name: presetText.title, exact: true }), name = '冻结重复别名原第一列';
      await (await (await import('./navigation-menu')).navigationMenuItem(query(), { name: presetText.open, exact: true })).click(); await presets.getByRole('textbox', { name: presetText.name, exact: true }).fill(name); await (await (await import('./navigation-menu')).navigationMenuItem(presets, { name: presetText.create, exact: true })).click(); await expect(presets.getByRole('region', { name: presetText.preview, exact: true })).toContainText(name); await (await (await import('./navigation-menu')).navigationMenuItem(presets, { name: zh.common.close, exact: true })).click();
      expect((await audit(info)).presets).toContainEqual({ name, frozenThrough: 'c0' });
      await (await (await import('./navigation-menu')).navigationMenuItem(query(), { name: resultText.open, exact: true })).click(); await (await (await import('./navigation-menu')).navigationMenuItem(columns, { name: resultText.unfreeze, exact: true })).click(); await (await (await import('./navigation-menu')).navigationMenuItem(columns, { name: resultText.apply, exact: true })).click(); await expect(grid.locator('[role="columnheader"][aria-colindex="3"]')).not.toHaveClass(/rdg-cell-frozen-start/);
      await (await (await import('./navigation-menu')).navigationMenuItem(query(), { name: presetText.open, exact: true })).click(); await presets.getByRole('combobox', { name: presetText.choose, exact: true }).selectOption({ label: name }); await (await (await import('./navigation-menu')).navigationMenuItem(presets, { name: presetText.apply, exact: true })).click(); await frozenPosition(grid, 3);
      const result = await exportJson(info); expect(result).toEqual([{ repeated: '冻结列编辑保持', 'repeated [2]': '9007199254740993', ...Object.fromEntries(pads.map(name => [name, ''])) }, { repeated: '原行二', 'repeated [2]': '9007199254740994', ...Object.fromEntries(pads.map(name => [name, ''])) }]);
      expect((await audit(info)).commands.filter(command => command === 'query.execute')).toHaveLength(executions); expect(await page.evaluate(async () => (await window.dbark.invoke('history.list', {})).map(row => row.id))).toEqual(history);
      await page.screenshot({ path: info.outputPath('重复别名冻结与方案恢复.png') }); expect(pageErrors).toEqual([]);
    });
  }, info, { captureFailureScreenshot: false });
});
