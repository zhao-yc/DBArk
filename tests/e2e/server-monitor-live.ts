import mysql from 'mysql2/promise';
import type { TestInfo } from '@playwright/test';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, pageErrors } from './desktop-fixture';
import { closeMysqlConnection } from '../../src/engine/connection';
import { ServerMonitorUiLifetime, assertServerMonitorUiIdentity, closeServerMonitorObserver, guardServerMonitorExitAnswers, serverMonitorUiTaskIds, type ServerMonitorUiTarget } from '../helpers/serverMonitorUi';
import { serverMonitorZhCN as t } from '../../src/renderer/serverMonitorZh';
import { zh } from '../../src/renderer/locales/zh-CN';

/** 准确双门与RAM绑定通过后才注册；只准备首个源码窗口用例，不接触旧原生现场。 */
export function registerServerMonitorUi(binding: ServerMonitorUiTarget) {
  // 失败记录强引用原owner及观察句柄；不因afterEach或迟到Promise覆盖/丢失归属。
  const cases = new Map<TestInfo,{ life: ServerMonitorUiLifetime; observer?: mysql.Connection; native?: any; stream?: any }>();
  let halted = false;
  test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true }); test.setTimeout(120000); test.describe.configure({ retries: 0 });
  test.afterEach(({},info) => { const current = cases.get(info); if (!current) { halted = true; retainOwnedDesktopResources(info); throw Error('S02未建立本例归属'); } try { current.life.afterEach(); cases.delete(info); } catch (reason) { halted = true; throw reason; } });
  test('S02准确13384只读监控概要、状态及有限会话，手动刷新一次并正常收尾', async ({trace,screenshot,video},info) => {
    if (halted) throw Error('S02前例已保留资源，停止后续用例');
    const captured = ownedDesktopResources(info), page = captured.page, application = captured.application;
    const life = new ServerMonitorUiLifetime({
      check(allowClosed) { binding.assertCurrent(); const current = ownedDesktopResources(info); if (current.page !== page || current.application !== application || !allowClosed && current.closed) throw Error('S02原窗口归属已变化'); },
      closed: () => ownedDesktopResources(info).closed, retain: () => { halted = true; retainOwnedDesktopResources(info); },
      async exit() { life.check(); await application.evaluate(guardServerMonitorExitAnswers); life.check(); await confirmOwnedDesktopExit(info); },
    },info as TestInfo & { _startWallTime?: number });
    const current: { life: ServerMonitorUiLifetime; observer?: mysql.Connection; native?: any; stream?: any } = { life }; cases.set(info,current);
    const observe = <T>(action: () => Promise<T>,allowClosed = false) => life.observe(action,allowClosed);
    try {
      life.check(); if (trace !== 'off' || screenshot !== 'off' || video !== 'off') throw Error('S02含认证表单禁止trace、截图或视频');
      await observe(async () => {
        current.observer = await mysql.createConnection({ host: binding.target.host, port: binding.target.port, user: binding.target.user, password: binding.target.password, connectTimeout: 15000 });
        current.native = (current.observer as mysql.Connection & { connection?: any }).connection; current.stream = current.native?.stream; life.check();
        if (!current.native || !current.stream) throw Error('S02观察连接未保留原生归属');
      });
      assertServerMonitorUiIdentity(await observe(() => current.observer!.query('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid')),binding.target.uuid);
      const connectionName = 'S02只读监控本例';
      await observe(() => page.locator('.navigation-toolbar').getByRole('button',{name:zh.common.newConnection,exact:true}).click());
      const form = page.getByRole('dialog',{name:zh.common.newConnection,exact:true});
      await observe(() => form.getByLabel(zh.connections.text006,{exact:true}).fill(connectionName));
      await observe(() => form.getByLabel(zh.connections.text008,{exact:true}).selectOption('mysql'));
      await observe(() => form.getByLabel(zh.connections.text009,{exact:true}).fill(binding.target.host));
      await observe(() => form.getByLabel(zh.connections.text010,{exact:true}).fill(String(binding.target.port)));
      await observe(() => form.getByLabel(zh.common.user,{exact:true}).fill(binding.target.user));
      await observe(() => form.getByLabel(zh.connections.text011,{exact:true}).fill(binding.target.password));
      await observe(() => form.getByLabel(zh.connections.text012,{exact:true}).fill(''));
      await observe(() => expect(form.getByLabel(zh.connections.text012,{exact:true})).toHaveValue(''));
      await observe(() => form.getByLabel(zh.connections.text016,{exact:true}).uncheck());
      await observe(() => expect(form.getByLabel(zh.connections.text016,{exact:true})).not.toBeChecked());
      // 不点击测试连接、不额外connections.open；第一个真实监控任务负责受管建连。
      await observe(() => form.getByRole('button',{name:zh.connections.text036,exact:true}).click()); await observe(() => expect(form).toBeHidden());
      const profiles = await observe(() => page.evaluate(() => window.dbark.invoke('connections.list',{}))), profile = profiles.length === 1 ? profiles[0] : undefined;
      expect(Boolean(profile && profile.name === connectionName && profile.host === binding.target.host && profile.port === binding.target.port && profile.user === binding.target.user && !profile.database && profile.rememberPassword === false && profile.password === undefined && profile.hasPassword === Boolean(binding.target.password) && !profile.ssh?.enabled && !profile.tls?.enabled)).toBe(true);
      const before = await observe(() => page.evaluate(async () => ({ tabs:(await window.dbark.invoke('settings.get',{})).tabs, history:await window.dbark.invoke('history.list',{}) })));
      expect(before.tabs.some(tab => tab.kind === 'query')).toBe(false);
      await observe(() => page.locator('.navigation-toolbar').getByRole('button',{name:t.title,exact:true}).click());
      const monitor = page.getByRole('dialog',{name:t.title,exact:true});
      await observe(() => monitor.getByLabel(t.connection,{exact:true}).selectOption(profile!.id));
      await observe(() => monitor.getByRole('button',{name:t.open,exact:true}).click());
      /** 原任务完成并恢复刷新按钮后再核真实列表，不用固定sleep猜测快照完成。 */
      const completed = async (count: 1 | 2) => {
        let tasks: unknown;
        await observe(() => expect.poll(async () => { tasks = await observe(() => page.evaluate(() => window.dbark.invoke('tasks.list',{}))); return Array.isArray(tasks) ? tasks.filter(task => task.kind === 'serverMonitor.read' && task.status === 'completed').length : -1; }).toBe(count));
        await observe(() => expect(monitor.getByRole('button',{name:t.refresh,exact:true})).toBeEnabled());
        return serverMonitorUiTaskIds(tasks,count);
      };
      const first = await completed(1);
      for (const name of [t.summary,t.status,t.sessions]) await observe(() => expect(monitor.getByRole('heading',{name,exact:true})).toBeVisible());
      await observe(() => expect(monitor).toContainText('8.4.11'));
      await observe(() => expect(monitor.getByText(t.scope,{exact:true})).toBeVisible()); await observe(() => expect(monitor.getByRole('checkbox',{name:t.auto,exact:true})).not.toBeChecked());
      const firstConnection = await observe(() => monitor.getByText(t.fields.connectionId,{exact:true}).locator('..').locator('dd').innerText()); expect(/^\d+$/.test(firstConnection)).toBe(true);
      await observe(() => monitor.getByRole('button',{name:t.refresh,exact:true}).click()); const second = await completed(2);
      expect(second.includes(first[0]) && second.filter(id => id !== first[0]).length === 1).toBe(true);
      const nextConnection = await observe(() => monitor.getByText(t.fields.connectionId,{exact:true}).locator('..').locator('dd').innerText()); expect(/^\d+$/.test(nextConnection) && nextConnection !== firstConnection).toBe(true);
      await observe(() => expect(monitor.getByText(t.scope,{exact:true})).toBeVisible()); await observe(() => expect(monitor.getByRole('checkbox',{name:t.auto,exact:true})).not.toBeChecked());
      await observe(() => monitor.locator('.server-monitor-dialog footer').getByRole('button',{name:t.close,exact:true}).click()); await observe(() => expect(monitor).toBeHidden());
      const after = await observe(() => page.evaluate(async () => ({ tabs:(await window.dbark.invoke('settings.get',{})).tabs, history:await window.dbark.invoke('history.list',{}) }))); expect(after).toEqual(before); expect(pageErrors).toEqual([]);
      await life.finish(() => page.evaluate(() => window.dbark.invoke('tasks.list',{})),() => closeServerMonitorObserver(current.observer! as mysql.Connection & { connection?: unknown },current.native,current.stream,() => life.check(true),native => closeMysqlConnection(native,true,false,life.remaining(1000))));
    } catch (reason) { life.preserve(); throw reason; }
    finally { life.endBody(); }
  });
}
