import { randomUUID } from 'node:crypto';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { closeMysqlConnection } from '../../src/engine/connection';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit } from './desktop-fixture';
import { connectAndCreate, environment } from './live-helpers';
import { bindTableCreateMariaTarget, assertMariaCreateFacts, mariaCreateFactSql, type MariaCreateVersion } from '../helpers/tableCreateMariaTarget';
import { tableCreateZh as text } from '../../src/renderer/locales/tableCreate.zh-CN';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';

/** 同一原生流strict QUIT和真实close均须完成，Promise end及缺流不能作为替代证明。 */
async function closeMariaObserver(observer: Connection): Promise<void> {
  type Native = Parameters<typeof closeMysqlConnection>[0] & { stream?: { closed?: boolean; once?: unknown; removeListener?: unknown; end?: unknown; destroy?: unknown } };
  const native = (observer as unknown as { connection?: Native }).connection, stream = native?.stream;
  if (!native || !stream || typeof native.end !== 'function' || typeof native.destroy !== 'function' || [stream.once, stream.removeListener, stream.end, stream.destroy].some(method => typeof method !== 'function')) throw Error('Maria预检原生流未知，保留现场');
  await closeMysqlConnection(native, true);
  if (native.stream !== stream || stream.closed !== true) throw Error('Maria预检底层close未确认，保留现场');
}
/** 原设计器/预览/单次确认链的独立正式定义；不修改共享fixture/helper或原45秒预算。 */
export function registerTableCreateMariaUiTests(version: MariaCreateVersion) {
  const binding = bindTableCreateMariaTarget(version, () => process.env, environment), states = new WeakMap<object, { active: boolean; retain(): void; check(): void }>();
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); test.describe.configure({ retries: 0 });
  test.afterEach(async ({}, info) => { const state = states.get(info); if (!state || state.active) { if (state) state.retain(); else try { retainOwnedDesktopResources(info); } catch { /* 无归属状态时仍拒绝继续。 */ } throw Error('Maria用例或收尾仍活动，保留现场'); } state.check(); });
  test(`MariaDB${version}普通INT主键、文字NULL默认及普通唯一索引经预览一次CREATE与目录树后核`, async ({}, info) => {
    const captured = ownedDesktopResources(info), page = captured.page, target = binding.target, database = 'dbark_create_' + randomUUID().replaceAll('-', '');
    let retained = false;
    /** 本地锁先于共享通知；通知失败或恢复、迟到响应及activity结束均不能解除本例保留。 */
    const retain = () => { if (retained) return; retained = true; try { retainOwnedDesktopResources(info); } catch { /* 只尽力通知一次，保留原首因。 */ } };
    const own = (allowClosed = false) => { if (retained) throw Error('Maria本例已停链保留，禁止继续观察、退出或清理'); try { binding.assertCurrent(); const current = ownedDesktopResources(info); if (current.page !== page || current.application !== captured.application || !allowClosed && current.closed) throw Error('Maria所属窗口未知'); return current; } catch (reason) { retain(); throw reason; } };
    const activity = { active: true, retain, check: () => { own(true); } }; states.set(info, activity);
    const observe = async <T>(action: () => Promise<T>, allowClosed = false): Promise<T> => { own(allowClosed); try { const result = await action(); own(allowClosed); return result; } catch (reason) { retain(); throw reason; } };
    /** 两个准确Maria实例只用本轮RAM指纹，在隔离DDL前核版本/模式及引擎编码，不探测MySQL变量。 */
    let confirmedFacts: string | undefined;
    const facts = async (connection: Connection) => {
      const [rows] = await observe(() => connection.query<RowDataPacket[]>(mariaCreateFactSql));
      const actual = assertMariaCreateFacts(rows, target); if (confirmedFacts !== undefined && actual !== confirmedFacts) throw Error('Maria本轮RAM指纹或会话能力变化'); confirmedFacts = actual;
      const [engines] = await observe(() => connection.query<RowDataPacket[]>("SELECT ENGINE AS engine,SUPPORT AS support FROM information_schema.ENGINES WHERE ENGINE='InnoDB' LIMIT 2")); expect(engines).toHaveLength(1); expect(engines[0].engine).toBe('InnoDB'); expect(['YES', 'DEFAULT']).toContain(engines[0].support);
      const [charsets] = await observe(() => connection.query<RowDataPacket[]>("SELECT CHARACTER_SET_NAME AS charset FROM information_schema.CHARACTER_SETS WHERE CHARACTER_SET_NAME='utf8mb4' LIMIT 2")); expect(charsets).toHaveLength(1); expect(charsets[0].charset).toBe('utf8mb4');
    };
    const options = { host: target.host, port: target.port, user: target.user, password: target.password, charset: 'utf8mb4', connectTimeout: 15000 };
    let observer: Connection | undefined, ownsName = false, primary: { reason: unknown } | undefined;
    try {
      const preflight = await observe(() => mysql.createConnection(options)); let failure: { reason: unknown } | undefined;
      try { await facts(preflight); } catch (reason) { failure = { reason }; throw reason; }
      finally { try { await observe(() => closeMariaObserver(preflight)); } catch (reason) { if (failure) throw new AggregateError([failure.reason, reason], 'Maria身份预检失败且严格收尾未确认', { cause: failure.reason }); throw reason; } }
      observer = await observe(() => mysql.createConnection(options)); const connection = observer; await facts(connection);
      const [existing] = await observe(() => connection.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database])); expect(existing).toHaveLength(0); ownsName = true;
      const context = await connectAndCreate(database, { page, application: captured.application, assertCurrent: () => { own(); } }); own();
      const ui = (action: () => Promise<unknown>) => observe(action), node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: context.connectionName, exact: true }) }), db = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
      await ui(() => db.getByRole('button', { name: database, exact: true }).click()); await ui(() => expect(db.getByRole('button', { name: database, exact: true })).toHaveAttribute('aria-expanded', 'true')); await ui(() => db.getByRole('button', { name: database, exact: true }).focus()); await ui(() => db.getByRole('button', { name: zh.sidebar.text017, exact: true }).click());
      const designer = page.getByRole('dialog', { name: formatText(zh.schema.text009, database), exact: true }); await ui(() => designer.getByLabel(zh.schema.text010, { exact: true }).fill('daily_new_table'));
      // 显式普通INT主键；文字NULL经真实开关选择，另一个VARCHAR保留普通文字默认。
      await ui(() => designer.getByLabel(formatText(zh.schema.text019, 1), { exact: true }).fill('int')); await ui(() => designer.getByLabel(formatText(zh.schema.text021, 1), { exact: true }).uncheck());
      for (const [ordinal, name, value] of [[2, 'literal_null', 'NULL'], [3, 'note', '普通默认']] as const) {
        await ui(() => designer.getByRole('button', { name: zh.schema.text027, exact: true }).click()); await ui(() => designer.getByLabel(formatText(zh.schema.text018, ordinal), { exact: true }).fill(name)); await ui(() => designer.getByLabel(formatText(zh.schema.text019, ordinal), { exact: true }).fill('varchar(64)')); await ui(() => designer.getByLabel(formatText(zh.schema.text022, ordinal), { exact: true }).fill(value));
      }
      await ui(() => designer.getByLabel(formatText(zh.schema.literalNullLabel, 2), { exact: true }).check());
      await ui(() => designer.getByRole('button', { name: new RegExp('^' + zh.common.indexes) }).click());
      for (const [ordinal, name, columns, unique] of [[2, 'uq_literal', 'literal_null', true], [3, 'ix_note', 'note, id', false]] as const) {
        await ui(() => designer.getByRole('button', { name: zh.schema.text036, exact: true }).click()); await ui(() => designer.getByLabel(formatText(zh.schema.text031, ordinal), { exact: true }).fill(name)); if (unique) await ui(() => designer.getByLabel(formatText(zh.schema.text033, ordinal), { exact: true }).check()); await ui(() => designer.getByLabel(formatText(zh.schema.text034, ordinal), { exact: true }).fill(columns));
      }
      await ui(() => designer.getByRole('button', { name: zh.schema.text049, exact: true }).click());
      const dialog = page.getByRole('dialog', { name: text.title, exact: true }); await ui(() => expect(dialog.locator('.monaco-editor .view-lines')).toContainText('CREATE TABLE')); await ui(() => expect(dialog.locator('.monaco-editor .view-lines')).toContainText("DEFAULT 'NULL'")); await ui(() => expect(dialog.locator('.monaco-editor .view-lines')).toContainText('KEY `ix_note` (`note`, `id`)'));
      const [absent] = await observe(() => connection.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [database, 'daily_new_table'])); expect(absent).toHaveLength(0);
      for (const label of [text.ackDdl, text.ackCreate]) await ui(() => dialog.getByRole('checkbox', { name: label, exact: true }).check()); await ui(() => dialog.getByLabel(text.confirmation, { exact: true }).fill(database + '.daily_new_table ')); await ui(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeDisabled()); await ui(() => dialog.getByLabel(text.confirmation, { exact: true }).fill(database + '.daily_new_table')); await ui(() => dialog.getByRole('button', { name: text.apply, exact: true }).dblclick()); await ui(() => expect(dialog.getByRole('status')).toHaveText(text.succeeded)); await ui(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeDisabled());
      const [columns] = await observe(() => connection.query<RowDataPacket[]>('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [database, 'daily_new_table']));
      expect(columns.map(row => [row.COLUMN_NAME, row.COLUMN_TYPE, row.IS_NULLABLE, row.COLUMN_DEFAULT, row.EXTRA])).toEqual([['id', 'int(11)', 'NO', null, ''], ['literal_null', 'varchar(64)', 'YES', "'NULL'", ''], ['note', 'varchar(64)', 'YES', "'普通默认'", '']]);
      const [indexes] = await observe(() => connection.query<RowDataPacket[]>('SELECT INDEX_NAME,NON_UNIQUE,COLUMN_NAME,SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY BINARY INDEX_NAME,SEQ_IN_INDEX', [database, 'daily_new_table'])); expect(indexes.map(row => [row.INDEX_NAME, Number(row.NON_UNIQUE), row.COLUMN_NAME, Number(row.SEQ_IN_INDEX)])).toEqual([['PRIMARY', 0, 'id', 1], ['ix_note', 1, 'note', 1], ['ix_note', 1, 'id', 2], ['uq_literal', 0, 'literal_null', 1]]);
      const [ddl] = await observe(() => connection.query<RowDataPacket[]>('SHOW CREATE TABLE ' + '`' + database + '`.`daily_new_table`')); expect(ddl).toHaveLength(1); expect(ddl[0]['Create Table']).toContain("DEFAULT 'NULL'"); expect(ddl[0]['Create Table']).toContain('KEY `ix_note` (`note`,`id`)'); const [empty] = await observe(() => connection.query<RowDataPacket[]>('SELECT 1 FROM ' + '`' + database + '`.`daily_new_table` LIMIT 1')); expect(empty).toHaveLength(0);
      const tasks = await observe(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks.filter(task => task.kind === 'schema.tableCreate.apply')).toHaveLength(1); await ui(() => dialog.getByRole('button', { name: text.close, exact: true }).click()); await ui(() => expect(node.locator('.object-row').getByText('daily_new_table', { exact: true })).toBeVisible());
    } catch (reason) { primary = { reason }; retain(); throw reason; }
    finally {
      try {
        const tasks = await observe(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); if (!Array.isArray(tasks) || tasks.some(task => (task.kind.startsWith('schema.tableCreate.') || task.kind.startsWith('schema.databaseCreate.')) && (task.kind.endsWith('.apply') ? task.status !== 'completed' : !['completed', 'failed', 'cancelled'].includes(task.status)))) throw Error('Maria建库或建表任务未确认终态');
        await observe(() => confirmOwnedDesktopExit(info), true); own(true); if (!/^dbark_create_[a-f0-9]{32}$/.test(database) || !ownsName || !observer) throw Error('Maria隔离资源归属未知'); await observe(() => observer!.query('DROP DATABASE IF EXISTS `' + database + '`'), true); const [remaining] = await observe(() => observer!.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]), true); expect(remaining).toHaveLength(0); await observe(() => closeMariaObserver(observer!), true);
      } catch (reason) { retain(); if (primary) throw new AggregateError([primary.reason, reason], '原Maria新建表用例失败且收尾未确认', { cause: primary.reason }); throw reason; }
      finally { activity.active = false; }
    }
  });
}
