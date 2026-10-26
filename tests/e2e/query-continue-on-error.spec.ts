import type { TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, page, ownedDesktopResources, retainOwnedDesktopResources, pageErrors } from './desktop-fixture';
import { queryContinueOnErrorZh as t } from '../../src/renderer/locales/queryContinueOnError.zh-CN';
import { queryPartialOutcomeZh } from '../../src/renderer/locales/queryPartialOutcome.zh-CN';
import { parameterZh } from '../../src/renderer/locales/queryParameters.zh-CN';
import { observeQueryFailureSource } from './query-failure-source-observer';
import type { QueryOutcome } from '../../src/shared/contracts';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_CONTINUE_ON_ERROR_UI === '1';
test.skip(!enabled, '遇错继续正式窗口须统筹核对200隔离实例并显式开启双门');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(150000);
interface Audit { pending: number; connections: number[]; queries: Array<{ command: string; enabled: boolean; ok: boolean; outcome?: QueryOutcome }>; }
const query = () => page.locator('.query-tab:visible');
const notice = () => query().getByRole('status', { name: t.title, exact: true });

/** 只旁观真实Main调用，不读取参数值或凭据，不改产品SQL和回包。 */
async function observed(info: TestInfo, body: () => Promise<void>) {
  const owner = ownedDesktopResources(info);
  await owner.application.evaluate(({ ipcMain, BrowserWindow }) => {
    const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, original = handlers?.get('dbark:request'), windows = BrowserWindow.getAllWindows();
    const window = windows[0], contents = window?.webContents, frame = contents?.mainFrame;
    if (root.__continueAudit || typeof original !== 'function' || windows.length !== 1 || !frame) throw Error('遇错继续旁观器原归属未知');
    const processId = frame.processId, frameToken = frame.frameToken;
    const state: Audit & { check(): void; restore(): void } = { pending: 0, connections: [], queries: [], check() {}, restore() {} };
    const check = () => { if (root.__continueAudit !== state || handlers.get('dbark:request') !== wrapped || contents.isDestroyed() || contents.mainFrame !== frame || frame.processId !== processId || frame.frameToken !== frameToken || BrowserWindow.getAllWindows()[0] !== window) throw Error('遇错继续原窗口或旁观器已变化'); };
    const wrapped = async (event: any, payload: any) => {
      check(); if (event.sender !== contents || event.senderFrame !== frame) throw Error('遇错继续旁观来源不符'); state.pending++;
      try {
        const response = await original(event, payload); check();
        if (payload.command === 'connections.open' && response?.ok === true && Number.isSafeInteger(response.result?.connectionId)) state.connections.push(response.result.connectionId);
        if (payload.command === 'query.execute' || payload.command === 'query.executeParameterized') state.queries.push({ command: payload.command, enabled: payload.input.continueOnError === true, ok: response?.ok === true, ...(response?.ok === true ? { outcome: response.result } : {}) });
        return response;
      } finally { state.pending--; }
    };
    state.check = check; state.restore = () => { check(); if (state.pending) throw Error('原遇错继续请求尚未结束'); handlers.set('dbark:request', original); delete root.__continueAudit; };
    root.__continueAudit = state; handlers.set('dbark:request', wrapped);
  });
  let failed = false, failure: unknown;
  try { await body(); } catch (error) { failed = true; failure = error; throw error; }
  finally {
    try { const result = await audit(info); expect(result.pending).toBe(0); await info.attach('遇错继续Main原始旁观', { body: JSON.stringify(result, null, 2), contentType: 'application/json' }); await owner.application.evaluate(() => (globalThis as any).__continueAudit.restore()); ownedDesktopResources(info); }
    catch (cleanup) { retainOwnedDesktopResources(info); if (failed) throw new AggregateError([failure, cleanup], '原遇错继续失败且旁观收尾未确认', { cause: failure }); throw cleanup; }
  }
}
/** 返回原窗口下的既有旁观事实，不用结果显示推测SQL执行次数。 */
async function audit(info: TestInfo): Promise<Audit> {
  const owner = ownedDesktopResources(info), result = await owner.application.evaluate(() => { const state = (globalThis as any).__continueAudit; state.check(); return { pending: state.pending, connections: state.connections, queries: state.queries }; }); ownedDesktopResources(info); return result;
}

