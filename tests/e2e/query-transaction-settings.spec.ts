import type { TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, desktop, page, ownedDesktopResources, retainOwnedDesktopResources, pageErrors } from './desktop-fixture';
import { queryTransactionSettingsZh as t } from '../../src/renderer/locales/queryTransactionSettings.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TRANSACTION_SETTINGS_UI === '1';
test.skip(!enabled, '事务设置正式窗口仅在统筹核对200隔离实例并显式开启双门后执行');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.setTimeout(150000);
interface Audit { commands: string[]; pending: number; settings: Array<{ command: string; sessionId: string; ok: boolean; input?: unknown; result?: unknown; error?: string }>; }
const query = () => page.locator('.query-tab:visible');
const dialog = () => page.getByRole('dialog', { name: t.title, exact: true });

/** 旁观真实Main的输入输出；保留原函数、窗口和frame归属，不伪造产品查询结果。 */
async function observed(info: TestInfo, body: () => Promise<void>) {
  const owner = ownedDesktopResources(info);
  await owner.application.evaluate(({ ipcMain, BrowserWindow }) => {
    const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, original = handlers?.get('dbark:request');
    const windows = BrowserWindow.getAllWindows(), window = windows[0], contents = window?.webContents, frame = contents?.mainFrame;
    if (root.__transactionSettingsAudit || typeof original !== 'function' || windows.length !== 1 || !frame) throw Error('事务设置旁观器归属未知');
    const processId = frame.processId, frameToken = frame.frameToken;
    const state: Audit & { check(): void; restore(): void } = { commands: [], pending: 0, settings: [], check() {}, restore() {} };
    const check = () => { const current = BrowserWindow.getAllWindows(); if (root.__transactionSettingsAudit !== state || handlers.get('dbark:request') !== wrapped || current.length !== 1 || current[0] !== window || contents.isDestroyed() || contents.mainFrame !== frame || frame.processId !== processId || frame.frameToken !== frameToken) throw Error('事务设置原窗口或frame已变化'); };
    const wrapped = async (event: any, payload: any) => {
      check(); if (event.sender !== contents || event.senderFrame !== frame) throw Error('事务设置旁观来源不符');
      state.commands.push(payload.command); state.pending++;
      try {
        const response = await original(event, payload); check();
        if (payload.command === 'query.transactionSettings.read' || payload.command === 'query.transactionSettings.apply' || payload.command === 'query.autocommit.apply') state.settings.push({ command: payload.command, sessionId: payload.input.sessionId, ok: response?.ok === true, ...(payload.command === 'query.autocommit.apply' ? { input: payload.input } : {}), ...(response?.ok === true ? { result: response.result } : { error: response?.error }) });
        return response;
      } finally { state.pending--; }
    };
    state.check = check; state.restore = () => { check(); if (state.pending) throw Error('事务设置原请求尚未收尾'); handlers.set('dbark:request', original); delete root.__transactionSettingsAudit; };
    root.__transactionSettingsAudit = state; handlers.set('dbark:request', wrapped);
  });
  let failed = false, failure: unknown;
  try { await body(); } catch (error) { failed = true; failure = error; throw error; }
  finally {
    try { const fact = await audit(info); await info.attach('事务设置Main真实旁观', { body: JSON.stringify(fact, null, 2), contentType: 'application/json' }); expect(fact.pending).toBe(0); await owner.application.evaluate(() => (globalThis as any).__transactionSettingsAudit.restore()); ownedDesktopResources(info); }
    catch (cleanup) { retainOwnedDesktopResources(info); if (failed) throw new AggregateError([failure, cleanup], '事务设置功能失败且旁观收尾未确认', { cause: failure }); throw cleanup; }
  }
}
/** 读取原旁观器的任务事实，不读凭据、不改变产品会话。 */
async function audit(info: TestInfo): Promise<Audit> {
  const owner = ownedDesktopResources(info), result = await owner.application.evaluate(() => { const state = (globalThis as any).__transactionSettingsAudit; state.check(); return { commands: state.commands, pending: state.pending, settings: state.settings }; }); ownedDesktopResources(info); return result;
}
/** 等待原读取落定，禁止把显示了一个旧快照当作新读取成功。 */
async function open(info: TestInfo) {
  const before = (await audit(info)).settings.length;
  await (await navigationMenuItem(query(), { name: t.open, exact: true })).click(); await expect(dialog()).toBeVisible();
  await expect.poll(async () => (await audit(info)).settings.length).toBe(before + 1);
  expect((await audit(info)).settings.at(-1)?.ok).toBe(true);
  await expect((await navigationMenuItem(dialog(), { name: t.refresh, exact: true }))).toBeEnabled();
}
/** 只用正式控件修改默认值，等待原apply的真实回包。 */
async function apply(info: TestInfo, isolation: string, readOnly: boolean) {
  const before = (await audit(info)).settings.length;
  await dialog().getByRole('combobox', { name: t.isolation, exact: true }).selectOption(isolation);
  await dialog().getByRole('checkbox', { name: t.readOnly, exact: true }).setChecked(readOnly);
  await (await navigationMenuItem(dialog(), { name: t.apply, exact: true })).click();
  await expect.poll(async () => (await audit(info)).settings.length).toBe(before + 1);
  expect((await audit(info)).settings.at(-1)).toMatchObject({ command: 'query.transactionSettings.apply', ok: true, result: { isolation, readOnly, transactionOpen: false } });
  await expect((await navigationMenuItem(dialog(), { name: t.refresh, exact: true }))).toBeEnabled();
}

