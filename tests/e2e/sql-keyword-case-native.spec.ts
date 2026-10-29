import { test, expect, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqlFormattingZh as text } from '../../src/renderer/locales/sqlFormatting.zh-CN';
import type { SqlKeywordCase } from '../../src/shared/sqlKeywordCase';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { sqlKeywordCaseNativeActive, bindSqlKeywordCaseNativeEnvironment } from './sql-keyword-case-native-gate';
import { compactSqlKeywordCaseNative, sqlKeywordCaseNativeSource } from '../helpers/sqlKeywordCaseNativeFixture';
import type { EditorIndentNativeRun, IndentNativeOwner } from './editor-indentation-native-owner';

const active = sqlKeywordCaseNativeActive(process.env, process.argv);
const binding = active ? bindSqlKeywordCaseNativeEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform })) : undefined;
const approval = active ? Object.freeze({ manifestPath: process.env.DBARK_SQL_KEYWORD_CASE_MANIFEST!, approvedHash: process.env.DBARK_SQL_KEYWORD_CASE_MANIFEST_SHA256! }) : undefined;
type Runtime = typeof import('./editor-indentation-native-runtime');
const runtime: Runtime | undefined = active ? require('./editor-indentation-native-runtime') as Runtime : undefined;
test.skip(!active, '默认关闭：仅Root批准DBARK_SQL_KEYWORD_CASE_NATIVE_TEST=1、integration=0及独立清单后运行');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
const cases = new WeakMap<TestInfo, ReturnType<typeof bindEditorIndentNativeCase>>();
// 继续复用原TestInfo和120秒墓碑，结束后迟到Promise不得再领取任何资源。
test.afterEach(({}, info) => { cases.get(info)?.retain(); });
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const redo = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';

