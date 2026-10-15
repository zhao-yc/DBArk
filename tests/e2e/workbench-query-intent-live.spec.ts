import { test, expect, desktop, page, closed, pageErrors } from './desktop-fixture';
import { objectUri, type WorkbenchTarget } from '../../src/shared/workbench';
import type { LiveContext } from './live-helpers';

// 两个开关必须同时显式启用；默认跳过早于桌面夹具，实库帮助器只在测试体内加载。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_QUERY_INTENT_LIVE === '1';
test.skip(!enabled, '默认严格跳过：需ROOT核对200连接并取得GUI时段后启用查询意图实库验收');
test.use({ trace: 'off' });

const queryForm = () => page.getByRole('dialog', { name: '新建查询', exact: true });
const shelf = () => page.getByRole('region', { name: '对象收藏', exact: true });
const query = () => page.locator('.query-tab:visible');
type Gate = { key: string; claimed: boolean; ready: boolean; ok?: boolean; error?: string; wait: Promise<void>; release(): void };
type Probe = { gate?: Gate; resolves: number; restore(): void };
type ProbeRoot = typeof globalThis & { __queryIntentLiveProbe?: Probe };

/** 目标键只含本例对象身份，不保存凭据、SQL、连接版本或列库返回数据。 */
const targetKey = (target: WorkbenchTarget) => JSON.stringify([target.connectionId, target.database, target.kind, target.kind === 'database' ? '' : target.name]);

/** 原handler完成真实核验后才等待交付；所有命令、回包、异常和连接修订逻辑仍由正式实现产生。 */
async function observeAndDelayResolve() {
  await desktop.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: { command: string; input: WorkbenchTarget }) => Promise<unknown>;
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers.get('dbark:request'); if (!original) throw Error('缺少正式请求处理器');
    const probe: Probe = { resolves: 0, restore() { probe.gate?.release(); handlers.set('dbark:request', original); } };
    (globalThis as ProbeRoot).__queryIntentLiveProbe = probe;
    handlers.set('dbark:request', async (event, payload) => {
      const target = payload.input;
      const key = payload.command === 'workbench.resolve' ? JSON.stringify([target.connectionId, target.database, target.kind, target.kind === 'database' ? '' : target.name]) : '';
      const gate = key && probe.gate?.key === key && !probe.gate.claimed ? probe.gate : undefined;
      if (gate) gate.claimed = true;
      const reply = await original(event, payload);
      if (payload.command === 'workbench.resolve') probe.resolves++;
      if (gate) {
        gate.ok = !!reply && typeof reply === 'object' && 'ok' in reply && reply.ok === true;
        if (reply && typeof reply === 'object' && 'error' in reply && typeof reply.error === 'string') gate.error = reply.error;
        gate.ready = true;
        await gate.wait;
      }
      return reply;
    });
  });
}

/** 只延迟下一次精确对象核验，不能意外接管新查询的建连、列库、执行或其它导航。 */
async function hold(target: WorkbenchTarget) {
  await desktop.evaluate((_, key: string) => {
    const probe = (globalThis as ProbeRoot).__queryIntentLiveProbe; if (!probe || probe.gate) throw Error('导航等待门状态异常');
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    probe.gate = { key, claimed: false, ready: false, wait, release };
  }, targetKey(target));
}

/** 真成功/真错误先到达原handler终态，才允许开始验证新用户意图；错误信息只读不替换。 */
async function nativeReply(ok: boolean) {
  await expect.poll(() => desktop.evaluate(() => {
    const gate = (globalThis as ProbeRoot).__queryIntentLiveProbe?.gate; return { ready: gate?.ready ?? false, ok: gate?.ok };
  }), { timeout: 20000, message: '等待正式workbench.resolve的真实终态' }).toEqual({ ready: true, ok });
  if (!ok) expect(await desktop.evaluate(() => (globalThis as ProbeRoot).__queryIntentLiveProbe?.gate?.error)).toContain('原对象已删除');
}

/** 释放的是原处理器已有回包，未创建成功对象或失败消息。 */
async function release() {
  await desktop.evaluate(() => {
    const probe = (globalThis as ProbeRoot).__queryIntentLiveProbe; probe?.gate?.release(); if (probe) probe.gate = undefined;
  });
}