test('正式事务设置保持结果与历史、只读拒写、未提交事务拒改并回滚、双标签默认隔离', async ({}, info) => {
  const live = await import('./live-helpers');
  if (!enabled || !['192.168.31.200', 'deve-server.yinzon.com'].includes(live.environment.DBARK_TEST_HOST ?? '') || live.environment.DBARK_TEST_PORT !== '13384') throw Error('事务设置窗口验收仅限既定200隔离13384');
  await live.isolatedDatabase(async context => {
    const { observer, database } = context;
    await info.attach('事务设置隔离资源', { body: JSON.stringify({ database, observerThreadId: (observer as unknown as { threadId?: number }).threadId }), contentType: 'application/json' });
    await observer.query(`CREATE TABLE \`${database}\`.tx_subject(id BIGINT UNSIGNED PRIMARY KEY,note VARCHAR(64)) ENGINE=InnoDB`);
    await observer.query(`INSERT INTO \`${database}\`.tx_subject VALUES(9007199254740993,'保留结果一'),(9007199254740994,'保留结果二')`);
    await observed(info, async () => {
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900));
      await live.openDatabaseQuery(database); const source = 'SELECT id,note FROM tx_subject ORDER BY id DESC'; await live.executeSql(source);
      const grid = query().getByRole('grid'), header = grid.locator('[role="columnheader"][aria-colindex="2"]'); await header.click();
      await expect(header).toHaveAttribute('aria-sort', 'ascending'); const result = await query().locator('.result-body').innerText();
      const before = await audit(info), history = await page.evaluate(async () => (await window.dbark.invoke('history.list', {})).map(row => row.id));
      await open(info);
      const idA = await dialog().getByLabel(t.physicalId, { exact: true }).innerText();
      const baseline = { isolation: await dialog().getByRole('combobox', { name: t.isolation, exact: true }).inputValue(), readOnly: await dialog().getByRole('checkbox', { name: t.readOnly, exact: true }).isChecked() };
      await apply(info, 'READ COMMITTED', true);
      await (await navigationMenuItem(dialog(), { name: t.close, exact: true })).click();
      expect(await query().locator('.result-body').innerText()).toBe(result); await expect(header).toHaveAttribute('aria-sort', 'ascending');
      await expect(query().locator('.monaco-editor .view-lines')).toContainText(source);
      expect((await audit(info)).commands.filter(command => command === 'query.execute')).toHaveLength(before.commands.filter(command => command === 'query.execute').length);
      expect(await page.evaluate(async () => (await window.dbark.invoke('history.list', {})).map(row => row.id))).toEqual(history);
      await (await navigationMenuItem(query(), { name: zh.common.transactionBegin, exact: true })).click();
      await live.writeSql('INSERT INTO tx_subject VALUES(1,\'只读事务应拒绝\')'); await (await navigationMenuItem(query(), { name: '执行全部', exact: true })).click();
      await expect((await navigationMenuItem(query(), { name: '停止', exact: true }))).toBeDisabled(); await expect(query().locator('.error-box')).toContainText(/read.only/i);
      await open(info); await expect((await navigationMenuItem(dialog(), { name: t.apply, exact: true }))).toBeDisabled(); await expect(dialog().getByRole('combobox', { name: t.isolation, exact: true })).toBeDisabled();
      expect((await audit(info)).settings.at(-1)).toMatchObject({ ok: true, result: { transactionOpen: true, serverConnectionId: idA.trim() } });
      await (await navigationMenuItem(dialog(), { name: t.close, exact: true })).click(); await (await navigationMenuItem(query(), { name: zh.common.transactionRollback, exact: true })).click();
      await open(info); await apply(info, 'SERIALIZABLE', false); await (await navigationMenuItem(dialog(), { name: t.close, exact: true })).click();
      await (await navigationMenuItem(query(), { name: zh.common.transactionBegin, exact: true })).click(); await live.executeSql('INSERT INTO tx_subject VALUES(2,\'必须保持未提交\')');
      const count = async () => (await observer.query<RowDataPacket[]>(`SELECT id FROM \`${database}\`.tx_subject WHERE id IN(1,2)`))[0]; expect(await count()).toEqual([]);
      await open(info); await expect((await navigationMenuItem(dialog(), { name: t.apply, exact: true }))).toBeDisabled(); expect(await count()).toEqual([]);
      await page.screenshot({ path: info.outputPath('活动事务禁止修改默认设置.png') });
      await (await navigationMenuItem(dialog(), { name: t.close, exact: true })).click(); await (await navigationMenuItem(query(), { name: zh.common.transactionRollback, exact: true })).click(); expect(await count()).toEqual([]);
      await live.openDatabaseQuery(database); await open(info);
      const idB = await dialog().getByLabel(t.physicalId, { exact: true }).innerText(); expect(idB.trim()).not.toBe(idA.trim());
      await expect(dialog().getByRole('combobox', { name: t.isolation, exact: true })).toHaveValue(baseline.isolation);
      await expect(dialog().getByRole('checkbox', { name: t.readOnly, exact: true })).toBeChecked({ checked: baseline.readOnly });
      expect((await audit(info)).settings.filter(item => item.command === 'query.transactionSettings.apply')).toHaveLength(2);
      expect((await audit(info)).settings.every(item => item.ok)).toBe(true);
      await page.screenshot({ path: info.outputPath('第二标签独立默认事务设置.png') }); await (await navigationMenuItem(dialog(), { name: t.close, exact: true })).click(); expect(pageErrors).toEqual([]);
    });
  }, info, { captureFailureScreenshot: false });
});

