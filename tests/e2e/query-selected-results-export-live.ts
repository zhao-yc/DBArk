import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, desktop, page, dataDir, retainOwnedDesktopResources } from './desktop-fixture';
import { isolatedDatabase, openDatabaseQuery, executeSql, environment } from './live-helpers';
import { zh } from '../../src/renderer/locales/zh-CN';

/** 默认包装器双门通过后才加载；实际只由Root统一许可，文件选择回答复用已有验收方式。 */
export function registerSelectedResultsExport() {
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(120000); test.describe.configure({ retries: 0 });
  test.beforeEach(() => {
    if (environment.DBARK_TEST_HOST !== '192.168.31.200' || !['13357', '13380', '13384', '13310', '13311', '13484'].includes(environment.DBARK_TEST_PORT ?? '') || environment.DBARK_TEST_SSH === '1' || environment.DBARK_TEST_PORT === '13484' && environment.DBARK_TEST_TLS !== '1') throw Error('仅接受Root核对的200既有直连隔离实例及原严格TLS策略');
  });
  test('查询结果勾选行按原顺序导出固定快照，切换和新执行清选择且不重执行SQL', async ({}, info) => {
    await isolatedDatabase(async ({ database }) => {
      try {
        await openDatabaseQuery(database);
        const sql = "SELECT 1 AS id,CAST('18446744073709551615' AS CHAR) AS repeated,NULL AS repeated,X'00ff' AS bytes UNION ALL SELECT 2,'不选','中间',X'' UNION ALL SELECT 3,'0.12345678901234567890','',NULL ORDER BY id";
        await executeSql(sql);
        const tab = page.locator('.query-tab:visible'), selected = tab.getByRole('button', { name: zh.resultExport.selectedTitle, exact: true });
        await expect(selected).toBeDisabled();
        const rows = tab.locator('.result-body .results-grid [role="row"]');
        await rows.nth(3).getByRole('checkbox').check(); await rows.nth(1).getByRole('checkbox').check(); await expect(selected).toBeEnabled();
        const before = await page.evaluate(async () => (await window.dbark.invoke('history.list', {})).map(item => item.id).sort());
        const file = join(dataDir, 'selected-query-rows.json');
        await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog; }, file);
        await selected.click(); const dialog = page.getByRole('dialog', { name: zh.resultExport.selectedTitle, exact: true });
        await expect(dialog).toContainText('仅导出已返回结果中勾选的 2 行'); await expect(dialog).toContainText('打开时已固定选择快照');
        await dialog.getByRole('combobox', { name: zh.resultExport.format, exact: true }).selectOption('json'); await dialog.locator('.file-picker').click();
        await dialog.getByRole('button', { name: zh.resultExport.start, exact: true }).click(); await expect(dialog.locator('.success-box')).toHaveText('已导出 2 行已返回结果。');
        const actual = JSON.parse(await readFile(file, 'utf8')); expect(actual.map((row: Record<string, unknown>) => row.id)).toEqual([1, 3]); expect(actual[0].repeated).toBe('18446744073709551615'); expect(actual[0]['repeated [2]']).toBeNull(); expect(actual[0].bytes).toEqual({ type: 'binary', base64: 'AP8=' }); expect(actual[1].repeated).toBe('0.12345678901234567890'); expect(actual[1].bytes).toBeNull();
        await dialog.getByRole('button', { name: zh.common.done, exact: true }).click();
        expect(await page.evaluate(async () => (await window.dbark.invoke('history.list', {})).map(item => item.id).sort())).toEqual(before);
        await tab.getByRole('button', { name: zh.query.pinResult, exact: true }).click(); await expect(selected).toBeDisabled();
        await tab.locator('.pinned-results .current-results').click(); await expect(selected).toBeDisabled();
        await rows.nth(1).getByRole('checkbox').check(); await expect(selected).toBeEnabled(); await executeSql('SELECT 4 AS next_result'); await expect(selected).toBeDisabled();
      } catch (reason) { retainOwnedDesktopResources(info); throw reason; }
    }, info, { captureFailureScreenshot: false });
  });
}
