import { clickSidebarAction } from './sidebar-menu';
import { randomUUID } from 'node:crypto';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { closeMysqlConnection } from '../../src/engine/connection';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit } from './desktop-fixture';
import { connectAndCreate, environment } from './live-helpers';
import { bindTableCreateEncodingTarget } from '../helpers/tableCreateEncodingTarget';
import { tableCreateZh as text } from '../../src/renderer/locales/tableCreate.zh-CN';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';

/** 同一原生流必须strict QUIT并到达close；缺流、换流或回调成功均不能降级为关闭事实。 */
async function closeEncodingObserver(observer: Connection) {
  type Native = Parameters<typeof closeMysqlConnection>[0] & { stream?: { closed?: boolean; once?: unknown; removeListener?: unknown; end?: unknown; destroy?: unknown } };
  const native = (observer as unknown as { connection?: Native }).connection, stream = native?.stream;
  if (!native || !stream || typeof native.end !== 'function' || typeof native.destroy !== 'function' || [stream.once, stream.removeListener, stream.end, stream.destroy].some(method => typeof method !== 'function')) throw Error('新表编码验收原生流未知，保留现场');
  await closeMysqlConnection(native, true);
  if (native.stream !== stream || stream.closed !== true) throw Error('新表编码验收底层close未确认，保留现场');
}
/** 专属隔离壳绑定注册身份并传入原表单内部；不修改共享fixture/helper/退出规则。 */
export function registerTableCreateEncodingUiTests() {
  const binding = bindTableCreateEncodingTarget(() => process.env, environment);
  const states = new WeakMap<object, { active: boolean; retain(): void; check(): void }>();
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); test.describe.configure({ retries: 0 });
  // 超时不会等待原body的Promise结束；活动阶段必须先保留，阻止自动夹具抢先退出。
  test.afterEach(async ({}, info) => { const state = states.get(info); if (!state || state.active) { if (state) state.retain(); else try { retainOwnedDesktopResources(info); } catch { /* 缺少本例状态也不能因通知失败而继续。 */ } throw Error('新表编码用例或收尾仍活动，保留现场'); } state.check(); });
  test('新表显式编码配对经准确预览一次创建，目录及精确默认值完整核验', async ({}, info) => {
    const captured = ownedDesktopResources(info), page = captured.page, target = binding.target, database = 'dbark_encoding_' + randomUUID().replaceAll('-', '');
    let retained = false;
    /** 先永久锁定本例，再尽力通知共享夹具；通知失败或恢复均不能解除本地保留或覆盖首因。 */
    const retain = () => { if (retained) return; retained = true; try { retainOwnedDesktopResources(info); } catch { /* 原因优先，不重试通知或借通知失败继续清理。 */ } };
    const own = (allowClosed = false) => { if (retained) throw Error('新表编码本例已停链保留，禁止继续观察、退出或清理'); try { binding.assertCurrent(); const current = ownedDesktopResources(info); if (current.page !== page || current.application !== captured.application || !allowClosed && current.closed) throw Error('新表编码验收窗口归属未知'); return current; } catch (reason) { retain(); throw reason; } };
    const activity = { active: true, retain, check: () => { own(true); } }; states.set(info, activity);
    const observe = async <T>(action: () => Promise<T>, allowClosed = false): Promise<T> => { own(allowClosed); try { const value = await action(); own(allowClosed); return value; } catch (reason) { retain(); throw reason; } };
    const facts = async (connection: Connection) => { const [rows] = await observe(() => connection.query<RowDataPacket[]>('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid')); expect(rows).toHaveLength(1); expect(String(rows[0].version)).toMatch(/^8\.4\.11(?:[-+].*)?$/); expect(['linux', 'debian-linux-gnu']).toContain(String(rows[0].os).toLowerCase()); expect([0, '0']).toContain(rows[0].names); expect(rows[0].uuid).toBe(target.uuid); };
    const options = { host: target.host, port: target.port, user: target.user, password: target.password, charset: 'utf8mb4', connectTimeout: 15000 };
    let observer: Connection | undefined, ownsName = false, primary: { reason: unknown } | undefined;
    try {
      const preflight = await observe(() => mysql.createConnection(options)); let failure: { reason: unknown } | undefined;
      try { await facts(preflight); } catch (reason) { failure = { reason }; throw reason; }
      finally { try { await observe(() => closeEncodingObserver(preflight)); } catch (reason) { if (failure) throw new AggregateError([failure.reason, reason], '原身份预检失败且收尾未确认', { cause: failure.reason }); throw reason; } }
      observer = await observe(() => mysql.createConnection(options)); const connection = observer; await facts(connection);
      const [existing] = await observe(() => connection.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database])); expect(existing).toHaveLength(0); ownsName = true;
      const context = await connectAndCreate(database, { page, application: captured.application, assertCurrent: () => { own(); } }); own();
      const ui = (action: () => Promise<unknown>) => observe(action);
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: context.connectionName, exact: true }) });
      const db = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
      await ui(() => db.getByRole('button', { name: database, exact: true }).click()); await ui(() => expect(db.getByRole('button', { name: database, exact: true })).toHaveAttribute('aria-expanded', 'true')); await ui(() => db.getByRole('button', { name: database, exact: true }).focus()); await ui(() => clickSidebarAction(db, { name: zh.sidebar.text017, exact: true }));
      const designer = page.getByRole('dialog', { name: formatText(zh.schema.text009, database), exact: true });
      await ui(() => designer.getByLabel(zh.schema.text010, { exact: true }).fill('encoded_new_table'));
      await ui(() => designer.getByRole('button', { name: zh.schema.text027, exact: true }).click());
      await ui(() => designer.getByLabel(formatText(zh.schema.text018, 2), { exact: true }).fill('amount')); await ui(() => designer.getByLabel(formatText(zh.schema.text019, 2), { exact: true }).fill('decimal(30,12)')); await ui(() => designer.getByLabel(formatText(zh.schema.text020, 2), { exact: true }).uncheck()); await ui(() => designer.getByLabel(formatText(zh.schema.text022, 2), { exact: true }).fill('123456789012345678.123456789012'));
      await ui(() => designer.getByRole('button', { name: zh.schema.text049, exact: true }).click());
      const dialog = page.getByRole('dialog', { name: text.title, exact: true }); await ui(() => dialog.getByRole('button', { name: text.encodingChoose, exact: true }).click());
      await ui(() => dialog.getByRole('combobox', { name: text.charset, exact: true }).selectOption('utf8mb4')); await ui(() => dialog.getByRole('combobox', { name: text.collation, exact: true }).selectOption('utf8mb4_bin')); await ui(() => dialog.getByRole('button', { name: text.preview, exact: true }).click());
      await ui(() => expect(dialog.locator('.monaco-editor .view-lines')).toContainText('DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_bin')); await ui(() => expect(dialog.locator('.monaco-editor .view-lines')).toContainText('123456789012345678.123456789012'));
      const [absent] = await observe(() => connection.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [database, 'encoded_new_table'])); expect(absent).toHaveLength(0);
      for (const label of [text.ackDdl, text.ackCreate]) await ui(() => dialog.getByRole('checkbox', { name: label, exact: true }).check());
      await ui(() => dialog.getByLabel(text.confirmation, { exact: true }).fill(database + '.encoded_new_table ')); await ui(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeDisabled()); await ui(() => dialog.getByLabel(text.confirmation, { exact: true }).fill(database + '.encoded_new_table')); await ui(() => dialog.getByRole('button', { name: text.apply, exact: true }).dblclick());
      await ui(() => expect(dialog.getByRole('status')).toHaveText(text.succeeded)); await ui(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeDisabled());
      const [tables] = await observe(() => connection.query<RowDataPacket[]>('SELECT TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [database, 'encoded_new_table'])); expect(tables).toHaveLength(1); expect(tables[0].TABLE_COLLATION).toBe('utf8mb4_bin');
      const [columns] = await observe(() => connection.query<RowDataPacket[]>('SELECT COLUMN_NAME,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [database, 'encoded_new_table'])); expect(columns.map(row => row.COLUMN_NAME)).toEqual(['id', 'amount']); expect(columns[1].COLUMN_DEFAULT).toBe('123456789012345678.123456789012');
      const tasks = await observe(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks.filter(task => task.kind === 'schema.tableCreate.apply')).toHaveLength(1);
      await ui(() => dialog.getByRole('button', { name: text.close, exact: true }).click()); await ui(() => expect(node.locator('.object-row').getByText('encoded_new_table', { exact: true })).toBeVisible());
    } catch (reason) { primary = { reason }; retain(); throw reason; }
    finally {
      try {
        const tasks = await observe(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})));
        if (!Array.isArray(tasks) || tasks.some(task => (task.kind.startsWith('schema.tableCreate.') || task.kind.startsWith('schema.databaseCreate.')) && (task.kind.endsWith('.apply') ? task.status !== 'completed' : !['completed', 'failed', 'cancelled'].includes(task.status)))) throw Error('新表编码任务未确认终态，保留现场');
        await observe(() => confirmOwnedDesktopExit(info), true); own(true);
        if (!/^dbark_encoding_[a-f0-9]{32}$/.test(database) || !ownsName || !observer) throw Error('新表编码隔离资源未知，保留现场');
        await observe(() => observer!.query('DROP DATABASE IF EXISTS `' + database + '`'), true);
        const [remaining] = await observe(() => observer!.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]), true); expect(remaining).toHaveLength(0);
        await observe(() => closeEncodingObserver(observer!), true);
      } catch (reason) { retain(); if (primary) throw new AggregateError([primary.reason, reason], '原新表编码用例失败且收尾未确认', { cause: primary.reason }); throw reason; }
      finally { activity.active = false; }
    }
  });
}
