import { sqliteRelationZh as relationText } from '../../src/renderer/locales/sqliteRelation.zh-CN';
import { sqliteIncomingZh as incomingText } from '../../src/renderer/locales/sqliteIncoming.zh-CN';
import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { sqliteTableBrowseZh as text } from '../../src/renderer/locales/sqliteTableBrowse.zh-CN';
import { relationshipDiagramZh as diagramText } from '../../src/renderer/locales/relationshipDiagram.zh-CN';
import { navigationMenuItem } from './navigation-menu';
import { sqliteTableEditZh as editText } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';
import { sqliteReferenceZh as referenceText } from '../../src/renderer/locales/sqliteReference.zh-CN';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_SQLITE_RELATIONSHIPS_NATIVE_TEST === '1';
if (active) {
  const forbidden = Object.keys(process.env).filter(key => /^DBARK_(?:TEST_|C02_|SSH_|MTLS_)/.test(key) || /^DBARK_.*(?:PASSWORD|PASSPHRASE|PRIVATE_KEY|CREDENTIAL|DATABASE_URL)$/.test(key) || /^(?:MYSQL_|MARIADB_|POSTGRES_|PGHOST$|PGPORT$|PGUSER$|PGPASSWORD$|PGDATABASE$|DATABASE_URL$|SSH_AUTH_SOCK$|SSH_AGENT_PID$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/.test(key) || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].includes(key));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length || !['win32', 'darwin'].includes(process.platform)) throw Error('SQLite关系图专项仅允许无外库认证的离线Windows/macOS源码，拒绝字段：' + forbidden.join(','));
  for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('关系图专项禁止自动trace');
}
type Desktop = typeof import('./desktop-fixture');
interface MenuAudit { pending: number; commands: string[]; denied: string[]; pickerCalls: number; reads: unknown[]; incoming: { input: Record<string, unknown>; reply?: unknown }[]; references: { input: Record<string, unknown>; reply?: unknown }[]; connectionId?: string; navigation?: boolean; profiles: Record<string, boolean>; snapshots: string[]; previews: string[]; writes: unknown[]; restore(): void; }
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：显式离线启用SQLite关系图原生专项');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
let completed: { directory: string; database: string; pid?: number; platform: string } | undefined;
test.afterEach(({}, info) => { if (active && info.status !== 'skipped' && !completed) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); throw Error('关系图未完成准确正常退出，原现场保留'); } });