test('默认首错停止与显式多错继续、逐错原SQL定位、参数隐私和历史、全成功摘要', async ({}, info) => {
  // 仅在尚未配置连接的测试窗口启用Monaco官方观察API；不替换编辑器、模型或执行端口。
  await page.addInitScript(() => {
    // ESM依赖先于SqlEditor模块体执行，首次读取时就须有官方globalAPI选项。
    let environment: unknown = { globalAPI: true };
    Object.defineProperty(window, 'MonacoEnvironment', { configurable: true, get: () => environment, set: value => { environment = { ...value, globalAPI: true }; } });
  });
  await page.reload(); await expect(page.locator('.app-commandbar')).toBeVisible();
  const live = await import('./live-helpers');
  if (!enabled || !['192.168.31.200', 'deve-server.yinzon.com'].includes(live.environment.DBARK_TEST_HOST ?? '') || live.environment.DBARK_TEST_PORT !== '13384') throw Error('遇错继续窗口仅限200既定隔离13384');
  await live.isolatedDatabase(async ({ observer, database }) => {
    await info.attach('遇错继续隔离资源', { body: JSON.stringify({ database, observerThreadId: (observer as unknown as { threadId: number }).threadId }), contentType: 'application/json' });
    await observer.query(`CREATE TABLE \`${database}\`.continue_subject(id INT PRIMARY KEY,note VARCHAR(64)) ENGINE=InnoDB`);
    await observer.query(`CREATE TABLE \`${database}\`.continue_secrets(id INT PRIMARY KEY,value VARCHAR(128) UNIQUE) ENGINE=InnoDB`);
    const hidden = '仅在执行结果显示的参数值'; await observer.query(`INSERT INTO \`${database}\`.continue_secrets VALUES(1,?)`, [hidden]);
    await observed(info, async () => {
      await ownedDesktopResources(info).application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1460, 980));
      await live.openDatabaseQuery(database); await expect(query().getByRole('checkbox', { name: t.option, exact: true })).not.toBeChecked();
      const observation = await page.evaluate(() => {
        const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
        return { api: !!api, editors: api?.editor.getEditors().filter(editor => { const node = editor.getContainerDomNode(); return node.isConnected && !!node.closest('.query-tab') && node.getClientRects().length > 0; }).length ?? 0 };
      });
      await info.attach('Monaco官方只读观察准入', { body: JSON.stringify(observation), contentType: 'application/json' }); expect(observation).toEqual({ api: true, editors: 1 });
      /** 等真实Main原响应落定；预期失败也保留原结果，不重发一次“确认”。 */
      const run = async (source: string) => {
        const before = (await audit(info)).queries.length; await live.writeSql(source); await query().getByRole('button', { name: '执行全部', exact: true }).click();
        await expect.poll(async () => (await audit(info)).queries.length).toBe(before + 1); await expect(query().getByRole('button', { name: '停止', exact: true })).toBeDisabled(); return (await audit(info)).queries.at(-1)!;
      };
      const defaultResult = await run("INSERT INTO continue_subject VALUES(1,'默认首条'); INSERT INTO continue_subject VALUES(1,'默认冲突'); INSERT INTO continue_subject VALUES(2,'不应继续')");
      expect(defaultResult).toMatchObject({ enabled: false, ok: true, outcome: { failure: { statementOrdinal: 2 } } }); expect(defaultResult.outcome?.scriptReport).toBeUndefined();
      await expect(query().getByRole('status', { name: queryPartialOutcomeZh.title, exact: true })).toBeVisible(); await expect(notice()).toHaveCount(0);
      expect((await observer.query<RowDataPacket[]>(`SELECT id FROM \`${database}\`.continue_subject ORDER BY id`))[0].map(row => row.id)).toEqual([1]); await observer.query(`DELETE FROM \`${database}\`.continue_subject`);
      await query().getByRole('checkbox', { name: t.option, exact: true }).check();
      const source = ["INSERT INTO continue_subject VALUES(1,'继续首条');", "INSERT INTO continue_subject VALUES(1,'继续冲突');", "SELECT '中间结果' AS result;", 'SELEC broken;', "INSERT INTO continue_subject VALUES(2,'继续尾条');", 'SELECT CAST(CONNECTION_ID() AS CHAR) AS sid,id,note FROM continue_subject ORDER BY id;'].join('\n');
      const continued = await run(source); expect(continued).toMatchObject({ enabled: true, ok: true, outcome: { scriptReport: { statementsAttempted: 6, statementsCompleted: 4, reachedEnd: true } } });
      expect(continued.outcome?.scriptReport?.errors.map(error => error.statementOrdinal)).toEqual([2, 4]);
      await expect(notice()).toContainText(t.reachedEnd); await expect(notice()).toContainText(t.counts(6, 4, 2));
      await expect(query().getByRole('status', { name: queryPartialOutcomeZh.title, exact: true })).toHaveCount(0);
      const original = await page.evaluate(observeQueryFailureSource), count = (await audit(info)).queries.length;
      for (const ordinal of [2, 4]) {
        await notice().getByRole('button', { name: t.locate(ordinal), exact: true }).click(); const current = await page.evaluate(observeQueryFailureSource);
        expect(current.version).toBe(original.version); expect(current.source).toBe(original.source); expect(current.focused).toBe(true);
        expect(current.selections?.map(value => value.text.trim().replace(/;$/, ''))).toEqual([ordinal === 2 ? "INSERT INTO continue_subject VALUES(1,'继续冲突')" : 'SELEC broken']);
      }
      expect((await audit(info)).queries).toHaveLength(count);
      expect((await observer.query<RowDataPacket[]>(`SELECT id,note FROM \`${database}\`.continue_subject ORDER BY id`))[0].map(row => [row.id, row.note])).toEqual([[1, '继续首条'], [2, '继续尾条']]);
      await page.screenshot({ path: info.outputPath('多错继续与逐条定位.png') });

      const parameterSource = 'INSERT INTO continue_secrets VALUES(2,:hidden); SELECT :hidden AS accepted'; await live.writeSql(parameterSource);
      await query().getByRole('button', { name: parameterZh.open, exact: true }).click(); const modal = page.getByRole('dialog', { name: parameterZh.title, exact: true });
      await expect(modal.getByRole('button', { name: parameterZh.execute, exact: true })).toBeEnabled(); await modal.getByRole('textbox', { name: parameterZh.value + ' hidden', exact: true }).fill(hidden);
      const beforeParameter = (await audit(info)).queries.length; await modal.getByRole('button', { name: parameterZh.execute, exact: true }).click(); await expect(modal).toHaveCount(0);
      await expect.poll(async () => (await audit(info)).queries.length).toBe(beforeParameter + 1); await expect(notice()).toContainText(t.counts(2, 1, 1));
      const parameter = (await audit(info)).queries.at(-1)!; expect(parameter).toMatchObject({ command: 'query.executeParameterized', enabled: true, ok: true, outcome: { scriptReport: { reachedEnd: true } } });
      expect(JSON.stringify(parameter.outcome?.scriptReport)).not.toContain(hidden); await expect(query().locator('.error-box')).not.toContainText(hidden);
      const history = await page.evaluate(() => window.dbark.invoke('history.list', {})), entry = history.find(item => item.sql === parameterSource);
      expect(entry?.success).toBe(false); expect(entry?.error).not.toContain(hidden); expect(entry?.sql).not.toContain(hidden);
      const successful = await run("SELECT '全成功结果' AS result"); expect(successful.outcome?.failure).toBeUndefined(); expect(successful.outcome?.scriptReport).toMatchObject({ statementsAttempted: 1, statementsCompleted: 1, reachedEnd: true, errors: [] });
      await expect(notice()).toContainText(t.counts(1, 1, 0)); await expect(query().locator('.error-box')).toHaveCount(0); expect((await audit(info)).queries).toHaveLength(4); expect(pageErrors).toEqual([]);
    });
  }, info, { captureFailureScreenshot: false });
});