/** 建表、例程及数据只能写入现有帮助器创建的两个本例随机库。 */
async function fixtures(old: LiveContext, current: LiveContext) {
  for (const context of [old, current]) if (!/^dbark_e2e_[a-z0-9_]+$/.test(context.database)) throw Error('拒绝使用非本例随机隔离库');
  await old.observer.query(`CREATE TABLE \`${old.database}\`.intent_subject(id INT PRIMARY KEY,note VARCHAR(60)) ENGINE=InnoDB`);
  await old.observer.query(`INSERT INTO \`${old.database}\`.intent_subject VALUES(1,'旧目标真实原值')`);
  await old.observer.query(`CREATE PROCEDURE \`${old.database}\`.intent_definition() SELECT note FROM \`${old.database}\`.intent_subject WHERE id=1`);
  await current.observer.query(`CREATE TABLE \`${current.database}\`.intent_current(id INT PRIMARY KEY,note VARCHAR(60)) ENGINE=InnoDB`);
  await current.observer.query(`INSERT INTO \`${current.database}\`.intent_current VALUES(1,'当前真实查询结果')`);
  const [missing] = await old.observer.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [old.database, 'intent_missing']);
  expect(missing).toEqual([]);
}

/** 收藏只以正式本地IPC建立夹具；对象核验和实际导航仍从侧栏按钮提交到原handler。 */
async function seedFavorites(old: LiveContext) {
  const targets: WorkbenchTarget[] = [
    { connectionId: old.connectionId, database: old.database, kind: 'table', name: 'intent_subject' },
    { connectionId: old.connectionId, database: old.database, kind: 'procedure', name: 'intent_definition' },
    { connectionId: old.connectionId, database: old.database, kind: 'table', name: 'intent_missing' }
  ];
  await page.evaluate(async targets => {
    const snapshot = await window.dbark.invoke('workbench.get', {});
    await window.dbark.invoke('workbench.save', { revision: snapshot.revision, document: { version: 1, focusMode: false, groups: [], favorites: targets.map((target, index) => ({ id: 'intent-live-' + index, label: ['真实迟到表', '真实迟到定义', '真实不存在对象'][index], groupId: null, target })) } });
  }, targets);
  await page.reload(); await expect(page.locator('.app-statusbar')).toBeVisible(); await expect(shelf()).toBeVisible();
  return targets;
}

/** 通过正式连接树选中当前连接与库；查询表单的初始上下文不依赖列表顺序或内部状态注入。 */
async function chooseCurrent(context: LiveContext) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByRole('button', { name: context.connectionName, exact: true }) });
  const database = connection.locator('.database-row').filter({ has: page.getByRole('button', { name: context.database, exact: true }) });
  if (!await database.isVisible()) await connection.locator('.connection-row').getByRole('button', { name: context.connectionName, exact: true }).click();
  await expect(database).toBeVisible({ timeout: 20000 }); await database.getByRole('button', { name: context.database, exact: true }).click();
  await expect(database).toHaveClass(/active/); return database;
}

/** 只读取已持久化的标签身份；先核对真实DOM数量，避免把防抖前的旧磁盘快照当作未改变。 */
async function savedTabs(count: number) {
  await expect(page.locator('.tab-strip .workspace-tab-button')).toHaveCount(count);
  let snapshot!: { activeTabId?: string; tabs: { id: string; kind: string; connectionId: string; database?: string; table?: string }[] };
  await expect.poll(async () => {
    snapshot = await page.evaluate(async () => {
      const settings = await window.dbark.invoke('settings.get', {});
      return { activeTabId: settings.activeTabId, tabs: settings.tabs.map(({ id, kind, connectionId, database, table }) => ({ id, kind, connectionId, database, table })) };
    }); return snapshot.tabs.length;
  }).toBe(count);
  return snapshot;
}

