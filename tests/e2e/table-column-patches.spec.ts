import { clickSidebarAction } from './sidebar-menu';
import type { RowDataPacket } from 'mysql2/promise';
import type { TestInfo } from '@playwright/test';
import type { TaskEvent } from '../../src/shared/contracts';
import { columnPatchZh as text } from '../../src/renderer/locales/columnPatches.zh-CN';
import { test, expect, page, desktop, answerDialogs, requestQuit, closed } from './desktop-fixture';
import { enabled, environment, isolatedDatabase, acceptNativeConfirmation, openDatabaseQuery, executeSql, modifier, type LiveContext } from './live-helpers';

// 必须显式授权实库，且禁用凭据追踪；本文件不模拟 IPC、结构服务或数据库结果。
test.use({ trace: 'off' });
const dialog = () => page.getByRole('dialog', { name: text.title, exact: true });
const tablePage = () => page.locator('.table-tab:visible');
const qualified = (db: string, table: string) => `\`${db}\`.\`${table}\``;
type ObservedWindow = Window & { __columnEvents?: TaskEvent[] };

/** 从真实对象树刷新并打开表，不能向工作区注入虚构标签。 */
async function openTable(context: LiveContext, name: string) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) });
  await connection.locator('.connection-row').hover();
  await clickSidebarAction(connection, { name: '刷新连接', exact: true });
  const database = connection.locator('.database-row').filter({ has: page.getByRole('button', { name: context.database, exact: true }) });
  await database.getByRole('button', { name: context.database, exact: true }).click();
  await connection.locator('.object-row').getByText(name, { exact: true }).click();
  await expect(tablePage().locator('.context-bar')).toContainText(name);
  await expect(tablePage().locator('.loading-overlay')).toHaveCount(0);
  await expect(tablePage().locator(':scope > .error-box')).toHaveCount(0);
  return connection;
}

/** 字段名定位真实行编辑按钮，不依赖列序号或私有 React 状态。 */
async function editColumn(name: string) {
  await dialog().getByRole('button', { name: new RegExp(`^${name} ·`) }).click();
  await expect(dialog().locator('.column-patch-editor')).toBeVisible();
}

/** 从真实对象行右键菜单进入字段编辑，不调用隐藏按钮或内部回调。 */
async function openSidebarColumnDialog(connection: ReturnType<typeof page.locator>, name: string) {
  const row = connection.locator('.object-row').filter({ has: page.getByText(name, { exact: true }) });
  await row.hover(); await clickSidebarAction(row, { name: `${text.title} ${name}`, exact: true });
}

/** 行草稿保存不执行 DDL；属性开关与默认类型均走真实表单。 */
async function changeDefault(name: string, kind: 'none' | 'null' | 'literal' | 'expression', value = '', valueType = 'text') {
  await editColumn(name);
  await dialog().getByRole('checkbox', { name: `${text.modify} ${text.default}`, exact: true }).check();
  await dialog().getByRole('combobox', { name: text.default, exact: true }).selectOption(kind);
  if (kind === 'literal') {
    await dialog().getByRole('combobox', { name: text.literal, exact: true }).selectOption(valueType);
    await dialog().getByRole('textbox', { name: text.value, exact: true }).fill(value);
  }
  if (kind === 'expression') {
    // 先填再清，验证可选属性确实删除，而非产生自有 undefined。
    const defaults = dialog().locator('.column-patch-field').filter({ has: page.getByRole('checkbox', { name: `${text.modify} ${text.default}`, exact: true }) });
    await defaults.getByRole('spinbutton', { name: text.precision, exact: true }).fill('6');
    await defaults.getByRole('spinbutton', { name: text.precision, exact: true }).fill('');
  }
  await dialog().getByRole('button', { name: text.rowSave, exact: true }).click();
}

