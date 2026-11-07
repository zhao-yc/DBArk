import { Client } from 'pg';
import { databaseSearchZh } from '../../src/renderer/locales/databaseSearch.zh-CN';
import { dataSearchZh as t } from '../../src/renderer/locales/dataSearch.zh-CN';
import { dataSearchRecordsZh as record } from '../../src/renderer/locales/dataSearchRecords.zh-CN';
import { postgresTableZh as editText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { postgresIdentifier as q } from '../../src/shared/postgresSql';
import { answerDialogs, confirmOwnedDesktopExit, dialogCalls, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_POSTGRES_SEARCH_NATIVE !== '1', '只运行隔离 PostgreSQL 数据搜索专项');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 90_000, retries: 0 });

test('PostgreSQL 跨库搜索完整值、分批接收、定位精确记录并拒绝旧行版本', async ({}, info) => {
  const user = process.env.DBARK_PGSEARCH_USER ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  const password = process.env.DBARK_PGSEARCH_PASSWORD, adminPassword = process.env.DBARK_PGSEARCH_ADMIN_PASSWORD;
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      ![password, adminPassword].every(value => /^[a-f0-9]{64}$/.test(value ?? '')) || !Number.isInteger(port) || port < 1025 || port > 65535 ||
      ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离回环 PostgreSQL 和源码 Electron');
  const { application, page } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('测试窗口归属已变化'); };
  const dbOther = user + '_other', clients: Client[] = [];
  const connect = async (database: string, name = 'postgres', secret = adminPassword) => {
    const client = new Client({ host: '127.0.0.1', port, database, user: name, password: secret, connectionTimeoutMillis: 5000 });
    await client.connect();
    clients.push(client);
    return client;
  };
  try {
    const admin = await connect('postgres');
    await admin.query("ALTER ROLE " + q(user) + " SET TimeZone TO 'Asia/Shanghai'");
    await admin.query('CREATE DATABASE ' + q(dbOther) + ' OWNER ' + q(user));
    const baseAdmin = await connect(user);
    await baseAdmin.query('CREATE SCHEMA "search.区" AUTHORIZATION ' + q(user));
    await baseAdmin.query('CREATE TABLE public.hidden_probe(id integer)');
    const first = await connect(user, user, password), second = await connect(dbOther, user, password);
    await first.query('CREATE TABLE "search.区"."many"(id integer PRIMARY KEY, note text)');
    await first.query(`INSERT INTO "search.区"."many" SELECT n, repeat('长',150) || 'MARK%_😀' FROM generate_series(1,55) n`);
    await first.query(`INSERT INTO "search.区"."many" VALUES (56, repeat('长',150) || 'MARKxy😀')`);
    await first.query(`INSERT INTO "search.区"."many" VALUES (57, 'MARK%_😀')`);
    await first.query('ALTER TABLE "search.区"."many" ENABLE ROW LEVEL SECURITY');
    await first.query('ALTER TABLE "search.区"."many" FORCE ROW LEVEL SECURITY');
    await first.query('CREATE POLICY permitted_rows ON "search.区"."many" FOR SELECT USING (id < 57)');
    await second.query('CREATE TABLE public.one(id bigint PRIMARY KEY, note text, payload bytea, absent text, guard timestamptz NOT NULL)');
    await second.query(`INSERT INTO public.one VALUES (9007199254740993, 'MARK%_😀', decode('00FEFF','hex'), NULL, '2026-11-07T00:00:00Z')`);
    await second.query('CREATE VIEW public.one_view AS SELECT note FROM public.one');
    await second.query(`CREATE FUNCTION public.plan_probe() RETURNS text LANGUAGE plpgsql IMMUTABLE AS
      $$ BEGIN RAISE EXCEPTION '意外执行未确认视图'; END $$`);
    await second.query('CREATE VIEW public.plan_probe_view AS SELECT public.plan_probe() AS note');

    const connectionName = 'PostgreSQL 数据搜索隔离';
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, own)).click();
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await form.getByLabel(zh.connections.text006, { exact: true }).fill(connectionName);
    await form.getByRole('combobox').selectOption('postgresql');
    await form.getByLabel(zh.connections.text009, { exact: true }).fill('127.0.0.1');
    await form.getByLabel(zh.connections.text010, { exact: true }).fill(String(port));
    await form.getByLabel(zh.common.user, { exact: true }).fill(user);
    await form.getByLabel(zh.connections.text011, { exact: true }).fill(password!);
    await form.getByLabel(zh.connections.text012, { exact: true }).fill(user);
    await form.getByLabel(zh.connections.text016, { exact: true }).uncheck();
    await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
    await expect(form).toBeHidden();
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: databaseSearchZh.entry, exact: true }, own)).click();
    const structure = page.getByRole('dialog', { name: databaseSearchZh.title, exact: true });
    await structure.getByRole('button', { name: databaseSearchZh.dataMode, exact: true }).click();
    const search = page.getByRole('dialog', { name: t.title, exact: true });
    await search.getByRole('combobox', { name: t.connection, exact: true }).selectOption({ label: connectionName });
    const button = (name: string) => search.getByRole('button', { name, exact: true });
    const chooser = (name: string) => search.getByRole('combobox', { name, exact: true });
    await button(t.loadDatabases).click();
    await expect(chooser(t.database).getByRole('option', { name: dbOther, exact: true })).toBeAttached();
    const select = async (database: string, object: string, columns: string[]) => {
      await chooser(t.database).selectOption(database);
      await button(t.loadObjects).click();
      await expect(chooser(t.object).locator('option').filter({ hasText: object })).toBeAttached();
      await expect(chooser(t.object).getByRole('option', { name: /hidden_probe/ })).toHaveCount(0);
      await chooser(t.object).selectOption(object);
      await button(t.loadColumns).click();
      for (const column of columns) await search.getByRole('checkbox', { name: t.fieldCheck(column), exact: true }).check();
    };
    await select(user, '"search.区"."many"', ['note']);
    await select(dbOther, '"public"."one"', ['note', 'payload', 'absent']);
    await expect(chooser(t.representation('payload'))).toHaveValue('hex');
    const keyword = search.getByRole('textbox', { name: t.keyword, exact: true });
    const status = search.getByRole('status');
    const run = async (mode: string, pattern: string, hits: number) => {
      await chooser(t.match).selectOption(mode);
      if (mode !== 'null') await keyword.fill(pattern);
      await button(t.start).click();
      await expect(status).toContainText(t.summary(hits, 2, 2));
      await expect(status).toContainText(t.done);
    };
    await run('contains', 'mark%_😀', 56);
    await expect(search.getByRole('gridcell', { name: '157', exact: true }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('跨库数据搜索.png') });
    const connections = async () => (await admin.query(
      "SELECT count(*)::int AS n FROM pg_catalog.pg_stat_activity WHERE application_name = 'tabrelio' AND usename = $1", [user])).rows[0].n;
    expect(await connections()).toBe(0);
    await run('null', '', 1);
    await expect(search.getByRole('gridcell', { name: 'absent', exact: true })).toBeVisible();
    await run('whole', '00FEFF', 1);
    await search.getByRole('gridcell', { name: '00FEFF', exact: true }).click();
    await button(record.open).click();
    const read = page.getByRole('dialog', { name: record.title, exact: true });
    await expect(read.getByRole('textbox', { name: record.value('id'), exact: true })).toHaveValue('9007199254740993');
    await expect(read.getByRole('textbox', { name: record.value('payload'), exact: true })).toHaveValue('00FEFF');
    await expect(read.getByRole('textbox', { name: record.value('payload'), exact: true })).toBeFocused();
    await page.screenshot({ path: info.outputPath('只读记录与原字节.png') });

    const editButton = () => read.getByRole('button', { name: record.edit, exact: true });
    const edit = page.getByRole('dialog', { name: editText.edit, exact: true });
    const preview = page.getByRole('dialog', { name: editText.preview, exact: true });
    const open = async () => {
      await run('whole', '00FEFF', 1);
      await search.getByRole('gridcell', { name: '00FEFF', exact: true }).click();
      await button(record.open).click();
      await expect(read.getByRole('textbox', { name: record.value('id'), exact: true })).toHaveValue('9007199254740993');
    };
    const stage = async (note: string) => {
      await editButton().click();
      await expect(edit.getByLabel('payload ' + editText.valueMode, { exact: true })).toBeFocused();
      await edit.getByLabel('note ' + editText.valueMode, { exact: true }).selectOption('text');
      await edit.getByLabel('note ' + editText.value, { exact: true }).fill(note);
      await edit.getByRole('button', { name: editText.stage, exact: true }).click();
      await expect(preview.locator('pre')).toContainText('UPDATE ONLY "public"."one"');
    };
    const submit = async () => {
      const apply = preview.getByRole('button', { name: editText.apply, exact: true });
      await expect(apply).toBeDisabled();
      await preview.getByRole('checkbox', { name: record.postgresConfirm, exact: true }).check();
      await apply.click();
    };
    const value = async () => (await second.query('SELECT note FROM public.one WHERE id = 9007199254740993')).rows[0].note;
    // 未参与搜索的列发生变化也必须使原行版本失效。
    await second.query("UPDATE public.one SET guard = guard + interval '1 second'");
    await editButton().click();
    const rejected = page.getByRole('dialog', { name: record.edit, exact: true });
    await expect(rejected.locator('.error-box')).toContainText('原记录已变化');
    await rejected.getByRole('button', { name: record.editBack, exact: true }).click();
    await read.getByRole('button', { name: record.back, exact: true }).click();
    await open();
    await stage('冲突时不得写入');
    expect(await value()).toBe('MARK%_😀');
    await second.query("UPDATE public.one SET guard = guard + interval '1 second'");
    await submit();
    await expect(preview.locator('.error-box')).toContainText('原记录已被修改、删除或替换，整批未写入');
    expect(await value()).toBe('MARK%_😀');
    await answerDialogs([0], application);
    const [discard] = await Promise.all([page.waitForEvent('dialog'),
      preview.getByRole('button', { name: record.editBack, exact: true }).click()]);
    expect(discard.message()).toBe(record.editDiscard);
    await read.getByRole('button', { name: record.back, exact: true }).click();

    await open();
    await stage('新行版本');
    await page.screenshot({ path: info.outputPath('原行编辑预览.png') });
    await submit();
    await expect(search).toBeVisible();
    expect(await value()).toBe('新行版本');
    await button(record.open).click();
    await expect(read.locator('.error-box')).toContainText('原记录已变化');
    await expect(read.getByRole('textbox')).toHaveCount(0);
    await read.getByRole('button', { name: record.back, exact: true }).click();
    const scope = await page.evaluate(async ({ connectionName, dbOther, user }) => {
      const profile = (await window.dbark.invoke('connections.list', {})).find(value => value.name === connectionName)!;
      const connectionId = profile.id, taskId = crypto.randomUUID(), table = '"public"."one"';
      const reply = await window.dbark.invoke('search.dataStart', { connectionId, taskId, dialect: 'postgresql',
        targets: [{ database: dbOther, table, kind: 'table', columns: [{ name: 'note', representation: 'text' }] }],
        matcher: { kind: 'text', pattern: { mode: 'whole', text: '新行版本', caseSensitive: true } },
        maxResults: 20, allowViews: false, onError: 'stop' });
      if (reply.kind !== 'batch' || !reply.hits[0]?.recordRef) throw Error('缺少真实搜索引用');
      const searchRecordRef = reply.hits[0].recordRef;
      await window.dbark.invoke('search.dataNext', { connectionId, taskId, sequence: reply.sequence });
      const original = { connectionId, database: dbOther, table, tabId: crypto.randomUUID() };
      const focused = { ...original, tabId: crypto.randomUUID() };
      const normal = await window.dbark.invoke('postgres.table.page', { ...original, limit: 10, offset: 0 });
      if (!normal.pageToken) throw Error('原表页缺少编辑快照');
      const reason = async (work: Promise<unknown>) => {
        try { await work; return ''; } catch (error) { return String(error); }
      };
      const query = { searchRecordRef, limit: 1, offset: 0 };
      const other = await reason(window.dbark.invoke('postgres.table.page', { ...focused, database: user, ...query }));
      const occupied = await reason(window.dbark.invoke('postgres.table.page', { ...original, ...query }));
      const narrow = await window.dbark.invoke('postgres.table.page', { ...focused, ...query });
      if (!narrow.pageToken) throw Error('命中缺少编辑快照');
      const bound = { ...focused, pageToken: narrow.pageToken };
      const remove = await reason(window.dbark.invoke('postgres.table.preview', { ...bound, changes: [{ kind: 'delete', row: 0 }] }));
      const filtered = await reason(window.dbark.invoke('postgres.table.filteredDelete', bound));
      const retained = await window.dbark.invoke('postgres.table.preview', { ...original, pageToken: normal.pageToken,
        changes: [{ kind: 'update', row: 0, fields: [{ column: 'c1', value: { mode: 'text', value: '原页草稿' } }] }] });
      await window.dbark.invoke('postgres.table.release', bound);
      await window.dbark.invoke('postgres.table.release', { ...original, pageToken: normal.pageToken });
      await window.dbark.invoke('search.dataRelease', { connectionId, taskId });
      await window.dbark.invoke('search.recordsRelease', { connectionId, sourceTaskId: taskId });
      return { other, occupied, remove, filtered, rows: narrow.rows.length, retained: retained.counts.update };
    }, { connectionName, dbOther, user });
    expect(scope).toMatchObject({ other: expect.stringContaining('不属于当前库表'), occupied: expect.stringContaining('需要独立'),
      remove: expect.stringContaining('只允许修改本条记录'), filtered: expect.stringContaining('只可用于原记录修改'), rows: 1, retained: 1 });
    expect(await value()).toBe('新行版本');
    await button(t.clear).click();
    await select(dbOther, '"public"."one_view"', ['note']);
    await keyword.fill('新行版本');
    await button(t.start).click();
    await expect(search.locator('.error-box')).toContainText(t.invalid);
    await search.getByRole('checkbox', { name: t.views, exact: true }).check();
    await button(t.start).click();
    await expect(status).toContainText(t.summary(1, 1, 1));
    await search.getByRole('gridcell', { name: '新行版本', exact: true }).click();
    await expect(button(record.open)).toBeDisabled();
    await button(t.close).click();
    await expect(search).toBeHidden();
    expect(await connections()).toBe(0);

    const mismatched = await page.evaluate(async ({ connectionName, dbOther }) => {
      const profile = (await window.dbark.invoke('connections.list', {})).find(value => value.name === connectionName)!;
      const taskId = crypto.randomUUID();
      const reply = await window.dbark.invoke('search.dataStart', { connectionId: profile.id, taskId, dialect: 'postgresql',
        targets: [{ database: dbOther, table: '"public"."plan_probe_view"', kind: 'table', columns: [{ name: 'note', representation: 'text' }] }],
        matcher: { kind: 'text', pattern: { mode: 'contains', text: 'probe', caseSensitive: true } },
        maxResults: 20, allowViews: false, onError: 'stop' });
      const terminal = reply.kind === 'error'
        ? await window.dbark.invoke('search.dataNext', { connectionId: profile.id, taskId, sequence: reply.sequence })
        : reply;
      return { reply, terminal };
    }, { connectionName, dbOther });
    expect(mismatched.reply).toMatchObject({ kind: 'error', message: expect.stringContaining('搜索关系已变化') });
    expect(mismatched.terminal).toMatchObject({ kind: 'terminal', status: 'failed' });
    expect(await connections()).toBe(0);

    // 暂停确认时取消原搜索，等待服务器会话消失后才释放来源引用。
    const pause = () => page.evaluate(async ({ user, connectionName }) => {
      const profile = (await window.dbark.invoke('connections.list', {})).find(value => value.name === connectionName)!;
      const taskId = crypto.randomUUID();
      const reply = await window.dbark.invoke('search.dataStart', { connectionId: profile.id, taskId, dialect: 'postgresql',
        targets: [{ database: user, table: '"search.区"."many"', kind: 'table', columns: [{ name: 'note', representation: 'text' }] }],
        matcher: { kind: 'text', pattern: { mode: 'contains', text: 'MARK%_😀', caseSensitive: true } },
        maxResults: 200, allowViews: false, onError: 'stop' });
      return { connectionId: profile.id, taskId, kind: reply.kind, hits: reply.kind === 'batch' ? reply.hits.length : 0 };
    }, { user, connectionName });
    const paused = await pause();
    expect(paused).toMatchObject({ kind: 'batch', hits: 50 });
    expect(await connections()).toBe(1);
    await page.evaluate(async ({ connectionId, taskId }) => {
      await window.dbark.invoke('search.dataRelease', { connectionId, taskId });
      await window.dbark.invoke('search.recordsRelease', { connectionId, sourceTaskId: taskId });
    }, paused);
    expect(await connections()).toBe(0);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
    // 退出时即使还有未确认的批次，也必须关闭独占数据库会话。
    expect(await pause()).toMatchObject({ kind: 'batch', hits: 50 });
    expect(await connections()).toBe(1);
    await confirmOwnedDesktopExit(info);
    expect(dialogCalls.map(call => call.title)).toEqual(['仍有待完成的工作']);
    expect(await connections()).toBe(0);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally {
    await Promise.allSettled(clients.map(client => client.end()));
  }
});
