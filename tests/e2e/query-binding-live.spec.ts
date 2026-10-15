import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, page, pageErrors } from './desktop-fixture';
import { enabled, isolatedDatabase, openDatabaseQuery, executeSql, writeSql, readRenderedResult, type LiveContext } from './live-helpers';

// 默认在夹具启动前跳过；只有统筹显式注入隔离连接并启用时，才会进入真实数据库链路。
test.use({ trace: 'off' });
const query = () => page.locator('.query-tab:visible');
const saveDialog = () => page.getByRole('dialog', { name: '保存查询', exact: true });
const firstId = '9007199254740993', secondId = '9007199254740995';

/** 数据库标识只接受现有帮助器创建的随机隔离库，不接收业务库或任意对象路径。 */
function isolatedName(database: string): string {
  if (!/^dbark_e2e_[a-z0-9_]+$/.test(database)) throw Error('拒绝使用非本例随机隔离库');
  return '`' + database + '`';
}
/** 观察连接只建立小型夹具，实际会话、事务、保存和另存均走应用界面。 */
async function fixtures(context: LiveContext) {
  const database = isolatedName(context.database);
  await context.observer.query(`CREATE TABLE ${database}.binding_subject(id BIGINT PRIMARY KEY,note VARCHAR(100)) ENGINE=InnoDB`);
  await context.observer.query(`INSERT INTO ${database}.binding_subject VALUES(${firstId},'原值甲'),(${secondId},'原值乙')`);
}
/** 每次读取观察端真实已提交值，不用它替代应用的事务控制或正文执行。 */
async function committed(context: LiveContext) {
  const [rows] = await context.observer.query<RowDataPacket[]>(`SELECT CAST(id AS CHAR) AS id,note FROM ${isolatedName(context.database)}.binding_subject ORDER BY id`);
  return rows.map(row => ({ id: String(row.id), note: String(row.note) }));
}
/** 从真实结果列读取会话编号、同名临时表和本会话未提交值；不能从内部状态反射获得。 */
async function probe(database: string, rowId: string, marker: string, note: string, currentDatabase = database) {
  const source = `SELECT CONNECTION_ID() AS binding_session_id,(SELECT marker FROM ${isolatedName(database)}.binding_session_token) AS binding_marker,(SELECT note FROM ${isolatedName(database)}.binding_subject WHERE id=${rowId}) AS binding_note,DATABASE() AS binding_database`;
  const previousHistory = await historyIds();
  await executeSql(source);
  expect(await page.evaluate(async ({ source, previousHistory }) => (await window.dbark.invoke('history.list', {})).some(entry => entry.sql === source && !previousHistory.includes(entry.id)), { source, previousHistory })).toBe(true);
  const text = await readRenderedResult(value => value.includes('binding_session_id') && value.includes(marker) && value.includes(note) && value.includes(currentDatabase));
  // 表头还包含类型文本，用别名前缀定位；按真实 ARIA 列号读取，不能把选择列当数据。
  const grid = query().getByRole('grid'), columns: string[] = [];
  for (const alias of ['binding_session_id', 'binding_marker', 'binding_note', 'binding_database']) {
    const header = grid.getByRole('columnheader', { name: new RegExp('^' + alias) }); await expect(header).toHaveCount(1);
    const index = await header.getAttribute('aria-colindex');
    if (!index || !/^\d+$/.test(index)) throw Error('SELECT 结果缺少真实列号：' + alias);
    columns.push(index);
  }
  let values: string[] = [];
  await expect.poll(async () => {
    const row = grid.locator('.rdg-row').first();
    values = await Promise.all(columns.map(index => row.locator(`[role="gridcell"][aria-colindex="${index}"]`).innerText().then(value => value.trim())));
    return values.slice(1);
  }).toEqual([marker, note, currentDatabase]);
  expect(values[0]).toMatch(/^\d+$/); expect(Number(values[0])).toBeGreaterThan(0);
  return { sessionId: values[0], text };
}
/** 历史 ID 快照能发现保存或打开时偷偷投递的任何普通查询，不依赖 observer 的隔离可见性。 */
async function historyIds() { return page.evaluate(async () => (await window.dbark.invoke('history.list', {})).map(entry => entry.id).sort()); }
/** 只通过实际工具栏打开保存表单；明确选择创建或原查询更新。 */
async function save(action: '保存到原查询' | '另存为新查询', name?: string) {
  await query().getByRole('button', { name: '保存查询', exact: true }).click();
  await expect(saveDialog().getByRole('button', { name: '另存为新查询', exact: true }), '实库套件需先合入Q03新保存入口，不能在仅有首批集成的版本上运行').toBeVisible();
  if (name) await saveDialog().getByLabel('查询名称', { exact: true }).fill(name);
  await saveDialog().getByRole('button', { name: action, exact: true }).click();
}
/** 页面断言从生产 IPC 读取本地记录，既不替换返回值，也不写组件或工作台内部状态。 */
async function records() { return page.evaluate(() => window.dbark.invoke('queries.list', {})); }
/** 从真实分页列表新开来源标签，按名称选择唯一夹具，不复用已有会话。 */
async function openSaved(name: string) {
  await page.locator('.app-commandbar').getByRole('button', { name: '历史与查询', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '历史与保存的查询', exact: true });
  await dialog.getByRole('button', { name: '保存的查询', exact: true }).click();
  const row = dialog.locator('.history-card').filter({ has: page.getByText(name, { exact: true }) });
  await expect(row).toHaveCount(1); await row.getByRole('button', { name: '在新标签打开', exact: true }).click();
  await expect(dialog).toBeHidden(); await expect(query().locator('.monaco-editor')).toBeVisible();
}
/** 顺序来自本例真实新增的标签；点击后等待活动页切换，保持原标签身份。 */
async function activate(index: number, title: string) {
  await page.locator('.tab-strip .tab-select').nth(index).click();
  await expect(page.locator('.tab-strip .workspace-tab-button.active .tab-select')).toHaveText(title);
}
/** 事务按钮控制原物理会话，完成后提交按钮应不可用；不借观察连接回滚被测会话。 */
async function rollback() {
  const button = query().getByRole('button', { name: '回滚', exact: true }); await expect(button).toBeEnabled(); await button.click();
  // 先等操作互斥释放，不能把“回滚仍在进行所以按钮禁用”误认为事务已经结束。
  await expect(query().getByRole('button', { name: '执行全部', exact: true })).toBeEnabled();
  await expect(query().getByRole('button', { name: '提交', exact: true })).toBeDisabled(); await expect(query().locator('.error-box')).toHaveCount(0);
}

