import { randomUUID } from 'node:crypto';
import { test as baseTest, type Locator } from '@playwright/test';
import type { DatabaseObject } from '../../src/shared/contracts';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { workbenchZh } from '../../src/renderer/locales/workbench.zh-CN';
import { databaseDropZh } from '../../src/renderer/locales/databaseDrop.zh-CN';
import { routineInvocationZh } from '../../src/renderer/locales/routineInvocation.zh-CN';
import { tableRenameZh } from '../../src/renderer/locales/tableRename.zh-CN';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_SIDEBAR_CONTEXT_MENU_TEST === '1';

// 默认和列表不加载桌面夹具；专项只允许虚构本地目标，不能继承任何实库连接环境。
if (enabled) {
  if (process.env.DBARK_INTEGRATION_ENABLED === '1' || ['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_TLS_CA'].some(key => process.env[key])) throw Error('对象树菜单专项必须与实库及凭据环境分离');
  register();
} else baseTest.skip('对象树紧凑布局与右键菜单专项默认关闭（未执行）', () => {});

type SummaryCall = { command: string; database?: string; released: boolean };
interface AuditSummary { calls: SummaryCall[]; prohibited: string[]; pending: number }
type Handler = (event: Electron.IpcMainInvokeEvent, payload: { command: string; input: Record<string, unknown> }) => Promise<unknown>;
interface MainAudit {
  summary(): AuditSummary;
  holdObjects(value: boolean): void;
  releaseObjects(objects: DatabaseObject[]): void;
  restore(): void;
}
type AuditRoot = typeof globalThis & { __sidebarMenuAcceptance?: MainAudit };

