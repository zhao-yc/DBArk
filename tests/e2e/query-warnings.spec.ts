import type { TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, page, ownedDesktopResources, retainOwnedDesktopResources, pageErrors } from './desktop-fixture';
import { queryWarningsZh as t } from '../../src/renderer/locales/queryWarnings.zh-CN';
import { queryPartialOutcomeZh } from '../../src/renderer/locales/queryPartialOutcome.zh-CN';
import { parameterZh } from '../../src/renderer/locales/queryParameters.zh-CN';
import { observeQueryFailureSource } from './query-failure-source-observer';
import type { QueryOutcome } from '../../src/shared/contracts';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_QUERY_WARNINGS_UI === '1';
test.skip(!enabled, '显式查询警告正式窗口须统筹核对200隔离实例并显式开启双门');
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
    if (root.__warningsAudit || typeof original !== 'function' || windows.length !== 1 || !frame) throw Error('显式查询警告旁观器原归属未知');
    const processId = frame.processId, frameToken = frame.frameToken;
    const state: Audit & { check(): void; restore(): void } = { pending: 0, connections: [], queries: [], check() {}, restore() {} };
    const check = () => { if (root.__warningsAudit !== state || handlers.get('dbark:request') !== wrapped || contents.isDestroyed() || contents.mainFrame !== frame || frame.processId !== processId || frame.frameToken !== frameToken || BrowserWindow.getAllWindows()[0] !== window) throw Error('显式查询警告原窗口或旁观器已变化'); };
    const wrapped = async (event: any, payload: any) => {
      check(); if (event.sender !== contents || event.senderFrame !== frame) throw Error('显式查询警告旁观来源不符'); state.pending++;
      try {
        const response = await original(event, payload); check();
        if (payload.command === 'connections.open' && response?.ok === true && Number.isSafeInteger(response.result?.connectionId)) state.connections.push(response.result.connectionId);
        if (payload.command === 'query.execute' || payload.command === 'query.executeParameterized') state.queries.push({ command: payload.command, enabled: payload.input.collectWarnings === true, ok: response?.ok === true, ...(response?.ok === true ? { outcome: response.result } : {}) });
        return response;
      } finally { state.pending--; }
    };
    state.check = check; state.restore = () => { check(); if (state.pending) throw Error('原显式查询警告请求尚未结束'); handlers.set('dbark:request', original); delete root.__warningsAudit; };
    root.__warningsAudit = state; handlers.set('dbark:request', wrapped);
  });
  let failed = false, failure: unknown;
  try { await body(); } catch (error) { failed = true; failure = error; throw error; }
  finally {
    try { const result = await audit(info); expect(result.pending).toBe(0); await info.attach('显式查询警告Main原始旁观', { body: JSON.stringify(result, null, 2), contentType: 'application/json' }); await owner.application.evaluate(() => (globalThis as any).__warningsAudit.restore()); ownedDesktopResources(info); }
    catch (cleanup) { retainOwnedDesktopResources(info); if (failed) throw new AggregateError([failure, cleanup], '原显式查询警告失败且旁观收尾未确认', { cause: failure }); throw cleanup; }
  }
}
/** 返回原窗口下的既有旁观事实，不用结果显示推测SQL执行次数。 */
async function audit(info: TestInfo): Promise<Audit> {
  const owner = ownedDesktopResources(info), result = await owner.application.evaluate(() => { const state = (globalThis as any).__warningsAudit; state.check(); return { pending: state.pending, connections: state.connections, queries: state.queries }; }); ownedDesktopResources(info); return result;
}

