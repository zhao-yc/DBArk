import type { Locator } from '@playwright/test';
import { test, expect, desktop, page, pageErrors, closed } from './desktop-fixture';
import type { LiveContext } from './live-helpers';

// 两个开关均需显式启用；默认跳过早于桌面夹具，且不加载可能读取本地凭据的实库帮助器。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_PLAN_STATE_LIVE === '1';
test.skip(!enabled, '默认严格跳过：需统筹核对200隔离连接、取得GUI时段并显式启用计划状态实库验收');
test.use({ trace: 'off' });

const query = () => page.locator('.query-tab:visible');
const plan = () => query().getByRole('region', { name: '可视化执行计划', exact: true });
const saveDialog = () => page.getByRole('dialog', { name: '保存查询', exact: true });
type SaveCommand = 'queries.create' | 'queries.updateSource';
type Counts = { execute: number; explain: number };
type Gate = { command: SaveCommand; claimed: boolean; arrived: boolean; ok?: boolean; wait: Promise<void>; release(): void };
type Probe = { counts: Counts; gate?: Gate; restore(): void };
type ProbeRoot = typeof globalThis & { __planStateLiveProbe?: Probe };

/** 旁观实际查询次数；只在真实保存处理完成后延迟交付，不生成结果、不改变CAS或保存逻辑。 */
async function observeAndDelaySaves() {
  await desktop.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: { command: string; input: unknown }) => Promise<unknown>;
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers.get('dbark:request'); if (!original) throw Error('缺少真实IPC请求处理器');
    const state: Probe = { counts: { execute: 0, explain: 0 }, restore: () => { state.gate?.release(); handlers.set('dbark:request', original); } };
    (globalThis as ProbeRoot).__planStateLiveProbe = state;
    handlers.set('dbark:request', async (event, payload) => {
      if (payload.command === 'query.execute') state.counts.execute++;
      if (payload.command === 'query.explain') state.counts.explain++;
      const gate = state.gate?.command === payload.command && !state.gate.claimed ? state.gate : undefined;
      if (gate) gate.claimed = true;
      const response = await original(event, payload);
      if (gate) {
        gate.ok = !!response && typeof response === 'object' && 'ok' in response && response.ok === true;
        gate.arrived = true;
        await gate.wait;
      }
      return response;
    });
  });
}

/** 仅返回命令计数，不读取或记录连接凭据、正文、计划原文或内部会话。 */
async function counts(): Promise<Counts> {
  return desktop.evaluate(() => {
    const probe = (globalThis as ProbeRoot).__planStateLiveProbe; if (!probe) throw Error('计划状态观察器未安装');
    return probe.counts;
  });
}

/** 保存完成前后都保持真实调用次数；忙碌是否保留UI由调用者在延迟窗口内另行断言。 */
async function saveHeld(action: '保存到原查询' | '另存为新查询', inspectBusy: () => Promise<void>, name?: string, ok = true) {
  const before = await counts();
  await query().getByRole('button', { name: '保存查询', exact: true }).click();
  if (name) await saveDialog().getByLabel('查询名称', { exact: true }).fill(name);
  await desktop.evaluate((_, command: SaveCommand) => {
    const probe = (globalThis as ProbeRoot).__planStateLiveProbe; if (!probe || probe.gate) throw Error('保存延迟门状态异常');
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    probe.gate = { command, claimed: false, arrived: false, wait, release };
  }, action === '另存为新查询' ? 'queries.create' : 'queries.updateSource');
  try {
    await saveDialog().getByRole('button', { name: action, exact: true }).click();
    await expect.poll(() => desktop.evaluate(() => {
      const gate = (globalThis as ProbeRoot).__planStateLiveProbe?.gate;
      return { arrived: gate?.arrived ?? false, ok: gate?.ok };
    }), { timeout: 20000, message: '等待原保存处理器真实结果，保持渲染端繁忙' }).toEqual({ arrived: true, ok });
    await expect(saveDialog().getByRole('button', { name: action, exact: true })).toBeDisabled();
    await expect(query().getByRole('button', { name: '执行全部', exact: true })).toBeDisabled();
    await expect(plan().getByRole('button', { name: '获取文本计划', exact: true })).toBeDisabled();
    await inspectBusy(); expect(await counts()).toEqual(before);
  } finally {
    await desktop.evaluate(() => {
      const probe = (globalThis as ProbeRoot).__planStateLiveProbe; probe?.gate?.release(); if (probe) probe.gate = undefined;
    });
  }
  if (ok) await expect(saveDialog()).toBeHidden();
  else await expect(saveDialog().getByRole('alert')).toContainText('原查询已修改');
  await expect(query().getByRole('button', { name: '执行全部', exact: true })).toBeEnabled();
  expect(await counts()).toEqual(before);
}

