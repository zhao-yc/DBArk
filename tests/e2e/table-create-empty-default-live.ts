import { clickSidebarAction } from './sidebar-menu';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { TestInfo } from '@playwright/test';
import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { assertEmptyDefaultColumns, assertEmptyDefaultDdl, assertEmptyDefaultFacts, assertEmptyDefaultTasks, bindEmptyDefaultTarget, closeEmptyDefaultStream, emptyDefaultFactSql, emptyDefaultGuard, emptyDefaultKeys, finishEmptyDefaultCase, type EmptyDefaultGuard } from '../helpers/tableCreateEmptyDefault';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { tableCreateZh as text } from '../../src/renderer/locales/tableCreate.zh-CN';

/** 专用正式场景；不导入会读取本地env的共享live-helpers，不改旧case或45秒预算。 */
export function registerTableCreateEmptyDefaultUiTests() {
  // 注册发生在实际测试及自动桌面fixture之前；单调截止比原45秒结束更早，不从body重新计时。
  const deadline = performance.now() + 45000;
  const helper: Record<string, string | undefined> = {};
  for (const key of emptyDefaultKeys) if (Object.hasOwn(process.env, key)) helper[key] = process.env[key];
  const binding = bindEmptyDefaultTarget(() => process.env, helper);
  if (process.platform !== 'win32') throw Error('空串正式UI仅允许Root安排的Windows宿主');
  // 显式目标先核一致性，才加载桌面与驱动；默认/list入口完全不进入这里。
  const { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit } = require('./desktop-fixture') as typeof import('./desktop-fixture');
  const mysql = require('mysql2/promise') as typeof import('mysql2/promise');
  const { closeMysqlConnection } = require('../../src/engine/connection') as typeof import('../../src/engine/connection');
  const states = new WeakMap<TestInfo, EmptyDefaultGuard>();
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
  test.describe.configure({ retries: 0 });
  test.afterEach(async ({}, info) => {
    const guard = states.get(info);
    if (!guard) { try { retainOwnedDesktopResources(info); } catch { /* 无本例状态也不能放行共享清理。 */ } throw Error('空串验收缺少活动归属状态'); }
    guard.afterEach();
  });
  test('新建表空串默认可取消和被输入替换，文字NULL与SQL NULL及普通默认经只读预览一次确认与独立目录后核', async ({ trace, screenshot, video }, info) => {
    const captured = ownedDesktopResources(info), page = captured.page, target = binding.target;
    const guard = emptyDefaultGuard({
      now: () => performance.now(), retain: () => retainOwnedDesktopResources(info),
      assertCurrent(allowClosed) {
        binding.assertCurrent();
        const current = ownedDesktopResources(info);
        if (current.page !== page || current.application !== captured.application || !allowClosed && current.closed) throw Error('空串验收所属原生窗口未知');
      },
    }, deadline);
    states.set(info, guard);
    const run = <T>(action: () => Promise<T>) => guard.run(action);
    const ui = (action: () => Promise<unknown>) => run(action);
    const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    const schema = 'dbark_empty_' + randomUUID().replaceAll('-', ''), table = 'empty_defaults';
    const quoted = '`' + schema + '`.`' + table + '`';
    let observer: Connection | undefined, schemaAck = false, tableAck = false, shownAtSuccess: string | undefined;
    /** 同一原生连接和底层流，复用产品strict QUIT+close，不以Promise end代替。 */
    const close = async (connection: Connection) => {
      type Native = Parameters<typeof closeMysqlConnection>[0] & { stream?: { closed?: boolean; once?: unknown; removeListener?: unknown; end?: unknown; destroy?: unknown } };
      await closeEmptyDefaultStream((connection as unknown as { connection?: Native }).connection, native => closeMysqlConnection(native, true));
    };
    let fingerprint: string | undefined;
    /** 预检及实际观察连接均先核准确版本/UUID、普通模式、InnoDB与utf8mb4能力。 */
    const facts = async (connection: Connection) => run(async () => {
      const [rows] = await connection.query<RowDataPacket[]>(emptyDefaultFactSql); guard.check();
      const actual = assertEmptyDefaultFacts(rows, target.uuid);
      if (fingerprint !== undefined && fingerprint !== actual) throw Error('空串验收本轮会话能力或服务器指纹变化');
      fingerprint = actual;
      const [engines] = await connection.query<RowDataPacket[]>("SELECT ENGINE,SUPPORT,TRANSACTIONS,XA,SAVEPOINTS FROM information_schema.ENGINES WHERE ENGINE='InnoDB' LIMIT 2"); guard.check();
      expect(engines).toHaveLength(1); expect(engines[0]).toMatchObject({ ENGINE: 'InnoDB', TRANSACTIONS: 'YES', XA: 'YES', SAVEPOINTS: 'YES' }); expect(['YES', 'DEFAULT']).toContain(engines[0].SUPPORT);
      const [charsets] = await connection.query<RowDataPacket[]>("SELECT CHARACTER_SET_NAME FROM information_schema.CHARACTER_SETS WHERE CHARACTER_SET_NAME='utf8mb4' LIMIT 2"); guard.check();
      expect(charsets).toEqual([{ CHARACTER_SET_NAME: 'utf8mb4' }]);
    });
    const options = { host: target.host, port: target.port, user: target.user, password: target.password, charset: 'utf8mb4', connectTimeout: 15000 };
    try {
      guard.check();
      if (trace !== 'off' || screenshot !== 'off' || video !== 'off' || info.retry !== 0 || info.repeatEachIndex !== 0 || info.timeout !== 45000) throw Error('空串验收禁止轨迹、重试、重复执行或改写原45秒预算');
      const preflight = await run(() => mysql.createConnection(options));
      await facts(preflight); await run(() => close(preflight));
      observer = await run(() => mysql.createConnection(options)); const connection = observer;
      await facts(connection);
      const [absent] = await run(() => connection.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [schema])); expect(absent).toHaveLength(0);
      // 隔离壳只用唯一合成库；ACK前异常会sticky保留，绝不猜测未创建后DROP或自动重放。
      await run(async () => {
        const [ack] = await connection.query<ResultSetHeader>('CREATE DATABASE `' + schema + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); guard.check();
        expect(ack.affectedRows).toBe(1); expect(ack.warningStatus).toBe(0); schemaAck = true;
      });
      const [initialTables] = await run(() => connection.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [schema])); expect(initialTables).toHaveLength(0);
      const connectionName = 'E2E ' + schema;
      // 真实连接表单使用显式账号，不走IPC伪造配置或本地认证文件。
      await ui(() => page.locator('.navigation-toolbar').getByRole('button', { name: '新建连接', exact: true }).click());
      const form = page.getByRole('dialog', { name: '新建连接', exact: true });
      for (const [label, value] of [['连接名称', connectionName], ['主机地址', target.host], ['端口', String(target.port)], ['用户名', target.user], ['数据库密码', target.password], ['连接分组', '隔离数据库验证']]) await ui(() => form.getByLabel(label, { exact: true }).fill(value));
      await ui(() => form.getByRole('button', { name: '测试连接', exact: true }).click());
      await ui(() => expect(form.locator('.success-box')).toContainText('连接成功'));
      await ui(() => form.getByRole('button', { name: '保存连接', exact: true }).click()); await ui(() => expect(form).toBeHidden());
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: connectionName, exact: true }) });
      await ui(() => node.locator('.connection-row').getByRole('button', { name: connectionName, exact: true }).click());
      const database = node.locator('.database-row').filter({ has: page.getByRole('button', { name: schema, exact: true }) });
      await ui(() => expect(database).toHaveCount(1)); await ui(() => database.getByRole('button', { name: schema, exact: true }).click());
      await ui(() => expect(database.getByRole('button', { name: schema, exact: true })).toHaveAttribute('aria-expanded', 'true'));
      await ui(() => database.getByRole('button', { name: schema, exact: true }).focus()); await ui(() => clickSidebarAction(database, { name: zh.sidebar.text017, exact: true }));
      const designer = page.getByRole('dialog', { name: formatText(zh.schema.text009, schema), exact: true });
      const input = (ordinal: number) => designer.getByLabel(formatText(zh.schema.text022, ordinal), { exact: true });
      const empty = designer.getByRole('checkbox', { name: formatText(zh.schema.emptyStringDefaultLabel, 2), exact: true });
      await ui(() => designer.getByLabel(zh.schema.text010, { exact: true }).fill(table));
      await ui(() => designer.getByLabel(formatText(zh.schema.text019, 1), { exact: true }).fill('int'));
      await ui(() => designer.getByLabel(formatText(zh.schema.text021, 1), { exact: true }).uncheck());
      for (const [ordinal, name, value, nullable] of [[2, 'empty_text', undefined, false], [3, 'literal_null', 'NULL', true], [4, 'sql_null', 'NULL', true], [5, 'note', '普通默认', true], [6, 'unset_text', undefined, false]] as const) {
        await ui(() => designer.getByRole('button', { name: zh.schema.text027, exact: true }).click());
        await ui(() => designer.getByLabel(formatText(zh.schema.text018, ordinal), { exact: true }).fill(name));
        await ui(() => designer.getByLabel(formatText(zh.schema.text019, ordinal), { exact: true }).fill('varchar(64)'));
        if (!nullable) await ui(() => designer.getByLabel(formatText(zh.schema.text020, ordinal), { exact: true }).uncheck());
        if (value !== undefined) await ui(() => input(ordinal).fill(value));
      }
      await ui(() => designer.getByRole('checkbox', { name: formatText(zh.schema.literalNullLabel, 3), exact: true }).check());
      await ui(() => expect(designer.getByRole('checkbox', { name: formatText(zh.schema.literalNullLabel, 4), exact: true })).not.toBeChecked());
      const confirmation = page.getByRole('dialog', { name: text.title, exact: true });
      /** 每次只读预览同时核原库无任何表、零apply；不凭界面文案推断零DDL。 */
      const preview = async (selected: boolean) => {
        await ui(() => designer.getByRole('button', { name: zh.schema.text049, exact: true }).click());
        await ui(() => expect(confirmation.locator('.monaco-editor .view-lines')).toContainText('CREATE TABLE'));
        await run(async () => { const sql = await confirmation.locator('.monaco-editor .view-lines').innerText(); guard.check(); expect(sql.replace(/\s+/g, ' ')).toMatch(new RegExp('^CREATE TABLE `' + schema + '`\\.`' + table + '`\\s*\\(')); assertEmptyDefaultDdl(sql, selected); });
        await run(async () => { const [tables] = await connection.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [schema]); guard.check(); expect(tables).toHaveLength(0); });
        await run(async () => { assertEmptyDefaultTasks(await tasks(), false); });
      };
      await ui(() => empty.check()); await ui(() => expect(empty).toBeChecked()); await ui(() => expect(input(2)).toHaveValue(''));
      await preview(true); await ui(() => confirmation.getByRole('button', { name: text.back, exact: true }).click());
      await ui(() => empty.uncheck()); await ui(() => expect(empty).not.toBeChecked());
      await preview(false); await ui(() => confirmation.getByRole('button', { name: text.back, exact: true }).click());
      await ui(() => empty.check()); await ui(() => input(2).fill('临时普通值')); await ui(() => expect(empty).not.toBeChecked()); await ui(() => expect(input(2)).toHaveValue('临时普通值'));
      await ui(() => empty.check()); await ui(() => expect(input(2)).toHaveValue('')); await ui(() => expect(empty).toBeChecked());
      await preview(true);
      for (const label of [text.ackDdl, text.ackCreate]) await ui(() => confirmation.getByRole('checkbox', { name: label, exact: true }).check());
      await ui(() => confirmation.getByLabel(text.confirmation, { exact: true }).fill(schema + '.' + table + ' '));
      await ui(() => expect(confirmation.getByRole('button', { name: text.apply, exact: true })).toBeDisabled());
      await ui(() => confirmation.getByLabel(text.confirmation, { exact: true }).fill(schema + '.' + table));
      // 只点击一次，不双击、不重试；未知状态在任何后续观察前已锁定保留。
      await ui(() => confirmation.getByRole('button', { name: text.apply, exact: true }).click());
      await ui(() => expect(confirmation.getByRole('status')).toHaveText(text.succeeded));
      await run(async () => { assertEmptyDefaultTasks(await tasks(), true); tableAck = true; });
      await ui(() => expect(confirmation.getByRole('button', { name: text.apply, exact: true })).toBeDisabled());
      /** SHOW/COLUMNS使用独立观察连接；不使用产品完整性比较器为产品结论自证。 */
      const definition = async (allowClosed = false) => guard.run(async () => {
        const [shown] = await connection.query<RowDataPacket[]>('SHOW CREATE TABLE ' + quoted); guard.check(allowClosed); expect(shown).toHaveLength(1);
        expect(shown[0].Table).toBe(table); const sql = shown[0]['Create Table']; expect(typeof sql).toBe('string'); assertEmptyDefaultDdl(sql, true);
        if (shownAtSuccess !== undefined) expect(sql).toBe(shownAtSuccess); else shownAtSuccess = sql;
        const [columns] = await connection.query<RowDataPacket[]>('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [schema, table]); guard.check(allowClosed); assertEmptyDefaultColumns(columns);
        const [rows] = await connection.query<RowDataPacket[]>('SELECT 1 FROM ' + quoted + ' LIMIT 1'); guard.check(allowClosed); expect(rows).toHaveLength(0);
      }, allowClosed);
      await definition();
      await ui(() => confirmation.getByRole('button', { name: text.close, exact: true }).click()); await ui(() => expect(confirmation).toHaveCount(0));
      await ui(() => expect(node.locator('.object-row').getByText(table, { exact: true })).toBeVisible());
      await finishEmptyDefaultCase(guard, {
        tasks, exit: () => confirmOwnedDesktopExit(info),
        assertClosed: () => { if (!ownedDesktopResources(info).closed) throw Error('空串验收未确认所属应用正常退出'); },
        async verifyOwned() {
          guard.check(true);
          if (!schemaAck || !tableAck || !observer || !shownAtSuccess || !/^dbark_empty_[a-f0-9]{32}$/.test(schema)) throw Error('空串验收准确隔离资源归属未知');
          const [factsNow] = await connection.query<RowDataPacket[]>(emptyDefaultFactSql); guard.check(true); expect(assertEmptyDefaultFacts(factsNow, target.uuid)).toBe(fingerprint);
          const [schemas] = await connection.query<RowDataPacket[]>('SELECT SCHEMA_NAME,DEFAULT_CHARACTER_SET_NAME,DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [schema]); guard.check(true); expect(schemas).toEqual([{ SCHEMA_NAME: schema, DEFAULT_CHARACTER_SET_NAME: 'utf8mb4', DEFAULT_COLLATION_NAME: 'utf8mb4_bin' }]);
          const [tables] = await connection.query<RowDataPacket[]>('SELECT TABLE_NAME,TABLE_TYPE,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [schema]); guard.check(true); expect(tables).toEqual([{ TABLE_NAME: table, TABLE_TYPE: 'BASE TABLE', ENGINE: 'InnoDB' }]);
          await definition(true);
        },
        async drop() { const [ack] = await connection.query<ResultSetHeader>('DROP DATABASE `' + schema + '`'); guard.check(true); expect(ack.warningStatus).toBe(0); },
        async absent() { const [rows] = await connection.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [schema]); guard.check(true); expect(rows).toHaveLength(0); },
        close: () => close(connection),
      });
    } catch (reason) { guard.stop(); throw reason; }
    // 失败不进入finally清库：未知CREATE、超时和迟到响应一律保留，交给Root只读处置。
  });
}
