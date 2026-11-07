import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { databaseSearchZh } from '../../src/renderer/locales/databaseSearch.zh-CN';
import { dataSearchZh as t } from '../../src/renderer/locales/dataSearch.zh-CN';
import { dataSearchRecordsZh as record } from '../../src/renderer/locales/dataSearchRecords.zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_SQLITE_DATA_SEARCH_NATIVE !== '1', '仅运行隔离 SQLite 表数据搜索专项');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 90_000, retries: 0 });

test('SQLite 完整值匹配、精确复合键定位、外部更新与取消后的文件锁释放', async ({}, info) => {
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离的源码 Electron');
  const { page, application } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('原测试窗口已变化'); };
  const directory = await mkdtemp(join(tmpdir(), 'tabrelio-sqlite-data-search-'));
  const path = join(directory, 'isolated.sqlite');
  const withDatabase = (action: (db: DatabaseSync) => void) => {
    const db = new DatabaseSync(path, { timeout: 100 });
    try { action(db); } finally { db.close(); }
  };
  const sha = async () => createHash('sha256').update(await readFile(path)).digest('hex');
  try {
    withDatabase(db => {
      db.exec(`PRAGMA encoding='UTF-16le';
        CREATE TABLE "多行😀"(id INTEGER PRIMARY KEY, note TEXT);
        CREATE TABLE "精确键"(code TEXT COLLATE NOCASE, seq INTEGER, note TEXT, payload, absent TEXT, hidden_value TEXT,
          PRIMARY KEY(code,seq)) WITHOUT ROWID;
        CREATE VIEW "预览" AS SELECT note FROM "精确键";
        CREATE VIEW "未确认" AS SELECT no_such_function('guard') AS note;
        CREATE TABLE wide_value (note);
        INSERT INTO wide_value VALUES (zeroblob(2097153));
        CREATE TABLE slow_pattern (note TEXT);`);
      db.prepare('INSERT INTO slow_pattern VALUES (?)').run('a'.repeat(8192) + '!');
      const insert = db.prepare('INSERT INTO "多行😀" VALUES (?,?)');
      const text = '长'.repeat(150) + '\0MARK%_😀';
      for (let index = 1; index <= 55; index++) insert.run(index, text);
      insert.run(56, 'MARKxy😀');
      db.prepare('INSERT INTO "精确键" VALUES (?,?,?,?,?,?)').run('键😀', 9007199254740993n, 'MARK%_😀',
        Buffer.from([0, 254, 255]), null, '首版');
      expect(db.prepare('SELECT length(CAST(note AS BLOB)) AS n FROM "多行😀" WHERE id=1').get()?.n).toBe(318);
    });
    const original = await sha();
    await application.evaluate(({ dialog }, file) => {
      let used = false;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        if (used || !(args.at(-1) as Electron.OpenDialogOptions).properties?.includes('openFile')) throw Error('不是本例文件选择');
        used = true;
        return { canceled: false, filePaths: [file] };
      }) as typeof dialog.showOpenDialog;
    }, path);
    const connectionName = 'SQLite 数据搜索隔离';
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, own)).click();
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await form.getByLabel(zh.connections.text006, { exact: true }).fill(connectionName);
    await form.getByRole('combobox').selectOption('sqlite');
    await form.getByRole('button', { name: sqliteZh.choose, exact: true }).click();
    await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
    await expect(form).toBeHidden();
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: databaseSearchZh.entry, exact: true }, own)).click();
    await page.getByRole('dialog', { name: databaseSearchZh.title, exact: true }).getByRole('button', { name: databaseSearchZh.dataMode, exact: true }).click();
    const search = page.getByRole('dialog', { name: t.title, exact: true });
    const button = (name: string) => search.getByRole('button', { name, exact: true });
    const chooser = (name: string) => search.getByRole('combobox', { name, exact: true });
    await expect(chooser(t.connection)).toHaveValue((await page.evaluate(() => window.dbark.invoke('connections.list', {})))[0].id);
    await expect(chooser(t.database)).toHaveValue('main');
    await button(t.loadDatabases).click();
    const select = async (object: string, columns: string[]) => {
      await button(t.loadObjects).click();
      await expect(chooser(t.object).locator('option').filter({ hasText: object })).toBeAttached();
      await chooser(t.object).selectOption(object);
      await button(t.loadColumns).click();
      for (const column of columns) await search.getByRole('checkbox', { name: t.fieldCheck(column), exact: true }).check();
    };
    await select('多行😀', ['note']);
    await select('精确键', ['note', 'payload', 'absent']);
    const keyword = search.getByRole('textbox', { name: t.keyword, exact: true });
    const status = search.getByRole('status');
    const run = async (mode: string, pattern: string, hits: number, blocks = 2) => {
      await chooser(t.match).selectOption(mode);
      if (mode !== 'null') await keyword.fill(pattern);
      await button(t.start).click();
      await expect(status).toContainText(t.summary(hits, blocks, blocks));
      await expect(status).toContainText(t.done);
    };
    await run('contains', 'mark%_😀', 56);
    await expect(search.getByRole('gridcell', { name: '158', exact: true }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('完整值搜索.png') });
    await run('regexp', '^mark%_😀$', 1);
    await run('null', '', 1);
    await run('whole', '00FEFF', 1);
    await search.getByRole('gridcell', { name: '00FEFF', exact: true }).click();
    await button(record.open).click();
    const read = page.getByRole('dialog', { name: record.title, exact: true });
    await expect(read.getByRole('textbox', { name: record.value('payload'), exact: true })).toHaveValue('00FEFF');
    await expect(read.getByRole('textbox', { name: record.value('seq'), exact: true })).toHaveValue('9007199254740993');
    await expect(read.getByRole('textbox', { name: record.value('code'), exact: true })).toHaveValue('键😀');
    await expect(read.getByRole('textbox', { name: record.value('payload'), exact: true })).toBeFocused();
    await page.screenshot({ path: info.outputPath('只读复合键定位.png') });
    await read.getByRole('button', { name: record.back, exact: true }).click();
    expect(await sha()).toBe(original);
    withDatabase(db => db.exec(`UPDATE "精确键" SET hidden_value='修改未选择字段'`));
    await button(record.open).click();
    await expect(read.locator('.error-box')).toContainText('原记录已变化');
    await expect(read.getByRole('textbox')).toHaveCount(0);
    await read.getByRole('button', { name: record.back, exact: true }).click();
    await button(t.clear).click();
    await select('预览', ['note']);
    await keyword.fill('MARK%_😀');
    await button(t.start).click();
    await expect(search.locator('.error-box')).toContainText(t.invalid);
    await search.getByRole('checkbox', { name: t.views, exact: true }).check();
    await run('whole', 'MARK%_😀', 1, 1);
    await search.getByRole('gridcell', { name: 'MARK%_😀', exact: true }).click();
    await expect(button(record.open)).toBeDisabled();
    await button(t.close).click();
    await expect(search).toBeHidden();

    const paused = await page.evaluate(async () => {
      const connectionId = (await window.dbark.invoke('connections.list', {}))[0].id, taskId = crypto.randomUUID();
      const reply = await window.dbark.invoke('search.dataStart', { connectionId, taskId, dialect: 'sqlite',
        targets: [{ database: 'main', table: '多行😀', kind: 'table', columns: [{ name: 'note', representation: 'text' }] }],
        matcher: { kind: 'text', pattern: { mode: 'contains', text: 'MARK%_😀', caseSensitive: true } },
        maxResults: 200, allowViews: false, onError: 'stop' });
      return { connectionId, taskId, kind: reply.kind, hits: reply.kind === 'batch' ? reply.hits.length : 0 };
    });
    expect(paused).toMatchObject({ kind: 'batch', hits: 50 });
    expect(() => withDatabase(db => db.exec('BEGIN EXCLUSIVE; ROLLBACK;'))).toThrow(/locked|busy/i);
    await page.evaluate(async ({ connectionId, taskId }) => {
      await window.dbark.invoke('search.dataRelease', { connectionId, taskId });
      await window.dbark.invoke('search.recordsRelease', { connectionId, sourceTaskId: taskId });
    }, paused);
    withDatabase(db => db.exec('BEGIN EXCLUSIVE; ROLLBACK;'));

    const stopped = async (table: string, mode: 'contains' | 'regexp', text: string) => page.evaluate(async ({ table, mode, text }) => {
      const connectionId = (await window.dbark.invoke('connections.list', {}))[0].id, taskId = crypto.randomUUID();
      const reply = await window.dbark.invoke('search.dataStart', { connectionId, taskId, dialect: 'sqlite',
        targets: [{ database: 'main', table, kind: 'table', columns: [{ name: 'note', representation: 'text' }] }],
        matcher: { kind: 'text', pattern: { mode, text, caseSensitive: true } },
        maxResults: 20, allowViews: false, onError: 'stop' });
      const terminal = reply.kind === 'error'
        ? await window.dbark.invoke('search.dataNext', { connectionId, taskId, sequence: reply.sequence }) : reply;
      await window.dbark.invoke('search.dataRelease', { connectionId, taskId });
      return { reply, terminal };
    }, { table, mode, text });
    const viewGuard = await stopped('未确认', 'contains', 'guard');
    expect(viewGuard.reply).toMatchObject({ kind: 'error', message: expect.stringContaining('对象类型已变化') });
    expect(viewGuard.terminal).toMatchObject({ kind: 'terminal', status: 'failed' });
    const wide = await stopped('wide_value', 'contains', 'not-there');
    expect(wide.reply).toMatchObject({ kind: 'error', message: expect.stringContaining('超过 2 MiB') });
    expect(wide.terminal).toMatchObject({ kind: 'terminal', status: 'failed' });
    // 带反向引用的回溯式正则无法走线性引擎，检验超时只终止本次搜索进程。
    const timeout = await stopped('slow_pattern', 'regexp', '^(a+)+\\1$');
    expect(timeout.reply).toMatchObject({ kind: 'error', message: expect.stringContaining('读取超时') });
    expect(timeout.terminal).toMatchObject({ kind: 'terminal', status: 'failed' });
    withDatabase(db => db.exec('BEGIN EXCLUSIVE; ROLLBACK;'));
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
    await rm(directory, { recursive: true });
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
