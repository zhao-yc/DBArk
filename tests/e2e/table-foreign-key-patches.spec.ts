import { clickSidebarAction } from './sidebar-menu';
import { randomUUID } from 'node:crypto';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import type { TestInfo } from '@playwright/test';
import type { TaskEvent } from '../../src/shared/contracts';
import { foreignKeyPatchZh as text } from '../../src/renderer/locales/foreignKeyPatches.zh-CN';
import { test, expect, page, desktop, closed, pageErrors, answerDialogs, quitDesktop } from './desktop-fixture';
import { enabled, environment, connectAndCreate, modifier, openDatabaseQuery, executeSql, type LiveContext } from './live-helpers';

test.use({ trace: 'off' });
const dialog = () => page.getByRole('dialog', { name: text.title, exact: true });
const tablePage = () => page.locator('.table-tab:visible');
const qualified = (database: string, table: string) => `\`${database}\`.\`${table}\``;
type Context = LiveContext & { parentDatabase: string };
type ObservedWindow = Window & { __foreignKeyEvents?: TaskEvent[] };
type GateState = {
  entered: boolean; response?: { ok: boolean; result?: { snapshotId?: string; previewToken?: string } };
  releases: { input: { snapshotId?: string; previewToken?: string }; ok: boolean }[];
  release(): void; restore(): void;
};
type GateGlobal = typeof globalThis & { __foreignKeyGate?: GateState };