test.describe('Q03 统筹启用的200隔离实库来源绑定', () => {
  test.skip(!enabled, '默认严格跳过：需统筹核验200服务器并显式注入隔离连接');

  test('保存与另存零自动执行，同源双标签会话、临时表、事务及陈旧草稿保持独立', async ({}, info) => {
    test.setTimeout(180000);
    await isolatedDatabase(async context => {
      await fixtures(context); const { database } = context;
      await openDatabaseQuery(database);
      await executeSql(`CREATE TEMPORARY TABLE binding_session_token(marker VARCHAR(20));INSERT INTO binding_session_token VALUES('会话甲');START TRANSACTION;UPDATE binding_subject SET note='甲未提交' WHERE id=${firstId}`);
      const a = await probe(database, firstId, '会话甲', '甲未提交'); await expect(query().getByRole('button', { name: '提交', exact: true })).toBeEnabled();
      const dangerous = `UPDATE ${isolatedName(database)}.binding_subject SET note='保存操作绝不能自动执行' WHERE id=${firstId}; -- 来源原文`;
      await writeSql(dangerous); const beforeCreate = await historyIds();
      await save('另存为新查询', '双会话来源'); await expect(saveDialog()).toBeHidden();
      expect(await historyIds()).toEqual(beforeCreate); expect(await query().locator('.result-body').innerText()).toBe(a.text);
      const original = (await records())[0]; expect(original.sql).toBe(dangerous);
      const beforeOpen = await historyIds(); await openSaved('双会话来源'); expect(await historyIds()).toEqual(beforeOpen);
      await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('settings.get', {}))).tabs.length).toBe(2);
      // 两个物理会话创建完全同名的临时表并更新不同行，避免把锁等待误当作会话隔离。
      await executeSql(`CREATE TEMPORARY TABLE binding_session_token(marker VARCHAR(20));INSERT INTO binding_session_token VALUES('会话乙');START TRANSACTION;UPDATE binding_subject SET note='乙未提交' WHERE id=${secondId}`);
      const b = await probe(database, secondId, '会话乙', '乙未提交'); expect(b.sessionId).not.toBe(a.sessionId);
      expect(await committed(context)).toEqual([{ id: firstId, note: '原值甲' }, { id: secondId, note: '原值乙' }]);
      const bSql = dangerous + '\n-- 乙标签更新原查询'; await writeSql(bSql); const beforeUpdate = await historyIds();
      await save('保存到原查询'); await expect(saveDialog()).toBeHidden(); expect(await historyIds()).toEqual(beforeUpdate);
      expect(await query().locator('.result-body').innerText()).toBe(b.text); expect((await records()).find(record => record.id === original.id)?.sql).toContain('乙标签更新原查询');
      await activate(0, '双会话来源'); expect(await query().locator('.result-body').innerText()).toBe(a.text); await expect(query().getByRole('button', { name: '提交', exact: true })).toBeEnabled();
      const aSql = dangerous + '\n-- 甲标签陈旧草稿'; await writeSql(aSql); const beforeConflict = await historyIds();
      await save('保存到原查询'); await expect(saveDialog().getByRole('alert')).toContainText('原查询已修改');
      expect(await historyIds()).toEqual(beforeConflict); expect((await records()).find(record => record.id === original.id)?.sql).toContain('乙标签更新原查询');
      await saveDialog().getByRole('button', { name: '取消', exact: true }).click();
      await expect(query().locator('.monaco-editor .view-lines')).toContainText('甲标签陈旧草稿');
      await save('另存为新查询', '甲标签冲突副本'); await expect(saveDialog()).toBeHidden(); expect(await historyIds()).toEqual(beforeConflict);
      const copy = (await records()).find(record => record.name === '甲标签冲突副本')!; expect(copy.id).not.toBe(original.id); expect(copy.sql).toContain('甲标签陈旧草稿');
      expect((await probe(database, firstId, '会话甲', '甲未提交')).sessionId).toBe(a.sessionId);
      await rollback(); expect((await probe(database, firstId, '会话甲', '原值甲')).sessionId).toBe(a.sessionId);
      await activate(1, '双会话来源'); expect((await probe(database, secondId, '会话乙', '乙未提交')).sessionId).toBe(b.sessionId);
      await rollback(); expect((await probe(database, secondId, '会话乙', '原值乙')).sessionId).toBe(b.sessionId);
      expect(await committed(context)).toEqual([{ id: firstId, note: '原值甲' }, { id: secondId, note: '原值乙' }]);
      expect((await page.evaluate(() => window.dbark.invoke('history.list', {}))).some(entry => entry.sql.includes('保存操作绝不能自动执行'))).toBe(false);
      await page.screenshot({ path: info.outputPath('binding-live-isolated-sessions.png') }); expect(pageErrors).toEqual([]);
    }, info);
  });

  test('实际USE改变上下文后旧绑定更新拒绝，明确另存及再次打开不替换原会话事务', async ({}, info) => {
    test.setTimeout(180000);
    await isolatedDatabase(async context => {
      await fixtures(context); const { database } = context; await openDatabaseQuery(database);
      await executeSql(`CREATE TEMPORARY TABLE binding_session_token(marker VARCHAR(20));INSERT INTO binding_session_token VALUES('切库会话');START TRANSACTION;UPDATE binding_subject SET note='切库前未提交' WHERE id=${firstId}`);
      const before = await probe(database, firstId, '切库会话', '切库前未提交');
      const dangerous = `UPDATE ${isolatedName(database)}.binding_subject SET note='USE另存不能自动执行' WHERE id=${firstId}`;
      await writeSql(dangerous); const beforeCreate = await historyIds(); await save('另存为新查询', '切库前来源'); await expect(saveDialog()).toBeHidden(); expect(await historyIds()).toEqual(beforeCreate);
      const original = (await records())[0]; expect(original.databaseContext).toEqual({ state: 'known', database });
      // information_schema 为只读系统目录，仅用于真实 USE，不在其中建表或修改数据。
      await executeSql('USE information_schema'); await expect(query().getByLabel('当前查询默认库', { exact: true })).toHaveText('information_schema');
      await writeSql(dangerous + '; -- 切库后的明确副本'); const beforeSave = await historyIds();
      await save('保存到原查询'); await expect(saveDialog().getByRole('alert')).toContainText('默认库状态已变化'); expect(await historyIds()).toEqual(beforeSave);
      const unchanged = (await records()).find(record => record.id === original.id)!; expect(unchanged).toEqual(original);
      await saveDialog().getByLabel('查询名称', { exact: true }).fill('切库后副本'); await saveDialog().getByRole('button', { name: '另存为新查询', exact: true }).click(); await expect(saveDialog()).toBeHidden();
      expect(await historyIds()).toEqual(beforeSave); const copy = (await records()).find(record => record.name === '切库后副本')!; expect(copy.id).not.toBe(original.id); expect(copy.databaseContext).toEqual({ state: 'known', database: 'information_schema' });
      const after = await probe(database, firstId, '切库会话', '切库前未提交', 'information_schema'); expect(after.sessionId).toBe(before.sessionId);
      const beforeOpen = await historyIds(); await openSaved('切库后副本'); expect(await historyIds()).toEqual(beforeOpen); await expect(query().getByLabel('当前查询默认库', { exact: true })).toHaveText('information_schema');
      await activate(0, '切库后副本'); expect(await query().locator('.result-body').innerText()).toBe(after.text); await expect(query().getByRole('button', { name: '提交', exact: true })).toBeEnabled();
      expect((await probe(database, firstId, '切库会话', '切库前未提交', 'information_schema')).sessionId).toBe(before.sessionId);
      await rollback(); expect((await probe(database, firstId, '切库会话', '原值甲', 'information_schema')).sessionId).toBe(before.sessionId);
      expect(await committed(context)).toEqual([{ id: firstId, note: '原值甲' }, { id: secondId, note: '原值乙' }]);
      expect((await records()).find(record => record.id === original.id)).toEqual(original);
      expect((await page.evaluate(() => window.dbark.invoke('history.list', {}))).some(entry => entry.sql.includes('USE另存不能自动执行'))).toBe(false);
      await page.screenshot({ path: info.outputPath('binding-live-use-context.png') }); expect(pageErrors).toEqual([]);
    }, info);
  });
});