/** 专项只注册新用例；原桌面夹具负责每例正常退出与精确临时目录收尾。 */
function register(): void {
  const runtime = require('./desktop-fixture') as typeof import('./desktop-fixture');
  const { navigationMenuItem } = require('./navigation-menu') as typeof import('./navigation-menu');
  const { test, expect } = runtime;
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off', ownedDesktopLaunchGuard: {
    /** 前例保留后在分配下一应用之前停链，避免遗留窗口与新owner混用。 */
    assertCurrent() { if (halted) throw Error('对象树菜单前例已保留，不再启动新应用'); }
  } });
  // Playwright失败会重启worker；串行组使后续用例跨worker跳过，不再启动下一应用。
  test.describe.configure({ mode: 'serial', retries: 0 });

  const firstDatabase = 'sidebar_menu_alpha', secondDatabase = 'sidebar_menu_beta';
  const sameName = '同名对象', longName = '很长的对象名称_用于确认单行省略且右键菜单仍保持完整身份_1234567890';
  const fixtureObjects: DatabaseObject[] = [
    { kind: 'table', name: sameName }, { kind: 'view', name: sameName },
    { kind: 'procedure', name: '菜单过程' }, { kind: 'function', name: '菜单函数' },
    { kind: 'table', name: longName },
    ...Array.from({ length: 45 }, (_, index) => ({ kind: 'table' as const, name: '滚动表_' + String(index).padStart(2, '0') }))
  ];
  let connectionId = '', connectionName = '', halted = false;
  let originalTab: { id: string; kind: 'query'; title: string; connectionId: string; sql: string; databaseContext: { state: 'known'; database: null } };
  const menu = () => runtime.page.locator('.sidebar-context-menu[role="menu"]:not(.sidebar-context-child-menu)');
  const row = (kind: 'connection' | 'database' | DatabaseObject['kind'], database?: string, name?: string) => runtime.page.locator(`[data-sidebar-node=${JSON.stringify(JSON.stringify([connectionId, database ?? null, kind, name ?? null]))}]`);
  const connectionRow = () => row('connection');
  const databaseRow = (database = firstDatabase) => row('database', database);
  const objectRow = (kind: DatabaseObject['kind'], name = sameName) => row(kind, firstDatabase, name);
  const label = (target: Locator) => target.locator(':scope > .tree-label');

  /** 只取有界命令摘要；认证、完整SQL或React内部状态均不进入审计。 */
  async function audit(): Promise<AuditSummary> { return runtime.desktop.evaluate(() => (globalThis as AuditRoot).__sidebarMenuAcceptance!.summary()); }
  /** 右键必须走实际节点，菜单只存在一份且选中高亮留在准确目标。 */
  async function openMenu(target: Locator) {
    await target.scrollIntoViewIfNeeded(); await target.click({ button: 'right' });
    await expect(menu()).toBeVisible(); await expect(runtime.page.locator('.sidebar-context-menu')).toHaveCount(1);
    await expect(target).toHaveClass(/\bactive\b/);
    const identity = JSON.parse((await target.getAttribute('data-sidebar-node'))!) as [string, string | null, string, string | null];
    await expect(menu()).toHaveAttribute('aria-label', '对象树操作：' + (identity[3] ?? identity[1] ?? connectionName));
  }
  /** 旧标签、正文和历史来自正式持久化读口，不从菜单实现中反推成功。 */
  async function unchangedWorkspace() {
    const settings = await runtime.page.evaluate(() => window.dbark.invoke('settings.get', {}));
    expect(settings.tabs).toEqual([originalTab]); expect(settings.activeTabId).toBe(originalTab.id);
    await expect(runtime.page.locator('.query-tab:visible .monaco-editor .view-lines')).toContainText('原编辑草稿不执行');
    expect(await runtime.page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect((await audit()).prohibited).toEqual([]);
  }
  /** 左键展开仍使用生产逻辑；仅Main的回包是离线合成值。 */
  async function openTree() {
    await label(connectionRow()).click(); await expect(label(connectionRow())).toHaveAttribute('aria-expanded', 'true');
    await expect(databaseRow()).toBeVisible(); await label(databaseRow()).click();
    await expect(label(databaseRow())).toHaveAttribute('aria-expanded', 'true'); await expect(objectRow('table')).toBeVisible();
  }
  /** 偏好设置走正式界面，不能改DOM/CSS或直接写渲染层状态伪造窄侧栏。 */
  async function sidebarWidth(width: number) {
    await runtime.page.getByRole('button', { name: zh.app.text009, exact: true }).click();
    const form = runtime.page.getByRole('dialog');
    await form.getByLabel(zh.app.text022, { exact: true }).fill(String(width));
    await form.getByRole('button', { name: zh.common.done, exact: true }).click();
    await expect(runtime.page.locator('.sidebar-container')).toHaveCSS('width', width + 'px');
  }
  /** 检查实际盒模型，不把固定CSS字符串或预期行数当作渲染证据。 */
  async function geometry() {
    const facts = await runtime.page.locator('.sidebar .tree-row').evaluateAll(nodes => nodes.map(node => ({ height: node.getBoundingClientRect().height, scroll: node.scrollWidth, client: node.clientWidth })));
    expect(facts.length).toBeGreaterThan(10);
    for (const fact of facts) { expect(Math.abs(fact.height - 31)).toBeLessThanOrEqual(0.5); expect(fact.scroll).toBeLessThanOrEqual(fact.client + 1); }
    await expect(runtime.page.locator('.sidebar .row-actions')).toHaveCount(0);
    return facts;
  }

  test.beforeEach(async ({}, info) => {
    if (halted) throw Error('对象树菜单前例已保留，停止后续用例');
    const owned = runtime.ownedDesktopResources(info);
    // 在任何表单操作之前落盘原Main身份，后续失败保留的PID也必须可追溯。
    const actual = await owned.application.evaluate(({ app }) => ({ pid: process.pid, platform: process.platform, architecture: process.arch, version: app.getVersion(), packaged: app.isPackaged, appPath: app.getAppPath() }));
    runtime.ownedDesktopResources(info);
    await info.attach('对象树菜单原Main启动归属', { body: JSON.stringify({ actual, noRealDatabase: true, noSystemClipboard: true }, null, 2), contentType: 'application/json' });
    connectionName = '菜单离线验收 ' + randomUUID();
    await (await navigationMenuItem(runtime.page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, () => { runtime.ownedDesktopResources(info); })).click();
    const form = runtime.page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    for (const [name, value] of [[zh.connections.text006, connectionName], [zh.connections.text009, '127.0.0.1'], [zh.connections.text010, '1'], [zh.common.user, 'dbark_sidebar_menu']]) await form.getByLabel(name, { exact: true }).fill(value);
    await form.getByLabel(zh.connections.text016, { exact: true }).uncheck();
    await form.getByRole('button', { name: zh.connections.text036, exact: true }).click(); await expect(form).toBeHidden();
    const profiles = await runtime.page.evaluate(() => window.dbark.invoke('connections.list', {}));
    expect(profiles).toHaveLength(1); expect(profiles[0]).toMatchObject({ host: '127.0.0.1', port: 1, user: 'dbark_sidebar_menu', rememberPassword: false }); connectionId = profiles[0].id;
    originalTab = { id: 'sidebar-original-' + randomUUID(), kind: 'query', title: '原编辑草稿', connectionId, sql: '-- 原编辑草稿不执行\nSELECT 9007199254740993;', databaseContext: { state: 'known', database: null } };
    await runtime.page.evaluate(async tab => { const settings = await window.dbark.invoke('settings.get', {}); await window.dbark.invoke('settings.save', { ...settings, tabs: [tab], activeTabId: tab.id }); }, originalTab);
    await runtime.page.reload(); await expect(runtime.page.locator('.app-statusbar')).toBeVisible();
    await expect(runtime.page.locator('.query-tab:visible .monaco-editor')).toBeVisible();

    await runtime.desktop.evaluate(({ ipcMain, BrowserWindow }, input) => {
      const root = globalThis as AuditRoot;
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
      const original = handlers.get('dbark:request'), window = BrowserWindow.getAllWindows()[0], contents = window?.webContents, frame = contents?.mainFrame;
      if (root.__sidebarMenuAcceptance || !original || BrowserWindow.getAllWindows().length !== 1 || !frame) throw Error('菜单审计原Main或frame不唯一');
      const processId = frame.processId, frameToken = frame.frameToken;
      const calls: SummaryCall[] = [], prohibited: string[] = [], held: { call: SummaryCall; complete(value: unknown): void }[] = [];
      let hold = false;
      /** 原窗口/frame/处理器必须持续相同，不接受其它窗口借用合成回包。 */
      const check = () => { if (root.__sidebarMenuAcceptance !== state || handlers.get('dbark:request') !== wrapped || contents.isDestroyed() || contents.mainFrame !== frame || frame.processId !== processId || frame.frameToken !== frameToken) throw Error('菜单旁观归属已变化'); };
      const state: MainAudit = {
        summary() { check(); return { calls: calls.map(call => ({ ...call })), prohibited: [...prohibited], pending: held.length }; },
        holdObjects(value) { check(); hold = value; },
        releaseObjects(objects) { check(); hold = false; for (const item of held.splice(0)) { item.call.released = true; item.complete({ ok: true, result: objects }); } },
        restore() { check(); if (held.length) throw Error('菜单原目录回包仍在途，不能恢复端口'); handlers.set('dbark:request', original); delete root.__sidebarMenuAcceptance; }
      };
      const wrapped: Handler = async (event, payload) => {
        check(); if (event.sender !== contents || event.senderFrame !== frame) throw Error('菜单请求不是原frame');
        const command = payload.command;
        if (['connections.open', 'connections.close', 'metadata.databases', 'metadata.objects'].includes(command)) {
          if ((payload.input.id ?? payload.input.connectionId) !== input.id) throw Error('离线菜单端口拒绝其它连接');
          const response = await original(event, { command: 'connections.list', input: {} }) as { ok: boolean; result?: { id: string; host: string; port: number; user: string }[] };
          const profile = response.result?.find(value => value.id === input.id);
          if (!response.ok || !profile || profile.host !== '127.0.0.1' || profile.port !== 1 || profile.user !== 'dbark_sidebar_menu') throw Error('菜单端口只接受本例虚构loopback:1配置');
          if (calls.length >= 64) throw Error('菜单合成端口调用超出预算');
          const call: SummaryCall = { command, database: typeof payload.input.database === 'string' ? payload.input.database : undefined, released: true }; calls.push(call);
          if (command === 'connections.open') return { ok: true, result: { dialect: 'mysql', version: '8.4.11', connectionId: 74001 } };
          if (command === 'connections.close') return { ok: true, result: undefined };
          if (command === 'metadata.databases') return { ok: true, result: input.databases };
          if (!input.databases.includes(String(payload.input.database))) throw Error('菜单端口拒绝本例以外的数据库');
          if (hold) { call.released = false; return new Promise(complete => held.push({ call, complete })); }
          return { ok: true, result: input.objects };
        }
        // 主进程阻止任何SQL、表读取或结构路径；即使界面误触也不会访问真实数据库。
        if (command === 'connections.test' || command.startsWith('sessions.') || command.startsWith('metadata.') || command.startsWith('schema.') || command.startsWith('table.') || command.startsWith('routine.') || command.startsWith('query.') && !['query.completionState', 'query.sessionState'].includes(command)) {
          prohibited.push(command); return { ok: false, error: '本离线菜单专项禁止数据库执行路径' };
        }
        return original(event, payload);
      };
      root.__sidebarMenuAcceptance = state; handlers.set('dbark:request', wrapped);
    }, { id: connectionId, databases: [firstDatabase, secondDatabase, 'mysql'], objects: fixtureObjects });
  });

  test.afterEach(async ({}, info) => {
    if (info.status !== info.expectedStatus) { halted = true; runtime.retainOwnedDesktopResources(info); return; }
    try {
      const facts = await audit(); expect(facts.prohibited).toEqual([]); expect(facts.pending).toBe(0); expect(runtime.pageErrors).toEqual([]);
      const actual = await runtime.desktop.evaluate(({ app }) => ({ pid: process.pid, platform: process.platform, architecture: process.arch, version: app.getVersion(), packaged: app.isPackaged, appPath: app.getAppPath() }));
      await info.attach('对象树菜单原Main离线旁观', { body: JSON.stringify({ actual, ...facts, noRealDatabase: true, noSystemClipboard: true }, null, 2), contentType: 'application/json' });
      await runtime.desktop.evaluate(() => (globalThis as AuditRoot).__sidebarMenuAcceptance!.restore());
      await runtime.confirmOwnedDesktopExit(info); expect(runtime.ownedDesktopResources(info).closed).toBe(true);
      await info.attach('对象树菜单原应用正常退出', { body: JSON.stringify({ confirmed: true, mainPid: actual.pid }), contentType: 'application/json' });
    } catch (error) { halted = true; runtime.retainOwnedDesktopResources(info); throw error; }
  });

  test('右键同步准确节点但不展开、不连接、不打开标签，查询上下文沿正式新建入口验证', async ({}, info) => {
    const before = await audit(); await openMenu(connectionRow());
    await expect(label(connectionRow())).toHaveAttribute('aria-expanded', 'false'); expect((await audit()).calls).toEqual(before.calls);
    await runtime.page.keyboard.press('Escape'); await expect(connectionRow()).toHaveClass(/\bactive\b/); await unchangedWorkspace();
    await openTree(); const loaded = await audit();
    const expanded = await runtime.page.locator('.sidebar .tree-label[aria-expanded]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-expanded')));
    for (const target of [databaseRow(secondDatabase), objectRow('table'), objectRow('view'), objectRow('procedure', '菜单过程'), objectRow('function', '菜单函数')]) {
      await openMenu(target); await expect(runtime.page.locator('.sidebar .tree-row.active')).toHaveCount(1); expect((await audit()).calls).toEqual(loaded.calls);
      expect(await runtime.page.locator('.sidebar .tree-label[aria-expanded]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-expanded')))).toEqual(expanded);
      await runtime.page.keyboard.press('Escape'); await expect(target).toHaveClass(/\bactive\b/); await unchangedWorkspace();
    }
    await openMenu(databaseRow(secondDatabase)); await runtime.page.keyboard.press('Escape');
    await (await navigationMenuItem(runtime.page.locator('.navigation-toolbar'), { name: zh.common.newQuery, exact: true }, () => { runtime.ownedDesktopResources(info); })).click();
    const form = runtime.page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
    const connection = form.locator('select'), database = form.locator('input[list="query-databases"]');
    await expect(connection).toHaveCount(1); await expect(database).toHaveCount(1);
    await expect(connection).toHaveValue(connectionId);
    await expect(database).toHaveValue(secondDatabase);
    await form.getByRole('button', { name: zh.common.cancel, exact: true }).click(); await unchangedWorkspace();
  });

  test('31px单行在明暗主题及窄宽侧栏中不跳动，长名称和底部菜单完整可达', async ({}, info) => {
    await openTree(); const recorded: { width: number; theme: string; rowCount: number; bounds: { rect: Record<string, number>; width: number; height: number } }[] = [];
    for (const width of [180, 260, 420]) {
      await sidebarWidth(width);
      for (const theme of ['dark', 'light']) {
        await test.step(`真实布局与菜单：${width}px / ${theme}`, async () => {
          if (await runtime.page.locator('html').getAttribute('data-theme') !== theme) await runtime.page.getByRole('button', { name: '切换主题', exact: true }).click();
          await expect(runtime.page.locator('html')).toHaveAttribute('data-theme', theme);
          const before = await geometry(); const target = objectRow('table', longName); await target.scrollIntoViewIfNeeded(); await target.hover(); expect(await geometry()).toEqual(before);
          await expect(label(target)).toHaveAttribute('title', '表 · ' + longName);
          const clipped = await target.locator('.truncate').evaluate(node => ({ client: node.clientWidth, scroll: node.scrollWidth, textOverflow: getComputedStyle(node).textOverflow }));
          expect(clipped.scroll).toBeGreaterThan(clipped.client); expect(clipped.textOverflow).toBe('ellipsis');
          await openMenu(target); expect(await geometry()).toEqual(before);
          const bounds = await menu().evaluate(node => ({ rect: node.getBoundingClientRect().toJSON(), width: innerWidth, height: innerHeight }));
          expect(bounds.rect.x).toBeGreaterThanOrEqual(7); expect(bounds.rect.y).toBeGreaterThanOrEqual(7); expect(bounds.rect.right).toBeLessThanOrEqual(bounds.width - 7); expect(bounds.rect.bottom).toBeLessThanOrEqual(bounds.height - 7);
          await menu().getByRole('menuitem').last().scrollIntoViewIfNeeded(); await expect(menu().getByRole('menuitem').last()).toBeVisible();
          if (width === 180 && theme === 'dark' || width === 420 && theme === 'light') await runtime.page.screenshot({ path: info.outputPath(`对象树菜单-${width}-${theme}.png`) });
          recorded.push({ width, theme, rowCount: before.length, bounds }); await runtime.page.keyboard.press('Escape'); await expect(menu()).toHaveCount(0);
        });
      }
    }
    const bottom = objectRow('table', '滚动表_44');
    const position = await test.step('底部对象滚动、盒模型与实际点击命中', async () => {
      await expect(menu()).toHaveCount(0); await bottom.scrollIntoViewIfNeeded();
      const box = await bottom.boundingBox(); if (!box) throw Error('缺少底部对象真实盒模型');
      // 点击原行内部中线并离右缘24px，避开Mac原生覆盖式滚动条，不强制穿透遮挡。
      const point = { x: Math.max(1, Math.min(box.width - 1, box.width - 24)), y: Math.max(1, box.height / 2) };
      const hit = await bottom.evaluate((row, relative) => {
        const rect = row.getBoundingClientRect(), style = getComputedStyle(row);
        const client = { x: rect.x + parseFloat(style.borderLeftWidth) + relative.x, y: rect.y + parseFloat(style.borderTopWidth) + relative.y };
        const element = document.elementFromPoint(client.x, client.y);
        return { box: rect.toJSON(), relative, client, belongsToOriginalRow: !!element && row.contains(element), originalNode: row.getAttribute('data-sidebar-node'),
          hit: element ? { tag: element.tagName, className: element.getAttribute('class'), node: element.closest('[data-sidebar-node]')?.getAttribute('data-sidebar-node') ?? null } : null };
      }, point);
      await info.attach('底部对象右键点击点及命中归属', { body: JSON.stringify({ observedBox: box, ...hit }, null, 2), contentType: 'application/json' });
      expect(hit.belongsToOriginalRow).toBe(true); expect(hit.hit?.node).toBe(hit.originalNode); return point;
    });
    await test.step('底部对象真实右键、菜单边界与行高', async () => {
      await bottom.click({ button: 'right', position }); await expect(menu()).toBeVisible();
      const bottomBounds = await menu().evaluate(node => ({ rect: node.getBoundingClientRect().toJSON(), width: innerWidth, height: innerHeight }));
      expect(bottomBounds.rect.right).toBeLessThanOrEqual(bottomBounds.width - 7); expect(bottomBounds.rect.bottom).toBeLessThanOrEqual(bottomBounds.height - 7);
      recorded.push({ width: 420, theme: 'light', rowCount: (await geometry()).length, bounds: bottomBounds });
    });
    await test.step('底部菜单关闭、证据落盘与原编辑工作区保持', async () => {
      await runtime.page.keyboard.press('Escape'); await expect(menu()).toHaveCount(0);
      await info.attach('对象树菜单实际行高及边界', { body: JSON.stringify(recorded, null, 2), contentType: 'application/json' }); await unchangedWorkspace();
    });
  });

  test('菜单键盘、外部点击与树滚动关闭，目录回包变更永久撤销旧菜单', async ({}, info) => {
    await openTree(); const target = objectRow('table'); await label(target).focus(); await label(target).press('Shift+F10'); await expect(menu()).toBeVisible();
    const available = menu().locator('[role="menuitem"]:not(:disabled)');
    await runtime.page.keyboard.press('Home'); await expect(available.first()).toBeFocused();
    await runtime.page.keyboard.press('End'); await expect(available.last()).toBeFocused();
    await runtime.page.keyboard.press('ArrowDown'); await expect(available.first()).toBeFocused();
    await runtime.page.keyboard.press('ArrowDown'); await expect(available.nth(1)).toBeFocused();
    await runtime.page.keyboard.press('ArrowUp'); await expect(available.first()).toBeFocused();
    const structureGroup = menu().getByRole('menuitem', { name: '设计与结构', exact: true });
    await structureGroup.focus(); await structureGroup.press('ArrowRight');
    const childMenu = menu().locator('.sidebar-context-child-menu'); await expect(childMenu).toBeVisible();
    await runtime.page.keyboard.press('Home'); await expect(childMenu.getByRole('menuitem').first()).toBeFocused();
    await runtime.page.keyboard.press('End'); await expect(childMenu.getByRole('menuitem').last()).toBeFocused();
    await runtime.page.keyboard.press('ArrowLeft'); await expect(childMenu).toHaveCount(0); await expect(structureGroup).toBeFocused();
    await structureGroup.press('ArrowRight'); await expect(childMenu).toBeVisible();
    await runtime.page.keyboard.press('Escape'); await expect(childMenu).toHaveCount(0); await expect(structureGroup).toBeFocused();
    await runtime.page.keyboard.press('Escape'); await expect(menu()).toHaveCount(0); await expect(label(target)).toBeFocused();
    await label(target).press('ContextMenu'); await expect(menu()).toBeVisible(); await runtime.page.locator('.sidebar-heading > span').click(); await expect(menu()).toHaveCount(0);
    await openMenu(target); const scroll = await runtime.page.locator('.tree-scroll').boundingBox(); if (!scroll) throw Error('缺少真实树滚动区域');
    await runtime.page.mouse.move(scroll.x + 5, scroll.y + scroll.height / 2); await runtime.page.mouse.wheel(0, 300); await expect(menu()).toHaveCount(0);
    // 原窗口失焦及尺寸变化走Electron窗口API，不向DOM派发伪造事件。
    const focusOwner = runtime.ownedDesktopResources(info);
    /** CDP及原生焦点操作前后都核本例原应用，不能在失配后接续另一个窗口。 */
    async function focusStep<T>(operation: () => Promise<T>): Promise<T> {
      const before = runtime.ownedDesktopResources(info);
      if (before.application !== focusOwner.application || before.page !== focusOwner.page) throw Error('焦点专项原应用归属已变化');
      const value = await operation(), after = runtime.ownedDesktopResources(info);
      if (after.application !== focusOwner.application || after.page !== focusOwner.page) throw Error('焦点专项原应用归属已变化');
      return value;
    }
    const nativeWindow = await focusStep(() => focusOwner.application.browserWindow(focusOwner.page));
    const focusSession = await focusStep(() => focusOwner.page.context().newCDPSession(focusOwner.page));
    // 仅取消Playwright默认的焦点模拟；实际DOM失焦仍须由原生窗口焦点转换产生。
    await focusStep(() => focusSession.send('Emulation.setFocusEmulationEnabled', { enabled: false }));
    // CDP点击不证明系统焦点；先取得真实焦点，再用原窗口最小化产生可核验的失焦转换。
    await focusStep(() => focusOwner.application.evaluate(({ app }) => { if (process.platform === 'darwin') app.focus({ steal: true }); }));
    await focusStep(() => nativeWindow.evaluate(owner => owner.focus())); await expect.poll(() => focusStep(() => nativeWindow.evaluate(owner => owner.isFocused()))).toBe(true);
    await focusStep(() => openMenu(target)); expect(await focusStep(() => nativeWindow.evaluate(owner => owner.isFocused()))).toBe(true);
    await expect.poll(() => focusStep(() => focusOwner.page.evaluate(() => document.hasFocus()))).toBe(true);
    await focusStep(() => nativeWindow.evaluate(owner => owner.minimize())); await expect.poll(() => focusStep(() => nativeWindow.evaluate(owner => owner.isMinimized()))).toBe(true);
    // 同应用无parent空白窗口实际接管焦点；不用其它应用、产品桥或伪造DOM事件。
    const focusHelper = await focusStep(() => focusOwner.application.evaluateHandle(({ BrowserWindow }) => new BrowserWindow({
      show: false, width: 240, height: 120, title: 'DBArk焦点验收',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })));
    await focusStep(() => focusHelper.evaluate(helper => helper.loadURL('about:blank')));
    const helperFacts = await focusStep(() => focusHelper.evaluate(helper => ({ mainPid: process.pid, windowId: helper.id, rendererPid: helper.webContents.getOSProcessId(), parentId: helper.getParentWindow()?.id ?? null, url: helper.webContents.getURL() })));
    const originalWindowId = await focusStep(() => nativeWindow.evaluate(owner => owner.id));
    await focusStep(() => info.attach('对象树菜单原应用焦点辅助窗口归属', { body: JSON.stringify({ originalWindowId, ...helperFacts }, null, 2), contentType: 'application/json' }));
    expect(helperFacts.windowId).not.toBe(originalWindowId); expect(helperFacts.parentId).toBe(null); expect(helperFacts.url).toBe('about:blank'); expect(helperFacts.rendererPid).toBeGreaterThan(0);
    await focusStep(() => focusHelper.evaluate(helper => { helper.show(); helper.focus(); }));
    await expect.poll(() => focusStep(() => focusHelper.evaluate(helper => helper.isFocused()))).toBe(true);
    await expect.poll(() => focusStep(() => nativeWindow.evaluate(owner => owner.isFocused()))).toBe(false);
    await expect.poll(() => focusStep(() => focusOwner.page.evaluate(() => document.hasFocus()))).toBe(false);
    await focusStep(() => expect(menu()).toHaveCount(0));
    // 只有以上原断言全部通过才正常关闭辅助窗口；失败保留全部所属现场。
    const helperClosed = await focusStep(() => focusHelper.evaluate(helper => new Promise<boolean>(resolve => { helper.once('closed', () => resolve(helper.isDestroyed())); helper.close(); })));
    expect(helperClosed).toBe(true); expect(await focusStep(() => focusHelper.evaluate(helper => helper.isDestroyed()))).toBe(true);
    await focusStep(() => focusHelper.dispose());
    await focusStep(() => nativeWindow.evaluate(owner => owner.restore())); await expect.poll(() => focusStep(() => nativeWindow.evaluate(owner => owner.isMinimized()))).toBe(false);
    await focusStep(() => nativeWindow.evaluate(owner => owner.focus())); await expect.poll(() => focusStep(() => nativeWindow.evaluate(owner => owner.isFocused()))).toBe(true);
    await focusStep(() => focusSession.send('Emulation.setFocusEmulationEnabled', { enabled: true })); await focusStep(() => focusSession.detach());
    await focusStep(() => nativeWindow.dispose());
    await openMenu(target); const bounds = await runtime.desktop.evaluate(({ BrowserWindow }) => { const owner = BrowserWindow.getAllWindows()[0], previous = owner.getBounds(); owner.setBounds({ ...previous, width: previous.width + 16 }); return previous; });
    await expect(menu()).toHaveCount(0); await runtime.desktop.evaluate(({ BrowserWindow }, previous) => BrowserWindow.getAllWindows()[0].setBounds(previous), bounds);
    // fill不点击树外部；原对象被正式搜索移除时，菜单必须随节点卸载失效。
    await openMenu(target); const search = runtime.page.getByRole('textbox', { name: zh.sidebar.text003, exact: true });
    await search.fill('本例目录不存在的名称'); await expect(target).toHaveCount(0); await expect(menu()).toHaveCount(0); await search.fill(''); await expect(target).toBeVisible();
    await runtime.desktop.evaluate(() => (globalThis as AuditRoot).__sidebarMenuAcceptance!.holdObjects(true));
    await openMenu(databaseRow()); await menu().getByRole('menuitem', { name: zh.sidebar.text018, exact: true }).click();
    await expect(label(databaseRow())).toHaveAttribute('aria-busy', 'true'); await openMenu(databaseRow());
    await expect(menu().getByRole('menuitem', { name: zh.sidebar.text018, exact: true })).toBeDisabled();
    const old = await menu().getByRole('menuitem', { name: zh.sidebar.text016, exact: true }).elementHandle(); if (!old) throw Error('没有可捕获的旧菜单节点');
    await runtime.desktop.evaluate(() => (globalThis as AuditRoot).__sidebarMenuAcceptance!.releaseObjects([{ kind: 'table', name: '刷新后的唯一表' }]));
    await expect(menu()).toHaveCount(0); await expect(label(databaseRow())).toHaveAttribute('aria-busy', 'false');
    const settled = await audit(); expect(await old.evaluate(button => button.isConnected)).toBe(false);
    await old.evaluate(button => (button as HTMLButtonElement).click()); expect((await audit()).calls).toEqual(settled.calls);
    await unchangedWorkspace();
  });

  test('连接编辑命中原目标，系统库删除禁用，同名表视图收藏与例程菜单各自独立', async () => {
    await openTree(); await openMenu(databaseRow('mysql'));
    await expect(menu().getByRole('menuitem', { name: `${databaseDropZh.title} mysql`, exact: true })).toBeDisabled(); await runtime.page.keyboard.press('Escape');
    await openMenu(connectionRow()); const edit = menu().getByRole('menuitem', { name: formatText(zh.sidebar.text010, connectionName), exact: true });
    await edit.focus(); await edit.press('Enter');
    const form = runtime.page.getByRole('dialog', { name: zh.connections.text003, exact: true }); await expect(form.getByLabel(zh.connections.text006, { exact: true })).toHaveValue(connectionName);
    await expect(form.getByLabel(zh.connections.text009, { exact: true })).toHaveValue('127.0.0.1'); await expect(form.getByLabel(zh.connections.text010, { exact: true })).toHaveValue('1');
    await form.getByRole('button', { name: zh.common.cancel, exact: true }).click();
    await openMenu(objectRow('table')); await menu().getByRole('menuitem', { name: '设计与结构', exact: true }).click();
    await expect(menu().getByRole('menuitem', { name: `${tableRenameZh.title} ${sameName}`, exact: true })).toBeVisible();
    await menu().getByRole('menuitem', { name: workbenchZh.action(workbenchZh.add, sameName), exact: true }).click();
    await expect.poll(async () => (await runtime.page.evaluate(() => window.dbark.invoke('workbench.get', {}))).document.favorites.length).toBe(1);
    const favorites = (await runtime.page.evaluate(() => window.dbark.invoke('workbench.get', {}))).document.favorites;
    expect(favorites[0].target).toEqual({ connectionId, database: firstDatabase, kind: 'table', name: sameName });
    await openMenu(objectRow('view')); await expect(menu().getByRole('menuitem', { name: workbenchZh.action(workbenchZh.add, sameName), exact: true })).toBeVisible();
    await expect(menu().getByRole('menuitem', { name: `${tableRenameZh.title} ${sameName}`, exact: true })).toHaveCount(0); await runtime.page.keyboard.press('Escape');
    await openMenu(objectRow('table')); await expect(menu().getByRole('menuitem', { name: workbenchZh.action(workbenchZh.remove, sameName), exact: true })).toBeVisible(); await runtime.page.keyboard.press('Escape');
    for (const [kind, name] of [['procedure', '菜单过程'], ['function', '菜单函数']] as const) { await openMenu(objectRow(kind, name)); await expect(menu().getByRole('menuitem', { name: `${routineInvocationZh.entry} ${name}`, exact: true })).toBeVisible(); await runtime.page.keyboard.press('Escape'); }
    await unchangedWorkspace();
  });
}
