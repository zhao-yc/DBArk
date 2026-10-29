import { clickSidebarAction } from './sidebar-menu';
import mysql, { type ConnectionOptions } from 'mysql2';
import type { Connection as PromiseConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { Locator, TestInfo } from '@playwright/test';
import { closeMysqlConnection } from '../../src/engine/connection';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources } from './desktop-fixture';
import { environment, isolatedDatabase } from './live-helpers';
import { batchFillCaseNames, BatchFillPreparation, type BatchFillTarget } from '../helpers/tableBatchFillLive';
import { recordBatchFillZh as fill } from '../../src/renderer/locales/recordBatchFill.zh-CN';
import { recordViewZh as record } from '../../src/renderer/locales/recordViews.zh-CN';
import { draftHistoryZh as history } from '../../src/renderer/locales/draftHistory.zh-CN';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';

interface Snapshot extends RowDataPacket { id: string; code: string; note: string | null; big_value: string; amount: string; stamp: string; payload: string; doc: string; }
// mysql2公开Promise类型未声明运行时持有的原生连接，单独补充只读归属端口。
type ProbeObserver = PromiseConnection & { readonly connection: Parameters<typeof closeMysqlConnection>[0] };

/** 首次等待前登记原生连接与原流；即使建连晚回包或期限失效，也只收尾自己的原句柄。 */
export async function withBatchFillProbe(options: ConnectionOptions, current: () => void, body: (observer: PromiseConnection) => Promise<void>): Promise<void> {
  current();
  const native = mysql.createConnection(options), stream = (native as unknown as { stream?: { closed?: boolean } }).stream;
  let observer: ProbeObserver | undefined, connected = false, failure: { reason: unknown } | undefined;
  try {
    if (!stream) throw Error('批量填充探针缺少原物理流');
    observer = native.promise() as ProbeObserver;
    if (observer.connection !== native) throw Error('批量填充探针包装不属于原连接');
    await new Promise<void>((resolve, reject) => native.connect(error => error ? reject(error) : resolve()));
    connected = true; current();
    await body(observer); current();
  } catch (reason) { failure = { reason }; throw reason; }
  finally {
    try {
      // 关闭不再受已失效的正文门拦截；原对象若被替换则保留现场，不能关闭替代连接。
      if (stream && (native as unknown as { stream?: unknown }).stream !== stream) throw Error('批量填充探针原流已替换');
      await closeMysqlConnection(native, true, !connected);
      if (!stream || stream.closed !== true || (native as unknown as { stream?: unknown }).stream !== stream || observer && observer.connection !== native) throw Error('批量填充探针原流关闭未确认');
    } catch (closeFailure) {
      if (failure) throw new AggregateError([failure.reason, closeFailure], '批量填充预检失败且原探针关闭未确认', { cause: failure.reason });
      throw closeFailure;
    }
  }
  current();
}

