import type { Locator } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, page } from './desktop-fixture';
import { enabled, environment, isolatedDatabase } from './live-helpers';
import { recordDuplicateZh as text } from '../../src/renderer/locales/recordDuplicate.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

// 新切片仅定义真实UI验收；默认双门关闭，本轮只--list，不启动GUI或连接200。
test.use({ trace: 'off' });
test.skip(!enabled || process.env.DBARK_D02_DUPLICATE_RECORD_UI !== '1', '默认关闭：须ROOT另行安排GUI与200/13384独占窗口');
test.beforeEach(() => {
  if (environment.DBARK_TEST_HOST !== '192.168.31.200' || environment.DBARK_TEST_PORT !== '13384') throw new Error('复制记录UI验收只允许ROOT已核对的200/13384');
});
test.setTimeout(120000);
const q = (database: string, table: string) => `\`${database}\`.\`${table}\``;
const activeTable = () => page.locator('.table-tab:visible');

/** 从真实对象树重新读取新建表，不通过脚本伪造表页或草稿状态。 */
async function openTable(connectionName: string, database: string, table: string) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(connectionName, { exact: true }) });
  const row = connection.locator('.connection-row'); await row.hover(); await row.getByRole('button', { name: '刷新连接', exact: true }).click();
  const databaseRow = connection.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) }); await expect(databaseRow).toBeVisible(); await databaseRow.getByRole('button', { name: database, exact: true }).click(); await connection.locator('.object-row').getByText(table, { exact: true }).click();
  await expect(activeTable().locator('.context-bar')).toContainText(table); await expect(activeTable().locator('.loading-overlay')).toHaveCount(0); return activeTable();
}

