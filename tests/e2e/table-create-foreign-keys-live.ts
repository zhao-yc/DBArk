import mysql, { type Connection, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import type { TestInfo, Page, ElectronApplication } from '@playwright/test';
import { closeMysqlConnection } from '../../src/engine/connection';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit } from './desktop-fixture';
import { connectAndCreate, environment, type LiveContext } from './live-helpers';
import { tableCreateForeignKeysTarget, bindTableCreateForeignKeysTarget } from '../helpers/tableCreateForeignKeysTarget';
import { assertForeignKeysUiSettled, observeForeignKeysUi, type ForeignKeysUiOwner, type ForeignKeysUiState } from '../helpers/tableCreateForeignKeysLifecycle';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { tableCreateZh as text } from '../../src/renderer/locales/tableCreate.zh-CN';
const states = new WeakMap<TestInfo, { owner: ForeignKeysUiOwner; state: ForeignKeysUiState; readTasks(): Promise<unknown> }>();

/** 每个句柄绑定同一TestInfo；只在已证明任务终态后的afterEach允许读取closed事实。 */
function ownerOf(info: TestInfo, assertIdentity: () => void) {
  const captured = ownedDesktopResources(info);
  const owner: ForeignKeysUiOwner = {
    assertCurrent(allowClosed = false) { try { assertIdentity(); const current = ownedDesktopResources(info); if (current.page !== captured.page || current.application !== captured.application || !allowClosed && current.closed) throw Error('复合外键验收窗口归属或关闭状态未知'); } catch (reason) { retainOwnedDesktopResources(info); throw reason; } },
    closed() { this.assertCurrent(true); return ownedDesktopResources(info).closed; },
    retain() { retainOwnedDesktopResources(info); },
  };
  return { owner, page: captured.page, application: captured.application };
}
/** Promise end不证明传输close；必须有同一原生流，复用产品严格QUIT及底层close等待。 */
async function closeForeignKeysObserver(observer: Connection): Promise<void> {
  type Native = Parameters<typeof closeMysqlConnection>[0] & { stream?: { closed?: boolean; once?: unknown; removeListener?: unknown; end?: unknown; destroy?: unknown } };
  const native = (observer as unknown as { connection?: Native }).connection, stream = native?.stream;
  if (!native || !stream || typeof native.end !== 'function' || typeof native.destroy !== 'function' || [stream.once, stream.removeListener, stream.end, stream.destroy].some(method => typeof method !== 'function')) throw Error('复合外键验收原生连接或底层流未知，保留现场');
  await closeMysqlConnection(native, true);
  if (native.stream !== stream || stream.closed !== true) throw Error('复合外键验收底层close未确认，保留现场');
}
/** 任一DDL之前，先以无默认库的只读连接核本轮UUID/准确版本，且预检close完成后才继续。 */
export async function preflightForeignKeysUi(owner: ForeignKeysUiOwner, state: ForeignKeysUiState, target: ReturnType<typeof tableCreateForeignKeysTarget>): Promise<void> {
  const observer = await observeForeignKeysUi(owner, state, () => mysql.createConnection({ host: target.host, port: target.port, user: target.user, password: target.password, charset: 'utf8mb4', connectTimeout: 15000 }));
  let primary: unknown;
  try {
    const [facts] = await observeForeignKeysUi(owner, state, () => observer.query<RowDataPacket[]>('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid'));
    owner.assertCurrent(); expect(facts).toHaveLength(1); expect(String(facts[0].version)).toMatch(/^8\.4\.11(?:[-+].*)?$/); expect(['linux', 'debian-linux-gnu']).toContain(String(facts[0].os).toLowerCase()); expect([0, '0']).toContain(facts[0].names); expect(facts[0].uuid).toBe(target.uuid);
  } catch (reason) { primary = reason; throw reason; }
  finally {
    try { await observeForeignKeysUi(owner, state, () => closeForeignKeysObserver(observer)); }
    catch (reason) { if (primary) throw new AggregateError([primary, reason], '身份预检失败且连接收尾未确认', { cause: primary }); throw reason; }
  }
}
/** 本例隔离壳将固定身份owner传入原真实表单；原共享helper内部默认owner不能代替本轮身份围栏。 */
async function isolateForeignKeysUi(info: TestInfo, owner: ForeignKeysUiOwner, state: ForeignKeysUiState, target: ReturnType<typeof tableCreateForeignKeysTarget>, desktop: { page: Page; application: ElectronApplication }, readTasks: () => Promise<unknown>, body: (context: LiveContext) => Promise<void>): Promise<void> {
  const database = 'dbark_e2e_fk_' + randomUUID().replaceAll('-', '');
  const observe = <T>(action: () => Promise<T>) => observeForeignKeysUi(owner, state, action);
  const observer = await observe(() => mysql.createConnection({ host: target.host, port: target.port, user: target.user, password: target.password, charset: 'utf8mb4', connectTimeout: 15000 }));
  let ownsName = false, primary: unknown;
  try {
    await observe(async () => { const [facts] = await observer.query<RowDataPacket[]>('SELECT @@version AS version,@@server_uuid AS uuid'); owner.assertCurrent(); expect(facts).toHaveLength(1); expect(String(facts[0].version)).toMatch(/^8\.4\.11(?:[-+].*)?$/); expect(facts[0].uuid).toBe(target.uuid); });
    await observe(async () => { const [existing] = await observer.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]); owner.assertCurrent(); expect(existing).toHaveLength(0); });
    ownsName = true; owner.assertCurrent();
    const context = await connectAndCreate(database, { ...desktop, assertCurrent: () => owner.assertCurrent() }); owner.assertCurrent();
    await body({ observer, ...context }); owner.assertCurrent();
  } catch (reason) { primary = reason; throw reason; }
  finally {
    try {
      await assertForeignKeysUiSettled(owner, state, readTasks); owner.assertCurrent();
      await confirmOwnedDesktopExit(info); owner.assertCurrent(true);
      if (!/^dbark_e2e_fk_[a-f0-9]{32}$/.test(database) || !ownsName) throw Error('复合外键隔离资源归属未确认，保留现场');
      const closedOwner: ForeignKeysUiOwner = { ...owner, assertCurrent: () => owner.assertCurrent(true) };
      await observeForeignKeysUi(closedOwner, state, () => observer.query('DROP DATABASE IF EXISTS `' + database + '`'));
      await observeForeignKeysUi(closedOwner, state, async () => { const [remaining] = await observer.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]); owner.assertCurrent(true); expect(remaining).toHaveLength(0); });
      await observeForeignKeysUi(closedOwner, state, () => closeForeignKeysObserver(observer));
    } catch (reason) {
      state.retained = true; try { owner.retain(); } catch { /* 本地停链保留原首因。 */ }
      if (primary) throw new AggregateError([primary, reason], '原FK用例失败且隔离收尾未确认', { cause: primary }); throw reason;
    }
  }
}
/** 默认关闭的真实定义；不改共享清理、45秒预算或原退出逻辑，不自动重试。 */
export function registerTableCreateForeignKeysUiTests() {
  const binding = bindTableCreateForeignKeysTarget(() => process.env, environment);
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); test.describe.configure({ retries: 0 });
  test.afterEach(async ({}, info) => {
    const value = states.get(info);
    if (!value) { retainOwnedDesktopResources(info); throw Error('复合外键验收缺少所属状态，保留现场'); }
    await assertForeignKeysUiSettled(value.owner, value.state, value.readTasks, true);
  });
  test('新建复合外键表经真实设计器确认一次创建，完整后核并刷新原目录', async ({}, info) => {
    const target = binding.target, { owner, page, application } = ownerOf(info, binding.assertCurrent);
    const state: ForeignKeysUiState = { active: true, pending: 0, tasksVerified: false, retained: false }, readTasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    states.set(info, { owner, state, readTasks });
    /** 所有页面动作和断言都在await前后核同一owner；观察另走未知停链边界。 */
    const ui = async (action: () => Promise<unknown>) => { owner.assertCurrent(); await action(); owner.assertCurrent(); };
    const observe = <T>(action: () => Promise<T>) => observeForeignKeysUi(owner, state, action);
    try {
      await preflightForeignKeysUi(owner, state, target); owner.assertCurrent();
      owner.assertCurrent();
      await isolateForeignKeysUi(info, owner, state, target, { page, application }, readTasks, async context => {
        let failure: unknown;
        try {
          await observe(async () => {
            const [facts] = await context.observer.query<RowDataPacket[]>('SELECT @@version AS version,@@server_uuid AS uuid'); owner.assertCurrent(); expect(facts).toHaveLength(1); expect(String(facts[0].version)).toMatch(/^8\.4\.11(?:[-+].*)?$/); expect(facts[0].uuid).toBe(target.uuid);
            expect(context.database).toMatch(/^dbark_e2e_[a-z0-9_]+$/);
          });
          await observe(async () => {
            const [ack] = await context.observer.query<ResultSetHeader>('CREATE TABLE `' + context.database + '`.`fk_parent` (`parent_a` BIGINT UNSIGNED NOT NULL,`parent_b` BIGINT UNSIGNED NOT NULL,PRIMARY KEY (`parent_a`,`parent_b`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin');
            owner.assertCurrent();
            expect(ack.affectedRows).toBe(0); expect(ack.warningStatus).toBe(0);
          });
          const connection = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: context.connectionName, exact: true }) }), database = connection.locator('.database-row').filter({ has: page.getByRole('button', { name: context.database, exact: true }) });
          await ui(() => database.getByRole('button', { name: context.database, exact: true }).click());
          await ui(() => expect(database.getByRole('button', { name: context.database, exact: true })).toHaveAttribute('aria-expanded', 'true'));
          await ui(() => database.getByRole('button', { name: context.database, exact: true }).focus());
          await ui(() => database.getByRole('button', { name: zh.sidebar.text017, exact: true }).click());
          const designer = page.getByRole('dialog', { name: formatText(zh.schema.text009, context.database), exact: true });
          await ui(() => designer.getByLabel(zh.schema.text010, { exact: true }).fill('fk_child'));
          await ui(() => designer.getByLabel(formatText(zh.schema.text018, 1), { exact: true }).fill('child_a'));
          await ui(() => designer.getByLabel(formatText(zh.schema.text021, 1), { exact: true }).uncheck());
          await ui(() => designer.getByRole('button', { name: zh.schema.text027, exact: true }).click());
          await ui(() => designer.getByLabel(formatText(zh.schema.text018, 2), { exact: true }).fill('child_b'));
          await ui(() => designer.getByLabel(formatText(zh.schema.text019, 2), { exact: true }).fill('bigint unsigned'));
          await ui(() => designer.getByLabel(formatText(zh.schema.text020, 2), { exact: true }).uncheck());
          await ui(() => designer.getByRole('button', { name: new RegExp('^' + zh.common.indexes) }).click());
          await ui(() => designer.getByLabel(formatText(zh.schema.text034, 1), { exact: true }).fill('child_a'));
          await ui(() => designer.getByRole('button', { name: zh.schema.text036, exact: true }).click());
          await ui(() => designer.getByLabel(formatText(zh.schema.text031, 2), { exact: true }).fill('ix_child_fk'));
          await ui(() => designer.getByLabel(formatText(zh.schema.text034, 2), { exact: true }).fill('child_a, child_b'));
          await ui(() => designer.getByRole('button', { name: new RegExp('^' + zh.common.foreignKeys) }).click());
          await ui(() => designer.getByRole('button', { name: zh.schema.text045, exact: true }).click());
          const foreign = designer.locator('.foreign-card');
          for (const [label, value] of [[zh.schema.text037, 'fk_child_parent'], [zh.schema.text038, 'child_a, child_b'], [zh.schema.text039, context.database], [zh.schema.text040, 'fk_parent'], [zh.schema.text041, 'parent_a, parent_b']]) await ui(() => foreign.getByLabel(label, { exact: true }).fill(value));
          // Field把选项文字也包含在label内；按准确可见标签定位其关联select，避免精确label全文失配。
          await ui(() => foreign.locator('label.field').filter({ has: page.getByText(zh.schema.text042, { exact: true }) }).getByRole('combobox').selectOption('CASCADE'));
          await ui(() => foreign.locator('label.field').filter({ has: page.getByText(zh.schema.text043, { exact: true }) }).getByRole('combobox').selectOption('CASCADE'));
          await ui(() => designer.getByRole('button', { name: zh.schema.text049, exact: true }).click());
          const confirmation = page.getByRole('dialog', { name: text.title, exact: true });
          await ui(() => expect(confirmation.locator('.monaco-editor .view-lines')).toContainText('FOREIGN KEY'));
          await observe(async () => { const [absent] = await context.observer.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [context.database, 'fk_child']); expect(absent).toHaveLength(0); });
          for (const label of [text.ackDdl, text.ackCreate]) await ui(() => confirmation.getByRole('checkbox', { name: label, exact: true }).check());
          await ui(() => confirmation.getByLabel(text.confirmation, { exact: true }).fill(context.database + '.fk_child '));
          await ui(() => expect(confirmation.getByRole('button', { name: text.apply, exact: true })).toBeDisabled());
          await ui(() => confirmation.getByLabel(text.confirmation, { exact: true }).fill(context.database + '.fk_child'));
          await ui(() => confirmation.getByRole('button', { name: text.apply, exact: true }).click());
          await ui(() => expect(confirmation.getByRole('status')).toHaveText(text.succeeded));
          await ui(() => expect(confirmation.getByRole('button', { name: text.apply, exact: true })).toBeDisabled());
          await observe(async () => { const tasks = await readTasks(), applies = tasks.filter(task => task.kind === 'schema.tableCreate.apply'); expect(applies).toHaveLength(1); expect(applies[0].status).toBe('completed'); });
          await observe(async () => {
            const [shown] = await context.observer.query<RowDataPacket[]>('SHOW CREATE TABLE `' + context.database + '`.`fk_child`'); expect(shown).toHaveLength(1);
            owner.assertCurrent();
            const ddl = String(shown[0]['Create Table']);
            expect(ddl).toMatch(/KEY `ix_child_fk` \(\s*`child_a`\s*,\s*`child_b`\s*\)/);
            expect(ddl).toMatch(new RegExp('CONSTRAINT `fk_child_parent` FOREIGN KEY \\(\\s*`child_a`\\s*,\\s*`child_b`\\s*\\) REFERENCES (?:`' + context.database + '`\\.)?`fk_parent` \\(\\s*`parent_a`\\s*,\\s*`parent_b`\\s*\\) ON DELETE CASCADE ON UPDATE CASCADE'));
          });
          await observe(async () => {
            const [rc] = await context.observer.query<RowDataPacket[]>('SELECT CONSTRAINT_SCHEMA,CONSTRAINT_NAME,TABLE_NAME,UNIQUE_CONSTRAINT_SCHEMA,REFERENCED_TABLE_NAME,UNIQUE_CONSTRAINT_NAME,MATCH_OPTION,UPDATE_RULE,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=? AND TABLE_NAME=? ORDER BY CONSTRAINT_NAME LIMIT 3', [context.database, 'fk_child']);
            owner.assertCurrent();
            expect(rc).toEqual([{ CONSTRAINT_SCHEMA: context.database, CONSTRAINT_NAME: 'fk_child_parent', TABLE_NAME: 'fk_child', UNIQUE_CONSTRAINT_SCHEMA: context.database, REFERENCED_TABLE_NAME: 'fk_parent', UNIQUE_CONSTRAINT_NAME: 'PRIMARY', MATCH_OPTION: 'NONE', UPDATE_RULE: 'CASCADE', DELETE_RULE: 'CASCADE' }]);
          });
          await observe(async () => {
            const [kcu] = await context.observer.query<RowDataPacket[]>('SELECT CONSTRAINT_NAME,COLUMN_NAME,ORDINAL_POSITION,POSITION_IN_UNIQUE_CONSTRAINT,REFERENCED_TABLE_SCHEMA,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=? AND TABLE_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY CONSTRAINT_NAME,ORDINAL_POSITION LIMIT 4', [context.database, 'fk_child']);
            owner.assertCurrent();
            expect(kcu.map(row => ({ ...row, ORDINAL_POSITION: String(row.ORDINAL_POSITION), POSITION_IN_UNIQUE_CONSTRAINT: String(row.POSITION_IN_UNIQUE_CONSTRAINT) }))).toEqual(['a', 'b'].map((suffix, index) => ({ CONSTRAINT_NAME: 'fk_child_parent', COLUMN_NAME: 'child_' + suffix, ORDINAL_POSITION: String(index + 1), POSITION_IN_UNIQUE_CONSTRAINT: String(index + 1), REFERENCED_TABLE_SCHEMA: context.database, REFERENCED_TABLE_NAME: 'fk_parent', REFERENCED_COLUMN_NAME: 'parent_' + suffix })));
          });
          await ui(() => confirmation.getByRole('button', { name: text.close, exact: true }).click());
          await ui(() => expect(confirmation).toHaveCount(0));
          await ui(() => expect(connection.locator('.object-row').getByText('fk_child', { exact: true })).toBeVisible());
        } catch (reason) { failure = reason; throw reason; }
        finally {
          try { await assertForeignKeysUiSettled(owner, state, readTasks); }
          catch (reason) { if (failure) throw new AggregateError([failure, reason], '原FK用例失败且任务终态未确认，保留现场', { cause: failure }); throw reason; }
        }
      });
    } finally { state.active = false; }
  });
}
