import type { TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, page } from './desktop-fixture';
import { currentStatementZh } from '../../src/renderer/locales/currentStatement.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

// 双门默认关闭；私网帮助器只在真正获准执行的用例体中导入，--list不读取真实env/key。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_Q02_CURRENT_STATEMENT_UI === '1';
test.skip(!enabled, '须ROOT安排原生GUI与200/13384独占窗口，默认仅列表');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.setTimeout(120000);
const query = () => page.locator('.query-tab:visible');
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
type Live = typeof import('./live-helpers');

/** 严格限定ROOT已核对的实例；未获双门授权时不加载任何私网材料。 */
async function isolated(body: (context: Parameters<Parameters<Live['isolatedDatabase']>[0]>[0], live: Live) => Promise<void>, info: TestInfo) {
  if (!enabled) throw new Error('当前语句UI未获得双门授权');
  const live = await import('./live-helpers');
  if (live.environment.DBARK_TEST_HOST !== '192.168.31.200' || live.environment.DBARK_TEST_PORT !== '13384') throw new Error('当前语句验收只允许ROOT已核对的200/13384');
  await live.isolatedDatabase(context => body(context, live), info);
}

/** 只用公开键盘动作定位本例短行，不读写内部模型、eval光标或访问剪贴板。 */
async function caret(live: Live, marked: string) {
  const offset = marked.indexOf('┃'); if (offset < 0 || marked.lastIndexOf('┃') !== offset) throw new Error('本例须有唯一光标标记');
  await live.writeSql(marked.replace('┃', '')); const lines = marked.slice(0, offset).split(/\r?\n/);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  for (let index = 1; index < lines.length; index++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home');
  // 公开用例前缀只含普通字符和单个emoji；ArrowRight按真实编辑器字符移动，偏移不按码点伪造。
  for (const _character of lines.at(-1)!) await page.keyboard.press('ArrowRight');
}

/** 由真实任务按钮等待结束；用例自己判断成功或明确拒绝。 */
async function current(shortcut = false) {
  if (shortcut) await page.keyboard.press(`${modifier}+Shift+Enter`); else await (await navigationMenuItem(query(), { name: currentStatementZh.action, exact: true })).click();
  await expect((await navigationMenuItem(query(), { name: zh.common.stop, exact: true }))).toBeDisabled({ timeout: 20000 });
}

test('真实按钮只执行中句，源草稿完整且历史/结果不含前后写入', async ({}, info) => isolated(async ({ database, observer }, live) => {
  await observer.query(`CREATE TABLE \`${database}\`.subject(id INT PRIMARY KEY)`); await live.openDatabaseQuery(database);
  const marked = "INSERT INTO subject VALUES(1);\r\nSELECT '🧭当前'┃ AS marker;\r\nINSERT INTO subject VALUES(3);", expected = "SELECT '🧭当前' AS marker";
  await caret(live, marked); await current(); await expect(query().locator('.error-box')).toHaveCount(0); await expect(query().locator('.result-body')).toContainText('🧭当前');
  expect((await observer.query<RowDataPacket[]>(`SELECT * FROM \`${database}\`.subject`))[0]).toHaveLength(0);
  const history = await page.evaluate(() => window.dbark.invoke('history.list', {})); expect(history.some(entry => entry.sql === expected && entry.success)).toBe(true); expect(history.some(entry => entry.sql.includes('INSERT INTO subject'))).toBe(false);
  await expect.poll(async () => page.evaluate(async () => { const settings = await window.dbark.invoke('settings.get', {}); return settings.tabs.find(tab => tab.id === settings.activeTabId)?.sql?.replaceAll('\r\n', '\n'); })).toBe(marked.replace('┃', '').replaceAll('\r\n', '\n'));
}, info));

test('新快捷键只执行当前，原CtrlCmdEnter选区与执行全部仍走原行为', async ({}, info) => isolated(async ({ database, observer }, live) => {
  await observer.query(`CREATE TABLE \`${database}\`.subject(id INT PRIMARY KEY,n INT DEFAULT 0)`); await observer.query(`INSERT INTO \`${database}\`.subject VALUES(2,0)`); await live.openDatabaseQuery(database);
  const marked = 'INSERT INTO subject VALUES(1,0);\nUPDATE subject SET n=n+1 ┃WHERE id=2;\nINSERT INTO subject VALUES(3,0);';
  await caret(live, marked); await current(true);
  expect((await observer.query<RowDataPacket[]>(`SELECT id,n FROM \`${database}\`.subject ORDER BY id`))[0].map(row => [row.id, row.n])).toEqual([[2, 1]]);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home'); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+ArrowRight' : 'Shift+End'); await page.keyboard.press(`${modifier}+Enter`);
  await expect((await navigationMenuItem(query(), { name: zh.common.stop, exact: true }))).toBeDisabled(); expect((await observer.query<RowDataPacket[]>(`SELECT n FROM \`${database}\`.subject WHERE id=2`))[0][0].n).toBe(2);
  await (await navigationMenuItem(query(), { name: zh.query.text011, exact: true })).click(); await expect((await navigationMenuItem(query(), { name: zh.common.stop, exact: true }))).toBeDisabled(); await expect(query().locator('.error-box')).toHaveCount(0);
  expect((await observer.query<RowDataPacket[]>(`SELECT id,n FROM \`${database}\`.subject ORDER BY id`))[0].map(row => [row.id, row.n])).toEqual([[1, 0], [2, 3], [3, 0]]);
}, info));

