import mysql, { type RowDataPacket } from 'mysql2/promise';
import { randomBytes } from 'node:crypto';
import { databaseSearchZh } from '../../src/renderer/locales/databaseSearch.zh-CN';
import { dataSearchZh } from '../../src/renderer/locales/dataSearch.zh-CN';
import { dataSearchRecordsZh as record } from '../../src/renderer/locales/dataSearchRecords.zh-CN';
import { recordViewZh } from '../../src/renderer/locales/recordViews.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { answerDialogs, confirmOwnedDesktopExit, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { clickSidebarAction } from './sidebar-menu';

test.skip(process.env.DBARK_MYSQL_SEARCH_EDIT_NATIVE !== '1', '仅运行隔离 MySQL 或 MariaDB 命中编辑专项');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120_000, retries: 0 });

test('跨库搜索编辑只更新命中原行，核对原值、并发和提交回执', async ({}, info) => {
  const dialect = process.env.DBARK_SEARCH_EDIT_DIALECT, hostname = process.env.DBARK_MYSQL_SEARCH_CONTAINER ?? '';
  const port = Number(process.env.DBARK_TEST_PORT), password = process.env.DBARK_TEST_PASSWORD ?? '';
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      (dialect !== 'mysql' && dialect !== 'mariadb') || !/^tabrelio-search-[a-f0-9]{12}$/.test(hostname) ||
      !Number.isInteger(port) || port < 1025 || port > 65535 || !/^[a-f0-9]{64}$/.test(password) ||
      process.env.DBARK_TEST_HOST !== '127.0.0.1' || process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
      ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('仅允许本轮回环隔离库及源码 Electron');
  const { page, application } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('原窗口已变化'); };
  const observer = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password, supportBigNumbers: true, bigNumberStrings: true });
  const database = 'dbark_e2e_search_edit_' + randomBytes(6).toString('hex'), table = '`' + database + '`.`subject`';
  const id = '9007199254740993', connectionName = dialect + ' 搜索编辑隔离';
  const value = async () => (await observer.execute<RowDataPacket[]>('SELECT note FROM ' + table + ' WHERE id = ?', [id]))[0][0].note;
  try {
    const [facts] = await observer.query<RowDataPacket[]>('SELECT @@hostname AS host, VERSION() AS version');
    expect(facts[0].host).toBe(hostname);
    expect(facts[0].version).toMatch(dialect === 'mysql' ? /^8\.4\./ : /^11\.4\./);
    await observer.query("SET GLOBAL time_zone = '+08:00'");
    await observer.query('CREATE DATABASE `' + database + '` CHARACTER SET utf8mb4');
    await observer.query('CREATE TABLE ' + table + ' (id BIGINT PRIMARY KEY, note TEXT, stamp TIMESTAMP(6), guard DOUBLE, payload BLOB, flags BIT(4), doc JSON) ENGINE=InnoDB');
    await observer.execute('INSERT INTO ' + table + ' VALUES (?, ?, ?, ?, ?, b\'0101\', ?), (1, \'原表页\', NULL, NULL, NULL, NULL, NULL)',
      [id, '唯一命中', '2026-11-07 01:02:03.654321', 1.0000000000000002, Buffer.from([0, 254, 255]), '{"v":9007199254740993}']);
    const edge = '`' + database + '`.`edge`';
    await observer.query('CREATE TABLE ' + edge + ' (id BIGINT PRIMARY KEY, note TEXT) ENGINE=InnoDB');
    await observer.query('INSERT INTO ' + edge + " VALUES (9007199254740992, '同原值'), (9007199254740993, '同原值')");
    const toolbar = page.locator('.navigation-toolbar');
    await (await navigationMenuItem(toolbar, { name: zh.common.newConnection, exact: true }, own)).click();
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await form.getByLabel(zh.connections.text006, { exact: true }).fill(connectionName);
    await form.getByRole('combobox').selectOption(dialect);
    await form.getByLabel(zh.connections.text009, { exact: true }).fill('127.0.0.1');
    await form.getByLabel(zh.connections.text010, { exact: true }).fill(String(port));
    await form.getByLabel(zh.common.user, { exact: true }).fill('root');
    await form.getByLabel(zh.connections.text011, { exact: true }).fill(password);
    await form.getByRole('checkbox', { name: zh.connections.text016, exact: true }).uncheck();
    await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
    await expect(form).toBeHidden();

    const scope = await page.evaluate(async ({ database, connectionName, id }) => {
      const profile = (await window.dbark.invoke('connections.list', {})).find(value => value.name === connectionName)!;
      const connectionId = profile.id, taskId = crypto.randomUUID(), target = { connectionId, database, table: 'edge' };
      const reply = await window.dbark.invoke('search.dataStart', { connectionId, taskId,
        targets: [{ database, table: 'edge', kind: 'table', columns: [{ name: 'id', representation: 'text' }] }],
        matcher: { kind: 'text', pattern: { mode: 'whole', text: id, caseSensitive: true } },
        maxResults: 20, allowViews: false, onError: 'stop' });
      if (reply.kind !== 'batch' || !reply.hits[0]?.recordRef) throw Error('没有精确搜索引用');
      const searchRecordRef = reply.hits[0].recordRef;
      await window.dbark.invoke('search.dataNext', { connectionId, taskId, sequence: reply.sequence });
      const { row } = await window.dbark.invoke('search.recordEditRead', { connectionId, taskId: crypto.randomUUID(), recordRef: searchRecordRef });
      const changes = [{ kind: 'update' as const, before: row, values: { note: '仅更新目标键' } }];
      const request = { ...target, searchRecordRef, changes };
      const reason = async (work: Promise<unknown>) => { try { await work; return ''; } catch (error) { return String(error); } };
      const wrong = await reason(window.dbark.invoke('table.preview', { ...request, table: 'subject' }));
      const remove = await reason(window.dbark.invoke('table.preview', { ...request, changes: [{ kind: 'delete', before: row }] }));
      const forged = await reason(window.dbark.invoke('table.preview', { ...request, changes: [{ ...changes[0], before: { ...row, id: '9007199254740992' } }] }));
      const bound = await window.dbark.invoke('table.preview', request);
      const downgraded = await reason(window.dbark.invoke('table.apply', { ...target, changes, taskId: crypto.randomUUID(), previewId: bound.previewId }));
      const preview = await window.dbark.invoke('table.preview', request);
      const applied = await window.dbark.invoke('table.apply', { ...request, previewId: preview.previewId, taskId: crypto.randomUUID() });
      const receipt = applied.receiptId && await window.dbark.invoke('table.applyReceipt.detail', { operationId: applied.receiptId });
      await window.dbark.invoke('search.dataRelease', { connectionId, taskId });
      await window.dbark.invoke('search.recordsRelease', { connectionId, sourceTaskId: taskId });
      return { wrong, remove, forged, downgraded, sql: preview.sql, affected: applied.affectedRows, receipt };
    }, { database, connectionName, id });
    expect(scope).toMatchObject({ wrong: expect.stringContaining('只允许修改原库表'), remove: expect.stringContaining('只允许修改原库表'),
      forged: expect.stringContaining('原始值与搜索证据不符'), downgraded: expect.stringContaining('提交预览已变化或失效'),
      sql: expect.stringContaining('CAST(? AS DECIMAL(65,0))'), affected: 1, receipt: { outcome: 'committed', committedReportedRows: 1 } });
    const [pair] = await observer.query<RowDataPacket[]>('SELECT id,note FROM ' + edge + ' ORDER BY id');
    expect(pair).toEqual([{ id: '9007199254740992', note: '同原值' }, { id, note: '仅更新目标键' }]);
    const tree = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(connectionName, { exact: true }) });
    const connectionRow = tree.locator('.connection-row');
    await connectionRow.getByRole('button', { name: connectionName, exact: true }).focus();
    await clickSidebarAction(connectionRow, { name: '刷新连接', exact: true });
    const databaseRow = tree.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
    await (await navigationMenuItem(databaseRow, { name: database, exact: true }, own)).click();
    await tree.locator('.object-row').getByText('subject', { exact: true }).click();
    const normal = page.locator('.table-tab:visible'), originalCell = normal.getByRole('gridcell', { name: '原表页', exact: true });
    await originalCell.dblclick();
    const input = normal.getByRole('textbox', { name: '编辑 note', exact: true });
    await input.fill('原表页未提交草稿');
    await input.press('Enter');
    await expect(normal.getByRole('gridcell', { name: '原表页未提交草稿', exact: true })).toBeVisible();

    await (await navigationMenuItem(toolbar, { name: databaseSearchZh.entry, exact: true }, own)).click();
    await page.getByRole('dialog', { name: databaseSearchZh.title, exact: true }).getByRole('button', { name: databaseSearchZh.dataMode, exact: true }).click();
    const search = page.getByRole('dialog', { name: dataSearchZh.title, exact: true });
    const button = (name: string) => search.getByRole('button', { name, exact: true });
    await search.getByLabel(dataSearchZh.connection, { exact: true }).selectOption({ label: connectionName });
    await button(dataSearchZh.loadDatabases).click();
    await search.getByLabel(dataSearchZh.database, { exact: true }).selectOption(database);
    await button(dataSearchZh.loadObjects).click();
    await search.getByLabel(dataSearchZh.object, { exact: true }).selectOption('subject');
    await button(dataSearchZh.loadColumns).click();
    await search.getByRole('checkbox', { name: dataSearchZh.fieldCheck('note'), exact: true }).check();
    await search.getByRole('textbox', { name: dataSearchZh.keyword, exact: true }).fill('唯一命中');
    const read = page.getByRole('dialog', { name: record.title, exact: true });
    const edit = page.getByRole('dialog', { name: record.edit, exact: true });
    const preview = page.getByRole('dialog', { name: record.mysqlPreview, exact: true });
    const open = async () => {
      await button(dataSearchZh.start).click();
      await expect(search.getByRole('status')).toContainText(dataSearchZh.done);
      await search.getByRole('gridcell', { name: '唯一命中', exact: true }).dblclick();
      await expect(read.getByLabel(record.value('id'), { exact: true })).toHaveValue(id);
      await read.getByRole('button', { name: record.edit, exact: true }).click();
    };
    const stage = async (note: string) => {
      const field = edit.getByLabel('note · ' + recordViewZh.value, { exact: true });
      await expect(field).toBeFocused();
      await field.fill(note);
      await edit.getByRole('region', { name: 'doc', exact: true }).getByRole('button', { name: recordViewZh.editField, exact: true }).click();
      await expect(edit.getByLabel('doc · ' + recordViewZh.value, { exact: true })).toBeFocused();
      await edit.getByRole('region', { name: 'note', exact: true }).getByRole('button', { name: recordViewZh.editField, exact: true }).click();
      await expect(field).toHaveValue(note);
      await edit.getByRole('button', { name: record.mysqlPreview, exact: true }).click();
      await expect(preview.locator('pre')).toContainText('UPDATE ' + table);
      await expect(preview.locator('pre')).toContainText(note);
    };
    const submit = async () => {
      const apply = preview.getByRole('button', { name: record.mysqlApply, exact: true });
      await expect(apply).toBeDisabled();
      await preview.getByRole('checkbox', { name: record.mysqlConfirm, exact: true }).check();
      await apply.click();
    };

    await button(dataSearchZh.start).click();
    await expect(search.getByRole('status')).toContainText(dataSearchZh.done);
    await search.getByRole('gridcell', { name: '唯一命中', exact: true }).dblclick();
    await expect(read.getByLabel(record.value('id'), { exact: true })).toHaveValue(id);
    // 邻近 DOUBLE 值可能具有相同显示文本，完整搜索证据仍必须识别改动。
    await observer.execute('UPDATE ' + table + ' SET guard = ? WHERE id = ?', [1.0000000000000004, id]);
    await read.getByRole('button', { name: record.edit, exact: true }).click();
    await expect(edit.locator('.error-box')).toContainText('原记录已变化');
    await edit.getByRole('button', { name: record.editBack, exact: true }).click();
    await read.getByRole('button', { name: record.back, exact: true }).click();

    await open();
    await stage('冲突不得写入');
    expect(await value()).toBe('唯一命中');
    await observer.execute('UPDATE ' + table + ' SET payload = ? WHERE id = ?', [Buffer.from([0, 254, 254]), id]);
    await submit();
    await expect(preview.locator('.error-box')).toContainText('原记录已变化');
    expect(await value()).toBe('唯一命中');
    await answerDialogs([0], application);
    const [discard] = await Promise.all([page.waitForEvent('dialog'), preview.getByRole('button', { name: record.editBack, exact: true }).click()]);
    expect(discard.message()).toBe(record.editDiscard);
    await read.getByRole('button', { name: record.back, exact: true }).click();

    await open();
    await stage('搜索提交成功');
    await page.screenshot({ path: info.outputPath('命中编辑预览.png') });
    await submit();
    await expect(search).toBeVisible();
    expect(await value()).toBe('搜索提交成功');
    const [other] = await observer.query<RowDataPacket[]>('SELECT note FROM ' + table + ' WHERE id=1');
    expect(other[0].note).toBe('原表页');
    await button(dataSearchZh.close).click();
    await expect(normal.getByRole('gridcell', { name: '原表页未提交草稿', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('原表页草稿.png') });
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
    await observer.query('DROP DATABASE `' + database + '`');
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally {
    await observer.end();
  }
});
