import { clickSidebarAction } from './sidebar-menu';
// 沿固定c138复制结构正式流程追加VIRTUAL/STORED场景；实际0。
import { randomUUID } from 'node:crypto';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import type { TestInfo } from '@playwright/test';
import { closeMysqlConnection } from '../../src/engine/connection';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit } from './desktop-fixture';
import { connectAndCreate, environment } from './live-helpers';
import { tableCopyStructureZh as text } from '../../src/renderer/locales/tableCopyStructure.zh-CN';
import { bindTableCopyGeneratedTarget } from '../helpers/tableCopyGeneratedTarget';

/** Promise end不足以证明关闭；同一原生流必须经过严格QUIT及底层close，缺失不能降级。 */
async function closeGeneratedObserver(observer: Connection): Promise<void> {
  type Native = Parameters<typeof closeMysqlConnection>[0] & { stream?: { closed?: boolean; once?: unknown; removeListener?: unknown; end?: unknown; destroy?: unknown } };
  const native = (observer as unknown as { connection?: Native }).connection, stream = native?.stream;
  if (!native || !stream || typeof native.end !== 'function' || typeof native.destroy !== 'function' || [stream.once, stream.removeListener, stream.end, stream.destroy].some(method => typeof method !== 'function')) throw Error('生成列验收原生连接或底层流未知，保留现场');
  await closeMysqlConnection(native, true);
  if (native.stream !== stream || stream.closed !== true) throw Error('生成列验收底层close未确认，保留现场');
}