/** 批量确认只接受集中中文风险句，协议 ack 编号不得展示成用户文案。 */
async function preview() {
  await dialog().getByRole('button', { name: text.preview, exact: true }).click();
  await expect(dialog().getByRole('heading', { name: text.fixedSql, exact: true })).toBeVisible();
  const checks = dialog().getByRole('checkbox');
  for (let index = 0; index < await checks.count(); index++) await checks.nth(index).check();
  await expect(dialog().getByRole('checkbox', { name: text.ackImplicit, exact: true })).toBeChecked();
  await expect(dialog().getByRole('checkbox', { name: text.ackWindow, exact: true })).toBeChecked();
  await expect(dialog()).not.toContainText('ddl-implicit-commit');
}

/** 外部观察连接精确读取本例表定义，比较预览前后是否确实零 DDL。 */
async function ddl(context: LiveContext, name: string) {
  const [rows] = await context.observer.query<RowDataPacket[]>(`SHOW CREATE TABLE ${qualified(context.database, name)}`);
  return String(rows[0]['Create Table']);
}

/** 只读任务观察不修改生产执行链路，也不根据错误字符串推测投递状态。 */
async function observeTasks() {
  await page.evaluate(() => { const state = window as ObservedWindow; if (!state.__columnEvents) { state.__columnEvents = []; window.dbark.onTask(event => state.__columnEvents!.push(event)); } });
}
async function applyTasks() {
  return page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'schema.columns.apply'));
}