/** 正式入口切换自动提交；原Main旁观和独立观察连接分别证明调用与真实可见数据。 */
test('正式自动提交开关保持原结果、明确确认活动事务提交、关闭不提交及双标签会话隔离', async ({}, info) => {
  const live = await import('./live-helpers');
  if (!enabled || !['192.168.31.200', 'deve-server.yinzon.com'].includes(live.environment.DBARK_TEST_HOST ?? '') || live.environment.DBARK_TEST_PORT !== '13384') throw Error('自动提交窗口验收仅限200隔离13384');
  await live.isolatedDatabase(async context => {
    const { observer, database } = context;
    await info.attach('自动提交隔离资源', { body: JSON.stringify({ database, observerThreadId: (observer as unknown as { threadId?: number }).threadId }), contentType: 'application/json' });
    await observer.query(`CREATE TABLE \`${database}\`.tx_subject(id INT PRIMARY KEY,note VARCHAR(64)) ENGINE=InnoDB`);
    await observer.query(`INSERT INTO \`${database}\`.tx_subject VALUES(1,'控制一'),(2,'控制二'),(3,'控制三')`);
    const rows = async () => (await observer.query<RowDataPacket[]>(`SELECT id,note FROM \`${database}\`.tx_subject ORDER BY id`))[0];
    await observed(info, async () => {
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900));
      await live.openDatabaseQuery(database); const source = 'SELECT id,note FROM tx_subject ORDER BY id DESC'; await live.executeSql(source);
      const header = query().getByRole('grid').locator('[role="columnheader"][aria-colindex="2"]'); await header.click();
      await expect(header).toHaveAttribute('aria-sort', 'ascending'); const result = await query().locator('.result-body').innerText();
      const history = await page.evaluate(async () => (await window.dbark.invoke('history.list', {})).map(row => row.id));
      await open(info); const idA = (await dialog().getByLabel(t.physicalId, { exact: true }).innerText()).trim();
      const defaults = { isolation: await dialog().getByRole('combobox', { name: t.isolation, exact: true }).inputValue(), readOnly: await dialog().getByRole('checkbox', { name: t.readOnly, exact: true }).isChecked() };
      /** 单个按钮等待原设置回包；未自动刷新或补发SQL。 */
      const setAutomatic = async (enabled: boolean, commit = false) => {
        const before = (await audit(info)).settings.length;
        await dialog().getByRole('checkbox', { name: t.autocommitChoice, exact: true }).setChecked(enabled);
        const label = enabled ? commit ? t.enableAndCommit : t.enableAutocommit : t.disableAutocommit;
        if (commit) {
          await expect((await navigationMenuItem(dialog(), { name: label, exact: true }))).toBeDisabled();
          expect((await audit(info)).settings.length).toBe(before);
          await expect(dialog()).toContainText(t.implicitCommit);
          await dialog().getByRole('checkbox', { name: t.acknowledgeCommit, exact: true }).check();
          await (await navigationMenuItem(dialog(), { name: label, exact: true })).scrollIntoViewIfNeeded();
          await page.screenshot({ path: info.outputPath('自动提交开启前明确确认.png') });
        }
        await (await navigationMenuItem(dialog(), { name: label, exact: true })).click();
        await expect.poll(async () => (await audit(info)).settings.length).toBe(before + 1);
        expect((await audit(info)).settings.at(-1)).toMatchObject({ command: 'query.autocommit.apply', ok: true, input: { autocommit: enabled, allowImplicitCommit: commit }, result: { confirmed: true, changed: true, implicitCommitAcknowledged: commit, snapshot: { autocommit: enabled, serverConnectionId: idA, database } } });
        await expect((await navigationMenuItem(dialog(), { name: t.refresh, exact: true }))).toBeEnabled();
      };
      await setAutomatic(false); await (await navigationMenuItem(dialog(), { name: t.close, exact: true })).click();
      expect(await query().locator('.result-body').innerText()).toBe(result); await expect(header).toHaveAttribute('aria-sort', 'ascending');
      await expect(query().locator('.monaco-editor .view-lines')).toContainText(source);
      expect(await page.evaluate(async () => (await window.dbark.invoke('history.list', {})).map(row => row.id))).toEqual(history);
      await live.executeSql("UPDATE tx_subject SET note='已确认隐式提交' WHERE id=1");
      expect(await rows()).toEqual([{ id: 1, note: '控制一' }, { id: 2, note: '控制二' }, { id: 3, note: '控制三' }]);
      await open(info); await expect(dialog().getByLabel(t.transaction, { exact: true })).toHaveText(t.yes);
      await setAutomatic(true, true); await expect(dialog().getByRole('status', { name: t.status })).toContainText('原活动事务已确认提交');
      const committed = [{ id: 1, note: '已确认隐式提交' }, { id: 2, note: '控制二' }, { id: 3, note: '控制三' }]; expect(await rows()).toEqual(committed);
      await (await navigationMenuItem(dialog(), { name: t.close, exact: true })).click();
      await (await navigationMenuItem(query(), { name: zh.common.transactionBegin, exact: true })).click(); await live.executeSql("UPDATE tx_subject SET note='关闭不应提交' WHERE id=2");
      await open(info); await expect((await navigationMenuItem(dialog(), { name: t.enableAutocommit, exact: true }))).toBeDisabled();
      await setAutomatic(false); await expect(dialog().getByLabel(t.transaction, { exact: true })).toHaveText(t.yes); expect(await rows()).toEqual(committed);
      await (await navigationMenuItem(dialog(), { name: t.close, exact: true })).click(); await (await navigationMenuItem(query(), { name: zh.common.transactionRollback, exact: true })).click(); expect(await rows()).toEqual(committed);
      await live.openDatabaseQuery(database); await open(info); const idB = (await dialog().getByLabel(t.physicalId, { exact: true }).innerText()).trim(); expect(idB).not.toBe(idA);
      await expect(dialog().getByLabel(t.autocommit, { exact: true })).toHaveText(t.yes);
      await expect(dialog().getByRole('combobox', { name: t.isolation, exact: true })).toHaveValue(defaults.isolation);
      await expect(dialog().getByRole('checkbox', { name: t.readOnly, exact: true })).toBeChecked({ checked: defaults.readOnly });
      await page.screenshot({ path: info.outputPath('自动提交第二标签独立会话.png') });
      const taskRecords = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
      expect(taskRecords.some(record => record.status === 'completed' && record.message === '服务器已确认自动提交开启；原活动事务已确认提交')).toBe(true);
      await info.attach('自动提交已提交三行独立读回', { body: JSON.stringify({ database, idA, idB, rows: await rows() }), contentType: 'application/json' });
      expect((await audit(info)).settings.filter(item => item.command === 'query.autocommit.apply')).toHaveLength(3);
      await (await navigationMenuItem(dialog(), { name: t.close, exact: true })).click(); expect(pageErrors).toEqual([]);
    });
  }, info, { captureFailureScreenshot: false });
});

/** 原门进入具体动作后才加载真实菜单导航，不改变默认/列表阶段的资源边界。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args); }
