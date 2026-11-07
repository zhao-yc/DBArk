import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { databaseSearchZh as searchEntry } from '../../src/renderer/locales/databaseSearch.zh-CN';
import { dataSearchZh as searchText } from '../../src/renderer/locales/dataSearch.zh-CN';
import { dataSearchRecordsZh as recordText } from '../../src/renderer/locales/dataSearchRecords.zh-CN';
import { sqliteTableEditZh as editText } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { answerDialogs, confirmOwnedDesktopExit, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_SQLITE_SEARCH_RECORD_EDIT_NATIVE !== '1', '仅运行隔离 SQLite 搜索命中编辑专项');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 90_000, retries: 0 });

test('SQLite 搜索命中编辑原行，拒绝外部冲突并保留已有表格草稿', async ({}, info) => {
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离的源码 Electron');
  const { application, page } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('原测试窗口已变化'); };
  const directory = await mkdtemp(join(tmpdir(), 'tabrelio-sqlite-search-record-edit-'));
  const path = join(directory, 'isolated.sqlite');
  const database = <T,>(action: (db: DatabaseSync) => T) => {
    const db = new DatabaseSync(path, { timeout: 100 });
    try { return action(db); } finally { db.close(); }
  };
  const values = () => database(db => db.prepare('SELECT id,note,guard FROM records WHERE id IN (1,150) ORDER BY id').all());
  try {
    database(db => db.exec(`CREATE TABLE records(id INTEGER PRIMARY KEY,note TEXT,guard TEXT);
      CREATE TABLE other(id INTEGER PRIMARY KEY,note TEXT);
      WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<150)
        INSERT INTO records SELECT n,CASE WHEN n=150 THEN '命中原值' ELSE '原'||n END,'首版' FROM seq;`));
    await application.evaluate(({ dialog }, file) => {
      let used = false;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        if (used || !(args.at(-1) as Electron.OpenDialogOptions).properties?.includes('openFile')) throw Error('不是本例文件选择');
        used = true;
        return { canceled: false, filePaths: [file] };
      }) as typeof dialog.showOpenDialog;
    }, path);
    const name = 'SQLite 搜索编辑隔离';
    const toolbar = page.locator('.navigation-toolbar');
    await (await navigationMenuItem(toolbar, { name: zh.common.newConnection, exact: true }, own)).click();
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await form.getByLabel(zh.connections.text006, { exact: true }).fill(name);
    await form.getByRole('combobox').selectOption('sqlite');
    await form.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true }).uncheck();
    await form.getByRole('button', { name: sqliteZh.choose, exact: true }).click();
    await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
    await expect(form).toBeHidden();

    await page.locator('.connection-row .tree-label').filter({ hasText: name }).click();
    await page.locator('.database-row .tree-label').filter({ hasText: /^main$/ }).click();
    await page.locator('.object-row .tree-label .truncate').getByText('records', { exact: true }).dblclick();
    const table = page.locator('.sqlite-table-tab:visible');
    const grid = table.getByRole('grid', { name: editText.grid, exact: true });
    const editor = page.getByRole('dialog', { name: editText.editRow, exact: true });
    const field = (name: string) => editor.getByLabel(editText.value(name), { exact: true });
    await expect(grid.getByTitle('原1', { exact: true })).toBeVisible();
    await expect(grid.getByTitle('命中原值', { exact: true })).toHaveCount(0);
    await grid.getByTitle('原1', { exact: true }).click();
    await table.getByRole('button', { name: editText.editRow, exact: true }).click();
    await field('note').fill('现有表格草稿');
    await editor.getByRole('button', { name: editText.saveInput, exact: true }).click();
    await expect(grid.getByTitle('现有表格草稿', { exact: true })).toBeVisible();

    const misuse = await page.evaluate(async () => {
      const connectionId = (await window.dbark.invoke('connections.list', {}))[0].id, taskId = crypto.randomUUID();
      const started = await window.dbark.invoke('search.dataStart', { connectionId, taskId, dialect: 'sqlite',
        targets: [{ database: 'main', table: 'records', kind: 'table', columns: [{ name: 'note', representation: 'text' }] }],
        matcher: { kind: 'text', pattern: { mode: 'whole', text: '命中原值', caseSensitive: true } },
        maxResults: 5, allowViews: false, onError: 'stop' });
      const ref = started.kind === 'batch' ? started.hits[0]?.recordRef : undefined;
      if (!ref || started.kind !== 'batch') throw Error('缺少真实搜索引用');
      await window.dbark.invoke('search.dataNext', { connectionId, taskId, sequence: started.sequence });
      const base = { connectionId, database: 'main' as const, searchRecordRef: ref, editing: true, offset: 0, limit: 1,
        mode: 'and' as const, filters: [], sort: [] };
      const reason = async (work: Promise<unknown>) => {
        try { await work; return ''; } catch (error) { return String(error); }
      };
      const other = await reason(window.dbark.invoke('sqlite.tablePage', { ...base, table: 'other', taskId: crypto.randomUUID() }));
      const first = await window.dbark.invoke('sqlite.tablePage', { ...base, table: 'records', taskId: crypto.randomUUID() });
      if (first.edit?.kind !== 'editable') throw Error('缺少准确编辑快照');
      const remove = await reason(window.dbark.invoke('sqlite.tableEdit.preview', {
        snapshotId: first.edit.snapshotId, taskId: crypto.randomUUID(), changes: [{ kind: 'delete', row: 0 }],
      }));
      await window.dbark.invoke('sqlite.tableEdit.release', { snapshotId: first.edit.snapshotId });
      await window.dbark.invoke('search.dataRelease', { connectionId, taskId });
      await window.dbark.invoke('search.recordsRelease', { connectionId, sourceTaskId: taskId });
      return { other, remove, rows: first.result.rows.length };
    });
    expect(misuse).toMatchObject({ other: expect.stringContaining('不属于当前表'), remove: expect.stringContaining('只允许修改本条记录'), rows: 1 });

    await (await navigationMenuItem(toolbar, { name: searchEntry.entry, exact: true }, own)).click();
    await page.getByRole('dialog', { name: searchEntry.title, exact: true }).getByRole('button', { name: searchEntry.dataMode, exact: true }).click();
    const search = page.getByRole('dialog', { name: searchText.title, exact: true });
    await search.getByRole('button', { name: searchText.loadObjects, exact: true }).click();
    await search.getByRole('combobox', { name: searchText.object, exact: true }).selectOption('records');
    await search.getByRole('button', { name: searchText.loadColumns, exact: true }).click();
    await search.getByRole('checkbox', { name: searchText.fieldCheck('note'), exact: true }).check();
    await search.getByRole('textbox', { name: searchText.keyword, exact: true }).fill('命中原值');
    const record = page.getByRole('dialog', { name: recordText.title, exact: true });
    const find = async () => {
      await search.getByRole('button', { name: searchText.start, exact: true }).click();
      await expect(search.getByRole('status')).toContainText(searchText.done);
      await search.getByRole('gridcell', { name: '命中原值', exact: true }).dblclick();
      await expect(record.getByRole('textbox', { name: recordText.value('note'), exact: true })).toHaveValue('命中原值');
    };
    const openEdit = () => record.getByRole('button', { name: recordText.edit, exact: true }).click();
    const stage = async (note: string) => {
      await openEdit();
      await expect(field('note')).toBeFocused();
      await expect(field('id')).toHaveValue('150');
      await field('note').fill(note);
      await editor.getByRole('button', { name: editText.saveInput, exact: true }).click();
    };
    const preview = page.getByRole('dialog', { name: editText.previewTitle, exact: true });
    const submit = async () => {
      const action = preview.getByRole('button', { name: editText.submit, exact: true });
      await expect(action).toBeDisabled();
      await preview.getByRole('checkbox', { name: editText.confirmation, exact: true }).check();
      await action.click();
    };
    await find();
    database(db => db.exec("UPDATE records SET guard='搜索后变化' WHERE id=150"));
    await openEdit();
    const rejected = page.getByRole('dialog', { name: recordText.edit, exact: true });
    await expect(rejected.locator('.error-box')).toContainText('原记录已变化');
    await rejected.getByRole('button', { name: recordText.editBack, exact: true }).click();
    await record.getByRole('button', { name: recordText.back, exact: true }).click();

    await find();
    await stage('冲突时不得写入');
    await expect(preview.locator('pre')).toContainText('UPDATE');
    expect(values()).toMatchObject([{ id: 1, note: '原1' }, { id: 150, note: '命中原值' }]);
    database(db => db.exec("UPDATE records SET guard='预览后变化' WHERE id=150"));
    await submit();
    await expect(preview.locator('.error-box')).toContainText('确认整批回滚');
    await expect(preview.locator('.error-box')).toContainText('原记录已被其他操作修改');
    expect(values()).toMatchObject([{ id: 1, note: '原1' }, { id: 150, note: '命中原值', guard: '预览后变化' }]);
    await preview.getByRole('button', { name: editText.closePreview, exact: true }).click();
    await answerDialogs([0], application);
    const [discard] = await Promise.all([page.waitForEvent('dialog'),
      editor.getByRole('button', { name: editText.cancelInput, exact: true }).click()]);
    expect(discard.message()).toBe(recordText.editDiscard);
    await record.getByRole('button', { name: recordText.back, exact: true }).click();

    await find();
    await stage('从搜索编辑后提交');
    await expect(preview.locator('pre')).toContainText('从搜索编辑后提交');
    await page.screenshot({ path: info.outputPath('命中记录修改预览.png') });
    await submit();
    await expect(search).toBeVisible();
    await expect.poll(values).toMatchObject([{ id: 1, note: '原1' }, { id: 150, note: '从搜索编辑后提交', guard: '预览后变化' }]);
    await search.getByRole('button', { name: searchText.close, exact: true }).click();
    await expect(grid.getByTitle('现有表格草稿', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('原表格草稿保留.png') });
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
    await rm(directory, { recursive: true });
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