/** 只记录本功能任务；表单密码与完整请求不进入证据。 */
async function tasks() { return page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind.startsWith('schema.foreignKeys.'))); }
async function applyTasks() { return (await tasks()).filter(task => task.kind === 'schema.foreignKeys.apply'); }
/** 只读观察连接读取原始定义，不用结构 API 替代界面操作。 */
async function ddl(context: Context, name: string, database = context.database): Promise<string> {
  const [rows] = await context.observer.query<RowDataPacket[]>(`SHOW CREATE TABLE ${qualified(database, name)}`);
  return String(rows[0]['Create Table']);
}
/** 每例独立 ASCII 库；先关闭真实应用，再逐个精确删除本例创建的库。 */
async function foreignKeyDatabase(body: (context: Context) => Promise<void>, info: TestInfo) {
  const database = `dbark_e2e_fk_${Date.now().toString(36)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
  const parentDatabase = `${database}_p`;
  const observer = await mysql.createConnection({ host: environment.DBARK_TEST_HOST, port: Number(environment.DBARK_TEST_PORT), user: environment.DBARK_TEST_USER, password: environment.DBARK_TEST_PASSWORD, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, connectTimeout: 15000 });
  try {
    const context = { observer, ...await connectAndCreate(database), parentDatabase };
    await body(context); expect(pageErrors).toEqual([]);
  } catch (error) {
    if (!closed) {
      await page.screenshot({ path: info.outputPath('foreign-key-live-failure.png') }).catch(() => undefined);
      await info.attach('外键失败界面与任务', { body: JSON.stringify({ database, parentDatabase, errors: await dialog().locator('.error-box').allTextContents(), states: await dialog().locator('.foreign-key-patch-state').allTextContents(), tasks: await tasks(), events: await page.evaluate(() => (window as ObservedWindow).__foreignKeyEvents ?? []) }, null, 2), contentType: 'application/json' }).catch(() => undefined);
    }
    const evidence: { database: string; table: string; ddl?: string; error?: string }[] = [];
    for (const schema of [database, parentDatabase]) {
      const [tables] = await observer.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? LIMIT 64', [schema]);
      for (const table of tables) {
        const name = String(table.TABLE_NAME);
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) throw new Error('失败证据发现非本例受控表名');
        try { const [rows] = await observer.query<RowDataPacket[]>(`SHOW CREATE TABLE ${qualified(schema, name)}`); evidence.push({ database: schema, table: name, ddl: String(rows[0]['Create Table']) }); }
        catch (reason) { evidence.push({ database: schema, table: name, error: String(reason) }); }
      }
    }
    await info.attach('外键失败实际定义', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    throw error;
  } finally {
    try { if (!closed) { await restoreGate(); await answerDialogs([1, 1]); await quitDesktop(); } }
    finally {
      try {
        // 子库先删除，释放跨库引用后才删除父库；不调整任何约束检查变量。
        for (const schema of [database, parentDatabase]) {
          if (!/^dbark_e2e_fk_[a-z0-9_]+$/.test(schema) || schema.length > 64) throw new Error('拒绝清理非本例隔离库');
          await observer.query({ sql: `DROP DATABASE IF EXISTS \`${schema}\``, timeout: 15000 });
          const [remaining] = await observer.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [schema]); expect(remaining).toHaveLength(0);
        }
      } finally { await observer.end(); }
    }
  }
}
/** 真对象树打开表，复用已有数据标签且不清除其草稿。 */
async function openTable(context: Context, name: string) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) });
  await connection.locator('.connection-row').hover(); await clickSidebarAction(connection, { name: '刷新连接', exact: true });
  await (await (await import('./navigation-menu')).navigationMenuItem(connection.locator('.database-row'), { name: context.database, exact: true })).click();
  await connection.locator('.object-row').getByText(name, { exact: true }).click();
  await expect(tablePage().locator('.context-bar')).toContainText(name); await expect(tablePage().locator('.loading-overlay')).toHaveCount(0); await expect(tablePage().locator(':scope > .error-box')).toHaveCount(0);
  return connection;
}
async function openDialog() { await (await (await import('./navigation-menu')).navigationMenuItem(tablePage(), { name: text.title, exact: true })).click(); await expect(dialog().getByRole('button', { name: text.read, exact: true })).toBeEnabled({ timeout: 30000 }); }
async function edit(name: string) { await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: `编辑外键差异 ${name}`, exact: true })).click(); await expect(dialog().locator('.foreign-key-patch-editor')).toBeVisible(); }
async function save() { await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.rowSave, exact: true })).click(); await expect(dialog().locator('.foreign-key-patch-editor')).toHaveCount(0); }
/** 引用只从当前真实选项取得，不构造或解析服务端 opaque refs。 */
async function selectColumn(side: '子' | '父', position: number, name: string) {
  const select = dialog().getByRole('combobox', { name: `${side}表字段 ${position}`, exact: true });
  const value = await select.locator('option').filter({ hasText: new RegExp(`^${name} ·`) }).getAttribute('value');
  if (!value) throw new Error('缺少真实字段选项'); await select.selectOption(value);
}
async function preview() {
  await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.preview, exact: true })).click(); await expect(dialog().getByRole('heading', { name: text.fixedSql, exact: true })).toBeVisible({ timeout: 30000 });
  for (const checkbox of await dialog().getByRole('checkbox').all()) await checkbox.check();
  await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeEnabled();
}
async function apply() { await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.apply, exact: true })).click(); await expect(dialog().getByRole('status')).toContainText(text.succeeded, { timeout: 30000 }); }
async function confirmDiscard() { await (await (await import('./navigation-menu')).navigationMenuItem(dialog().getByRole('alertdialog', { name: text.confirmTitle }), { name: text.confirmContinue, exact: true })).click(); }
/** 建立普通完整支持键，避免隐式创建索引掩盖产品行为。 */
async function simpleTables(context: Context, constraint = 'fk_old') {
  await context.observer.query(`CREATE TABLE ${qualified(context.database, 'parent')}(id INT NOT NULL,note VARCHAR(40),PRIMARY KEY(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
  await context.observer.query(`CREATE TABLE ${qualified(context.database, 'child')}(id INT NOT NULL,parent_id INT NULL,note VARCHAR(40) COMMENT '原字段注释',PRIMARY KEY(id),KEY child_support(parent_id) COMMENT '原支持键',CONSTRAINT \`${constraint}\` FOREIGN KEY(parent_id) REFERENCES ${qualified(context.database, 'parent')}(id) ON UPDATE RESTRICT ON DELETE RESTRICT,CHECK(id>0)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='原表注释'`);
  await context.observer.query(`INSERT INTO ${qualified(context.database, 'parent')} VALUES(1,'parent-old')`);
  await context.observer.query(`INSERT INTO ${qualified(context.database, 'child')} VALUES(1,1,'child-old')`);
}
/** 编辑真实网格，保留未提交值以观察入口或 beforeApply 的保护。 */
async function dirtyNote(value: string) {
  const column = await tablePage().getByRole('columnheader', { name: /^note/ }).getAttribute('aria-colindex');
  const cell = tablePage().locator(`[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="${column}"]`);
  await cell.dblclick(); const input = tablePage().getByRole('textbox', { name: '编辑 note', exact: true }); await input.fill(value); await input.press('Enter'); await expect(cell).toContainText(value);
}
/** 只门控生产 IPC 已完成的真实响应；原 handler、校验、引擎和数据库均照常运行。 */
async function installGate(command: 'schema.foreignKeys.get' | 'schema.foreignKeys.preview') {
  await desktop.evaluate(({ ipcMain }, selected) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: { command?: string; input?: { snapshotId?: string; previewToken?: string } }) => Promise<{ ok: boolean; result?: { snapshotId?: string; previewToken?: string } }>;
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers.get('dbark:request'); if (!original) throw new Error('未找到真实 IPC handler，不能构造假结果');
    let resume!: () => void; const held = new Promise<void>(resolve => { resume = resolve; });
    const state: GateState = { entered: false, releases: [], release: resume, restore: () => { resume(); handlers.set('dbark:request', original); } };
    (globalThis as GateGlobal).__foreignKeyGate = state;
    handlers.set('dbark:request', async (event, payload) => {
      const response = await original(event, payload);
      if (payload.command === 'schema.foreignKeys.release') state.releases.push({ input: { ...payload.input }, ok: response.ok });
      if (payload.command === selected && !state.entered) { state.response = response; state.entered = true; await held; }
      return response;
    });
  }, command);
}
async function restoreGate() { await desktop.evaluate(() => { const current = globalThis as GateGlobal; current.__foreignKeyGate?.restore(); delete current.__foreignKeyGate; }); }
/** 取消发生在真实返回等待期间，必须释放迟到令牌且不把它显示为可执行预览。 */
async function cancelHeldResponse(kind: 'snapshotId' | 'previewToken') {
  await expect.poll(() => desktop.evaluate(() => (globalThis as GateGlobal).__foreignKeyGate?.entered)).toBe(true);
  const result = await desktop.evaluate(() => (globalThis as GateGlobal).__foreignKeyGate?.response); expect(result?.ok).toBe(true); expect(result?.result?.[kind]).toBeTruthy();
  await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.cancel, exact: true })).click(); await expect(dialog().getByRole('button', { name: text.read, exact: true })).toBeDisabled();
  await desktop.evaluate(() => (globalThis as GateGlobal).__foreignKeyGate?.release());
  await expect(dialog().getByRole('button', { name: text.read, exact: true })).toBeEnabled({ timeout: 15000 });
  await expect.poll(() => desktop.evaluate((_, { key, token }) => (globalThis as GateGlobal).__foreignKeyGate?.releases.filter(row => row.ok && row.input[key] === token).length, { key: kind, token: result!.result![kind] })).toBe(1);
  await expect(dialog().getByRole('heading', { name: text.fixedSql, exact: true })).toHaveCount(0); expect(await applyTasks()).toHaveLength(0); await restoreGate();
}