/** 仅开启官方只读getter观察；不替换Monaco输入、动作、模型或应用store。 */
async function observe(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  await run.step(owner, () => owner.page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; }));
  await run.step(owner, () => owner.page.reload());
  await run.step(owner, () => expect(owner.page.locator('.app-statusbar')).toBeVisible());
}
/** 来自原Monaco实例的只读身份、正文与版本；隐藏标签也按实际pane顺序区分。 */
async function snapshots(run: EditorIndentNativeRun, owner: IndentNativeOwner, all = false) {
  return run.step(owner, () => owner.page.evaluate(all => {
    type Api = typeof import('monaco-editor');
    const root = window as Window & { monaco?: Api; __keywordCaseObservation?: { ids: WeakMap<object, number>; next: number } };
    if (!root.monaco?.editor.getEditors) throw Error('关键字原生专项缺少官方Monaco观察API');
    const registry = root.__keywordCaseObservation ??= { ids: new WeakMap(), next: 0 };
    const id = (value: object) => { if (!registry.ids.has(value)) registry.ids.set(value, ++registry.next); return registry.ids.get(value)!; };
    return root.monaco.editor.getEditors().filter(editor => { const node = editor.getContainerDomNode(); return node.isConnected && node.closest('.query-tab') && (all || node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden'); }).map(editor => {
      const model = editor.getModel(); if (!model || model.isDisposed()) throw Error('关键字原生模型未知');
      const pane = editor.getContainerDomNode().closest('.tab-pane');
      return { editor: id(editor), model: id(model), pane: Array.from(document.querySelectorAll('.tab-content .tab-pane')).indexOf(pane!), value: model.getValue(), eol: model.getEOL(), version: model.getVersionId(), alternativeVersion: model.getAlternativeVersionId() };
    }).sort((a, b) => a.pane - b.pane);
  }, all));
}
/** 当前活动Monaco必须唯一，不通过标题相似度猜模型归属。 */
async function current(run: EditorIndentNativeRun, owner: IndentNativeOwner) { const values = await snapshots(run, owner); expect(values).toHaveLength(1); return values[0]; }
/** 原IPC只读存储事实，不直接修改Zustand或Monaco。 */
async function settings(run: EditorIndentNativeRun, owner: IndentNativeOwner) { return run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('settings.get', {}))); }
/** 文本全部经真实Monaco键盘输入；格式化和Undo也使用实际键盘动作。 */
async function write(run: EditorIndentNativeRun, owner: IndentNativeOwner, value: string) {
  const input = owner.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox');
  await run.step(owner, () => input.focus()); await run.step(owner, () => owner.page.keyboard.press(`${modifier}+A`)); await run.step(owner, () => owner.page.keyboard.insertText(value));
  await expect.poll(() => current(run, owner).then(value => value.value)).toBe(value);
}
/** 新查询沿原回环拒连表单，只接收未建会话草稿，不伪造连接或执行SQL。 */
async function newQuery(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const page = owner.page; await run.step(owner, () => page.locator('.navigation-toolbar').getByRole('button', { name: zh.common.newQuery, exact: true }).click());
  const dialog = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
  await run.step(owner, () => expect(dialog.locator('.error-box')).toContainText(/ECONNREFUSED|连接被拒绝|拒绝连接/i, { timeout: 20000 }));
  await run.step(owner, () => dialog.getByRole('button', { name: zh.app.text053, exact: true }).click());
  await run.step(owner, () => expect(dialog).toBeHidden());
  await run.step(owner, () => expect(page.locator('.query-tab:visible .monaco-editor').getByRole('textbox')).toBeEditable());
}
/** 正式表单创建无密码无SSH概要；只在Root后续明确运行时触及固定离线端口。 */
async function prepareQuery(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const page = owner.page; await run.step(owner, () => page.locator('.navigation-toolbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click());
  const dialog = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
  for (const [name, value] of [[zh.connections.text006, '关键字原生离线'], [zh.connections.text009, '127.0.0.1'], [zh.connections.text010, '1'], [zh.common.user, 'offline'], [zh.connections.text011, ''], [zh.connections.text012, '']]) await run.step(owner, () => dialog.getByLabel(name, { exact: true }).fill(value));
  await run.step(owner, () => dialog.getByRole('checkbox', { name: zh.connections.text016, exact: true }).uncheck());
  await run.step(owner, () => dialog.getByRole('button', { name: zh.connections.text036, exact: true }).click());
  await run.step(owner, () => expect(dialog).toBeHidden()); await newQuery(run, owner);
}
/** 默认、草稿取消和显式保存均通过真实偏好面板；偏好变更本身不得编辑正文。 */
async function preference(run: EditorIndentNativeRun, owner: IndentNativeOwner, mode?: SqlKeywordCase) {
  const before = await snapshots(run, owner, true), page = owner.page;
  // 偏好按钮属于真实标题栏；命令栏只含查询、连接和编辑器入口。
  await run.step(owner, () => page.locator('.app-titlebar').getByRole('button', { name: zh.app.text009, exact: true }).click());
  const dialog = page.getByRole('dialog', { name: zh.app.text009, exact: true }), section = dialog.getByRole('region', { name: text.preferences, exact: true });
  if (mode) {
    await run.step(owner, () => section.getByLabel(text.keywordCase, { exact: true }).selectOption(mode));
    await run.step(owner, () => section.getByRole('button', { name: text.save, exact: true }).click());
    await run.step(owner, () => expect(section.getByRole('status')).toHaveText(text.saved));
  } else {
    await run.step(owner, () => expect(section.getByLabel(text.keywordCase, { exact: true })).toHaveValue('preserve'));
    await run.step(owner, () => section.getByLabel(text.keywordCase, { exact: true }).selectOption('upper'));
    await run.step(owner, () => section.getByRole('button', { name: text.cancelDraft, exact: true }).click());
    await run.step(owner, () => expect(section.getByLabel(text.keywordCase, { exact: true })).toHaveValue('preserve'));
  }
  await run.step(owner, () => dialog.getByRole('button', { name: zh.common.done, exact: true }).click()); await run.step(owner, () => expect(dialog).toBeHidden());
  expect(await snapshots(run, owner, true)).toEqual(before);
  const stored = (await settings(run, owner)).sqlKeywordCase;
  if (mode) expect(stored).toBe(mode); else expect(stored === undefined || stored === 'preserve').toBe(true);
}
/** 原Monaco快捷键触发真实产品格式化，不调用runAction、模型setter或模拟点击。 */
async function formatShortcut(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  await run.step(owner, () => owner.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox').focus());
  await run.step(owner, () => owner.page.keyboard.press('Alt+Shift+F'));
}
/** 独立固定token预期及一次Undo/Redo，证明正文和同一模型历史而非只看选项值。 */
async function formatAndUndo(run: EditorIndentNativeRun, owner: IndentNativeOwner, mode: SqlKeywordCase) {
  const before = await current(run, owner); await formatShortcut(run, owner);
  await expect.poll(() => current(run, owner).then(value => compactSqlKeywordCaseNative(value.value))).toBe(compactSqlKeywordCaseNative(sqlKeywordCaseNativeSource(mode)));
  const after = await current(run, owner); expect(after.value).not.toBe(before.value); expect([after.editor, after.model, after.eol]).toEqual([before.editor, before.model, before.eol]);
  await run.step(owner, () => owner.page.keyboard.press(`${modifier}+z`)); await expect.poll(() => current(run, owner).then(value => value.value)).toBe(before.value);
  await run.step(owner, () => owner.page.keyboard.press(redo)); await expect.poll(() => current(run, owner).then(value => value.value)).toBe(after.value);
}

/** 重启后同时核持久化活动ID及实际唯一可见pane，不先点击标签修复错误恢复状态。 */
async function assertRestoredWorkspace(run: EditorIndentNativeRun, owner: IndentNativeOwner, saved: Awaited<ReturnType<typeof settings>>, savedModels: Awaited<ReturnType<typeof snapshots>>, mode: SqlKeywordCase) {
  const actual = await settings(run, owner);
  expect(actual.sqlKeywordCase).toBe(mode); expect(actual.tabs).toEqual(saved.tabs); expect(actual.activeTabId).toBe(saved.activeTabId);
  const paneIndex = saved.tabs.findIndex(tab => tab.id === saved.activeTabId); expect(paneIndex).toBeGreaterThanOrEqual(0);
  const restored = await snapshots(run, owner, true); expect(restored).toHaveLength(saved.tabs.length);
  expect(restored.map(value => value.pane)).toEqual(saved.tabs.map((_tab, index) => index));
  expect(restored.map(value => value.value)).toEqual(savedModels.map(value => value.value));
  const visible = await current(run, owner); expect(visible.pane).toBe(paneIndex); expect(visible).toEqual(restored[paneIndex]);
  return { activeTabId: actual.activeTabId, paneIndex, editor: visible.editor, model: visible.model };
}

/** 扣留真实file模块请求的原callback，不替换响应、store、格式化器或编辑动作。 */
async function installKeywordCaseModuleGate(run: EditorIndentNativeRun, owner: IndentNativeOwner, nonce: string) {
  return run.step(owner, () => owner.application.evaluate(({ BrowserWindow }, nonce) => {
    type State = { nonce: string; summary(): { held: number; delivered: number; detached: boolean; failed: boolean }; release(): void; detach(): { held: number; delivered: number; detached: boolean; failed: boolean } };
    const root = globalThis as typeof globalThis & { __keywordCaseModuleGate?: State };
    if (root.__keywordCaseModuleGate) throw Error('原模块门仍存在，不得覆盖');
    const windows = BrowserWindow.getAllWindows(); if (windows.length !== 1) throw Error('原模块门窗口归属未知');
    const window = windows[0], contents = window.webContents, session = contents.session;
    let held = 0, delivered = 0, detached = false, failed = false, callback: ((value: { cancel: boolean }) => void) | undefined;
    const assert = () => { if (root.__keywordCaseModuleGate !== state || window.isDestroyed() || contents.isDestroyed() || window.webContents !== contents || contents.session !== session) throw Error('原模块门归属已失效'); };
    const state: State = { nonce, summary: () => { assert(); return { held, delivered, detached, failed }; }, release() { assert(); if (failed || held !== 1 || delivered || !callback) throw Error('没有唯一原模块回包'); const original = callback; callback = undefined; delivered++; original({ cancel: false }); }, detach() { assert(); if (failed || callback || held !== 1 || delivered !== 1) throw Error('原模块门失败或回包未闭合，保留门及私有线索'); session.webRequest.onBeforeRequest(null); detached = true; const result = state.summary(); delete root.__keywordCaseModuleGate; return result; } };
    root.__keywordCaseModuleGate = state;
    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, next) => {
      const url = new URL(details.url);
      if (details.webContentsId !== contents.id || url.protocol !== 'file:' || !/\/sqlFormattingRoles-[A-Za-z0-9_-]+\.js$/.test(url.pathname)) { next({}); return; }
      // 异步拦截器失去归属时取消该回包并永久失败，不向Main事件循环抛出异常。
      try { assert(); } catch { failed = true; next({ cancel: true }); return; }
      if (held) { failed = true; next({ cancel: true }); return; }
      held++; callback = next;
    });
    return state.summary();
  }, nonce));
}
/** 所有门操作只指向同一主进程私有nonce；失效后不借下一owner释放回包。 */
async function keywordCaseModuleGate(run: EditorIndentNativeRun, owner: IndentNativeOwner, nonce: string, action: 'summary' | 'release' | 'detach') {
  return run.step(owner, () => owner.application.evaluate((_electron, { nonce, action }) => {
    const root = globalThis as typeof globalThis & { __keywordCaseModuleGate?: { nonce: string; summary(): { held: number; delivered: number; detached: boolean; failed: boolean }; release(): void; detach(): { held: number; delivered: number; detached: boolean; failed: boolean } } };
    const gate = root.__keywordCaseModuleGate; if (!gate || gate.nonce !== nonce) throw Error('原模块门nonce不匹配');
    if (action === 'detach') return gate.detach(); if (action === 'release') gate.release(); return gate.summary();
  }, { nonce, action }));
}

for (const restoredCase of ['upper', 'lower'] as const) test(`离线原生关键字${restoredCase}：默认/两种大小写、单Undo、迟到撤销、SQLite9及独立重启`, async ({ trace, screenshot, video }, info: TestInfo) => {
  expect(trace).toBe('off'); expect(screenshot).toBe('off'); expect(video).toBe('off');
  const scope = bindEditorIndentNativeCase(info, binding!, () => test.info()); cases.set(info, scope); scope.assertCurrent();
  const run = runtime!.createEditorIndentNativeRun(scope, approval!);
  try {
    const first = await run.launch(); await observe(run, first); await prepareQuery(run, first);
    await write(run, first, sqlKeywordCaseNativeSource()); await preference(run, first); await formatAndUndo(run, first, 'preserve');
    await write(run, first, sqlKeywordCaseNativeSource()); await newQuery(run, first); await write(run, first, sqlKeywordCaseNativeSource());
    const tabs = first.page.locator('.tab-strip .workspace-tab-button .tab-select'); await run.step(first, () => expect(tabs).toHaveCount(2)); await run.step(first, () => tabs.nth(0).click());
    await preference(run, first, restoredCase); const beforeLate = await snapshots(run, first, true), nonce = randomUUID();
    expect(await installKeywordCaseModuleGate(run, first, nonce)).toEqual({ held: 0, delivered: 0, detached: false, failed: false }); await formatShortcut(run, first);
    await expect.poll(() => keywordCaseModuleGate(run, first, nonce, 'summary').then(value => value.held)).toBe(1);
    expect(await keywordCaseModuleGate(run, first, nonce, 'summary')).toEqual({ held: 1, delivered: 0, detached: false, failed: false });
    expect(await snapshots(run, first, true)).toEqual(beforeLate);
    await run.step(first, () => tabs.nth(1).click()); await run.step(first, () => tabs.nth(0).click());
    expect(await snapshots(run, first, true)).toEqual(beforeLate); await keywordCaseModuleGate(run, first, nonce, 'release');
    await run.step(first, () => expect(first.page.locator('.query-tab:visible .error-box')).toContainText(text.unavailable));
    expect(await snapshots(run, first, true)).toEqual(beforeLate);
    const lateWitness = await keywordCaseModuleGate(run, first, nonce, 'detach'); expect(lateWitness).toEqual({ held: 1, delivered: 1, detached: true, failed: false });
    await formatAndUndo(run, first, restoredCase);
    const opposite = restoredCase === 'upper' ? 'lower' : 'upper'; await preference(run, first, opposite); await formatAndUndo(run, first, opposite);
    await preference(run, first, restoredCase); await formatAndUndo(run, first, restoredCase);
    expect((await snapshots(run, first, true))[1]).toEqual(beforeLate[1]);
    // 等原防抖保存自然完成再取磁盘对照，不用测试代码主动flush或修改store。
    const savedModels = await snapshots(run, first, true);
    await expect.poll(() => settings(run, first).then(value => value.tabs.map(tab => tab.sql))).toEqual(savedModels.map(value => value.value));
    const saved = await settings(run, first); expect(saved.activeTabId).toBe(saved.tabs[0].id); await run.close(first);
    const disk = await run.stopped(path => runtime!.readIndentNativeSettings(path, () => run.assert())); expect(disk.schema).toBe(9); expect(disk.settings.sqlKeywordCase).toBe(restoredCase); expect(disk.settings.tabs).toEqual(saved.tabs); expect(disk.settings.activeTabId).toBe(saved.activeTabId);
    const second = await run.launch(); await observe(run, second);
    const restartWitness = await assertRestoredWorkspace(run, second, saved, savedModels, restoredCase);
    await write(run, second, sqlKeywordCaseNativeSource()); await formatAndUndo(run, second, restoredCase);
    expect(await run.step(second, () => second.page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]); expect(await run.step(second, () => second.page.evaluate(() => window.dbark.invoke('tasks.list', {})))).toEqual([]);
    await run.close(second); await run.finish(); expect(run.removed).toBe(true);
    await info.attach('关键字原生终态', { body: Buffer.from(JSON.stringify({ accepted: true, restoredCase, schema: 9, restart: restartWitness, owners: run.owners.map(owner => ({ confirmed: owner.confirmed, willQuit: owner.ready, closed: owner.closed, recordedPids: owner.ids.size })), lateModule: { ...lateWitness, contextRoundTrip: true }, directoryRemoved: run.removed, systemClipboard: 0, sqlExecution: 0 })), contentType: 'application/json' });
  } catch (reason) {
    run.retained = true;
    try { await info.attach('关键字原生保留现场', { body: Buffer.from(JSON.stringify({ directory: run.path, owners: run.owners.map(owner => ({ confirmed: owner.confirmed, willQuit: owner.ready, closed: owner.closed, ids: [...owner.ids] })), automaticRetry: false, automaticForceStop: false, directoryRemoved: run.removed })), contentType: 'application/json' }); }
    catch (attachment) { throw new AggregateError([reason, attachment], '关键字用例失败且现场附录失败', { cause: reason }); }
    throw reason;
  }
});
