import { clickSidebarAction } from './sidebar-menu';
import { randomUUID } from 'node:crypto';
import { assertDefaultEncodingLiveTarget } from '../helpers/tableDefaultEncodingTarget';
import type { QueryOutcome } from '../../src/shared/contracts';
import { test, expect, ownedDesktopResources, confirmOwnedDesktopExit } from './desktop-fixture';
import { beginDefinitionNavigationCase, finishDefinitionNavigationCase } from './definition-navigation-live';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { tableCreateZh as text } from '../../src/renderer/locales/tableCreate.zh-CN';
import { tableCreatePrefixZh as prefix } from '../../src/renderer/locales/tableCreatePrefix.zh-CN';

/** 本用途仅在Root预先明确的专用库创建随机表，绝不建用户、建库、DROP或替Root清理保留资源。 */
export function registerTableCreatePrefixTests() {
  test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true }); test.setTimeout(90000);
  test.afterEach(({}, info) => { finishDefinitionNavigationCase(info); });
  test('准确MySQL8.4.11新表前缀控件、组合预算、整长规范化、单次提交及独立目录读取', async ({ trace }, info) => {
    const activity = beginDefinitionNavigationCase(info), captured = ownedDesktopResources(info), page = captured.page;
    let closed = false;
    const own = () => { activity.check(); const current = ownedDesktopResources(info); if (current.page !== captured.page || current.application !== captured.application || !closed && current.closed) { activity.retain(); throw Error('前缀正式例本窗口归属变化'); } };
    /** 每次等待前后核原期限及原窗口；未知立即本地停链，不能由finally猜测退出或删除。 */
    const step = async <T,>(action: () => Promise<T>) => { own(); try { const value = await action(); own(); return value; } catch (reason) { activity.retain(); throw reason; } };
    try {
      if (trace !== 'off') throw Error('前缀正式表单不能记录认证轨迹');
      assertDefaultEncodingLiveTarget({host:process.env.DBARK_TEST_HOST,port:process.env.DBARK_TEST_PORT,tlsFlag:process.env.DBARK_TEST_TLS,caPath:process.env.DBARK_TEST_CA});
      if(process.env.DBARK_INTEGRATION_ENABLED!=='1'||process.env.DBARK_TABLE_CREATE_PREFIX_UI!=='1'||process.env.DBARK_TEST_PORT!=='13384'||process.env.DBARK_TEST_TLS!=='0'||!/^dbark_e2e_prefix_[a-f0-9]{32}$/.test(process.env.DBARK_TEST_DATABASE??''))throw Error('前缀正式目标或双门未明确');
      const database = process.env.DBARK_TEST_DATABASE!, name = 'prefix_' + randomUUID().replaceAll('-', ''), connectionName = '前缀正式 ' + name;
      await step(() => page.locator('.navigation-toolbar').getByRole('button', { name: '新建连接', exact: true }).click());
      const connection = page.getByRole('dialog', { name: '新建连接', exact: true });
      for (const [label, value] of [['连接名称', connectionName], ['主机地址', process.env.DBARK_TEST_HOST!], ['端口', process.env.DBARK_TEST_PORT!], ['用户名', process.env.DBARK_TEST_USER!], ['数据库密码', process.env.DBARK_TEST_PASSWORD ?? '']]) await step(() => connection.getByLabel(label, { exact: true }).fill(value));
      await step(() => connection.getByRole('button', { name: '测试连接', exact: true }).click()); await step(() => expect(connection.locator('.success-box')).toContainText('连接成功')); await step(() => connection.getByRole('button', { name: '保存连接', exact: true }).click()); await step(() => expect(connection).toBeHidden());
      const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))), profile = profiles.find(value => value.name === connectionName); if (!profile) throw Error('本例新配置未确认');
      const session = await step(() => page.evaluate(value => window.dbark.invoke('sessions.open', value), { connectionId: profile.id, database }));
      /** 独立只读会话走真实IPC和引擎；结果未知即保留，不另建未受管的观察驱动。 */
      const read = (sql: string): Promise<QueryOutcome> => step(() => page.evaluate(input => window.dbark.invoke('query.execute', input), { sessionId: session.sessionId, sql, taskId: randomUUID(), maxRows: 100 }));
      const facts = (await read('SELECT @@version AS version,@@server_uuid AS uuid,@@innodb_page_size AS pageSize,@@innodb_default_row_format AS rowFormat')).results[0];
      expect(facts.truncated).toBe(false); expect(facts.rows).toHaveLength(1); expect(String(facts.rows[0].version)).toMatch(/^8\.4\.11(?:[-+][^\s]+)?$/); expect(facts.rows[0].uuid).toBe(process.env.DBARK_TEST_EXPECTED_SERVER_UUID); expect(Number(facts.rows[0].pageSize)).toBe(16384); expect(String(facts.rows[0].rowFormat).toUpperCase()).toBe('DYNAMIC');
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: connectionName, exact: true }) }); await step(() => node.getByRole('button', { name: connectionName, exact: true }).click());
      const databaseRow = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) }); await step(() => databaseRow.getByRole('button', { name: database, exact: true }).click()); await step(() => expect(databaseRow.getByRole('button', { name: database, exact: true })).toHaveAttribute('aria-expanded','true')); await step(() => databaseRow.getByRole('button', { name: database, exact: true }).focus()); await step(() => clickSidebarAction(databaseRow, { name: zh.sidebar.text017, exact: true }, undefined, own));
      const form = page.getByRole('dialog', { name: `创建表 · ${database}`, exact: true }); await step(() => form.getByLabel('表名称', { exact: true }).fill(name));
      for (const [position, column, type] of [[2, 'v', 'varchar(1000)'], [3, 'b', 'varbinary(64)']] as const) { await step(() => form.getByRole('button', { name: zh.schema.text027, exact: true }).click()); await step(() => form.getByLabel(formatText(zh.schema.text018, position), { exact: true }).fill(column)); await step(() => form.getByLabel(formatText(zh.schema.text019, position), { exact: true }).fill(type)); }
      await step(() => form.getByRole('button', { name: /^索引/ }).click());
      for (const [position, index, column, length] of [[2, 'ix', 'v', '766'], [3, 'uq_b', 'b', '64']] as const) { await step(() => form.getByRole('button', { name: zh.schema.text036, exact: true }).click()); await step(() => form.getByLabel(formatText(zh.schema.text031, position), { exact: true }).fill(index)); await step(() => form.getByLabel(prefix.field(position, 1), { exact: true }).selectOption(column)); await step(() => form.getByLabel(prefix.prefix(position, 1), { exact: true }).fill(length)); }
      const ix = form.getByRole('group', { name: '新表索引2', exact: true }); await step(() => ix.getByRole('button', { name: prefix.add, exact: true }).click()); await step(() => form.getByLabel(prefix.field(2, 2), { exact: true }).selectOption('id')); await step(() => form.getByLabel(formatText(zh.schema.text033, 3), { exact: true }).check());
      await step(() => form.getByRole('button', { name: zh.schema.text049, exact: true }).click());
      const confirmation = page.getByRole('dialog', { name: text.title, exact: true }); await step(() => expect(confirmation.locator('.monaco-editor .view-lines')).toContainText('ROW_FORMAT=DYNAMIC')); await step(() => expect(confirmation.locator('.monaco-editor .view-lines')).toContainText('`v`(766)'));
      const absent = (await read(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='${name}'`)).results[0]; expect(absent.rows).toHaveLength(0);
      await step(() => confirmation.getByLabel(text.confirmation, { exact: true }).fill(database + '.' + name)); for (const label of [text.ackDdl, text.ackCreate]) await step(() => confirmation.getByRole('checkbox', { name: label, exact: true }).check()); await step(() => confirmation.getByRole('button', { name: text.apply, exact: true }).dblclick()); await step(() => expect(confirmation.getByRole('status')).toHaveText(text.succeeded, { timeout: 20000 }));
      const indexes = (await read(`SELECT INDEX_NAME AS name,COLUMN_NAME AS col,SEQ_IN_INDEX AS seq,SUB_PART AS part FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='${name}' ORDER BY CASE WHEN INDEX_NAME='PRIMARY' THEN 0 ELSE 1 END,INDEX_NAME,SEQ_IN_INDEX`)).results[0]; expect(indexes.truncated).toBe(false); expect(indexes.rows.map(row => ({ name: row.name, col: row.col, seq: Number(row.seq), part: row.part === null ? null : Number(row.part) }))).toEqual([{ name: 'PRIMARY', col: 'id', seq: 1, part: null }, { name: 'ix', col: 'v', seq: 1, part: 766 }, { name: 'ix', col: 'id', seq: 2, part: null }, { name: 'uq_b', col: 'b', seq: 1, part: null }]);
      const tableRows = (await read(`SELECT ENGINE AS engine,ROW_FORMAT AS rowFormat,TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='${name}'`)).results[0]; expect(tableRows.truncated).toBe(false); expect(tableRows.rows).toHaveLength(1); expect(String(tableRows.rows[0].engine).toUpperCase()).toBe('INNODB'); expect(String(tableRows.rows[0].rowFormat).toUpperCase()).toBe('DYNAMIC');
      const columnRows = (await read(`SELECT COLUMN_NAME AS name,CHARACTER_MAXIMUM_LENGTH AS chars,CHARACTER_OCTET_LENGTH AS bytes,CHARACTER_SET_NAME AS charset,COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME='${name}' AND COLUMN_NAME IN ('v','b') ORDER BY COLUMN_NAME`)).results[0]; expect(columnRows.truncated).toBe(false); expect(columnRows.rows.map(row=>({name:row.name,chars:Number(row.chars),bytes:Number(row.bytes),charset:row.charset,collation:row.collation}))).toEqual([{name:'b',chars:64,bytes:64,charset:null,collation:null},{name:'v',chars:1000,bytes:4000,charset:'utf8mb4',collation:tableRows.rows[0].collation}]);
      const definition = await step(() => page.evaluate(input => window.dbark.invoke('metadata.ddl', input), { connectionId: profile.id, database, name, kind: 'table' as const })); expect(definition).toMatch(/KEY `uq_b`\s*\(`b`\)/);
      const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks.filter(task => task.kind === 'schema.tableCreate.apply')).toHaveLength(1); expect(tasks.filter(task => task.kind === 'schema.tableCreate.apply').every(task => task.status === 'completed')).toBe(true);
      await step(() => page.evaluate(input => window.dbark.invoke('sessions.close', input), { sessionId: session.sessionId }));
      await step(() => confirmation.getByRole('button', { name: text.close, exact: true }).click()); own(); await confirmOwnedDesktopExit(info); closed = true; own();
      console.info(JSON.stringify({ 新表前缀正式: true, database, table: name, 保留供Root复核: true }));
    } catch (reason) { activity.retain(); throw reason; } finally { activity.active = false; }
  });
}