test('DELIMITER过程体只整体创建一次，不执行内部语句或相邻CALL', async ({}, info) => isolated(async ({ database, observer }, live) => {
  await observer.query(`CREATE TABLE \`${database}\`.subject(id INT PRIMARY KEY)`); await live.openDatabaseQuery(database);
  await caret(live, 'INSERT INTO subject VALUES(1);\nDELIMITER $$\nCREATE PROCEDURE q02_p() BEGIN\n INSERT INTO subject VALUES(2);\n INSERT INTO subject ┃VALUES(3);\nEND$$\nDELIMITER ;\nCALL q02_p();'); await current(); await expect(query().locator('.error-box')).toHaveCount(0);
  expect((await observer.query<RowDataPacket[]>(`SELECT * FROM \`${database}\`.subject`))[0]).toHaveLength(0); expect((await observer.query<RowDataPacket[]>('SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=? AND ROUTINE_NAME=?', [database, 'q02_p']))[0]).toHaveLength(1);
  await live.executeSql('CALL q02_p()'); expect((await observer.query<RowDataPacket[]>(`SELECT id FROM \`${database}\`.subject ORDER BY id`))[0].map(row => row.id)).toEqual([2, 3]);
}, info));

test('空白与未闭合脚本明确拒绝，零写入且没有全文或空SQL历史', async ({}, info) => isolated(async ({ database, observer }, live) => {
  await observer.query(`CREATE TABLE \`${database}\`.subject(id INT PRIMARY KEY)`); await live.openDatabaseQuery(database); const before = await page.evaluate(() => window.dbark.invoke('history.list', {}));
  await caret(live, 'INSERT INTO subject VALUES(1);\n┃\nINSERT INTO subject VALUES(3);'); await current(); await expect(query().locator('.error-box')).toContainText('没有可执行');
  await caret(live, "INSERT INTO subject ┃VALUES(1);\nSELECT '未闭合"); await current(); await expect(query().locator('.error-box')).toContainText('未闭合');
  expect((await observer.query<RowDataPacket[]>(`SELECT * FROM \`${database}\`.subject`))[0]).toHaveLength(0); const after = await page.evaluate(() => window.dbark.invoke('history.list', {})); expect(after).toHaveLength(before.length); expect(after.every(entry => entry.sql.trim())).toBe(true);
}, info));

test('临时表、ROW_COUNT与LAST_INSERT_ID不被附加模式SQL覆盖，事务仍可明确回滚', async ({}, info) => isolated(async ({ database }, live) => {
  await live.openDatabaseQuery(database); await live.executeSql("CREATE TEMPORARY TABLE q02_t(id INT AUTO_INCREMENT PRIMARY KEY,v INT);INSERT INTO q02_t(v) VALUES(1)");
  await caret(live, 'SET @before=1;\nSELECT ROW_COUNT() AS rows_affected,LAST_INSERT_ID() ┃AS inserted_id;\nDROP TEMPORARY TABLE q02_t;'); await current(); await expect(query().locator('.error-box')).toHaveCount(0); await expect(query().locator('.result-body')).toContainText('rows_affected');
  const cells = query().locator('.result-body [role="gridcell"]'); await expect(cells.filter({ hasText: /^1$/ })).toHaveCount(2);
  await (await navigationMenuItem(query(), { name: zh.common.transactionBegin, exact: true })).click(); await caret(live, 'DROP TEMPORARY TABLE q02_t;\nINSERT INTO q02_t(v) ┃VALUES(2);\nCOMMIT;'); await current(); await (await navigationMenuItem(query(), { name: zh.common.transactionRollback, exact: true })).click();
  await live.executeSql('SELECT COUNT(*) AS remaining FROM q02_t'); await expect(query().locator('.result-body [role="gridcell"]').filter({ hasText: /^1$/ })).toHaveCount(1);
}, info));

/** 原门进入具体动作后才加载真实菜单导航，不改变默认/列表阶段的资源边界。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args); }