test('SQLite真实表页关系图单快照读取、隐式主键、草稿与本地显示', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop, { join, basename, dirname, resolve } = require('node:path') as typeof import('node:path');
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const owner = runtime.ownedDesktopResources(info), { application, page } = owner, process = application.process(), directory = runtime.dataDir, database = join(directory, 'relationships.sqlite');
  let closed = false, armed = false;
  /** 每个异步边界都绑定准确owner、期限和合成目录，不接管其它应用。 */
  const check = () => {
    const now = runtime.ownedDesktopResources(info);
    if (now.application !== application || now.page !== page || now.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry || info.repeatEachIndex || info.config.workers !== 1) throw Error('原关系图验收owner或期限已变化');
  };
  const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); const result = await action(); check(); return result; };
  const audit = () => step(() => application.evaluate(() => {
    const state = (globalThis as typeof globalThis & { __sqliteRelationshipsAudit?: MenuAudit }).__sqliteRelationshipsAudit;
    if (!state) throw Error('关系图Main观察器不存在'); return { pending: state.pending, commands: state.commands, denied: state.denied, pickerCalls: state.pickerCalls, reads: state.reads, references: state.references, incoming: state.incoming, profiles: state.profiles, snapshots: state.snapshots, previews: state.previews, writes: state.writes };
  }));
  const table = () => page.locator('.sqlite-table-tab:visible');
  const toolbar = () => table().getByRole('toolbar', { name: text.toolbar, exact: true });
  try {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); expect(dirname(resolve(database))).toBe(resolve(directory)); expect(basename(directory)).toMatch(/^dbark-e2e-/);
    const db = new DatabaseSync(database); try { db.exec("PRAGMA foreign_keys=OFF; CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT,p REFERENCES parent); INSERT INTO parent VALUES(1); INSERT INTO subject VALUES(1,'合成原值','001'); CREATE TABLE parent_pair(a TEXT COLLATE NOCASE NOT NULL,b INTEGER NOT NULL,label TEXT,PRIMARY KEY(a,b)) WITHOUT ROWID; INSERT INTO parent_pair VALUES('Alpha',9223372036854775807,'甲'),('Beta',2,'乙'),('Gamma',3,'丙'); CREATE TABLE child_pair(id INTEGER PRIMARY KEY,a TEXT,b INTEGER,note TEXT,FOREIGN KEY(a,b) REFERENCES parent_pair); INSERT INTO child_pair VALUES(1,'Alpha',9223372036854775807,'原值'),(2,NULL,NULL,'控制'); CREATE TABLE related_child(id INTEGER PRIMARY KEY,p TEXT REFERENCES parent(id),label TEXT); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<52) INSERT INTO related_child SELECT x,'001','明细'||x FROM n; INSERT INTO related_child VALUES(53,NULL,'无关联'),(54,'2','其它父键'); CREATE TABLE child_note(id INTEGER PRIMARY KEY,owner INTEGER REFERENCES child_pair(id),payload BLOB); INSERT INTO child_note VALUES(1,1,X'00FF')"); } finally { db.close(); }
    await info.attach('关系图准确启动归属', { body: JSON.stringify({ directory, database, pid: process.pid }), contentType: 'application/json' });
    await step(() => application.evaluate(({ ipcMain, dialog, BrowserWindow }, input) => {
      type Root = typeof globalThis & { __sqliteRelationshipsAudit?: MenuAudit };
      const root = globalThis as Root, handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: Electron.IpcMainInvokeEvent, packet: { command: string; input: Record<string, unknown> }) => Promise<unknown>> })._invokeHandlers;
      const original = handlers.get('dbark:request'), picker = dialog.showOpenDialog, window = BrowserWindow.getAllWindows()[0], frame = window.webContents.mainFrame;
      if (!original || root.__sqliteRelationshipsAudit || BrowserWindow.getAllWindows().length !== 1) throw Error('关系图Main原入口不明确');
      const state: MenuAudit = { pending: 0, commands: [], denied: [], pickerCalls: 0, reads: [], references: [], incoming: [], profiles: {}, snapshots: [], previews: [], writes: [], restore() {} };
      let choosing = false;
      const deny = (command: string): never => { state.denied.push(command); throw Error('关系图专项拒绝越界：' + command); };
      const current = () => { if (root.__sqliteRelationshipsAudit !== state || handlers.get('dbark:request') !== wrapped || dialog.showOpenDialog !== ownPicker || window.isDestroyed() || window.webContents.mainFrame !== frame || BrowserWindow.getAllWindows().length !== 1 || state.denied.length) throw Error('关系图Main原观察器失效'); };
      const ownPicker = (async (...args: unknown[]) => { current(); const options = args.at(-1) as Electron.OpenDialogOptions; if (!choosing || state.pickerCalls >= 2 || !options.properties?.includes('openFile')) return deny('其它文件对话框'); state.pickerCalls++; return { canceled: false, filePaths: [input.database] }; }) as typeof dialog.showOpenDialog;
      const allowed = new Set(['app.menuState', 'app.setDirty', 'settings.get', 'settings.save', 'connections.list', 'connections.save', 'connections.test', 'connections.open', 'files.choose', 'metadata.databases', 'metadata.objects', 'tasks.list', 'history.list', 'sqlite.tablePage', 'sqlite.tableLayout.get', 'sqlite.relationships', 'sqlite.referencePage', 'sqlite.incomingPage', 'sqlite.tableEdit.release', 'sqlite.tableEdit.preview', 'sqlite.tableEdit.apply']);
      const wrapped = async (event: Electron.IpcMainInvokeEvent, packet: { command: string; input: Record<string, unknown> }) => {
        current(); const command = packet?.command, value = packet?.input;
        if (event.sender !== window.webContents || event.senderFrame !== frame || !allowed.has(command) || !value || typeof value !== 'object') return deny(String(command));
        if (command === 'files.choose') { if (value.purpose !== 'sqlite-database' || typeof value.sqliteConnectionId !== 'string') return deny(command); if (state.pickerCalls >= 2 || value.sqliteConnectionId in state.profiles) return deny(command); state.connectionId = value.sqliteConnectionId; state.profiles[value.sqliteConnectionId] = state.pickerCalls === 0; choosing = true; }
        if (command === 'connections.save' || command === 'connections.test') { const config = value.sqlite as { readOnly?: boolean } | undefined; if (typeof value.id !== 'string' || !(value.id in state.profiles) || value.dialect !== 'sqlite' || config?.readOnly !== state.profiles[value.id]) return deny(command); }
        if (command === 'connections.open' && !(String(value.id) in state.profiles) || command.startsWith('metadata.') && !(String(value.connectionId) in state.profiles)) return deny(command);
        if (command === 'sqlite.tableEdit.preview' && !state.snapshots.includes(String(value.snapshotId))) return deny(command);
        if (command === 'sqlite.tableEdit.apply' && (!state.previews.includes(String(value.previewId)) || value.confirmation !== 'main.child_pair' || state.writes.length)) return deny(command);
        if (command === 'sqlite.tableEdit.release' && (value.snapshotId !== undefined && !state.snapshots.includes(String(value.snapshotId)) || value.previewId !== undefined && !state.previews.includes(String(value.previewId)))) return deny(command);
        if (command.startsWith('sqlite.') && !command.startsWith('sqlite.tableEdit.')) {
          const id = String(value.connectionId), readOnly = state.profiles[id];
          if (!(id in state.profiles) || value.database !== 'main') return deny(command);
          if (command === 'sqlite.relationships') { if (!readOnly || (value.anchor as { table?: string })?.table !== 'subject' || !Array.isArray(value.tables) || value.tables.some(name => !['subject', 'parent'].includes(String(name)))) return deny(command); }
          else if (command === 'sqlite.incomingPage') { if (!(readOnly ? ['parent'] : state.navigation ? ['child_pair','parent_pair'] : ['child_pair']).includes(String(value.table)) || value.incoming === 'page' && !(readOnly ? ['related_child','subject'] : state.navigation && value.table === 'parent_pair' ? ['child_pair'] : ['child_note']).includes(String(value.childTable))) return deny(command); }
          else if (!(readOnly ? ['subject', 'parent'] : state.navigation && command === 'sqlite.referencePage' ? ['child_pair','child_note'] : ['child_pair']).includes(String(value.table))) return deny(command);
        }
        state.pending++; state.commands.push(command);
        try { const result = await original(event, packet); current();
          const reply = result as { ok?: boolean; result?: { edit?: { kind?: string; snapshotId?: string }; previewId?: string } };
          if (reply.ok && command === 'sqlite.tablePage' && reply.result?.edit?.kind === 'editable') { if (state.profiles[String(value.connectionId)] || value.table !== 'child_pair' || !reply.result.edit.snapshotId) return deny(command); state.snapshots.push(reply.result.edit.snapshotId); }
          if (reply.ok && command === 'sqlite.tableEdit.preview' && reply.result?.previewId) state.previews.push(reply.result.previewId);
          if (command === 'sqlite.tableEdit.apply') state.writes.push({ input: structuredClone(value), reply: structuredClone(result) });
          if (command === 'sqlite.relationships') state.reads.push({ input: structuredClone(value), reply: structuredClone(result) }); if (command === 'sqlite.incomingPage') state.incoming.push({ input: structuredClone(value), reply: structuredClone(result) }); if (command === 'sqlite.referencePage') state.references.push({ input: structuredClone(value), reply: structuredClone(result) }); return result; } finally { state.pending--; if (command === 'files.choose') choosing = false; }
      };
      state.restore = () => { current(); if (state.pending) throw Error('关系图原请求未完成'); handlers.set('dbark:request', original); dialog.showOpenDialog = picker; delete root.__sqliteRelationshipsAudit; };
      root.__sqliteRelationshipsAudit = state; handlers.set('dbark:request', wrapped); dialog.showOpenDialog = ownPicker;
    }, { database })); armed = true;
    await step(async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click());
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await step(() => form.getByLabel(zh.connections.text006, { exact: true }).fill('SQLite关系图本例'));
    await step(() => form.locator('select').selectOption('sqlite')); await step(() => expect(form.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true })).toBeChecked());
    await step(() => form.getByRole('button', { name: sqliteZh.choose, exact: true }).click()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
    await step(() => page.locator('.connection-row .tree-label').filter({ hasText: 'SQLite关系图本例' }).click()); await step(() => page.locator('.database-row .tree-label').filter({ hasText: /^main$/ }).click());
    await step(() => page.locator('.object-row .tree-label').filter({ hasText: /^subject$/ }).dblclick()); await step(() => expect(table().getByRole('grid')).toBeVisible()); await step(() => expect.poll(async () => (await audit()).pending).toBe(0));
    // 打开模态会同步原生菜单可用状态；仅排除这个声明式状态命令，其余请求完整逐项核对。
    const operations = (commands: string[]) => commands.filter(command => command !== 'app.menuState');
    const before = await audit();
    await step(async () => (await navigationMenuItem(toolbar(), { name: diagramText.entry, exact: true }, check)).click());
    const dialog = page.getByRole('dialog', { name: diagramText.title, exact: true }); await step(() => expect(dialog).toBeVisible());
    expect(operations((await audit()).commands)).toEqual(operations(before.commands));
    await step(() => dialog.getByRole('button', { name: diagramText.read, exact: true }).click());
    await step(() => expect(dialog).toContainText('1 张已读表 · 1 个未读目标 · 1 个外键'));
    await step(() => expect(dialog).toContainText('隐式主键第1列（未确认）'));
    await step(() => dialog.getByRole('button', { name: diagramText.catalog, exact: true }).click());
    await step(() => expect(dialog.getByRole('checkbox', { name: 'parent', exact: true })).toBeVisible());
    await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); const beforePick = await audit();
    await step(() => dialog.getByRole('checkbox', { name: 'parent', exact: true }).check());
    expect(operations((await audit()).commands)).toEqual(operations(beforePick.commands));
    await step(() => dialog.getByRole('button', { name: diagramText.read, exact: true }).click());
    await step(() => expect(dialog).toContainText('2 张已读表 · 0 个未读目标 · 1 个外键')); await step(() => expect(dialog).toContainText('p → id'));
    await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); const beforeLocal = await audit();
    for (const theme of ['dark', 'light']) {
      // 对话框在前时只更新合成窗口的显示主题；不模拟点击隐藏业务按钮。
      await step(() => page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme));
      await step(() => dialog.getByRole('button', { name: diagramText.zoomOut, exact: true }).click());
      await step(() => dialog.getByRole('button', { name: diagramText.fit, exact: true }).click());
      await step(() => dialog.getByRole('button', { name: 'main.parent', exact: true }).click());
      await step(() => expect(dialog.locator('.relationship-diagram-node')).toHaveCount(2));
      await info.attach('SQLite关系图-' + theme, { body: await step(() => page.screenshot()), contentType: 'image/png' });
    }
    expect(operations((await audit()).commands)).toEqual(operations(beforeLocal.commands));
    await step(() => dialog.getByRole('button', { name: diagramText.refresh, exact: true }).click()); await step(() => expect.poll(async () => (await audit()).reads.length).toBe(3));
    await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); const after = await audit();
    expect(after.denied).toEqual([]); expect(after.pickerCalls).toBe(1); expect(runtime.pageErrors).toEqual([]);
    const requests = after.reads as { input: { taskId: string; tables: string[] }; reply: { ok: boolean; result: { tables: unknown[]; schemaVersion: string } } }[];
    expect(requests.map(value => value.input.tables)).toEqual([['subject'], ['subject', 'parent'], ['subject', 'parent']]);
    expect(new Set(requests.map(value => value.input.taskId)).size).toBe(3); for (const value of requests) { expect(value.reply.ok).toBe(true); expect(value.reply.result.tables).toHaveLength(value.input.tables.length); }
    await step(() => dialog.locator('.modal-footer').getByRole('button', { name: diagramText.close, exact: true }).click()); await step(() => expect(dialog).toBeHidden());
    await info.attach('SQLite关系图真实Main请求与原资源边界', { body: JSON.stringify({ platform: globalThis.process.platform, before, after, realMain: true, realSQLiteWorker: true, systemFilePickerInputVerified: false, themeSelectionViaSettingsVerified: false, noSystemClipboard: true }), contentType: 'application/json' });
    // 真实当前行的TEXT子键001按父INTEGER亲和性匹配1；打开与选择都零隐式读取。
    const sourceReads = (await audit()).commands.filter(command => command === 'sqlite.tablePage').length;
    await step(() => table().getByRole('grid').locator('[role="row"][aria-rowindex="2"] [role="gridcell"]').nth(1).click());
    const beforeReference = await audit(); await step(async () => (await navigationMenuItem(toolbar(), { name: referenceText.entry, exact: true }, check)).click());
    const reference = page.getByRole('dialog', { name: referenceText.title, exact: true }); await step(() => expect(reference).toBeVisible()); expect((await audit()).references).toEqual(beforeReference.references);
    await step(() => reference.getByRole('button', { name: referenceText.catalog, exact: true }).click()); await step(() => expect(reference.getByLabel(referenceText.constraint, { exact: true })).toHaveValue('0'));
    expect((await audit()).references).toHaveLength(1); await step(() => reference.getByRole('button', { name: referenceText.read, exact: true }).click());
    await step(() => expect(reference.getByRole('grid').getByRole('gridcell').filter({ hasText: /^1$/ })).toHaveCount(1));
    const referenceFacts = await audit(); expect(referenceFacts.references).toHaveLength(2); expect(referenceFacts.references[1].input).toMatchObject({ reference: 'page', foreignKey: 0, values: [{ kind: 'text', value: '001' }], table: 'subject', offset: 0, limit: 50 });
    expect(referenceFacts.commands.filter(command => command === 'sqlite.tablePage')).toHaveLength(sourceReads);
    await info.attach('SQLite外键父记录真实窗口', { body: await page.screenshot(), contentType: 'image/png' });
    await step(() => reference.getByRole('button', { name: referenceText.close, exact: true }).click()); await step(() => expect(reference).toHaveCount(0));
    await info.attach('SQLite外键浏览原始回包', { body: JSON.stringify((await audit()).references), contentType: 'application/json' });
    // 只读父行反向读取：目录不带业务值，52条子记录完整分页，切换声明不隐式查询。
    const readOnlyBranch = page.locator('.connection-row').filter({ hasText: 'SQLite关系图本例' }).locator('..');
    await step(() => readOnlyBranch.locator('.object-row .tree-label').filter({ hasText: /^parent$/ }).dblclick());
    await step(() => table().getByRole('grid').getByRole('gridcell').filter({ hasText: /^1$/ }).click());
    const beforeIncoming = (await audit()).incoming.length, sourceIncomingReads = (await audit()).commands.filter(command => command === 'sqlite.tablePage').length;
    await step(async () => (await navigationMenuItem(toolbar(), { name: incomingText.entry, exact: true }, check)).click());
    const incoming = () => page.getByRole('dialog', { name: incomingText.title, exact: true }); await step(() => expect(incoming()).toBeVisible()); expect((await audit()).incoming).toHaveLength(beforeIncoming);
    await step(() => incoming().getByRole('button', { name: incomingText.catalog, exact: true }).click()); await step(() => expect(incoming().getByLabel(incomingText.constraint, { exact: true }).locator('option')).toHaveCount(2));
    const directoryFacts = await audit(); expect(directoryFacts.incoming.at(-1)!.input).toMatchObject({ incoming: 'catalog', table: 'parent' }); expect(directoryFacts.incoming.at(-1)!.input).not.toHaveProperty('values');
    await step(() => incoming().getByRole('button', { name: incomingText.read, exact: true }).click()); await step(() => expect(incoming().getByRole('button', { name: incomingText.next, exact: true })).toBeEnabled()); expect(((await audit()).incoming.at(-1)!.reply as any).result.page.result.rows).toHaveLength(50);
    expect((await audit()).incoming.at(-1)!.input).toMatchObject({ incoming: 'page', childTable: 'related_child', values: [{ kind: 'integer', value: '1' }], offset: 0, limit: 50 });
    await info.attach('SQLite反向关联第一页', { body: await page.screenshot(), contentType: 'image/png' });
    await step(() => incoming().getByRole('button', { name: incomingText.next, exact: true }).click()); await step(() => expect(incoming().getByRole('grid').getByRole('gridcell').filter({ hasText: /^明细52$/ })).toHaveCount(1)); await step(() => expect(incoming().getByRole('button', { name: incomingText.next, exact: true })).toBeDisabled());
    await step(() => incoming().getByRole('button', { name: incomingText.previous, exact: true }).click()); await step(() => expect(incoming().getByRole('button', { name: incomingText.previous, exact: true })).toBeDisabled()); await step(() => expect(incoming().getByRole('button', { name: incomingText.next, exact: true })).toBeEnabled());
    const beforeSwitch = (await audit()).incoming.length; await step(() => incoming().getByLabel(incomingText.constraint, { exact: true }).selectOption('1')); expect((await audit()).incoming).toHaveLength(beforeSwitch); await step(() => expect(incoming().getByRole('grid')).toHaveCount(0));
    await step(() => incoming().getByRole('button', { name: incomingText.read, exact: true }).click()); await step(() => expect(incoming().getByRole('grid').getByRole('gridcell').filter({ hasText: /^合成原值$/ })).toHaveCount(1));
    const deletedParent = new DatabaseSync(database); try { deletedParent.exec('PRAGMA foreign_keys=OFF; DELETE FROM parent WHERE id=1'); } finally { deletedParent.close(); }
    await step(() => incoming().getByRole('button', { name: incomingText.read, exact: true }).click()); await step(() => expect(incoming()).toContainText(incomingText.empty));
    const restoreParent = new DatabaseSync(database); try { restoreParent.exec('INSERT INTO parent VALUES(1)'); } finally { restoreParent.close(); }
    expect((await audit()).commands.filter(command => command === 'sqlite.tablePage')).toHaveLength(sourceIncomingReads);
    await step(() => incoming().getByRole('button', { name: incomingText.close, exact: true }).click()); await step(() => expect(incoming()).toHaveCount(0));
    // 第二个准确profile只允许本例child_pair可写；候选、暂存、撤销和预览取消均核对磁盘零提前写。
    await step(async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click());
    const writable = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await step(() => writable.getByLabel(zh.connections.text006, { exact: true }).fill('SQLite外键选择本例')); await step(() => writable.locator('select').selectOption('sqlite'));
    await step(() => writable.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true }).uncheck()); await step(() => writable.getByRole('button', { name: sqliteZh.choose, exact: true }).click()); await step(() => writable.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(writable).toBeHidden());
    const connection = page.locator('.connection-row').filter({ hasText: 'SQLite外键选择本例' }); await step(() => connection.locator('.tree-label').click());
    // 将数据库和表限定在准确连接容器内，不依赖连接排序或全局last节点。
    const branch = connection.locator('..'); const databaseRows = branch.locator('.database-row .tree-label').filter({ hasText: /^main$/ }); await step(() => databaseRows.click());
    const objects = branch.locator('.object-row .tree-label').filter({ hasText: /^child_pair$/ }); await step(() => objects.dblclick()); await step(() => expect(table().getByRole('grid')).toBeVisible());
    const disk = () => { const db = new DatabaseSync(database, { readOnly: true }); try { return db.prepare('SELECT id,a,CAST(b AS TEXT) AS b,note FROM child_pair ORDER BY id').all(); } finally { db.close(); } };
    const baseline = disk(), grid = () => table().getByRole('grid'), choose = () => page.getByRole('dialog', { name: referenceText.choiceTitle, exact: true });
    await step(() => grid().getByRole('button', { name: editText.select(1), exact: true }).click()); await step(() => table().getByRole('button', { name: editText.editRow, exact: true }).click());
    const rowForm = page.getByRole('dialog', { name: editText.editRow, exact: true }); await step(() => rowForm.getByLabel(editText.value('note'), { exact: true }).fill('保留本地草稿')); await step(() => rowForm.getByRole('button', { name: editText.saveInput, exact: true }).click());
    const openChoice = async () => { const before = (await audit()).references.length; await step(async () => (await navigationMenuItem(toolbar(), { name: referenceText.choiceEntry, exact: true }, check)).click()); await step(() => expect(choose()).toBeVisible()); expect((await audit()).references).toHaveLength(before); await step(() => choose().getByRole('button', { name: referenceText.catalog, exact: true }).click()); };
    const selectParent = async (label: string) => { await step(() => choose().getByRole('grid').getByRole('gridcell').filter({ hasText: new RegExp('^' + label + '$') }).click()); await step(() => expect(choose().getByRole('button', { name: referenceText.stage, exact: true })).toBeEnabled()); };
    await openChoice(); await step(() => choose().getByRole('button', { name: referenceText.candidates, exact: true }).click()); await step(() => expect(choose().getByRole('grid').getByRole('gridcell').filter({ hasText: /^9223372036854775807$/ })).toHaveCount(1));
    const beforeSearch = (await audit()).references.length; await step(() => choose().getByLabel(referenceText.searchColumn, { exact: true }).selectOption('label')); await step(() => choose().getByLabel(referenceText.search, { exact: true }).fill('乙')); expect((await audit()).references).toHaveLength(beforeSearch);
    await step(() => choose().getByRole('button', { name: referenceText.candidates, exact: true }).click()); await selectParent('Beta'); expect(disk()).toEqual(baseline);
    await info.attach('SQLite复合外键候选搜索', { body: await page.screenshot(), contentType: 'image/png' });
    await step(() => choose().getByRole('button', { name: referenceText.stage, exact: true }).click()); await step(() => expect(choose()).toHaveCount(0)); expect(disk()).toEqual(baseline);
    const assertDraft = async (a: string, b: string) => { await step(() => table().getByRole('button', { name: editText.editRow, exact: true }).click()); await step(() => expect(rowForm.getByLabel(editText.value('a'), { exact: true })).toHaveValue(a)); await step(() => expect(rowForm.getByLabel(editText.value('b'), { exact: true })).toHaveValue(b)); await step(() => expect(rowForm.getByLabel(editText.value('note'), { exact: true })).toHaveValue('保留本地草稿')); await step(() => rowForm.getByRole('button', { name: editText.cancelInput, exact: true }).click()); };
    await assertDraft('Beta', '2'); await step(() => table().getByRole('button', { name: editText.undo, exact: true }).click()); await assertDraft('Alpha', '9223372036854775807'); await step(() => table().getByRole('button', { name: editText.redo, exact: true }).click()); await assertDraft('Beta', '2');
    await openChoice(); await step(() => expect(choose().getByRole('button', { name: referenceText.clear, exact: true })).toBeDisabled()); await step(() => choose().getByRole('checkbox', { name: referenceText.clearConfirm, exact: true }).check()); const beforeClear = (await audit()).references.length;
    await step(() => choose().getByRole('button', { name: referenceText.clear, exact: true }).click()); await step(() => expect(choose()).toHaveCount(0)); expect((await audit()).references.slice(beforeClear).map(value => value.input.reference)).toEqual(['catalog']); expect(disk()).toEqual(baseline);
    await step(() => table().getByRole('button', { name: editText.editRow, exact: true }).click()); for (const name of ['a', 'b']) await step(() => expect(rowForm.getByLabel(editText.type(name), { exact: true })).toHaveValue('null')); await step(() => rowForm.getByRole('button', { name: editText.cancelInput, exact: true }).click());
    await step(() => table().getByRole('button', { name: editText.undo, exact: true }).click()); await assertDraft('Beta', '2');
    await openChoice(); await step(() => choose().getByRole('button', { name: referenceText.candidates, exact: true }).click()); await selectParent('Gamma');
    const remove = new DatabaseSync(database); try { remove.exec("DELETE FROM parent_pair WHERE a='Gamma'"); } finally { remove.close(); }
    await step(() => choose().getByRole('button', { name: referenceText.stage, exact: true }).click()); await step(() => expect(choose()).toContainText('所选父键已删除或变化')); expect(disk()).toEqual(baseline); await step(() => choose().getByRole('button', { name: referenceText.close, exact: true }).click()); await assertDraft('Beta', '2');
    const restore = new DatabaseSync(database); try { restore.exec("INSERT INTO parent_pair VALUES('Gamma',3,'丙')"); } finally { restore.close(); }
    await step(() => table().getByRole('button', { name: editText.preview, exact: true }).click()); const preview = page.getByRole('dialog', { name: editText.previewTitle, exact: true }); await step(() => expect(preview).toBeVisible()); expect(disk()).toEqual(baseline); await step(() => preview.getByRole('button', { name: editText.closePreview, exact: true }).click()); expect(disk()).toEqual(baseline);
    await step(() => table().getByRole('button', { name: editText.preview, exact: true }).click()); await step(() => preview.getByRole('checkbox', { name: editText.confirmation, exact: true }).check()); await step(() => preview.getByRole('button', { name: editText.submit, exact: true }).click()); await step(() => expect(preview).toHaveCount(0));
    await step(() => expect.poll(disk).toEqual([{ id: 1, a: 'Beta', b: '2', note: '保留本地草稿' }, baseline[1]]));
    // 可写源行的父键草稿99不改变原保存键1，反向只读后仍可一步撤销草稿。
    await step(() => grid().getByRole('button', { name: editText.select(1), exact: true }).click()); await step(() => table().getByRole('button', { name: editText.editRow, exact: true }).click()); await step(() => rowForm.getByLabel(editText.value('id'), { exact: true }).fill('99')); await step(() => rowForm.getByRole('button', { name: editText.saveInput, exact: true }).click());
    const beforeWritableIncoming = (await audit()).incoming.length; await step(async () => (await navigationMenuItem(toolbar(), { name: incomingText.entry, exact: true }, check)).click()); await step(() => expect(incoming()).toBeVisible()); expect((await audit()).incoming).toHaveLength(beforeWritableIncoming);
    await step(() => incoming().getByRole('button', { name: incomingText.catalog, exact: true }).click()); await step(() => incoming().getByRole('button', { name: incomingText.read, exact: true }).click());
    await step(() => expect(incoming().getByRole('grid')).toBeVisible()); expect(((await audit()).incoming.at(-1)!.reply as any).result.page.result.rows[0].c2).toEqual({ type: 'binary', base64: 'AP8=' }); expect((await audit()).incoming.at(-1)!.input).toMatchObject({ incoming: 'page', table: 'child_pair', childTable: 'child_note', values: [{ kind: 'integer', value: '1' }] });
    await info.attach('SQLite反向关联保留父键草稿', { body: await page.screenshot(), contentType: 'image/png' }); await step(() => incoming().getByRole('button', { name: incomingText.close, exact: true }).click());
    // 同一根草稿下连续父→子→子→父；方向和历史导航都不自动读，旧结果只作本地缓存。
    await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteRelationshipsAudit?: MenuAudit }).__sqliteRelationshipsAudit; if (!state || state.pending || state.writes.length !== 1) throw Error('原关联验收阶段不正确'); state.navigation = true; }));
    const totalRelated = async () => { const a = await audit(); return a.references.length + a.incoming.length; }, beforeNavigator = await totalRelated();
    await step(async () => (await navigationMenuItem(toolbar(), { name: relationText.entry, exact: true }, check)).click());
    const browser = page.getByRole('dialog', { name: relationText.title, exact: true }); await step(() => expect(browser).toBeVisible()); expect(await totalRelated()).toBe(beforeNavigator);
    await step(() => browser.getByRole('button', { name: referenceText.catalog, exact: true }).click()); await step(() => browser.getByRole('button', { name: referenceText.read, exact: true }).click()); await step(() => browser.getByRole('grid').getByRole('gridcell').filter({ hasText: /^Beta$/ }).click());
    const afterFirstLevel = await totalRelated(), firstParentHash = ((await audit()).references.at(-1)!.reply as any).result.page.schemaKey;
    await step(() => browser.getByRole('button', { name: relationText.nextChildren, exact: true }).click()); await step(() => expect(browser).toContainText(relationText.current('parent_pair', 2, 2))); expect(await totalRelated()).toBe(afterFirstLevel);
    await step(() => browser.getByRole('button', { name: incomingText.catalog, exact: true }).click()); await step(() => browser.getByRole('button', { name: incomingText.read, exact: true }).click()); await step(() => browser.getByRole('grid').getByRole('gridcell').filter({ hasText: /^1$/ }).click());
    await step(() => browser.getByRole('button', { name: relationText.nextChildren, exact: true }).click()); await step(() => browser.getByRole('button', { name: incomingText.catalog, exact: true }).click()); await step(() => browser.getByRole('button', { name: incomingText.read, exact: true }).click());
    await step(() => browser.getByRole('grid').locator('[role="row"][aria-rowindex="2"] [role="gridcell"]').first().click()); await step(() => browser.getByRole('button', { name: relationText.nextParents, exact: true }).click());
    await step(() => browser.getByRole('button', { name: referenceText.catalog, exact: true }).click()); await step(() => browser.getByRole('button', { name: referenceText.read, exact: true }).click()); await step(() => expect(browser.getByRole('grid').getByRole('gridcell').filter({ hasText: /^Beta$/ })).toHaveCount(1));
    await step(() => expect(browser.getByRole('button', { name: referenceText.read, exact: true })).toBeEnabled()); const beforeTravel = await totalRelated();
    await info.attach('SQLite四层关联与历史', { body: await page.screenshot(), contentType: 'image/png' });
    await step(() => browser.getByRole('button', { name: relationText.back, exact: true }).click()); await step(() => expect(browser).toContainText(relationText.current('child_pair', 3, 4))); await step(() => expect(browser.getByRole('button', { name: relationText.nextParents, exact: true })).toBeEnabled());
    await step(() => browser.getByRole('button', { name: relationText.forward, exact: true }).click()); await step(() => expect(browser).toContainText(relationText.current('child_note', 4, 4))); expect(await totalRelated()).toBe(beforeTravel);
    await step(() => browser.getByRole('button', { name: relationText.back, exact: true }).click()); await step(() => browser.getByRole('button', { name: relationText.back, exact: true }).click()); await step(() => expect(browser).toContainText(relationText.current('parent_pair', 2, 4)));
    await step(() => browser.getByRole('button', { name: relationText.nextParents, exact: true }).click()); await step(() => expect(browser).toContainText(relationText.current('child_pair', 3, 3))); await step(() => expect(browser.getByRole('button', { name: relationText.forward, exact: true })).toBeDisabled()); expect(await totalRelated()).toBe(beforeTravel);
    await step(() => browser.getByRole('button', { name: referenceText.catalog, exact: true }).click()); await step(() => browser.getByRole('button', { name: referenceText.read, exact: true }).click()); await step(() => expect(browser.getByRole('button', { name: referenceText.read, exact: true })).toBeEnabled());
    await step(() => browser.getByRole('button', { name: relationText.back, exact: true }).click()); await step(() => browser.getByRole('button', { name: relationText.back, exact: true }).click()); await step(() => expect(browser).toContainText(relationText.current('child_pair', 1, 3)));
    await step(() => browser.getByRole('button', { name: referenceText.read, exact: true }).click()); await step(() => expect(browser.getByRole('button', { name: referenceText.read, exact: true })).toBeEnabled()); expect((await audit()).references.at(-1)!.input).toHaveProperty('parentSchemaKey', firstParentHash);
    await info.attach('SQLite关联返回根记录', { body: await page.screenshot(), contentType: 'image/png' }); await step(() => browser.getByRole('button', { name: relationText.close, exact: true }).click()); await step(() => expect(browser).toHaveCount(0));
    await step(() => table().getByRole('button', { name: editText.editRow, exact: true }).click()); await step(() => expect(rowForm.getByLabel(editText.value('id'), { exact: true })).toHaveValue('99')); await step(() => rowForm.getByRole('button', { name: editText.cancelInput, exact: true }).click()); await step(() => table().getByRole('button', { name: editText.undo, exact: true }).click());
    expect(disk()).toEqual([{ id: 1, a: 'Beta', b: '2', note: '保留本地草稿' }, baseline[1]]);
    const finalFacts = await audit(); expect(finalFacts.denied).toEqual([]); expect(finalFacts.pickerCalls).toBe(2); expect(finalFacts.writes).toHaveLength(1); expect(runtime.pageErrors).toEqual([]);
    await info.attach('SQLite外键选择最终草稿与提交', { body: await page.screenshot(), contentType: 'image/png' }); await info.attach('SQLite外键选择完整请求与零提前写入', { body: JSON.stringify({ baseline, finalDisk: disk(), finalFacts, applicationWrites: 1, systemFilePickerInputVerified: false, systemClipboardOperations: 0 }), contentType: 'application/json' });
    await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteRelationshipsAudit?: MenuAudit }).__sqliteRelationshipsAudit; if (!state) throw Error('原关系图观察器已消失'); state.restore(); })); armed = false;
    check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(process.exitCode).toBe(0);
    const verify = new DatabaseSync(database, { readOnly: true }); try { expect(verify.prepare('SELECT id,note,p FROM subject').all()).toEqual([{ id: 1, note: '合成原值', p: '001' }]); expect(verify.prepare('SELECT id FROM parent').all()).toEqual([{ id: 1 }]); } finally { verify.close(); }
    completed = { directory, database, pid: process.pid, platform: globalThis.process.platform };
    await info.attach('SQLite关系图准确正常退出', { body: JSON.stringify({ ...completed, exitCode: process.exitCode }), contentType: 'application/json' });
  } catch (reason) {
    runtime.retainOwnedDesktopResources(info);
    try { await info.attach('SQLite关系图失败原件', { body: JSON.stringify({ directory, database, pid: process.pid, exitCode: process.exitCode, closed, armed, error: reason instanceof Error ? reason.message : String(reason), automaticRetry: false, directoryRemoved: false }), contentType: 'application/json' }); } catch { /* 不覆盖原错误或解除原owner保留。 */ }
    throw reason;
  }
});

/** 原fixture确认准确进程退出后才清理目录；本例只读核零，不自行删除失败现场。 */
test.afterAll(async ({}, info: TestInfo) => {
  if (!completed) return;
  const { stat } = require('node:fs/promises') as typeof import('node:fs/promises'); let removed = false;
  try { await stat(completed.directory); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') removed = true; else throw reason; }
  expect(removed).toBe(true); await info.attach('SQLite关系图最终清理原件', { body: JSON.stringify({ ...completed, directoryRemoved: true, launches: 1, systemClipboardOperations: 0 }), contentType: 'application/json' });
});