/** 在隔离夹具退出应用之前保存失败现场，否则afterEach已经没有可读取的DOM与任务事件。 */
async function columnDatabase(body: (context: LiveContext) => Promise<void>, info: TestInfo) {
  await isolatedDatabase(async context => {
    try { await body(context); }
    catch (reason) {
      if (!closed) {
        // 原始错误与真实结构化投递证明共同保存，不从失败文本推测结果，也不重试任何DDL。
        const evidence = {
          errors: await dialog().locator('.error-box').allTextContents(),
          state: await dialog().locator('.column-patch-state').allTextContents(),
          tasks: await applyTasks(),
          progress: await page.evaluate(() => (window as ObservedWindow).__columnEvents?.filter(event => event.columnPatch) ?? []),
        };
        await info.attach('字段差异失败原始错误与任务进度', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
      }
      throw reason;
    }
  }, info);
}

/** 原值单元格按 aria 坐标定位，草稿编辑不会偷换成直接 SQL 更新。 */
async function draftCell(column: string, value: string) {
  const header = tablePage().getByRole('columnheader', { name: new RegExp(`^${column}`) });
  const index = await header.getAttribute('aria-colindex');
  const cell = tablePage().locator(`[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="${index}"]`);
  await cell.dblclick(); const input = tablePage().getByRole('textbox', { name: `编辑 ${column}`, exact: true });
  await input.fill(value); await input.press('Enter'); await expect(cell).toContainText(value);
}

test.describe('字段差异编辑：真实结构服务与独立会话', () => {
  test.skip(!enabled, '未显式授权 200 实库字段差异验收');
  test.setTimeout(120000);
  test.beforeEach(async () => {
    environment.DBARK_TEST_HOST = '192.168.31.200';
    environment.DBARK_TEST_PORT = process.env.DBARK_COLUMN_PATCH_TEST_PORT ?? '13384';
    if (!['13357', '13380', '13384', '13310', '13311'].includes(environment.DBARK_TEST_PORT)) throw new Error('拒绝访问未授权实例');
    await observeTasks();
  });

  test('两个表入口、只读预览零 DDL、双击只执行一次且保留未改属性', async ({}, info) => {
    await columnDatabase(async context => {
      const name = 'column_once';
      await context.observer.query(`CREATE TABLE ${qualified(context.database, name)} (id INT PRIMARY KEY, value VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT 'old' COMMENT '原注释', UNIQUE KEY value_u(value)) ENGINE=InnoDB`);
      const connection = await openTable(context, name);
      await openSidebarColumnDialog(connection, name);
      await expect(dialog().getByRole('button', { name: /^value ·/ })).toBeEnabled();
      await dialog().getByRole('button', { name: text.close, exact: true }).click();
      await tablePage().getByRole('button', { name: text.title, exact: true }).click();
      await editColumn('value');
      await dialog().getByRole('checkbox', { name: `${text.modify} ${text.comment}`, exact: true }).check();
      await dialog().getByRole('textbox', { name: text.comment, exact: true }).fill('新注释');
      await dialog().getByRole('button', { name: text.rowSave, exact: true }).click();
      const original = await ddl(context, name); await observeTasks(); await preview();
      expect(await ddl(context, name)).toBe(original); expect(await applyTasks()).toHaveLength(0);
      await dialog().locator('.monaco-editor').getByRole('textbox').focus();
      await page.keyboard.press(`${modifier}+Enter`); await page.keyboard.press(`${modifier}+S`);
      expect(await ddl(context, name)).toBe(original); expect(await applyTasks()).toHaveLength(0);
      await page.screenshot({ path: info.outputPath('column-patch-preview.png') });
      await dialog().getByRole('button', { name: text.apply, exact: true }).dblclick();
      await expect(dialog().getByRole('status')).toContainText(text.succeeded, { timeout: 30000 });
      expect(await applyTasks()).toHaveLength(1);
      const actual = await ddl(context, name);
      expect(actual).toContain("COMMENT '新注释'"); expect(actual).toContain("DEFAULT 'old'");
      expect(actual).toContain('utf8mb4_bin'); expect(actual).toContain('UNIQUE KEY `value_u`');
      await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeDisabled();
      const completed = (await applyTasks())[0]; expect(completed.status).toBe('completed');
      await page.evaluate(taskId => window.dbark.invoke('query.cancel', { taskId }), completed.id);
      expect((await applyTasks())[0].status).toBe('completed'); expect(await ddl(context, name)).toBe(actual);
    }, info);
  });

  test('批量默认值区分空文本、文字 NULL、SQL NULL、无默认、精确数字、HEX 与受控表达式', async ({}, info) => {
    await columnDatabase(async context => {
      const name = 'defaults_matrix';
      const [versions] = await context.observer.query<RowDataPacket[]>('SELECT VERSION() AS version');
      // 这些真实版本会把二进制 DEFAULT 的 SHOW CREATE 文字化，完成写入也不能伪称已核验原字节。
      const binaryDefinitionUnverified = /^5\.7\./.test(String(versions[0].version)) || /MariaDB/i.test(String(versions[0].version));
      await context.observer.query(`CREATE TABLE ${qualified(context.database, name)} (id INT PRIMARY KEY, empty_text VARCHAR(20) DEFAULT 'old', text_null VARCHAR(20) DEFAULT 'old', sql_null VARCHAR(20) DEFAULT 'old', no_default INT NOT NULL DEFAULT 7, exact_number DECIMAL(30,8) DEFAULT 1, bytes VARBINARY(10) DEFAULT 'old', stamp DATETIME DEFAULT '2000-01-01 00:00:00') ENGINE=InnoDB`);
      await openTable(context, name); await tablePage().getByRole('button', { name: text.title, exact: true }).click();
      await expect(dialog().getByRole('button', { name: /^empty_text ·/ })).toBeEnabled();
      await changeDefault('empty_text', 'literal', ''); await changeDefault('text_null', 'literal', 'NULL');
      await changeDefault('sql_null', 'null'); await changeDefault('no_default', 'none');
      await changeDefault('exact_number', 'literal', '9007199254740993.12345678', 'number');
      await changeDefault('bytes', 'literal', '00ff', 'binary'); await changeDefault('stamp', 'expression');
      const before = await ddl(context, name); await preview(); expect(await ddl(context, name)).toBe(before);
      await dialog().getByRole('button', { name: text.apply, exact: true }).click();
      await expect(dialog().getByRole('status')).toContainText(binaryDefinitionUnverified ? text.verificationFailed : text.succeeded, { timeout: 30000 });
      const applied = await applyTasks(); expect(applied).toHaveLength(1); expect(applied[0].status).toBe('completed');
      await expect.poll(() => page.evaluate(taskId => (window as ObservedWindow).__columnEvents?.filter(event => event.taskId === taskId && event.status === 'completed'), applied[0].id)).toMatchObject([
        { columnPatch: { ddlSubmitted: true, ddlCompleted: true, definitionVerified: !binaryDefinitionUnverified, outcome: 'succeeded' } },
      ]);
      await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeDisabled();
      await context.observer.query(`INSERT INTO ${qualified(context.database, name)} (id,no_default) VALUES (1,9)`);
      const [rows] = await context.observer.query<RowDataPacket[]>(`SELECT empty_text,text_null,sql_null,exact_number,HEX(bytes) AS bytes,CAST(stamp IS NOT NULL AS CHAR) AS stamp FROM ${qualified(context.database, name)}`);
      // 观察条件显式返回文本，不依赖各版本布尔表达式的字段类型，也不在 JS 中强转精度数据。
      expect(rows[0]).toMatchObject({ empty_text: '', text_null: 'NULL', sql_null: null, exact_number: '9007199254740993.12345678', bytes: '00FF', stamp: '1' });
      const actual = await ddl(context, name); expect(actual).toMatch(/`no_default` int(?:\(\d+\))? NOT NULL[,\n]/i);
    }, info);
  });

  test('同目标数据草稿阻止两个入口，其他表草稿及查询事务临时表保持', async ({}, info) => {
    await columnDatabase(async context => {
      for (const name of ['guarded', 'other_draft', 'transaction_guard']) {
        await context.observer.query(`CREATE TABLE ${qualified(context.database, name)} (id INT PRIMARY KEY, value VARCHAR(30) NOT NULL DEFAULT 'old') ENGINE=InnoDB`);
        await context.observer.query(`INSERT INTO ${qualified(context.database, name)} VALUES (1,'old')`);
      }
      const connection = await openTable(context, 'guarded'); await draftCell('value', '未提交');
      await tablePage().getByRole('button', { name: text.title, exact: true }).click(); await expect(page.locator('.toast[role="alert"]')).toContainText(text.dataDirty); await expect(dialog()).toHaveCount(0);
      await openSidebarColumnDialog(connection, 'guarded'); await expect(page.locator('.toast[role="alert"]')).toContainText(text.dataDirty); await expect(dialog()).toHaveCount(0);
      // 明确放弃的是本例已知数据草稿，随后另一个表的草稿必须继续保留。
      await acceptNativeConfirmation(); await tablePage().getByRole('button', { name: '刷新', exact: true }).click();
      await expect(tablePage().locator('.loading-overlay')).toHaveCount(0);
      await openTable(context, 'other_draft'); await draftCell('value', '其他表草稿');
      await openDatabaseQuery(context.database); await executeSql('CREATE TEMPORARY TABLE kept_temp (value INT); INSERT INTO kept_temp VALUES (42); START TRANSACTION; UPDATE transaction_guard SET value=\'未提交事务\' WHERE id=1;');
      await openTable(context, 'guarded'); await tablePage().getByRole('button', { name: text.title, exact: true }).click();
      await expect(dialog()).toBeVisible(); await expect(page.locator('.toast')).toHaveCount(0);
      await editColumn('value'); await dialog().getByRole('checkbox', { name: `${text.modify} ${text.comment}`, exact: true }).check(); await dialog().getByRole('textbox', { name: text.comment, exact: true }).fill('独立 DDL'); await dialog().getByRole('button', { name: text.rowSave, exact: true }).click(); await preview();
      await dialog().getByRole('button', { name: text.apply, exact: true }).click(); await expect(dialog().getByRole('status')).toContainText(text.succeeded, { timeout: 30000 });
      await dialog().getByRole('button', { name: text.close, exact: true }).click();
      const [rows] = await context.observer.query<RowDataPacket[]>(`SELECT value FROM ${qualified(context.database, 'transaction_guard')}`); expect(rows[0].value).toBe('old');
      await page.locator('.workspace-tab-button').filter({ has: page.locator('.dirty-dot') }).getByRole('button').first().click(); await expect(tablePage()).toContainText('其他表草稿');
      const queryTab = await page.evaluate(async () => (await window.dbark.invoke('settings.get', {})).tabs.find(tab => tab.kind === 'query' && tab.sql?.includes('kept_temp'))!.title);
      await page.locator('.workspace-tab-button').getByRole('button', { name: queryTab, exact: true }).click();
      await executeSql('SELECT kept_temp.value AS temp_value, transaction_guard.value AS uncommitted FROM kept_temp CROSS JOIN transaction_guard;'); await expect(page.locator('.query-tab:visible')).toContainText('42'); await expect(page.locator('.query-tab:visible')).toContainText('未提交事务'); await executeSql('ROLLBACK;');
    }, info);
  });

  test('预览后外部定义改变拒绝旧令牌，不重放字段差异', async ({}, info) => {
    await columnDatabase(async context => {
      const name = 'changed_definition'; await context.observer.query(`CREATE TABLE ${qualified(context.database, name)} (id INT PRIMARY KEY, value VARCHAR(20) DEFAULT 'old') ENGINE=InnoDB`);
      await openTable(context, name); await tablePage().getByRole('button', { name: text.title, exact: true }).click(); await expect(dialog().getByRole('button', { name: /^value ·/ })).toBeEnabled();
      await changeDefault('value', 'literal', 'planned'); await observeTasks(); await preview();
      await context.observer.query(`ALTER TABLE ${qualified(context.database, name)} COMMENT='外部已修改'`);
      await dialog().getByRole('button', { name: text.apply, exact: true }).click();
      await expect(dialog().locator('.error-box')).toBeVisible(); await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeDisabled();
      expect(await ddl(context, name)).toContain("DEFAULT 'old'"); expect(await ddl(context, name)).toContain("COMMENT='外部已修改'"); expect(await applyTasks()).toHaveLength(1);
      const proofs = await page.evaluate(() => (window as ObservedWindow).__columnEvents?.filter(event => event.columnPatch)); expect(proofs?.some(event => event.columnPatch?.outcome === 'not-sent')).toBe(true);
    }, info);
  });

  test('同目标真实加载任务未结束时阻止结构入口，解锁后才允许读取', async ({}, info) => {
    await columnDatabase(async context => {
      const name = 'busy_target'; await context.observer.query(`CREATE TABLE ${qualified(context.database, name)} (id INT PRIMARY KEY, value VARCHAR(20)) ENGINE=InnoDB`);
      const connection = await openTable(context, name);
      await context.observer.query(`LOCK TABLES ${qualified(context.database, name)} WRITE`);
      try {
        await tablePage().getByRole('button', { name: '刷新', exact: true }).click();
        await expect(tablePage().locator('.loading-overlay')).toBeVisible();
        await expect(tablePage().getByRole('button', { name: text.title, exact: true })).toBeDisabled();
        await openSidebarColumnDialog(connection, name);
        await expect(page.locator('.toast[role="alert"]')).toContainText(text.dataBusy); await expect(dialog()).toHaveCount(0);
      } finally { await context.observer.query('UNLOCK TABLES'); }
      await expect(tablePage().locator('.loading-overlay')).toHaveCount(0);
      await tablePage().getByRole('button', { name: text.title, exact: true }).click();
      await expect(dialog().getByRole('button', { name: /^value ·/ })).toBeEnabled();
      expect(await applyTasks()).toHaveLength(0);
    }, info);
  });

  test('DDL 等待期间取消与未知状态保留核对资料，终态取消不重放', async ({}, info) => {
    await columnDatabase(async context => {
      const name = 'cancel_ddl'; await context.observer.query(`CREATE TABLE ${qualified(context.database, name)} (id INT PRIMARY KEY, value VARCHAR(20) DEFAULT 'old') ENGINE=InnoDB`);
      await openTable(context, name); await tablePage().getByRole('button', { name: text.title, exact: true }).click(); await expect(dialog().getByRole('button', { name: /^value ·/ })).toBeEnabled(); await changeDefault('value', 'literal', 'cancelled'); await observeTasks(); await preview();
      await context.observer.query('START TRANSACTION'); await context.observer.query(`SELECT * FROM ${qualified(context.database, name)}`);
      try {
        await dialog().getByRole('button', { name: text.apply, exact: true }).click();
        await expect.poll(async () => { const [rows] = await context.observer.query<RowDataPacket[]>('SHOW FULL PROCESSLIST'); return rows.filter(row => typeof row.Info === 'string' && row.Info.startsWith(`ALTER TABLE ${qualified(context.database, name)}`)).length; }).toBe(1);
        await expect(dialog().getByRole('button', { name: text.close, exact: true })).toBeDisabled();
        await dialog().getByRole('button', { name: text.cancel, exact: true }).click();
        await expect(dialog().getByRole('status')).toContainText(text.unknown, { timeout: 30000 });
        await expect(dialog().getByRole('heading', { name: text.fixedSql, exact: true })).toBeVisible(); await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeDisabled();
      } finally { await context.observer.query('ROLLBACK'); }
      expect(await ddl(context, name)).toContain("DEFAULT 'old'");
      const tasks = await applyTasks(); expect(tasks).toHaveLength(1);
      await page.evaluate(taskId => window.dbark.invoke('query.cancel', { taskId }), tasks[0].id);
      expect(await applyTasks()).toHaveLength(1); expect(await ddl(context, name)).toContain("DEFAULT 'old'");
    }, info);
  });

  test('真实快照释放幂等且销毁预览，字段草稿参加原生退出确认', async ({}, info) => {
    await columnDatabase(async context => {
      const name = 'release_snapshot'; await context.observer.query(`CREATE TABLE ${qualified(context.database, name)} (id INT PRIMARY KEY, value VARCHAR(20) DEFAULT 'old') ENGINE=InnoDB`);
      // 这是实际 IPC 生命周期验收，不替代界面执行；释放后只尝试只读预览，不投递 DDL。
      const released = await page.evaluate(async target => { const snapshot = await window.dbark.invoke('schema.columns.get', { ...target, taskId: crypto.randomUUID() }); const column = snapshot.columns.find(item => item.name === 'value')!; const result = await window.dbark.invoke('schema.columns.preview', { snapshotId: snapshot.snapshotId, patches: [{ kind: 'alter', columnRef: column.columnRef, changes: { comment: '不会执行' } }], taskId: crypto.randomUUID() }); await window.dbark.invoke('schema.columns.release', { snapshotId: snapshot.snapshotId }); await window.dbark.invoke('schema.columns.release', { snapshotId: snapshot.snapshotId, previewToken: result.previewToken }); try { await window.dbark.invoke('schema.columns.preview', { snapshotId: snapshot.snapshotId, patches: [{ kind: 'drop', columnRef: column.columnRef }], taskId: crypto.randomUUID() }); return false; } catch { return true; } }, { connectionId: context.connectionId, database: context.database, table: name });
      expect(released).toBe(true); await openTable(context, name); await tablePage().getByRole('button', { name: text.title, exact: true }).click(); await expect(dialog().getByRole('button', { name: /^value ·/ })).toBeEnabled(); await editColumn('value');
      await dialog().getByRole('checkbox', { name: `${text.modify} ${text.comment}`, exact: true }).check(); await dialog().getByRole('textbox', { name: text.comment, exact: true }).fill('尚未应用');
      await answerDialogs([0]); await requestQuit();
      await expect.poll(() => desktop.evaluate(() => globalThis.__dbarkE2EDialogs.calls.some(call => call.title === '仍有待完成的工作'))).toBe(true);
      expect(closed).toBe(false); await expect(dialog()).toBeVisible(); expect(await applyTasks()).toHaveLength(0);
      await acceptNativeConfirmation(); await dialog().getByRole('button', { name: text.close, exact: true }).click(); await expect(dialog()).toHaveCount(0);
      await answerDialogs([]); await expect.poll(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})).then(tasks => tasks.some(task => task.status === 'running'))).toBe(false);
    }, info);
  });
});