/** 只清理本例已证明终态的资源；每个等待前后仍核固定身份，原首因保持在聚合首位。 */
async function cleanupGeneratedCase(info: TestInfo, own: (allowClosed?: boolean) => ReturnType<typeof ownedDesktopResources>, retain: () => void, observer: Connection | undefined, database: string, ownsName: boolean, primary?: { reason: unknown }): Promise<void> {
  try {
    own();
    const tasks = await own().page.evaluate(() => window.dbark.invoke('tasks.list', {})); own();
    if (!Array.isArray(tasks) || tasks.some(task => (task.kind.startsWith('schema.tableCopyStructure.') || task.kind.startsWith('schema.databaseCreate.')) && (task.kind.endsWith('.apply') ? task.status !== 'completed' : !['completed', 'failed', 'cancelled'].includes(task.status)))) throw Error('生成列复制或建库任务未确认终态，保留现场');
    await confirmOwnedDesktopExit(info); own(true);
    if (!/^dbark_copy_[a-f0-9]{32}$/.test(database) || !ownsName || !observer) throw Error('生成列隔离资源归属未确认，保留现场');
    await observer.query('DROP DATABASE IF EXISTS `' + database + '`'); own(true);
    const [remaining] = await observer.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]); own(true); expect(remaining).toHaveLength(0);
    await closeGeneratedObserver(observer); own(true);
  } catch (reason) {
    try { retain(); } catch { /* 本例已先落本地锁；通知失败不能覆盖原首因。 */ }
    if (primary) throw new AggregateError([primary.reason, reason], '原生成列UI失败且隔离收尾未确认，保留现场', { cause: primary.reason }); throw reason;
  }
}
/** 只注册未执行定义；不修改共享fixture，ROOT须另行安排固定候选与实际服务器终态证明。 */
export function registerTableCopyGeneratedUiTests() {
  const binding = bindTableCopyGeneratedTarget(() => process.env, environment);
  const states = new WeakMap<object, { active: boolean; retain(): void; check(): void }>();
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(120000); test.describe.configure({ retries: 0 });
  // 超时不等待原body结束；用途先停链保留，禁止自动夹具抢先退出仍在等待的用例。
  test.afterEach(async ({}, info) => { const state = states.get(info); if (!state || state.active) { if (state) state.retain(); else try { retainOwnedDesktopResources(info); } catch { /* 缺少本例状态也不因通知失败继续。 */ } throw Error('生成列用例或收尾仍活动，保留现场'); } state.check(); });
  for (const storage of ['VIRTUAL', 'STORED'] as const) test('MySQL8.4.11普通生成列'+storage+'先展示DDL和准确确认，单次创建空表并保持源数据与结构', async ({}, info) => {
    const target = binding.target, captured = ownedDesktopResources(info), page = captured.page, database = 'dbark_copy_' + randomUUID().replaceAll('-', '');
    let retained = false;
    /** 本地永久落锁先于共享通知；通知失败、恢复和activity结束都不解除本例保留。 */
    const retain = () => { if (retained) return; retained = true; try { retainOwnedDesktopResources(info); } catch { /* 只尽力通知一次，不能覆盖原首因或放行清理。 */ } };
    /** 固定窗口及注册身份共同组成owner；失效后不重新捕获目标，也不自动退出清库。 */
    const own = (allowClosed = false) => {
      if (retained) throw Error('生成列本例已停链保留，禁止继续观察、退出或清理');
      try { binding.assertCurrent(); const current = ownedDesktopResources(info); if (current.page !== captured.page || current.application !== captured.application || !allowClosed && current.closed) throw Error('生成列验收窗口归属或关闭状态未知'); return current; }
      catch (reason) { retain(); throw reason; }
    };
    const activity = { active: true, retain, check: () => { own(true); } }; states.set(info, activity);
    let observer: Connection | undefined, ownsName = false, primary: { reason: unknown } | undefined;
    /** 观察SQL未知或归属变化立即保留，禁止finally继续猜测清库。 */
    const observe = async <T>(request: () => Promise<T>): Promise<T> => { own(); try { const value = await request(); own(); return value; } catch (reason) { retain(); throw reason; } };
    /** 准确四项事实不能用宽松数字转换补证；每个新物理观察连接都重核。 */
    const facts = async (connection: Connection) => {
      const [rows] = await observe(() => connection.query<RowDataPacket[]>('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid'));
      own(); expect(rows).toHaveLength(1); expect(String(rows[0].version)).toMatch(/^8\.4\.11(?:[-+].*)?$/); expect(['linux', 'debian-linux-gnu']).toContain(String(rows[0].os).toLowerCase()); expect([0, '0']).toContain(rows[0].names); expect(rows[0].uuid).toBe(target.uuid);
    };
    try {
      const options = { host: target.host, port: target.port, user: target.user, password: target.password, charset: 'utf8mb4', connectTimeout: 15000 };
      // 预检连接无默认库；它的严格close完成前，不能进入任何隔离建库或表DDL。
      const preflight = await observe(() => mysql.createConnection(options)); let preflightFailure: { reason: unknown } | undefined;
      try { await facts(preflight); }
      catch (reason) { preflightFailure = { reason }; throw reason; }
      finally { try { await observe(() => closeGeneratedObserver(preflight)); } catch (reason) { if (preflightFailure) throw new AggregateError([preflightFailure.reason, reason], '身份预检失败且原生收尾未确认', { cause: preflightFailure.reason }); throw reason; } }
      own(); observer = await observe(() => mysql.createConnection(options)); const connection = observer;
      await facts(connection); own();
      const [existing] = await observe(() => connection.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database])); expect(existing).toHaveLength(0); ownsName = true;
      const context = await connectAndCreate(database, { page, application: captured.application, assertCurrent: () => { own(); } }); own();
      const source = '`' + database + '`.`copy_source`', destination = '`' + database + '`.`copy_destination`';
      await observe(() => connection.query(`CREATE TABLE ${source} (id int NOT NULL,price decimal(30,12) NOT NULL,total decimal(50,12) GENERATED ALWAYS AS (id * price + 9007199254740993.123456789012) ${storage},note varchar(80) DEFAULT NULL,PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='合成生成列来源'`));
      await observe(() => connection.query(`INSERT INTO ${source} (id,price,note) VALUES(1,2.000000000001,'源行不会复制')`));
      const [before] = await observe(() => connection.query<RowDataPacket[]>('SHOW CREATE TABLE ' + source)); const [rowsBefore] = await observe(() => connection.query<RowDataPacket[]>('SELECT id,note FROM ' + source));
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: context.connectionName, exact: true }) }); await node.getByRole('button', { name: context.connectionName, exact: true }).focus(); own(); await clickSidebarAction(node, { name: '刷新连接', exact: true }); own(); await (await (await import('./navigation-menu')).navigationMenuItem(node.locator('.database-row'), { name: database, exact: true }, own)).click(); own(); await node.locator('.object-row').getByText('copy_source', { exact: true }).click(); own();
      const table = page.locator('.table-tab:visible'); await expect(table.locator('.loading-overlay')).toHaveCount(0); own(); await (await (await import('./navigation-menu')).navigationMenuItem(table, { name: text.title, exact: true }, own)).click(); own();
      const dialog = page.getByRole('dialog', { name: text.title, exact: true }); await expect(dialog.getByRole('heading', { name: text.sourceDdl, exact: true })).toBeVisible(); own(); await dialog.getByRole('textbox', { name: text.newName, exact: true }).fill('copy_destination'); own(); await (await (await import('./navigation-menu')).navigationMenuItem(dialog, { name: text.preview, exact: true }, own)).click(); own(); await expect(dialog.locator('.monaco-editor .view-lines').last()).toContainText('LIKE'); own();
      const [absent] = await observe(() => connection.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [database, 'copy_destination'])); expect(absent).toHaveLength(0);
      await expect(dialog.getByRole('heading', { name: text.generated, exact: true })).toBeVisible(); own(); await expect(dialog).toContainText(storage === 'VIRTUAL' ? text.generatedVirtual : text.generatedStored); own();
      const submit = dialog.getByRole('button', { name: text.apply, exact: true }); for (const label of [text.ackImplicit, text.ackScope, text.ackWindow, text.ackGenerated]) { await dialog.getByRole('checkbox', { name: label, exact: true }).check(); own(); }
      await dialog.getByRole('textbox', { name: text.confirmation, exact: true }).fill(database + '.copy_destination '); own(); await expect(submit).toBeDisabled(); own(); await dialog.getByRole('textbox', { name: text.confirmation, exact: true }).fill(database + '.copy_destination'); own(); await submit.dblclick(); own(); await expect(dialog.locator('.table-copy-structure-outcome')).toHaveText(text.succeeded, { timeout: 30000 }); own(); await expect(submit).toBeDisabled(); own();
      const [after] = await observe(() => connection.query<RowDataPacket[]>('SHOW CREATE TABLE ' + source)); const [rowsAfter] = await observe(() => connection.query<RowDataPacket[]>('SELECT id,note FROM ' + source)); const [created] = await observe(() => connection.query<RowDataPacket[]>('SHOW CREATE TABLE ' + destination)); const [empty] = await observe(() => connection.query<RowDataPacket[]>('SELECT 1 FROM ' + destination + ' LIMIT 1'));
      expect(after).toEqual(before); expect(rowsAfter).toEqual(rowsBefore); expect(empty).toHaveLength(0); const expectedDefinition = String(before[0]['Create Table']).replace('CREATE TABLE `copy_source`', 'CREATE TABLE `copy_destination`'); expect(created[0]['Create Table']).toBe(expectedDefinition);
      const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); own(); expect(tasks.filter(task => task.kind === 'schema.tableCopyStructure.apply')).toHaveLength(1); await (await (await import('./navigation-menu')).navigationMenuItem(dialog, { name: text.close, exact: true }, own)).click(); own(); await expect(node.locator('.object-row').getByText('copy_destination', { exact: true })).toBeVisible(); own();
    } catch (reason) { primary = { reason }; retain(); throw reason; }
    finally { try { await cleanupGeneratedCase(info, own, retain, observer, database, ownsName, primary); } finally { activity.active = false; } }
  });
}
