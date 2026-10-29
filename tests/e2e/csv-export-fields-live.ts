import { clickSidebarAction } from './sidebar-menu';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources } from './desktop-fixture';
import { environment, isolatedDatabase } from './live-helpers';
import { zh } from '../../src/renderer/locales/zh-CN';

/** 所属CSV任务未终态或读取未知时先停链；不能借退出请求取消它后继续删库。 */
export async function assertCsvExportTasksTerminal(info: TestInfo): Promise<void> {
  try {
    const owner = ownedDesktopResources(info); if (owner.closed) throw Error('尚无完整所属退出证明，不能用closed代替任务终态');
    const tasks = await owner.page.evaluate(() => window.dbark.invoke('tasks.list', {})); ownedDesktopResources(info);
    if (tasks.some(task => ['files.export', 'files.exportColumns'].includes(task.kind) && !['completed', 'failed', 'cancelled'].includes(task.status))) throw Error('本例CSV目录或导出任务尚未终态，保留所属资源');
  } catch (reason) { retainOwnedDesktopResources(info); throw reason; }
}
/** 首个正式定义仅准备明文13384；目标、账号和严格owner由ROOT另行安排，不改共享fixture。 */
export function registerCsvExportFieldsUiTests() {
  if (process.env.DBARK_TEST_HOST !== '192.168.31.200' || process.env.DBARK_TEST_PORT !== '13384' || process.env.DBARK_TEST_TLS === '1') throw Error('首个CSV字段UI定义仅准备200明文13384，其它组合尚未准备');
  for (const key of ['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS'] as const) if (process.env[key] !== environment[key]) throw Error('CSV字段UI原始目标与helper配置不一致');
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(120000); test.describe.configure({ retries: 0 });
  test('真实CSV表导出勾选重排、预览顺序与精确文件一致，双击仅一次且原数据保持', async ({}, info) => {
    await isolatedDatabase(async context => {
      let primary: { reason: unknown } | undefined;
      try {
        const owned = () => ownedDesktopResources(info), page = owned().page;
        const [version] = await context.observer.query<RowDataPacket[]>('SELECT @@version AS version'); owned(); expect(String(version[0].version)).toMatch(/^8\.4\.11(?:[-+].*)?$/);
        const table = `\`${context.database}\`.\`csv_fields\``;
        await context.observer.query(`CREATE TABLE ${table}(id BIGINT UNSIGNED NOT NULL PRIMARY KEY,price DECIMAL(30,6),raw_value VARBINARY(20)) ENGINE=InnoDB`); owned();
        await context.observer.query(`INSERT INTO ${table} VALUES(18446744073709551615,123456789012345678901234.123456,X'00FF')`); owned();
        const before = (await context.observer.query<RowDataPacket[]>(`SELECT CAST(id AS CHAR) AS id,CAST(price AS CHAR) AS price,HEX(raw_value) AS bytes FROM ${table}`))[0]; owned();
        const directory = await owned().application.evaluate(({ app }) => app.getPath('userData')); owned(); const output = join(directory, 'csv-selected-fields.csv'); await writeFile(output, '原文件'); owned();
        const connection = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: context.connectionName, exact: true }) }); await connection.getByRole('button', { name: context.connectionName, exact: true }).focus(); await clickSidebarAction(connection, { name: '刷新连接', exact: true }, undefined, owned); owned();
        await (await (await import('./navigation-menu')).navigationMenuItem(connection.locator('.database-row'), { name: context.database, exact: true })).click(); await connection.locator('.object-row').getByText('csv_fields', { exact: true }).click(); owned();
        await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.table-tab:visible'), { name: zh.common.export, exact: true })).click(); const dialog = page.getByRole('dialog', { name: `${zh.transfer.text005} · ${context.database}.csv_fields`, exact: true });
        const fields = dialog.getByRole('region', { name: 'CSV导出字段' }); await expect(fields.getByRole('checkbox', { name: /^raw_value ·/ })).toBeEnabled(); await fields.getByRole('checkbox', { name: /^raw_value ·/ }).uncheck(); await (await (await import('./navigation-menu')).navigationMenuItem(fields, { name: '上移CSV字段 price', exact: true })).click(); owned();
        await expect(fields.getByRole('list', { name: 'CSV字段顺序预览', exact: true }).getByRole('listitem')).toHaveText(['price 上移 下移', 'id 上移 下移']);
        const original = await owned().application.evaluate(({ dialog }) => { return typeof dialog.showSaveDialog; }); owned(); expect(original).toBe('function');
        await owned().application.evaluate(({ dialog }, path) => { const root = globalThis as typeof globalThis & { __csvFieldsSave?: typeof dialog.showSaveDialog }; if (root.__csvFieldsSave) throw Error('文件选择不能覆盖其他任务'); root.__csvFieldsSave = dialog.showSaveDialog; dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog; }, output); owned();
        try { await dialog.locator('.file-picker').click(); owned(); }
        finally { await owned().application.evaluate(({ dialog }) => { const root = globalThis as typeof globalThis & { __csvFieldsSave?: typeof dialog.showSaveDialog }; if (root.__csvFieldsSave) { dialog.showSaveDialog = root.__csvFieldsSave; delete root.__csvFieldsSave; } }); owned(); }
        await expect(dialog.locator('.file-picker')).toContainText('csv-selected-fields.csv'); const submit = dialog.getByRole('button', { name: zh.transfer.text029, exact: true }); await submit.dblclick(); await expect(dialog.locator('.success-box')).toContainText('1', { timeout: 30000 }); owned();
        expect(parse(await readFile(output, 'utf8'))).toEqual([['price', 'id'], ['123456789012345678901234.123456', '18446744073709551615']]); owned();
        const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); owned(); expect(tasks.filter(task => task.kind === 'files.export')).toHaveLength(1); expect(tasks.find(task => task.kind === 'files.export')?.status).toBe('completed');
        const after = (await context.observer.query<RowDataPacket[]>(`SELECT CAST(id AS CHAR) AS id,CAST(price AS CHAR) AS price,HEX(raw_value) AS bytes FROM ${table}`))[0]; owned(); expect(after).toStrictEqual(before);
      } catch (reason) { primary = { reason }; throw reason; }
      finally { try { await assertCsvExportTasksTerminal(info); } catch (reason) { if (primary) throw new AggregateError([primary.reason, reason], '原UI失败且CSV任务未确认终态，保留所属资源'); throw reason; } }
    }, info, { captureFailureScreenshot: false });
  });
}