/** 外部观察连接只创建三行小表，标识严格限定为现有帮助器生成的本例随机库。 */
async function fixtures(context: LiveContext) {
  if (!/^dbark_e2e_[a-z0-9_]+$/.test(context.database)) throw Error('拒绝在非本例随机隔离库建表');
  const table = `\`${context.database}\`.plan_state_subject`;
  await context.observer.query(`CREATE TABLE ${table}(id INT PRIMARY KEY,peer_id INT,note VARCHAR(40)) ENGINE=InnoDB`);
  await context.observer.query(`INSERT INTO ${table} VALUES(1,2,'计划甲'),(2,3,'计划乙'),(3,1,'计划丙')`);
}

/** 用实际ARIA状态核对非默认选中节点和收起状态，不读取React内部状态。 */
async function retainedNode(node: Locator) {
  await expect(plan().getByRole('button', { name: '树形计划', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(node).toHaveAttribute('aria-selected', 'true'); await expect(node).toHaveAttribute('aria-expanded', 'false');
  await expect(plan().getByRole('treeitem').first()).toHaveAttribute('aria-selected', 'false');
}

/** 按真实分页保存列表打开同源第二标签，只改变来源正文以触发真实CAS，不能伪造错误响应。 */
async function openSaved(name: string) {
  await page.locator('.app-commandbar').getByRole('button', { name: '历史与查询', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '历史与保存的查询', exact: true });
  await dialog.getByRole('button', { name: '保存的查询', exact: true }).click();
  const row = dialog.locator('.history-card').filter({ has: page.getByText(name, { exact: true }) });
  await expect(row).toHaveCount(1); await row.getByRole('button', { name: '在新标签打开', exact: true }).click();
  await expect(dialog).toBeHidden(); await expect(query().locator('.monaco-editor')).toBeVisible();
}

/** 来源断言读取正式本地IPC；所有创建、另存、更新和冲突都由真实UI提交。 */
async function records() { return page.evaluate(() => window.dbark.invoke('queries.list', {})); }

/** Monaco沿用平台换行；先核对实际完整草稿，再用原字节验证保存，不能假定Windows输入为LF。 */
async function capturedDraft(expected: string): Promise<string> {
  let actual='';
  await expect.poll(async()=>{const settings=await page.evaluate(()=>window.dbark.invoke('settings.get',{}));actual=settings.tabs.find(tab=>tab.id===settings.activeTabId)?.sql??'';return actual.replaceAll('\r\n','\n');}).toBe(expected.replaceAll('\r\n','\n'));
  return actual;
}

test('真实JSON计划经保存、原来源更新、另存及同源CAS冲突保留状态，新查询替换旧计划', async ({}, info) => {
  test.setTimeout(180000);
  const { isolatedDatabase, openDatabaseQuery, writeSql, executeSql, readRenderedResult } = await import('./live-helpers');
  await isolatedDatabase(async context => {
    await observeAndDelaySaves();
    try {
      await fixtures(context); await openDatabaseQuery(context.database);
      const source = 'SELECT a.id,a.note,b.note AS peer_note FROM plan_state_subject a JOIN plan_state_subject b ON b.id=a.peer_id WHERE a.id>=1';
      await writeSql(source); await query().getByRole('button', { name: '执行计划', exact: true }).click();
      await expect(query().getByRole('button', { name: '执行全部', exact: true })).toBeEnabled({ timeout: 20000 });
      await expect(query().locator('.error-box')).toHaveCount(0);
      await expect(plan().locator('.explain-toolbar')).toContainText('EXPLAIN FORMAT=JSON');
      expect(await counts()).toEqual({ execute: 0, explain: 1 });
      const node = plan().getByRole('treeitem').filter({ hasText: '查询块 · 1' });
      await expect(node).toHaveCount(1); await node.click(); await node.press('ArrowLeft'); await retainedNode(node);

      await saveHeld('另存为新查询', () => retainedNode(node), '计划状态原查询'); await retainedNode(node);
      const original = (await records()).find(record => record.name === '计划状态原查询')!;
      expect(original.sql).toBe(source);
      const updated = source + '\n-- 真实原来源更新'; await writeSql(updated);const updatedDraft=await capturedDraft(updated);
      await saveHeld('保存到原查询', () => retainedNode(node)); await retainedNode(node);
      expect((await records()).find(record => record.id === original.id)?.sql).toBe(updatedDraft);

      await plan().getByRole('button', { name: '原始输出', exact: true }).click();
      const raw = await plan().getByLabel('原始输出', { exact: true }).innerText();
      expect(JSON.parse(raw)).toHaveProperty('query_block');
      const retainedRaw = async () => {
        await expect(plan().getByRole('button', { name: '原始输出', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(plan().getByLabel('原始输出', { exact: true })).toHaveText(raw);
      };
      await saveHeld('另存为新查询', retainedRaw, '计划状态独立副本'); await retainedRaw();
      const copy = (await records()).find(record => record.name === '计划状态独立副本')!;
      expect(copy.id).not.toBe(original.id); expect(copy.sql).toBe(updatedDraft);
      expect((await records()).find(record => record.id === original.id)?.sql).toBe(updatedDraft);
      await plan().getByRole('button', { name: '树形计划', exact: true }).click(); await retainedNode(node);

      // 同源第二标签只保存不同正文；原标签仍持旧摘要，CAS错误必须来自正式处理器。
      const beforeOpen = await counts(); await openSaved('计划状态独立副本'); expect(await counts()).toEqual(beforeOpen);
      await expect(page.locator('.tab-strip .tab-select')).toHaveCount(2);
      const winner = source + '\n-- 同源第二标签先更新'; await writeSql(winner);const winnerDraft=await capturedDraft(winner);
      await query().getByRole('button', { name: '保存查询', exact: true }).click();
      await saveDialog().getByRole('button', { name: '保存到原查询', exact: true }).click(); await expect(saveDialog()).toBeHidden();
      expect((await records()).find(record => record.id === copy.id)?.sql).toBe(winnerDraft); expect(await counts()).toEqual(beforeOpen);
      await page.locator('.tab-strip .tab-select').first().click();
      await expect(page.locator('.tab-strip .workspace-tab-button.active .tab-select')).toHaveText('计划状态独立副本'); await retainedNode(node);
      const stale = source + '\n-- 陈旧草稿必须保留'; await writeSql(stale);
      await saveHeld('保存到原查询', () => retainedNode(node), undefined, false); await retainedNode(node);
      expect((await records()).find(record => record.id === copy.id)?.sql).toBe(winnerDraft);
      await expect(query().locator('.monaco-editor .view-lines')).toContainText('陈旧草稿必须保留');
      await saveDialog().getByRole('button', { name: '取消', exact: true }).click(); await expect(saveDialog()).toBeHidden();
      expect(await counts()).toEqual({ execute: 0, explain: 1 });
      await page.screenshot({ path: info.outputPath('plan-state-live-after-cas.png') });

      // 真正新执行仍走正式编辑器与SQL链路，不能把旧计划保留为缓存或用重新执行伪造恢复。
      await executeSql("SELECT '新查询已替换旧计划' AS plan_state_live_new");
      await expect(plan()).toHaveCount(0); await expect(query().getByRole('grid')).toBeVisible();
      expect(await readRenderedResult(text => text.includes('plan_state_live_new') && text.includes('新查询已替换旧计划'))).toContain('新查询已替换旧计划');
      expect(await counts()).toEqual({ execute: 1, explain: 1 }); expect(pageErrors).toEqual([]);
    } finally {
      // 先释放任何未交付的真实保存响应并恢复原处理器，再交回现有帮助器退出及精确清库。
      if (!closed) await desktop.evaluate(() => {
        const root = globalThis as ProbeRoot; root.__planStateLiveProbe?.restore(); delete root.__planStateLiveProbe;
      });
    }
  }, info);
});
