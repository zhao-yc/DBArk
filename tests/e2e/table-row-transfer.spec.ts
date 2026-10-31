import { test as baseTest } from '@playwright/test';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_TABLE_ROW_TRANSFER_NATIVE === '1' && process.env.DBARK_INTEGRATION_ENABLED === '1') register();
else baseTest.skip('表页勾选跨库复制实库窗口专项默认关闭（未执行）', () => {});

/** 仅消费预置的两准确隔离库；默认及列表模式不加载桌面、驱动或认证。 */
function register(): void {
  const env = process.env, sourceDatabase = env.DBARK_ROW_TRANSFER_SOURCE ?? '', targetDatabase = env.DBARK_ROW_TRANSFER_TARGET ?? '';
  if (process.platform !== 'win32' || env.DBARK_TEST_HOST !== '192.168.31.200' || env.DBARK_TEST_PORT !== '13384' || !env.DBARK_TEST_USER || !env.DBARK_TEST_PASSWORD || !/^dbark_rowtransfer_[a-f0-9]{12}_a$/.test(sourceDatabase) || targetDatabase !== sourceDatabase.slice(0, -1) + 'b' || !/^[a-f0-9-]{36}$/.test(env.DBARK_TEST_EXPECTED_SERVER_UUID ?? '')) throw Error('跨库复制窗口专项缺少准确隔离环境');
  const desktop = require('./desktop-fixture') as typeof import('./desktop-fixture'), { test, expect } = desktop;
  const { navigationMenuItem } = require('./navigation-menu') as typeof import('./navigation-menu');
  const { tableRowTransferZh: text } = require('../../src/renderer/locales/tableRowTransfer.zh-CN') as typeof import('../../src/renderer/locales/tableRowTransfer.zh-CN');
  const { resultInsertZh: insert } = require('../../src/renderer/locales/resultInsert.zh-CN') as typeof import('../../src/renderer/locales/resultInsert.zh-CN');
  const mysql = require('mysql2/promise') as typeof import('mysql2/promise');
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
  test.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  let completed = false;
  test.afterEach(({}, info) => { if (!completed) { desktop.retainOwnedDesktopResources(info); throw Error('跨库复制实库窗口未完整收尾，保留原件和准确隔离库'); } });
  test('真实表页勾选跨库追加、取消零写入、第二行冲突整批回滚及源数据保持', async ({}, info) => {
    const owner = desktop.ownedDesktopResources(info), app = owner.application, page = owner.page, directory = desktop.dataDir;
    let appClosed = false, observer: Awaited<ReturnType<typeof mysql.createConnection>> | undefined;
    const sourceId = 'row-transfer-source', targetId = 'row-transfer-target';
    /** 每次异步操作仍属于原窗口、双库和原120秒单次运行，不猜测断线后的结果。 */
    function check(): void {
      const current = desktop.ownedDesktopResources(info);
      if (current.application !== app || current.page !== page || current.closed !== appClosed || desktop.dataDir !== directory || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.timeout !== 120000 || env.DBARK_ROW_TRANSFER_SOURCE !== sourceDatabase || env.DBARK_ROW_TRANSFER_TARGET !== targetDatabase || env.DBARK_INTEGRATION_ENABLED !== '1' || env.DBARK_TABLE_ROW_TRANSFER_NATIVE !== '1') throw Error('跨库复制原窗口或验收环境已变化');
    }
    async function step<T>(action: () => Promise<T>): Promise<T> { check(); const result = await action(); check(); return result; }
    const table = () => page.locator('.table-tab:visible'), grid = () => table().getByRole('grid', { name: '当前页数据网格', exact: true });
    const dialog = () => page.getByRole('dialog', { name: text.title, exact: true });
    const read = (database: string) => step(async () => {
      const [rows] = await observer!.query("SELECT CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,note,body,HEX(payload) AS payload,CAST(stamp AS CHAR) AS stamp FROM `" + database + "`.subject ORDER BY id");
      return rows as import('mysql2').RowDataPacket[];
    });
    /** 连接、数据库、表及解释时区全部明确选择，不使用当前树选择作为目标。 */
    async function prepare(): Promise<void> {
      const action = await step(() => navigationMenuItem(table(), { name: text.entry, exact: true }, check)); await step(() => action.click());
      await step(() => expect(dialog().getByLabel(insert.timeZone, { exact: true })).toHaveValue(''));
      await step(() => dialog().getByLabel(insert.connection, { exact: true }).selectOption(targetId));
      await step(() => dialog().getByRole('button', { name: insert.databases, exact: true }).click());
      await step(() => dialog().getByLabel(insert.database, { exact: true }).selectOption(targetDatabase));
      await step(() => dialog().getByRole('button', { name: insert.tables, exact: true }).click());
      await step(() => dialog().getByLabel(insert.table, { exact: true }).selectOption('subject'));
      await step(() => dialog().getByRole('button', { name: insert.metadata, exact: true }).click());
      await step(() => dialog().getByLabel(insert.timeZone, { exact: true }).fill('+00:00'));
      await step(() => dialog().getByRole('button', { name: insert.preview, exact: true }).click());
      await step(() => expect(dialog().getByLabel(insert.confirmation, { exact: true })).toBeVisible());
    }
    async function apply(): Promise<void> {
      await step(() => dialog().getByLabel(insert.confirmation, { exact: true }).fill(targetDatabase + '.subject'));
      await step(() => dialog().getByLabel(insert.acknowledge, { exact: true }).check());
      await step(() => dialog().getByRole('button', { name: insert.apply, exact: true }).click());
    }
    try {
      observer = await step(() => mysql.createConnection({ host: env.DBARK_TEST_HOST!, port: 13384, user: env.DBARK_TEST_USER!, password: env.DBARK_TEST_PASSWORD!, supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, dateStrings: true, jsonStrings: true, multipleStatements: false }));
      const [identityRows] = await step(() => observer!.query('SELECT @@server_uuid AS uuid,@@hostname AS hostname,@@port AS port'));
      const identity = (identityRows as import('mysql2').RowDataPacket[])[0]; expect(identity.uuid).toBe(env.DBARK_TEST_EXPECTED_SERVER_UUID); expect(Number(identity.port)).toBe(3306);
      const before = await read(sourceDatabase); expect(before).toHaveLength(3); expect(await read(targetDatabase)).toEqual([]);
      await step(() => page.evaluate(async ({ sourceId, targetId, sourceDatabase, targetDatabase, host, user, password }) => {
        for (const [id, database, name] of [[sourceId, sourceDatabase, '复制来源隔离连接'], [targetId, targetDatabase, '明确目标隔离连接']]) await window.dbark.invoke('connections.save', { id, name, group: '', color: '', dialect: 'mysql', host, port: 13384, user, password, database, rememberPassword: false });
        const settings = await window.dbark.invoke('settings.get', {});
        await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'row-transfer-table', pageSize: 50, tabs: [{ id: 'row-transfer-table', kind: 'table', title: '合成来源表', connectionId: sourceId, database: sourceDatabase, table: 'subject' }] });
      }, { sourceId, targetId, sourceDatabase, targetDatabase, host: env.DBARK_TEST_HOST!, user: env.DBARK_TEST_USER!, password: env.DBARK_TEST_PASSWORD! }));
      await step(() => page.reload()); await step(() => expect(grid().getByRole('row')).toHaveCount(4));
      const row = (id: string) => grid().getByRole('row').filter({ has: page.getByRole('gridcell', { name: id, exact: true }) });
      await step(() => row('9007199254740993').getByRole('checkbox').check()); await step(() => row('18446744073709551615').getByRole('checkbox').check());
      await prepare(); expect(await read(targetDatabase)).toEqual([]); await step(() => dialog().getByRole('button', { name: insert.close, exact: true }).click()); await step(() => expect(dialog()).toBeHidden());
      expect(await read(targetDatabase)).toEqual([]); await step(() => expect(row('9007199254740993').getByRole('checkbox')).toBeChecked());
      await prepare(); await apply(); await step(() => expect(dialog().getByText(insert.committed(2), { exact: true })).toBeVisible());
      const expected = before.filter(value => value.id !== '9007199254740994'); expect(await read(targetDatabase)).toEqual(expected); expect(await read(sourceDatabase)).toEqual(before);
      const image = await step(() => page.screenshot()); await step(() => info.attach('跨库复制提交窗口', { body: image, contentType: 'image/png' }));
      await step(() => dialog().getByRole('button', { name: insert.close, exact: true }).click()); await step(() => expect(dialog()).toBeHidden());
      await step(() => row('9007199254740993').getByRole('checkbox').uncheck()); await step(() => row('9007199254740994').getByRole('checkbox').check());
      await prepare(); await apply(); await step(() => expect(dialog().getByText(insert.rolledBack, { exact: false })).toBeVisible());
      expect(await read(targetDatabase)).toEqual(expected); expect(await read(sourceDatabase)).toEqual(before);
      await step(() => dialog().getByRole('button', { name: insert.close, exact: true }).click()); await step(() => expect(dialog()).toBeHidden()); expect(desktop.pageErrors).toEqual([]);
      await step(() => observer!.end()); observer = undefined;
      check(); await desktop.confirmOwnedDesktopExit(info); appClosed = true; check();
      await info.attach('跨库复制实库终态', { body: Buffer.from(JSON.stringify({ sourceDatabase, targetDatabase, sourceRows: 3, committedRows: 2, cancelledPreviewRows: 2, secondRowConflictWholeRollback: true, sourceExact: true, targetExact: true, utcInterpretationExplicit: true, normalOwnedExit: true, clipboardOperations: 0, installerVerified: false, platform: process.platform, architecture: process.arch })), contentType: 'application/json' });
      completed = true;
    } catch (reason) { desktop.retainOwnedDesktopResources(info); throw reason; }
    finally { if (observer) await observer.end().catch(() => {}); }
  });
}