/** 依实际列头aria坐标定位单元格，避免固定列序掩盖隐藏/排序布局错误。 */
async function cell(table: Locator, row: Locator, name: string) {
  const header = table.getByRole('columnheader').filter({ hasText: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  const index = await header.getAttribute('aria-colindex'); if (!index) throw new Error('真实列头缺少aria坐标'); return row.locator(`[role="gridcell"][aria-colindex="${index}"]`);
}

/** 只编辑真实网格草稿，不发送SQL或绕过集中预览。 */
async function edit(table: Locator, target: Locator, value: string) {
  await target.dblclick(); const input = table.locator('.grid-input'); await expect(input).toBeVisible(); await input.fill(value); await input.press('Enter'); await expect(input).toHaveCount(0);
}

test('复制精确BIGINT/DECIMAL/时间/NULL/字节，省略自增与生成列且不写数据库', async ({}, info) => {
  await isolatedDatabase(async ({ observer, database, connectionName }) => {
    await observer.query(`CREATE TABLE ${q(database, 'copy_types')} (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,note VARCHAR(40),big_value BIGINT UNSIGNED,amount DECIMAL(30,6),stamp DATETIME(6),nullable_value TEXT,payload BLOB,computed VARCHAR(50) GENERATED ALWAYS AS (CONCAT(note,'计算')) STORED) ENGINE=InnoDB`);
    await observer.query(`INSERT INTO ${q(database, 'copy_types')} (note,big_value,amount,stamp,nullable_value,payload) VALUES ('原记录',18446744073709551615,12345678901234567890.120000,'2026-10-16 01:02:03.123456',NULL,UNHEX('00ff8000'))`);
    const table = await openTable(connectionName, database, 'copy_types'); const source = table.locator('.results-grid [role="row"]').filter({ hasText: '原记录' }).first(); const note = await cell(table, source, 'note'); await note.click();
    await table.getByRole('button', { name: text.action, exact: true }).click(); const copy = table.locator('.row-inserted'); await expect(copy).toHaveCount(1); await expect(note).toHaveAttribute('aria-selected', 'true');
    for (const [key, value] of [['big_value', '18446744073709551615'], ['amount', '12345678901234567890.120000'], ['stamp', '2026-10-16 01:02:03.123456'], ['nullable_value', 'NULL'], ['payload', '0x00ff8000']] as const) await expect(await cell(table, copy, key)).toHaveText(value);
    for (const key of ['id', 'computed']) await expect(await cell(table, copy, key)).toHaveText(zh.common.defaultValue);
    const [rows] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${q(database, 'copy_types')}`); expect(Number(rows[0].n)).toBe(1); await expect(page.getByRole('dialog', { name: zh.table.text031, exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('duplicate-exact-staged-only.png') });
  }, info);
});

test('普通主键及唯一键冲突在预览前报错，手动改键后只显示原集中预览', async ({}, info) => {
  await isolatedDatabase(async ({ observer, database, connectionName }) => {
    await observer.query(`CREATE TABLE ${q(database, 'copy_keys')} (id INT PRIMARY KEY,code VARCHAR(30) NOT NULL UNIQUE,note TEXT) ENGINE=InnoDB`); await observer.query(`INSERT INTO ${q(database, 'copy_keys')} VALUES (1,'原唯一键','原记录')`);
    const table = await openTable(connectionName, database, 'copy_keys'); await table.getByRole('gridcell', { name: '原记录', exact: true }).click(); await table.getByRole('button', { name: text.action, exact: true }).click(); const copy = table.locator('.row-inserted');
    await table.getByRole('button', { name: zh.table.text019, exact: true }).click(); await expect(table.locator('.error-box')).toContainText('主键或唯一键冲突'); await expect(page.getByRole('dialog', { name: zh.table.text031, exact: true })).toHaveCount(0);
    await edit(table, await cell(table, copy, 'id'), '2'); await table.getByRole('button', { name: zh.table.text019, exact: true }).click(); await expect(table.locator('.error-box')).toContainText('code');
    await edit(table, await cell(table, copy, 'code'), '用户新唯一键'); await table.getByRole('button', { name: zh.table.text019, exact: true }).click(); const preview = page.getByRole('dialog', { name: zh.table.text031, exact: true }); await expect(preview).toBeVisible(); await expect(preview).toContainText(text.previewHint);
    const [rows] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${q(database, 'copy_keys')}`); expect(Number(rows[0].n)).toBe(1); await preview.getByRole('button', { name: zh.common.backToEdit, exact: true }).click(); await page.screenshot({ path: info.outputPath('duplicate-keys-preview-only.png') });
  }, info);
});

test('无可靠键表与视图保持只读，不产生复制入口的写入资格', async ({}, info) => {
  await isolatedDatabase(async ({ observer, database, connectionName }) => {
    await observer.query(`CREATE TABLE ${q(database, 'copy_no_key')} (id INT,note TEXT) ENGINE=InnoDB`); await observer.query(`INSERT INTO ${q(database, 'copy_no_key')} VALUES (1,'无可靠键记录')`); await observer.query(`CREATE VIEW ${q(database, 'copy_view')} AS SELECT * FROM ${q(database, 'copy_no_key')}`);
    for (const name of ['copy_no_key', 'copy_view']) { const table = await openTable(connectionName, database, name); await table.getByRole('gridcell', { name: '无可靠键记录', exact: true }).click(); await expect(table.getByRole('button', { name: text.action, exact: true })).toBeDisabled(); await expect(table.locator('.row-inserted')).toHaveCount(0); }
  }, info);
});

test('INVISIBLE普通列沿引擎租约只读补取，非默认源值进入新增草稿且不写数据库', async ({}, info) => {
  await isolatedDatabase(async ({ observer, database, connectionName }) => {
    await observer.query(`CREATE TABLE ${q(database, 'copy_invisible')} (id INT PRIMARY KEY AUTO_INCREMENT,note TEXT,server_hidden VARCHAR(40) INVISIBLE DEFAULT '服务器默认值') ENGINE=InnoDB`);
    await observer.query(`INSERT INTO ${q(database, 'copy_invisible')} (note,server_hidden) VALUES ('普通可见记录','源记录非默认值')`);
    const table = await openTable(connectionName, database, 'copy_invisible'); await table.getByRole('gridcell', { name: '普通可见记录', exact: true }).click(); const action = table.getByRole('button', { name: text.action, exact: true });
    // 此用例要求ROOT提供能核真实InnoDB身份的账号；权限不足有独立纯测试，不冒充完整能力验收。
    await expect(action).toBeEnabled(); await expect(action).toHaveAttribute('title', /只读补取缺失字段/); await action.click(); await expect(table.locator('.row-inserted')).toHaveCount(1); await expect(table.getByRole('status')).toContainText('缺失字段读取时间');
    await table.getByRole('button', { name: zh.table.text019, exact: true }).click(); const preview = page.getByRole('dialog', { name: zh.table.text031, exact: true }); await expect(preview).toBeVisible(); await expect(preview).toContainText('server_hidden'); await expect(preview).toContainText('源记录非默认值'); await preview.getByRole('button', { name: zh.common.backToEdit, exact: true }).click();
    const [rows] = await observer.query<RowDataPacket[]>(`SELECT server_hidden FROM ${q(database, 'copy_invisible')}`); expect(rows).toHaveLength(1); expect(rows[0].server_hidden).toBe('源记录非默认值');
  }, info);
});

test('复制已暂存值并保持原记录选中、勾选与已有草稿，新增草稿不支持再次复制', async ({}, info) => {
  await isolatedDatabase(async ({ observer, database, connectionName }) => {
    await observer.query(`CREATE TABLE ${q(database, 'copy_drafts')} (id INT PRIMARY KEY AUTO_INCREMENT,note TEXT) ENGINE=InnoDB`); await observer.query(`INSERT INTO ${q(database, 'copy_drafts')} (note) VALUES ('原记录')`);
    const table = await openTable(connectionName, database, 'copy_drafts'), original = table.locator('.results-grid [role="row"]').filter({ hasText: '原记录' }); await original.getByRole('checkbox').check(); await edit(table, await cell(table, original, 'note'), '已暂存修改');
    const changed = table.locator('.row-modified'), changedCell = await cell(table, changed, 'note'); await changedCell.click(); await table.getByRole('button', { name: text.action, exact: true }).click(); await expect(changedCell).toHaveAttribute('aria-selected', 'true'); await expect(changed.getByRole('checkbox')).toBeChecked(); await expect(changedCell).toHaveText('已暂存修改');
    const copy = table.locator('.row-inserted'), copyCell = await cell(table, copy, 'note'); await expect(copyCell).toHaveText('已暂存修改'); await copyCell.click(); await expect(table.getByRole('button', { name: text.action, exact: true })).toBeDisabled();
    const [rows] = await observer.query<RowDataPacket[]>(`SELECT note FROM ${q(database, 'copy_drafts')}`); expect(rows).toHaveLength(1); expect(rows[0].note).toBe('原记录');
  }, info);
});