test.describe('外键差异：真实 Electron 与隔离数据库', () => {
  test.skip(!enabled, '未显式授权 200 隔离数据库验收'); test.setTimeout(150000);
  test.beforeEach(async () => {
    environment.DBARK_TEST_HOST = '192.168.31.200'; environment.DBARK_TEST_PORT = process.env.DBARK_FOREIGN_KEY_TEST_PORT ?? process.env.DBARK_TEST_PORT ?? '13384';
    if (!['13357', '13380', '13384', '13310', '13311'].includes(environment.DBARK_TEST_PORT)) throw new Error('拒绝访问未授权实例');
    if (!environment.DBARK_TEST_USER) throw new Error('缺少隔离环境连接配置');
    await page.evaluate(() => { const current = window as ObservedWindow; current.__foreignKeyEvents = []; window.dbark.onTask(event => { if (event.foreignKeyPatch) current.__foreignKeyEvents!.push(event); }); });
  });

  test('两入口、只读预览零 DDL、双击只提交一次且保留其它原定义', async ({}, info) => {
    await foreignKeyDatabase(async context => {
      await simpleTables(context); const original = await ddl(context, 'child'); const connection = await openTable(context, 'child');
      const row = connection.locator('.object-row').filter({ has: page.getByText('child', { exact: true }) }); await row.hover(); await clickSidebarAction(row, { name: `${text.title} child`, exact: true });
      await expect(dialog().getByRole('button', { name: '编辑外键差异 fk_old', exact: true })).toBeEnabled({ timeout: 30000 }); await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.close, exact: true })).click(); await openDialog();
      await edit('fk_old'); await dialog().getByRole('textbox', { name: text.name, exact: true }).fill('fk_new'); await save(); await preview(); expect(await ddl(context, 'child')).toBe(original);
      await expect(dialog().locator('.monaco-editor .view-lines')).toContainText('DROP FOREIGN KEY'); await expect(dialog().locator('.monaco-editor .view-lines')).toContainText('ADD CONSTRAINT');
      await dialog().locator('.monaco-editor').getByRole('textbox').focus(); await page.keyboard.press(`${modifier}+Enter`); await page.keyboard.press(`${modifier}+S`); expect(await applyTasks()).toHaveLength(0); expect(await ddl(context, 'child')).toBe(original);
      await page.screenshot({ path: info.outputPath('foreign-key-preview.png') }); await dialog().getByRole('button', { name: text.apply, exact: true }).dblclick(); await expect(dialog().getByRole('status')).toContainText(text.succeeded, { timeout: 30000 });
      expect(await applyTasks()).toHaveLength(1); expect(await ddl(context, 'child')).toBe(original.replace('`fk_old`', '`fk_new`')); await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeDisabled();
    }, info);
  });

  test('显式跨库父重读确认舍弃草稿，复合映射换父与动作必须明确异名', async ({}, info) => {
    await foreignKeyDatabase(async context => {
      await context.observer.query(`CREATE DATABASE \`${context.parentDatabase}\` CHARACTER SET utf8mb4`);
      await context.observer.query(`CREATE TABLE ${qualified(context.database, 'parent')}(a INT NOT NULL,b INT NOT NULL,PRIMARY KEY(a,b)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
      await context.observer.query(`CREATE TABLE ${qualified(context.parentDatabase, 'other_parent')}(x INT NOT NULL,y INT NOT NULL,PRIMARY KEY(y,x)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
      await context.observer.query(`CREATE TABLE ${qualified(context.database, 'child')}(id INT PRIMARY KEY,a INT NULL,b INT NULL,KEY ab(a,b),KEY ba(b,a),CONSTRAINT fk_pair FOREIGN KEY(a,b) REFERENCES ${qualified(context.database, 'parent')}(a,b) ON UPDATE RESTRICT ON DELETE RESTRICT) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
      await openTable(context, 'child'); await openDialog(); await edit('fk_pair'); await dialog().getByRole('textbox', { name: text.name, exact: true }).fill('discard_me'); await save();
      await dialog().getByRole('textbox', { name: text.extraDatabase, exact: true }).fill(context.parentDatabase); await dialog().getByRole('textbox', { name: text.extraTable, exact: true }).fill('other_parent'); await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.loadParent, exact: true })).click();
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.confirmCancel, exact: true })).click(); await edit('fk_pair'); await expect(dialog().getByRole('textbox', { name: text.name, exact: true })).toHaveValue('discard_me'); await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.editorCancel, exact: true })).click();
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.loadParent, exact: true })).click(); await confirmDiscard(); await expect(dialog().getByRole('button', { name: text.read, exact: true })).toBeEnabled({ timeout: 30000 });
      await edit('fk_pair'); await expect(dialog().getByRole('textbox', { name: text.name, exact: true })).toHaveValue('fk_pair'); await dialog().getByRole('combobox', { name: text.parent, exact: true }).selectOption({ label: `${context.parentDatabase} / other_parent` });
      await selectColumn('父', 1, 'x'); await selectColumn('父', 2, 'y'); await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: '上移字段映射 2', exact: true })).click();
      await dialog().getByRole('combobox', { name: text.onDelete, exact: true }).selectOption('SET NULL'); await dialog().getByRole('combobox', { name: text.onUpdate, exact: true }).selectOption('CASCADE');
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.rowSave, exact: true })).click(); await expect(dialog().locator('.error-box')).toContainText(text.sameName); expect(await applyTasks()).toHaveLength(0);
      await dialog().getByRole('textbox', { name: text.name, exact: true }).fill('fk_cross'); await save(); await preview(); await apply();
      const [pairs] = await context.observer.query<RowDataPacket[]>('SELECT COLUMN_NAME,REFERENCED_TABLE_SCHEMA,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME=? ORDER BY ORDINAL_POSITION', [context.database, 'child', 'fk_cross']);
      expect(pairs.map(row => [row.COLUMN_NAME, row.REFERENCED_TABLE_SCHEMA, row.REFERENCED_TABLE_NAME, row.REFERENCED_COLUMN_NAME])).toEqual([['b', context.parentDatabase, 'other_parent', 'y'], ['a', context.parentDatabase, 'other_parent', 'x']]);
      const [actions] = await context.observer.query<RowDataPacket[]>('SELECT UPDATE_RULE,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=? AND CONSTRAINT_NAME=?', [context.database, 'fk_cross']); expect(actions.map(row => [row.UPDATE_RULE, row.DELETE_RULE])).toEqual([['CASCADE', 'SET NULL']]);
    }, info);
  });

  test('目标入口与父表 beforeApply 均保护未提交草稿且不丢值', async ({}, info) => {
    await foreignKeyDatabase(async context => {
      await simpleTables(context); await context.observer.query(`CREATE TABLE ${qualified(context.database, 'other_child')}(id INT PRIMARY KEY,parent_id INT,KEY support(parent_id),CONSTRAINT fk_other FOREIGN KEY(parent_id) REFERENCES ${qualified(context.database, 'parent')}(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
      await openTable(context, 'child'); await dirtyNote('子表未提交'); await (await (await import('./navigation-menu')).navigationMenuItem(tablePage(), { name: text.title, exact: true })).click(); await expect(dialog()).toHaveCount(0); await expect(page.locator('.toast[role="alert"]')).toContainText(text.dataDirty);
      await openTable(context, 'parent'); await dirtyNote('父表未提交'); await openTable(context, 'other_child'); await openDialog(); await edit('fk_other'); await dialog().getByRole('textbox', { name: text.name, exact: true }).fill('fk_blocked'); await save(); await preview();
      const original = await ddl(context, 'other_child'); await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.apply, exact: true })).click(); await expect(dialog().locator('.error-box')).toContainText(text.dataDirty); await expect(dialog().getByRole('status')).toContainText(text.notSent); expect(await applyTasks()).toHaveLength(0); expect(await ddl(context, 'other_child')).toBe(original);
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.close, exact: true })).click(); await confirmDiscard();
      await page.locator('.tab-select').filter({ hasText: /^parent$/ }).click(); await expect(tablePage().getByRole('gridcell').filter({ hasText: '父表未提交' })).toBeVisible();
      await page.locator('.tab-select').filter({ hasText: /^child$/ }).click(); await expect(tablePage().getByRole('gridcell').filter({ hasText: '子表未提交' })).toBeVisible();
      const [rows] = await context.observer.query<RowDataPacket[]>(`SELECT note FROM ${qualified(context.database, 'parent')} UNION ALL SELECT note FROM ${qualified(context.database, 'child')}`); expect(rows.map(row => row.note)).toEqual(['parent-old', 'child-old']);
    }, info);
  });

  test('真实 get 与 preview 返回迟到时释放令牌，不生成可执行旧预览', async ({}, info) => {
    await foreignKeyDatabase(async context => {
      await simpleTables(context); await openTable(context, 'child'); const original = await ddl(context, 'child');
      await installGate('schema.foreignKeys.get'); await (await (await import('./navigation-menu')).navigationMenuItem(tablePage(), { name: text.title, exact: true })).click(); await cancelHeldResponse('snapshotId');
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.read, exact: true })).click(); await expect(dialog().getByRole('button', { name: '编辑外键差异 fk_old', exact: true })).toBeEnabled({ timeout: 30000 });
      await edit('fk_old'); await dialog().getByRole('textbox', { name: text.name, exact: true }).fill('fk_late'); await save(); await installGate('schema.foreignKeys.preview'); await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.preview, exact: true })).click(); await cancelHeldResponse('previewToken'); expect(await ddl(context, 'child')).toBe(original);
    }, info);
  });

  test('真实 metadata lock 取消等待终态，查询标签事务与临时表仍保留', async ({}, info) => {
    await foreignKeyDatabase(async context => {
      await simpleTables(context); await context.observer.query(`CREATE TABLE ${qualified(context.database, 'transaction_probe')}(id INT PRIMARY KEY) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
      await openTable(context, 'child'); await openDatabaseQuery(context.database); const queryTab = await page.locator('.workspace-tab-button.active .tab-select').innerText();
      await executeSql(`CREATE TEMPORARY TABLE local_probe(v VARCHAR(40)); INSERT INTO local_probe VALUES('保留临时表'); START TRANSACTION; INSERT INTO ${qualified(context.database, 'transaction_probe')} VALUES(1);`);
      await expect(page.locator('.query-tab:visible .tab-status')).toContainText('事务进行中'); await openTable(context, 'child'); await openDialog(); await edit('fk_old'); await dialog().getByRole('textbox', { name: text.name, exact: true }).fill('fk_cancelled'); await save(); await preview(); const original = await ddl(context, 'child');
      await context.observer.query(`LOCK TABLES ${qualified(context.database, 'child')} READ`);
      let blockedId: string | undefined;
      try {
        await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.apply, exact: true })).click();
        await expect.poll(async () => { const [rows] = await context.observer.query<RowDataPacket[]>('SHOW FULL PROCESSLIST'); const blocked = rows.find(row => typeof row.Info === 'string' && row.Info.startsWith('ALTER TABLE') && row.Info.includes(context.database) && /metadata lock/i.test(String(row.State))); if (blocked) blockedId = String(blocked.Id); return !!blocked; }, { timeout: 20000 }).toBe(true);
        await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.cancel, exact: true })).click(); await expect(dialog().getByRole('button', { name: text.read, exact: true })).toBeEnabled({ timeout: 20000 });
        expect((await applyTasks()).map(task => task.status)).toEqual(['cancelled']);
        await expect.poll(async () => { const [rows] = await context.observer.query<RowDataPacket[]>('SHOW FULL PROCESSLIST'); return rows.some(row => String(row.Id) === blockedId); }).toBe(false);
      } finally { await context.observer.query('UNLOCK TABLES'); }
      expect(await ddl(context, 'child')).toBe(original); await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.close, exact: true })).click(); await confirmDiscard();
      await page.locator('.tab-select').filter({ hasText: queryTab.trim() }).click(); await expect(page.locator('.query-tab:visible .tab-status')).toContainText('事务进行中');
      await executeSql('SELECT v FROM local_probe'); await expect(page.locator('.query-tab:visible').getByRole('gridcell').filter({ hasText: '保留临时表' })).toBeVisible();
      const [before] = await context.observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${qualified(context.database, 'transaction_probe')}`); expect(String(before[0].n)).toBe('0');
      await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.query-tab:visible'), { name: '回滚', exact: true })).click(); await expect(page.locator('.query-tab:visible .tab-status')).not.toContainText('事务进行中');
      const [after] = await context.observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${qualified(context.database, 'transaction_probe')}`); expect(String(after[0].n)).toBe('0');
    }, info);
  });

  test('已有非受证约束名称保留原片段并明确只读，不替换为猜测定义', async ({}, info) => {
    await foreignKeyDatabase(async context => {
      await simpleTables(context, '旧外键'); await openTable(context, 'child'); const original = await ddl(context, 'child'); await openDialog();
      const item = dialog().locator('.foreign-key-patch-item').filter({ has: page.getByRole('button', { name: '编辑外键差异 旧外键', exact: true }) });
      await expect(item.getByRole('button', { name: '编辑外键差异 旧外键', exact: true })).toBeDisabled(); await expect(item.getByRole('button', { name: '标记删除外键 旧外键', exact: true })).toBeDisabled();
      expect((await item.locator('.warning-text').allTextContents()).join('').length).toBeGreaterThan(0); await item.getByText(text.original, { exact: true }).click(); await expect(item.locator('.foreign-key-patch-raw')).toContainText('旧外键');
      expect(await applyTasks()).toHaveLength(0); expect(await ddl(context, 'child')).toBe(original);
    }, info);
  });

  test('默认自身父表候选可真实新增和删除自引用，支持索引及数据保持', async ({}, info) => {
    await foreignKeyDatabase(async context => {
      await context.observer.query(`CREATE TABLE ${qualified(context.database, 'self_child')}(id INT NOT NULL,parent_id INT NULL,note VARCHAR(40),PRIMARY KEY(id),KEY support(parent_id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
      await context.observer.query(`INSERT INTO ${qualified(context.database, 'self_child')} VALUES(1,NULL,'根'),(2,1,'子')`); await openTable(context, 'self_child'); const original = await ddl(context, 'self_child'); await openDialog();
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.add, exact: true })).click(); await dialog().getByRole('textbox', { name: text.name, exact: true }).fill('fk_self'); await dialog().getByRole('combobox', { name: text.parent, exact: true }).selectOption({ label: `${context.database} / self_child` }); await selectColumn('子', 1, 'parent_id'); await selectColumn('父', 1, 'id'); await save(); await preview(); await apply();
      expect(await ddl(context, 'self_child')).toContain('CONSTRAINT `fk_self`'); await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.read, exact: true })).click(); await expect(dialog().getByRole('button', { name: '标记删除外键 fk_self', exact: true })).toBeEnabled({ timeout: 30000 });
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: '标记删除外键 fk_self', exact: true })).click(); await confirmDiscard(); await preview(); await apply(); expect(await ddl(context, 'self_child')).toBe(original);
      const [rows] = await context.observer.query<RowDataPacket[]>(`SELECT id,parent_id,note FROM ${qualified(context.database, 'self_child')} ORDER BY id`); expect(rows.map(row => [row.id, row.parent_id, row.note])).toEqual([[1, null, '根'], [2, 1, '子']]); expect(await applyTasks()).toHaveLength(2);
    }, info);
  });
});