test('双真实连接：旧表/只读定义成功及不存在对象失败不覆盖新查询，最新真实导航正常落地', async ({}, info) => {
  test.setTimeout(240000);
  const { isolatedDatabase, executeSql, readRenderedResult } = await import('./live-helpers');
  // 嵌套复用帮助器建立两个真实连接和独立库；内层先退出应用并清库，外层随后清理另一库。
  await isolatedDatabase(async old => {
    await isolatedDatabase(async current => {
      expect(current.connectionId).not.toBe(old.connectionId); expect(current.database).not.toBe(old.database);
      await fixtures(old, current); const targets = await seedFavorites(old); await observeAndDelayResolve();
      try {
        let tabCount = 0;
        const cases = [
          { target: 0, active: false }, { target: 1, active: false },
          { target: 0, active: true }, { target: 1, active: true }, { target: 2, active: true }
        ];
        for (const [index, item] of cases.entries()) {
          const currentDatabase = await chooseCurrent(current), target = targets[item.target];
          const button = shelf().getByRole('button', { name: [/^打开对象：真实迟到表 ·/, /^打开对象：真实迟到定义 ·/, /^打开对象：真实不存在对象 ·/][item.target] });
          await hold(target); await button.click(); await nativeReply(item.target !== 2);
          await page.locator('.app-commandbar').getByRole('button', { name: '新建查询', exact: true }).click();
          await expect(queryForm()).toBeVisible();
          await expect(queryForm().getByLabel('数据库连接', { exact: true })).toHaveValue(current.connectionId);
          await expect(queryForm().getByLabel('默认数据库（可选）', { exact: true })).toHaveValue(current.database);
          // 正式建连与列库必须完成，不能用测试回包填充新查询表单。
          await expect(queryForm().getByLabel('默认数据库（可选）', { exact: true })).toHaveAttribute('placeholder', '选择或输入数据库名称', { timeout: 20000 });
          await expect(queryForm().getByRole('alert')).toHaveCount(0);
          let result = '';
          if (item.active) {
            await queryForm().getByRole('button', { name: '打开查询', exact: true }).click(); await expect(queryForm()).toBeHidden(); tabCount++;
            await executeSql(`SELECT note,DATABASE() AS intent_database,CONNECTION_ID() AS intent_session,'主动查询${index}' AS intent_marker FROM intent_current WHERE id=1`);
            result = await readRenderedResult(text => text.includes('当前真实查询结果') && text.includes(current.database) && text.includes('主动查询' + index));
          }
          const before = await savedTabs(tabCount); await release();
          // 等正式收藏入口finally释放，确认渲染端已处理旧回包，再检查新意图仍然完整。
          await expect(button).toBeEnabled(); await expect(currentDatabase).toHaveClass(/active/);
          expect(await savedTabs(tabCount)).toEqual(before); await expect(page.locator('.toast')).not.toContainText('原对象已删除');
          if (item.active) {
            await expect(page.getByRole('dialog')).toHaveCount(0);
            await expect(query().locator('.context-bar')).toContainText(current.connectionName);
            expect(await readRenderedResult(text => text.includes('主动查询' + index))).toBe(result);
          } else {
            await expect(page.getByRole('dialog')).toHaveCount(1); await expect(queryForm()).toBeVisible();
            await expect(queryForm().getByLabel('数据库连接', { exact: true })).toHaveValue(current.connectionId);
            await expect(queryForm().getByLabel('默认数据库（可选）', { exact: true })).toHaveValue(current.database);
            await queryForm().getByRole('button', { name: '取消', exact: true }).click(); await expect(queryForm()).toBeHidden();
          }
        }

        // 旧请求失效后新的真实表导航仍可成功；保留已有当前连接查询标签，不把它们替换掉。
        const beforeLatest = await savedTabs(tabCount);
        await shelf().getByRole('button', { name: /^打开对象：真实迟到表 ·/ }).click();
        const table = page.locator('.table-tab:visible'); await expect(table).toBeVisible();
        await expect(table.locator('.context-bar')).toContainText(old.connectionName); await expect(table.getByRole('grid')).toContainText('旧目标真实原值', { timeout: 20000 });
        await expect(table.locator('.error-box')).toHaveCount(0);
        const afterLatest = await savedTabs(tabCount + 1);
        expect(afterLatest.tabs.filter(tab => beforeLatest.tabs.some(previous => previous.id === tab.id))).toEqual(beforeLatest.tabs);

        // 最新真实过程链接读取原定义且保持只读，证明修复没有全局禁用导航或吞掉有效对象。
        await page.locator('.app-commandbar').getByRole('button', { name: '粘贴对象链接', exact: true }).click();
        const link = page.getByRole('dialog', { name: '粘贴对象链接', exact: true });
        await link.getByLabel('DBArk 对象链接', { exact: true }).fill(objectUri(targets[1]));
        await link.getByRole('button', { name: '打开链接', exact: true }).click(); await expect(link).toBeHidden();
        const definition = page.getByRole('dialog'); await expect(definition).toContainText('只读');
        await expect(definition.getByRole('button', { name: '取消', exact: true })).toBeEnabled({ timeout: 20000 });
        await expect(definition.locator('.monaco-editor .view-lines')).toContainText('PROCEDURE');
        await expect(definition.getByRole('button', { name: '执行 SQL', exact: true })).toHaveCount(0);
        await page.screenshot({ path: info.outputPath('query-intent-live-latest-definition.png') });
        await definition.getByRole('button', { name: '取消', exact: true }).click(); await expect(definition).toHaveCount(0);
        expect(await desktop.evaluate(() => (globalThis as ProbeRoot).__queryIntentLiveProbe?.resolves)).toBe(7);
        expect(pageErrors).toEqual([]);
      } finally {
        // 先释放任何在途原回包并还原处理器，再由内外两层帮助器退出及精确清理随机库。
        if (!closed) await desktop.evaluate(() => { const root = globalThis as ProbeRoot; root.__queryIntentLiveProbe?.restore(); delete root.__queryIntentLiveProbe; });
      }
    }, info);
  }, info);
});