test('显式采集、原生报告离线切换与参数消息隐藏、默认关闭恢复', async ({}, info) => {
  const live=await import('./live-helpers');
  if(!enabled||!['192.168.31.200','deve-server.yinzon.com'].includes(live.environment.DBARK_TEST_HOST??'')||live.environment.DBARK_TEST_PORT!=='13384') throw Error('警告窗口专项只允许200隔离13384');
  await live.isolatedDatabase(async ({database,observer})=>{
    await info.attach('警告专项隔离资源',{body:JSON.stringify({database,observerThreadId:(observer as unknown as {threadId:number}).threadId}),contentType:'application/json'});
    await observed(info,async()=>{
      await ownedDesktopResources(info).application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1460,980));
      await live.openDatabaseQuery(database);
      const option=query().getByRole('checkbox',{name:t.option,exact:true});
      await expect(option).not.toBeChecked();
      /** 等待真实Main回执；详情查看不得再执行一次用户SQL。 */
      const run=async(source:string)=>{
        const before=(await audit(info)).queries.length; await live.writeSql(source);
        await query().getByRole('button',{name:'执行全部',exact:true}).click();
        await expect.poll(async()=>(await audit(info)).queries.length).toBe(before+1);
        await expect(query().getByRole('button',{name:'停止',exact:true})).toBeDisabled();
        return (await audit(info)).queries.at(-1)!;
      };
      const original=await run("SELECT CAST('default-warning' AS UNSIGNED) AS value,CONNECTION_ID() AS diagnostic_thread");
      expect(original).toMatchObject({command:'query.execute',enabled:false,ok:true});
      expect(original.outcome?.warnings).toBeUndefined(); expect(original.outcome?.results[0].warningCount).toBe(1);
      const originalThread=Number(original.outcome?.results[0].rows[0]?.c1); expect(Number.isSafeInteger(originalThread)&&originalThread>0).toBe(true);
      await info.attach('警告专项原产品线程',{body:JSON.stringify({database,originalThread}),contentType:'application/json'});
      await expect(query().getByRole('button',{name:t.open,exact:true})).toHaveCount(0);
      await expect(query().locator('.tab-status')).toContainText(t.count(1));
      await option.check(); await expect(query()).toContainText('ROW_COUNT()');
      const result=await run("SELECT CAST('<b>ui-warning</b>' AS UNSIGNED) AS first; SELECT CAST('second-warning' AS UNSIGNED) AS second");
      expect(result).toMatchObject({enabled:true,ok:true,outcome:{warnings:{collection:'explicit',omittedStatements:0,truncated:false}}});
      expect(result.outcome?.warnings?.statements).toHaveLength(2);
      const beforeOpen=(await audit(info)).queries.length;
      await query().getByRole('button',{name:t.open,exact:true}).click();
      const dialog=page.getByRole('dialog',{name:t.title,exact:true});
      await expect(dialog.getByRole('columnheader',{name:t.level,exact:true})).toBeVisible();
      await expect(dialog.getByRole('columnheader',{name:t.code,exact:true})).toBeVisible();
      await expect(dialog.getByRole('columnheader',{name:t.message,exact:true})).toBeVisible();
      await expect(dialog.getByRole('cell',{name:'1292',exact:true})).toBeVisible();
      await expect(dialog).toContainText('<b>ui-warning</b>'); expect(await dialog.locator('b').count()).toBe(0);
      await dialog.getByRole('combobox',{name:t.statement,exact:true}).selectOption('1');
      await expect(dialog).toContainText('second-warning'); await expect(dialog).not.toContainText('<b>ui-warning</b>');
      await page.screenshot({path:info.outputPath('查询警告详情.png')});
      await dialog.getByRole('button',{name:t.close,exact:true}).click(); await expect(dialog).toHaveCount(0);
      await query().getByRole('button',{name:t.open,exact:true}).click(); await expect(dialog).toBeVisible();
      await dialog.getByRole('button',{name:t.close,exact:true}).click(); expect((await audit(info)).queries).toHaveLength(beforeOpen);
      const hidden='只在类型参数输入的警告值',source='SELECT CAST(:hidden AS UNSIGNED) AS parameter_value';
      await live.writeSql(source); await query().getByRole('button',{name:parameterZh.open,exact:true}).click();
      const modal=page.getByRole('dialog',{name:parameterZh.title,exact:true});
      await expect(option).toBeDisabled(); await modal.getByRole('textbox',{name:parameterZh.value+' hidden',exact:true}).fill(hidden);
      const beforeParameter=(await audit(info)).queries.length;
      await modal.getByRole('button',{name:parameterZh.execute,exact:true}).click(); await expect(modal).toHaveCount(0);
      await expect.poll(async()=>(await audit(info)).queries.length).toBe(beforeParameter+1);
      await expect(query().getByRole('button',{name:'停止',exact:true})).toBeDisabled();
      const parameter=(await audit(info)).queries.at(-1)!;
      expect(parameter).toMatchObject({command:'query.executeParameterized',enabled:true,ok:true});
      expect(parameter.outcome?.warnings?.statements[0].conditions).toEqual([{level:'Warning',code:1292,messageHidden:true}]);
      expect(JSON.stringify(parameter.outcome?.warnings)).not.toContain(hidden);
      await query().getByRole('button',{name:t.open,exact:true}).click(); await expect(dialog).toContainText(t.hidden);
      await expect(dialog).not.toContainText(hidden); await dialog.getByRole('button',{name:t.close,exact:true}).click();
      const history=await page.evaluate(()=>window.dbark.invoke('history.list',{}));
      const entry=history.find(item=>item.sql===source); expect(entry?.success).toBe(true); expect(JSON.stringify(entry)).not.toContain(hidden);
      await option.uncheck(); const clean=await run('SELECT 1 AS clean');
      expect(clean.enabled).toBe(false); expect(clean.outcome?.warnings).toBeUndefined();
      await expect(query().getByRole('button',{name:t.open,exact:true})).toHaveCount(0);
      expect((await audit(info)).queries).toHaveLength(4); expect(pageErrors).toEqual([]);
    });
  },info,{captureFailureScreenshot:false});
});
