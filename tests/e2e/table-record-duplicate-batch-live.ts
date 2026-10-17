import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import type { Locator, TestInfo } from '@playwright/test';
import { closeMysqlConnection } from '../../src/engine/connection';
import { test, expect, pageErrors, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit } from './desktop-fixture';
import { BatchDuplicateLifecycle, batchDuplicateDigest, type BatchDuplicateTarget } from '../helpers/batchRecordDuplicateUi';
import { recordDuplicateZh as text } from '../../src/renderer/locales/recordDuplicate.zh-CN';
import { draftHistoryZh as history } from '../../src/renderer/locales/draftHistory.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

type Baseline = { id: string; code: string; note: string; big_value: string; amount: string; stamp: string; nullable_value: string | null; payload: string; doc: string; computed: string };
// mysql2的Promise包装实际持有原生connection，但公开Connection类型未声明该端口。
type NativeObserver = Parameters<typeof closeMysqlConnection>[0];
type Observer = Connection & { readonly connection: NativeObserver };
const names = ['批量复制精确值与暂存值，整批一步撤销重做且不自动写入', '勾选含新增草稿时整批拒绝且不增加历史', '批量副本唯一键冲突先拒绝，改键后只读预览并返回编辑'];

/** 本模块仅由双门实跑分支动态加载；所有SQL均为既有表的显式只读观察。 */
export function registerBatchRecordDuplicate(binding: BatchDuplicateTarget): void {
  const states = new WeakMap<TestInfo, BatchDuplicateLifecycle>(), target = binding.target;
  /** 安装模式只读核本轮明确EXE/asar，源模式的构建身份由Root外层固定。 */
  const launchGuard = { assertCurrent() {
    binding.assertCurrent();
    if (target.executable) {
      const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
      if (digest(target.executable) !== target.exeHash || digest(join(dirname(target.executable), 'resources', 'app.asar')) !== target.asarHash) throw Error('批量复制安装资源字节与本轮许可不同');
    }
  } };
  test.use({ preserveOnUnconfirmedExit: true, ownedDesktopLaunchGuard: launchGuard, trace: 'off', screenshot: 'off', video: 'off' });
  test.setTimeout(120000); test.describe.configure({ mode: 'serial', retries: 0 });
  // 实际解析的CLI配置仍须关闭；覆盖采集配置时在任何认证表单/SQL之前停链。
  test.beforeEach(({ trace, screenshot, video }, info) => { if (trace !== 'off' || screenshot !== 'off' || video !== 'off') { retainOwnedDesktopResources(info); throw Error('批量复制验收禁止轨迹、截图和视频'); } });
  test.afterEach(({}, info) => {
    const state = states.get(info);
    if (!state) { try { retainOwnedDesktopResources(info); } catch { /* 缺失owner也不能降级退出。 */ } throw Error('批量复制未建立本例生命周期，保留现场'); }
    state.afterEach();
  });

  for (const [scenario, name] of names.entries()) test(name, async ({}, info) => {
    const captured = ownedDesktopResources(info), page = captured.page;
    const state = new BatchDuplicateLifecycle({ assertCurrent(allowClosed = false) {
      binding.assertCurrent(); const current = ownedDesktopResources(info);
      if (current.page !== page || current.application !== captured.application || !allowClosed && current.closed) throw Error('批量复制桌面或TestInfo归属已变化');
    }, closed: () => ownedDesktopResources(info).closed, retain: () => retainOwnedDesktopResources(info), confirmExit: () => confirmOwnedDesktopExit(info) }, info as TestInfo & { _startWallTime?: number });
    states.set(info, state);
    const observe = <T>(action: () => Promise<T>) => state.observe(action);
    const qualified = '`' + target.database + '`.`' + target.table + '`';
    const options = { host: target.host, port: target.port, user: target.user, password: target.password, charset: 'utf8mb4', connectTimeout: 15000, supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, dateStrings: true, jsonStrings: true };
    const streams = new Map<Observer, { native: NativeObserver; stream: { closed?: boolean } }>();
    /** 建连完成即捕获原生连接与原流，后续不能在关闭时重新绑定替代品。 */
    async function openObserver(): Promise<Observer> {
      const connection = await mysql.createConnection(options) as unknown as Observer, native = connection.connection, stream = (native as unknown as { stream?: { closed?: boolean } }).stream;
      if (!stream) throw Error('批量复制观察连接缺少原流'); streams.set(connection, { native, stream }); return connection;
    }
    /** 绑定同一原生流并等待严格QUIT，不以end Promise代替物理close。 */
    async function strictClose(connection: Observer): Promise<void> {
      const original = streams.get(connection); if (!original) throw Error('批量复制缺少原始观察归属');
      const { native, stream } = original;
      if (connection.connection !== native || (native as unknown as { stream?: unknown }).stream !== stream) throw Error('批量复制观察原流已替换');
      await closeMysqlConnection(native as Parameters<typeof closeMysqlConnection>[0], true);
      if (connection.connection !== native || (native as unknown as { stream?: unknown }).stream !== stream || stream.closed !== true) throw Error('批量复制观察原流关闭未确认');
    }
    /** 每个独立连接均核本轮UUID与准确版本，不凭端口或另一个连接追认身份。 */
    async function identity(connection: Observer): Promise<void> {
      const [rows] = await observe(() => connection.query<RowDataPacket[]>('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid'));
      if (rows.length !== 1 || !/^8\.4\.11(?:$|[-+])/.test(rows[0].version) || rows[0].os !== 'Linux' || ![0, '0'].includes(rows[0].names) || rows[0].uuid !== target.uuid) throw Error('批量复制实际实例身份不同');
    }
    /** 只取固定列；JSON保留服务器文本，精确数值/微秒和字节由独立SQL投影。 */
    async function baseline(connection: Observer): Promise<Baseline[]> {
      const [rows] = await observe(() => connection.query<RowDataPacket[]>(`SELECT CAST(s.id AS CHAR) AS id,s.code,s.note,CAST(s.big_value AS CHAR) AS big_value,CAST(s.amount AS CHAR) AS amount,DATE_FORMAT(s.stamp,'%Y-%m-%d %H:%i:%s.%f') AS stamp,s.nullable_value,HEX(s.payload) AS payload,CAST(s.doc AS CHAR CHARACTER SET utf8mb4) AS doc,CAST(s.computed AS CHAR) AS computed FROM ${qualified} AS s ORDER BY s.id`));
      if (rows.length !== 2 || batchDuplicateDigest(rows) !== target.rowsHash || rows.some(row => ['id', 'code', 'note', 'big_value', 'amount', 'stamp', 'payload', 'doc', 'computed'].some(key => typeof row[key] !== 'string') || row.nullable_value !== null && typeof row.nullable_value !== 'string')
        || rows[0].code === rows[1].code || !rows.every(row => row.code) || rows[0].big_value !== '18446744073709551615' || rows[0].amount !== '12345678901234567890.120000' || !rows[0].stamp.endsWith('.123456') || rows[0].nullable_value !== null || rows[1].nullable_value !== '' || rows[0].payload.toLowerCase() !== '00ff8000' || rows[1].payload !== '') throw Error('批量复制既有两行精度夹具或本轮摘要不符');
      return rows as unknown as Baseline[];
    }
    async function definition(connection: Observer): Promise<void> {
      const [rows] = await observe(() => connection.query<RowDataPacket[]>('SHOW CREATE TABLE ' + qualified));
      if (rows.length !== 1 || typeof rows[0]['Create Table'] !== 'string' || batchDuplicateDigest(rows[0]['Create Table']) !== target.ddlHash) throw Error('批量复制既有定义与本轮许可不符');
    }
    try {
      // 身份预检独立连接关闭后才进入正式观察和表单；无CREATE、DROP或授权路径。
      const probe = await observe(openObserver); await identity(probe); await observe(() => strictClose(probe));
      const observer = await observe(openObserver); await identity(observer); await definition(observer); const before = await baseline(observer);
      const connectionName = '批量复制只读验收 ' + randomUUID();
      await observe(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click());
      const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      await observe(() => form.getByLabel(zh.connections.text006, { exact: true }).fill(connectionName));
      const dialect = form.getByRole('combobox', { name: new RegExp('^' + zh.connections.text008) });
      await observe(() => expect(dialect).toHaveCount(1)); await observe(() => dialect.selectOption('mysql'));
      for (const [label, value] of [[zh.connections.text009, target.host], [zh.connections.text010, String(target.port)], [zh.common.user, target.user], [zh.connections.text011, target.password], [zh.connections.text012, target.database]] as const) await observe(() => form.getByLabel(label, { exact: true }).fill(value));
      await observe(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck());
      await observe(() => form.getByRole('button', { name: zh.connections.text034, exact: true }).click());
      await observe(() => expect(form.locator('.success-box')).toContainText('连接成功'));
      await observe(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click());
      await observe(() => expect(form).toBeHidden());
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: connectionName, exact: true }) });
      const connectionButton = node.locator('.connection-row').getByRole('button', { name: connectionName, exact: true });
      if (await observe(() => connectionButton.getAttribute('aria-expanded')) !== 'true') await observe(() => connectionButton.click());
      const database = node.locator('.database-row').getByRole('button', { name: target.database, exact: true });
      await observe(() => expect(database).toBeVisible()); if (await observe(() => database.getAttribute('aria-expanded')) !== 'true') await observe(() => database.click());
      await observe(() => node.locator('.object-row').getByText(target.table, { exact: true }).click());
      const table = page.locator('.table-tab:visible'); await observe(() => expect(table.locator('.context-bar')).toContainText(target.table)); await observe(() => expect(table.locator('.loading-overlay')).toHaveCount(0));
      const sourceRow = (code: string) => table.locator('.results-grid [role="row"]').filter({ has: page.getByRole('gridcell', { name: code, exact: true }) }).first();
      /** 坐标由真实列头取得，不假设checkbox偏移或固定列位置。 */
      async function cell(row: Locator, key: string): Promise<Locator> {
        const header = table.getByRole('columnheader').filter({ hasText: new RegExp('^' + key + '(?:\\s|$)') });
        const index = await observe(() => header.getAttribute('aria-colindex')); if (!index) throw Error('批量复制列坐标缺失');
        return row.locator(`[role="gridcell"][aria-colindex="${index}"]`);
      }
      async function edit(row: Locator, key: string, value: string): Promise<void> {
        const targetCell = await cell(row, key); await observe(() => targetCell.dblclick()); const input = table.locator('.grid-input');
        await observe(() => expect(input).toBeVisible()); await observe(() => input.fill(value)); await observe(() => input.press('Enter')); await observe(() => expect(input).toHaveCount(0));
      }
      const original = before.map(row => sourceRow(row.code)); for (const row of original) await observe(() => expect(row).toHaveCount(1));
      // 夹具按可靠键升序显示；若当前网格顺序不同则据实际aria-rowindex排序，勾选顺序故意相反。
      const order = await Promise.all(original.map(row => observe(() => row.getAttribute('aria-rowindex'))));
      if (order.some(value => !value || !/^\d+$/.test(value)) || order[0] === order[1]) throw Error('批量复制原网格行坐标不完整');
      const indices = [0, 1].sort((a, b) => Number(order[a]) - Number(order[b]));
      const added = table.locator('.row-inserted'), batch = table.getByRole('button', { name: text.batchAction, exact: true });
      const undo = table.getByRole('button', { name: history.undo, exact: false }), redo = table.getByRole('button', { name: history.redo, exact: false });
      const selectBoth = async () => { for (const index of [...indices].reverse()) await observe(() => original[index].getByRole('checkbox').check()); };
      if (scenario === 0) {
        const verifyCopies = async () => {
          for (const [position, index] of indices.entries()) {
            const copy = added.nth(position + 1), row = before[index];
            for (const [key, value] of Object.entries({ code: row.code, note: index === 0 ? '本页已暂存修改' : row.note, big_value: row.big_value, amount: row.amount, stamp: row.stamp, nullable_value: row.nullable_value === null ? 'NULL' : row.nullable_value, payload: '0x' + row.payload.toLowerCase(), doc: row.doc, id: zh.common.defaultValue, computed: zh.common.defaultValue })) await observe(async () => expect(await cell(copy, key)).toHaveText(value));
          }
        };
        await edit(original[0], 'note', '本页已暂存修改'); await observe(() => table.getByRole('button', { name: zh.common.add, exact: true }).click()); await observe(() => expect(added).toHaveCount(1));
        await selectBoth(); const active = await cell(original[0], 'note'); await observe(() => active.click()); await observe(() => batch.click()); await observe(() => expect(added).toHaveCount(3));
        await verifyCopies();
        for (const row of original) await observe(() => expect(row.getByRole('checkbox')).toBeChecked()); await observe(() => expect(active).toHaveAttribute('aria-selected', 'true'));
        await observe(() => undo.click()); await observe(() => expect(added).toHaveCount(1)); await observe(() => expect(active).toHaveText('本页已暂存修改'));
        await observe(() => redo.click()); await observe(() => expect(added).toHaveCount(3));
        await verifyCopies(); for (const row of original) await observe(() => expect(row.getByRole('checkbox')).toBeChecked()); await observe(() => expect(active).toHaveAttribute('aria-selected', 'true'));
      } else if (scenario === 1) {
        await observe(() => table.getByRole('button', { name: zh.common.add, exact: true }).click()); await observe(() => expect(added).toHaveCount(1));
        await observe(() => original[0].getByRole('checkbox').check()); await observe(() => added.getByRole('checkbox').check());
        await observe(() => batch.click()); await observe(() => expect(table.locator('.error-box')).toHaveText(text.batchSelection)); await observe(() => expect(added).toHaveCount(1));
        await observe(() => expect(original[0].getByRole('checkbox')).toBeChecked()); await observe(() => expect(added.getByRole('checkbox')).toBeChecked());
        await observe(() => undo.click()); await observe(() => expect(added).toHaveCount(0)); await observe(() => redo.click()); await observe(() => expect(added).toHaveCount(1));
      } else {
        await selectBoth(); await observe(() => batch.click()); await observe(() => expect(added).toHaveCount(2)); await observe(() => undo.click()); await observe(() => expect(added).toHaveCount(0)); await observe(() => redo.click()); await observe(() => expect(added).toHaveCount(2));
        await observe(() => table.getByRole('button', { name: zh.table.text019, exact: true }).click()); await observe(() => expect(table.locator('.error-box')).toContainText('主键或唯一键冲突'));
        await observe(() => expect(page.getByRole('dialog')).toHaveCount(0));
        for (const index of [0, 1]) await edit(added.nth(index), 'code', '本例副本唯一键' + index);
        await observe(() => table.getByRole('button', { name: zh.table.text019, exact: true }).click()); const preview = page.getByRole('dialog', { name: zh.table.text031, exact: true });
        await observe(() => expect(preview).toBeVisible()); await observe(() => expect(preview).toContainText(zh.table.text032 + '2' + zh.table.text033)); await observe(() => expect(preview).toContainText(text.previewHint)); await observe(() => expect(preview.locator('.monaco-editor .view-lines')).toContainText('INSERT'));
        for (const index of [0, 1]) await observe(() => expect(preview.locator('.monaco-editor .view-lines')).toContainText('本例副本唯一键' + index));
        await observe(() => preview.getByRole('button', { name: zh.common.backToEdit, exact: true }).click()); await observe(() => expect(preview).toBeHidden()); await observe(() => expect(added).toHaveCount(2));
      }
      await observe(() => expect(page.getByRole('dialog')).toHaveCount(0)); await observe(async () => expect(pageErrors).toEqual([]));
      await definition(observer); await baseline(observer); await observe(() => strictClose(observer));
      launchGuard.assertCurrent(); state.markReadOnlyVerified(); await state.finish(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})));
    } catch (reason) { state.preserve(); throw reason; }
    finally { state.endBody(); }
  });
}