/** 仅双门实跑时加载；沿原隔离库、真实表单和原preview/apply事务，不替换产品接口。 */
export function registerTableBatchFill(binding: BatchFillTarget): void {
  binding.assertHelper(environment);
  const preparations = new WeakMap<TestInfo, BatchFillPreparation>();
  test.describe.configure({ mode: 'serial', timeout: 120000, retries: 0 });
  const launchGuard = {
    assertPreparation(info: TestInfo) {
      let preparation = preparations.get(info);
      if (!preparation) { preparation = new BatchFillPreparation(info as TestInfo & { _startWallTime?: number }); preparations.set(info, preparation); }
      preparation.assertCurrent();
    },
    assertCurrent() { binding.assertHelper(environment); },
  };
  test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true, ownedDesktopLaunchGuard: launchGuard });

  for (const [scenario, name] of batchFillCaseNames.entries()) test(name, async ({}, info) => {
    const captured = ownedDesktopResources(info), page = captured.page;
    const multi = scenario >= 2, conflict = scenario % 2 === 1;
    let receipt: Record<string, unknown> | undefined, originalObserver: ProbeObserver['connection'] | undefined, originalStream: { closed?: boolean } | undefined;
    let ended = false;
    /** 每次等待前后都核目标和本例桌面归属；失败或超时后的迟到回包不得继续后续写入。 */
    function current() {
      try {
        launchGuard.assertPreparation(info);
        binding.assertHelper(environment);
        const owner = ownedDesktopResources(info);
        if (ended || owner.page !== page || owner.application !== captured.application || owner.closed) throw Error('批量填充本例桌面已经失效');
      } catch (reason) { retainOwnedDesktopResources(info); throw reason; }
    }
    async function checked<T>(operation: () => Promise<T>): Promise<T> {
      current();
      try { const result = await operation(); current(); return result; }
      catch (reason) { retainOwnedDesktopResources(info); throw reason; }
    }
    /** 在原fixture创建任何库之前核实际服务器；探针只读，不创建或删除资源。 */
    async function preflight() {
      const { host, port, user, password } = binding.target;
      await withBatchFillProbe({ host, port, user, password, charset: 'utf8mb4', connectTimeout: 15000 }, current, async observer => {
        const [rows] = await checked(() => observer.query<RowDataPacket[]>('SELECT @@server_uuid AS uuid, @@version AS version'));
        await checked(async () => { expect(rows).toHaveLength(1); expect(rows[0].uuid).toBe(binding.target.uuid); expect(rows[0].version).toMatch(/^8\./); });
      });
    }
    try {
      const actualApp = await checked(() => captured.application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), packaged: app.isPackaged, pid: process.pid, parent: process.ppid, platform: process.platform })));
      const launcher = captured.application.process();
      expect(actualApp.packaged).toBe(false); expect(actualApp.platform).toBe(process.platform);
      if (process.platform === 'win32') { expect(actualApp.parent).toBe(launcher.pid); expect(actualApp.pid).not.toBe(launcher.pid); } else expect(actualApp.pid).toBe(launcher.pid);
      await preflight(); current();
      await isolatedDatabase(async context => {
        try {
          current();
          originalObserver = (context.observer as ProbeObserver).connection; originalStream = (originalObserver as unknown as { stream: { closed?: boolean } }).stream;
          if (!/^dbark_e2e_[a-z0-9_]+$/.test(context.database)) throw Error('批量填充拒绝非本例随机隔离库');
          const qualified = `\`${context.database}\`.\`batch_fill_subject\``;
          const [server] = await checked(() => context.observer.query<RowDataPacket[]>('SELECT @@server_uuid AS uuid'));
          await checked(async () => expect(server[0].uuid).toBe(binding.target.uuid));
          // 仅创建本例三行：两条选中、第三条控制；所有精确值以字符串/SQL字节表达。
          await checked(() => context.observer.query(`CREATE TABLE ${qualified}(id BIGINT UNSIGNED PRIMARY KEY,code VARCHAR(24) NOT NULL UNIQUE,note TEXT NULL,big_value BIGINT UNSIGNED NOT NULL,amount DECIMAL(30,6) NOT NULL,stamp DATETIME(6) NOT NULL,payload VARBINARY(8) NOT NULL,doc JSON NOT NULL) ENGINE=InnoDB`));
          for (const [index, id] of ['9007199254740993', '9007199254740995', '18446744073709551615'].entries()) await checked(() => context.observer.query(
            `INSERT INTO ${qualified}(id,code,note,big_value,amount,stamp,payload,doc) VALUES(?,?,?,?,?,?,UNHEX(?),CAST(? AS JSON))`,
            [id, ['selected_a', 'selected_b', 'control'][index], '原值' + index, '18446744073709551615', '12345678901234567890.120000', '2026-10-18 01:02:03.123456', ['00FF8000', '000100', 'FF00'][index], '{"n":9007199254740993,"s":"保留旁列"}']));
          /** 不通过JS数值或JSON解析核旁列；固定列序的SQL字符串/HEX快照覆盖所有三行。 */
          async function snapshot(): Promise<Snapshot[]> {
            // 排序指向原BIGINT列，避免同名CHAR投影别名将控制行按字典序放到前面。
            const [rows] = await checked(() => context.observer.query<Snapshot[]>(`SELECT CAST(s.id AS CHAR) AS id,s.code,s.note,CAST(s.big_value AS CHAR) AS big_value,CAST(s.amount AS CHAR) AS amount,DATE_FORMAT(s.stamp,'%Y-%m-%d %H:%i:%s.%f') AS stamp,HEX(s.payload) AS payload,CAST(s.doc AS CHAR CHARACTER SET utf8mb4) AS doc FROM ${qualified} AS s ORDER BY s.id`));
            return rows;
          }
          const before = await snapshot();
          await checked(async () => {
            expect(before).toHaveLength(3);
            expect(before.map(row => row.id)).toEqual(['9007199254740993', '9007199254740995', '18446744073709551615']);
            for (const row of before) { expect(row.big_value).toBe('18446744073709551615'); expect(row.amount).toBe('12345678901234567890.120000'); expect(row.stamp).toBe('2026-10-18 01:02:03.123456'); expect(row.doc).toContain('9007199254740993'); }
            expect(before.map(row => row.payload)).toEqual(['00FF8000', '000100', 'FF00']);
          });
          const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByRole('button', { name: context.connectionName, exact: true }) });
          await checked(() => connection.locator('.connection-row').getByRole('button', { name: context.connectionName, exact: true }).focus());
          await checked(() => clickSidebarAction(connection, { name: '刷新连接', exact: true }));
          const database = connection.locator('.database-row').getByRole('button', { name: context.database, exact: true });
          await checked(() => expect(database).toBeVisible());
          if (await checked(() => database.getAttribute('aria-expanded')) !== 'true') await checked(() => database.click());
          await checked(() => connection.locator('.object-row').getByText('batch_fill_subject', { exact: true }).click());
          const table = page.locator('.table-tab:visible');
          await checked(() => expect(table.locator('.context-bar')).toContainText('batch_fill_subject'));
          await checked(() => expect(table.locator('.loading-overlay')).toHaveCount(0));
          const row = (code: string) => table.locator('.results-grid [role="row"]').filter({ has: page.getByRole('gridcell', { name: code, exact: true }) });
          /** 只匹配列名直接文本，排除紧邻的small类型文字；仍从实际列头读取网格坐标。 */
          async function cell(source: Locator, key: 'note') {
            const index = await checked(() => table.getByRole('columnheader').filter({ has: page.locator(`xpath=.//span[@class="data-header"]/span[text()="${key}"]`) }).getAttribute('aria-colindex'));
            if (!index || !/^\d+$/.test(index)) throw Error('批量填充缺少实际列坐标');
            return source.locator(`[role="gridcell"][aria-colindex="${index}"]`);
          }
          const selected = before.slice(0, 2);
          const order: { code: string; index: number }[] = [];
          for (const source of selected) {
            await checked(() => expect(row(source.code)).toHaveCount(1));
            const index = await checked(() => row(source.code).getAttribute('aria-rowindex'));
            if (!index || !/^\d+$/.test(index)) throw Error('批量填充缺少实际行坐标');
            order.push({ code: source.code, index: Number(index) });
            await checked(() => row(source.code).getByRole('checkbox').check());
          }
          if (order[0].index === order[1].index) throw Error('批量填充行坐标重复');
          order.sort((a, b) => a.index - b.index);
          await checked(() => expect(row('control').getByRole('checkbox')).not.toBeChecked());
          await checked(() => table.getByRole('button', { name: fill.action, exact: true }).click());
          const dialog = page.getByRole('dialog', { name: fill.title, exact: true });
          await checked(() => expect(dialog).toContainText(formatText(fill.count, 2)));
          await checked(() => dialog.getByLabel(fill.field, { exact: true }).selectOption('note'));
          const firstGroup = dialog.getByRole('group', { name: fill.assignment(1), exact: true });
          await checked(() => firstGroup.getByLabel(record.mode, { exact: true }).selectOption(conflict ? 'text' : 'null'));
          if (conflict) await checked(() => firstGroup.locator('.record-field-input').fill('整批待提交'));
          if (multi) {
            // 全部输入走正式字段编辑器，精确金额和BIGINT始终保留文本，二进制走Hex。
            for (const [index, item] of [{ column: 'big_value', value: '18446744073709551614' }, { column: 'amount', value: '987654321098765432.123456' }, { column: 'payload', value: '00FF80275C' }].entries()) {
              await checked(() => dialog.getByRole('button', { name: fill.add, exact: true }).click());
              const group = dialog.getByRole('group', { name: fill.assignment(index + 2), exact: true });
              await checked(() => group.getByRole('combobox', { name: fill.fieldAt(index + 2), exact: true }).selectOption(item.column));
              await checked(() => group.locator('.record-field-input').fill(item.value));
            }
            const duplicate = dialog.getByRole('combobox', { name: fill.fieldAt(2), exact: true }).locator('option[value="note"]');
            await checked(() => expect(duplicate).toHaveAttribute('disabled', '')); await checked(() => expect(duplicate).toHaveJSProperty('disabled', true));
            await checked(() => expect(dialog.locator('fieldset')).toHaveCount(4));
            await checked(async () => expect(await snapshot()).toEqual(before));
            await checked(async () => info.attach('多字段暂存前原对话框', { body: await dialog.screenshot(), contentType: 'image/png' }));
          }
          await checked(() => dialog.getByRole('button', { name: fill.stage, exact: true }).click());
          await checked(() => expect(dialog).toHaveCount(0));
          const staged = conflict ? '整批待提交' : 'NULL';
          async function checkDraft(value: string | undefined) {
            await checked(() => expect(table.locator('.row-modified')).toHaveCount(value === undefined ? 0 : 2));
            for (const source of selected) await checked(async () => expect(await cell(row(source.code), 'note')).toHaveText(value ?? source.note!));
            await checked(async () => expect(await cell(row('control'), 'note')).toHaveText(before[2].note!));
          }
          await checkDraft(staged); await checked(async () => expect(await snapshot()).toEqual(before));
          if (!conflict) {
            await checked(() => table.getByRole('button', { name: history.undo, exact: false }).click());
            await checkDraft(undefined); await checked(async () => expect(await snapshot()).toEqual(before));
            await checked(() => table.getByRole('button', { name: history.redo, exact: false }).click());
            await checkDraft(staged); await checked(async () => expect(await snapshot()).toEqual(before));
          }
          await checked(() => table.getByRole('button', { name: zh.table.text019, exact: true }).click());
          const preview = page.getByRole('dialog', { name: zh.table.text031, exact: true });
          await checked(() => expect(preview).toBeVisible());
          await checked(() => expect(preview).toContainText(zh.table.text032 + '2' + zh.table.text033));
          await checked(() => expect(preview.locator('.monaco-editor .view-lines')).toContainText('UPDATE'));
          await checked(async () => expect(await snapshot()).toEqual(before));
          let expected = before.map(source => ({ ...source, note: source.code === 'control' ? source.note : null }));
          if (multi && !conflict) expected = before.map(source => source.code === 'control' ? { ...source } : { ...source, note: null, big_value: '18446744073709551614', amount: '987654321098765432.123456', payload: '00FF80275C' });
          if (conflict) {
            // 外改实际网格顺序的第二条，让第一条已执行的修改也必须由同一事务回滚。
            const changed = before.find(source => source.code === order[1].code)!;
            const conflictColumn = multi ? 'code' : 'note';
            const [result] = await checked(() => context.observer.query<ResultSetHeader>(`UPDATE ${qualified} SET ${conflictColumn}=? WHERE id=CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED)`, ['外部已提交', changed.id]));
            await checked(async () => expect(result.affectedRows).toBe(1));
            expected = before.map(source => source.id === changed.id ? { ...source, [conflictColumn]: '外部已提交' } : { ...source });
            await checked(async () => expect(await snapshot()).toEqual(expected));
          }
          await checked(() => preview.getByRole('button', { name: zh.common.confirmApply, exact: true }).click());
          if (!conflict) {
            await checked(() => expect(preview).toHaveCount(0));
            await checked(() => expect(table.locator('.row-modified')).toHaveCount(0));
            await checked(async () => expect(await snapshot()).toEqual(expected));
            for (const source of selected) await checked(async () => expect(await cell(row(source.code), 'note')).toHaveText('NULL'));
          } else {
            await checked(() => expect(preview.locator('.error-box')).toContainText('数据并发冲突，目标表事务内整批修改已回滚'));
            await checked(() => expect(preview).toContainText(record.applyAttempted));
            await checked(() => expect(preview.getByRole('button', { name: zh.common.confirmApply, exact: true })).toBeDisabled());
            // 有界观察连续三次真实快照；不点击第二次提交、不手动重放，也不以UI报错替代库核。
            let stable = 0;
            await checked(() => expect.poll(async () => { expect(await snapshot()).toEqual(expected); return ++stable; }, { intervals: [250], timeout: 3000 }).toBeGreaterThanOrEqual(3));
            await checked(() => preview.getByRole('button', { name: zh.common.backToEdit, exact: true }).click());
            await checked(() => expect(preview).toHaveCount(0)); await checkDraft(staged);
            await checked(() => expect(table.getByRole('button', { name: history.undo, exact: false })).toBeDisabled());
            await checked(() => expect(table.getByRole('button', { name: history.redo, exact: false })).toBeDisabled());
            await checked(async () => expect(await snapshot()).toEqual(expected));
          }
          receipt = { scenario: name, multi, conflict, database: context.database, actualApp, stagedRows: 2, fields: multi ? ['note', 'big_value', 'amount', 'payload'] : ['note'], originalAllThreeRows: before, expectedAllThreeRows: expected, originalObserverThreadId: originalObserver.threadId, noWritesUntilExplicitApply: true, fullSnapshotMatchedAfterApply: true, oneUndoRedo: !conflict, conflictBeforeSecondRowAndWholeRollback: conflict };
        } catch (reason) { retainOwnedDesktopResources(info); throw reason; }
      }, info, { captureFailureScreenshot: false });
      // shared隔离夹具完成退出与精确清库后，再核原Observer物理流，不以Promise end代替close。
      launchGuard.assertPreparation(info); expect(launcher.exitCode).toBe(0); expect(ownedDesktopResources(info).closed).toBe(true);
      await expect.poll(() => originalStream?.closed === true).toBe(true); launchGuard.assertPreparation(info);
      expect((originalObserver as unknown as { stream: unknown }).stream).toBe(originalStream);
      await info.attach('批量填充原三行及正常收尾', { body: Buffer.from(JSON.stringify({ ...receipt, normalAppExitCode: launcher.exitCode, originalObserverStreamClosed: true, databaseRemovedByOriginalFixture: true, systemClipboard: 0, systemFileDialogInput: 0 })), contentType: 'application/json' });
    } catch (reason) { retainOwnedDesktopResources(info); throw reason; }
    finally { ended = true; }
  });
}
