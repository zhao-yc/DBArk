import { test, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { queryFilesZh as text } from '../../src/renderer/locales/queryFiles.zh-CN';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { assertQueryFileNativeKeyApproval, bindQueryFileNativeEnvironment, queryFileNativeActive, queryFileNativeRecipe as recipe } from './query-file-native-gate';
import type { EditorIndentNativeRun, IndentNativeOwner } from './editor-indentation-native-owner';

const active = queryFileNativeActive(process.env, process.argv);
const binding = active ? bindQueryFileNativeEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform })) : undefined;
const approval = active ? Object.freeze({ manifestPath: process.env.DBARK_QUERY_FILE_MANIFEST!, approvedHash: process.env.DBARK_QUERY_FILE_MANIFEST_SHA256! }) : undefined;
type Runtime = typeof import('./editor-indentation-native-runtime');
type Fixture = typeof import('./query-file-native-fixture');
type Keys = typeof import('./query-file-native-key-bridge');
const runtime: Runtime | undefined = active ? require('./editor-indentation-native-runtime') as Runtime : undefined;
const native: Fixture | undefined = active ? require('./query-file-native-fixture') as Fixture : undefined;
const keys: Keys | undefined = active ? require('./query-file-native-key-bridge') as Keys : undefined;
type KeyBridge = Awaited<ReturnType<Keys['createQueryFileNativeKeyBridge']>>;
test.skip(!active, '默认关闭：Root批准独立编译manifest及fixture配方后才可开启DBARK_QUERY_FILE_NATIVE_TEST=1，integration=0');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
const cases = new WeakMap<TestInfo, ReturnType<typeof bindEditorIndentNativeCase>>();
// 用原TestInfo及原120秒期限；结束后留下墓碑，不另造launcher或超时权限。
test.afterEach(({}, info) => { cases.get(info)?.retain(); });
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/** 只读settings观察真实Main持久状态，不能注入store、模型或文件命令结果。 */
async function settings(run: EditorIndentNativeRun, owner: IndentNativeOwner) { return run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('settings.get', {}))); }
/** 仅启用官方Monaco观察API；原空白实例和独立重启实例各执行一次。 */
async function observe(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  await run.step(owner, () => owner.page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; }));
  await run.step(owner, () => owner.page.reload()); await run.step(owner, () => expect(owner.page.locator('.app-statusbar')).toBeVisible());
}
/** 编辑器和模型身份只用getter记录；隐藏原标签也从同一Monaco注册表观察。 */
async function editors(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  return run.step(owner, () => owner.page.evaluate(() => {
    const root = window as Window & { monaco?: typeof import('monaco-editor'); __queryFileObservation?: { ids: WeakMap<object, number>; next: number } };
    if (!root.monaco?.editor.getEditors) throw Error('文件专项缺少官方Monaco观察API');
    const registry = root.__queryFileObservation ??= { ids: new WeakMap(), next: 0 };
    const id = (value: object) => { if (!registry.ids.has(value)) registry.ids.set(value, ++registry.next); return registry.ids.get(value)!; };
    return root.monaco.editor.getEditors().filter(editor => editor.getContainerDomNode().isConnected && editor.getContainerDomNode().closest('.query-tab')).map(editor => {
      const node = editor.getContainerDomNode(), model = editor.getModel(), pane = node.closest('.tab-pane'); if (!model || model.isDisposed() || !pane) throw Error('文件专项原编辑器身份未知');
      return { editor: id(editor), model: id(model), value: model.getValue(), version: model.getVersionId(), eol: model.getEOL(), paneIndex: Array.from(document.querySelectorAll('.tab-content .tab-pane')).indexOf(pane), visible: node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden' };
    });
  }));
}
/** 全文期望来自固定配方，只统一已知CRLF观察表示，不trim或反推UI文本。 */
async function current(run: EditorIndentNativeRun, owner: IndentNativeOwner) { const values = (await editors(run, owner)).filter(value => value.visible); expect(values).toHaveLength(1); return values[0]; }
/** 复用既有离线连接表单与拒连后继续编辑，不点击测试连接，不建立SQL会话。 */
async function prepare(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const page = owner.page;
  await run.step(owner, () => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click());
  const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
  for (const [name, value] of [[zh.connections.text006, '文件原生离线'], [zh.connections.text009, '127.0.0.1'], [zh.connections.text010, '1'], [zh.common.user, 'offline'], [zh.connections.text011, ''], [zh.connections.text012, '']]) await run.step(owner, () => connection.getByLabel(name, { exact: true }).fill(value));
  await run.step(owner, () => connection.getByRole('checkbox', { name: zh.connections.text016, exact: true }).uncheck());
  await run.step(owner, () => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await run.step(owner, () => expect(connection).toBeHidden());
  await run.step(owner, () => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newQuery, exact: true }).click());
  const query = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
  await run.step(owner, () => expect(query.locator('.error-box')).toContainText(/ECONNREFUSED|连接被拒绝|拒绝连接/i, { timeout: 20000 }));
  await run.step(owner, () => query.getByRole('button', { name: zh.app.text053, exact: true }).click()); await run.step(owner, () => expect(query).toBeHidden());
}
/** 仅真实键盘输入；配方没有前导缩进，不使用剪贴板、setValue或executeEdits。 */
async function write(run: EditorIndentNativeRun, owner: IndentNativeOwner, value: string) {
  await run.step(owner, () => owner.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox').focus());
  await run.step(owner, () => owner.page.keyboard.press(`${modifier}+A`)); await run.step(owner, () => owner.page.keyboard.insertText(value));
  await expect.poll(() => current(run, owner).then(value => value.value.replaceAll('\r\n', '\n'))).toBe(value);
  await expect.poll(async () => { const value = await settings(run, owner); return value.tabs.find(tab => tab.id === value.activeTabId)?.sql?.replaceAll('\r\n', '\n'); }).toBe(value);
}
/** 选择实际renderer标签，settings只提供当前顺序与标识，不直接写activeTabId。 */
async function select(run: EditorIndentNativeRun, owner: IndentNativeOwner, id: string) {
  const value = await settings(run, owner), index = value.tabs.findIndex(tab => tab.id === id); expect(index).toBeGreaterThanOrEqual(0);
  await run.step(owner, () => owner.page.locator('.tab-strip .tab-select').nth(index).click()); await expect.poll(() => settings(run, owner).then(value => value.activeTabId)).toBe(id);
}
/** CtrlS必须推进真实来源修订且显示clean，不能借上一次toast或伪造文件返回值过关。 */
async function save(run: EditorIndentNativeRun, owner: IndentNativeOwner, id: string, bridge: KeyBridge, stage: 'saved' | 'draft' | 'restarted') {
  const before = (await settings(run, owner)).tabs.find(tab => tab.id === id)!; expect(before.fileSourceBinding).toBeDefined();
  await run.step(owner, () => bridge.request(owner, stage, id, before.fileSourceBinding!));
  await expect.poll(() => settings(run, owner).then(value => value.tabs.find(tab => tab.id === id)?.fileSourceBinding?.revision ?? 0)).toBeGreaterThan(before.fileSourceBinding!.revision);
  await run.step(owner, () => expect(owner.page.locator('.query-tab:visible').getByLabel(text.fileSource, { exact: true })).toContainText(text.clean));
}
/** 真实任务允许且仅允许文件任务；本地查询库与执行历史始终为空。 */
async function noExecution(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const value = await run.step(owner, () => owner.page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}), queries: await window.dbark.invoke('queries.list', {}) })));
  expect(value.history).toEqual([]); expect(value.queries).toEqual([]); expect(value.tasks.length).toBeGreaterThan(0); expect(value.tasks.every(task => /^queryFileSources\.(open|save)$/.test(task.kind) && task.status !== 'running')).toBe(true); expect(owner.errors).toEqual([]);
}
/** 让真实App被动effect提交clean，再以只读IPC顺序观察落盘，不篡改退出dirty门。 */
async function settled(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  await run.step(owner, () => owner.page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))));
  return settings(run, owner);
}

test('离线原生文件：关联编辑CtrlS、外改不覆盖、重读保留、SQLite9及独立重启恢复', async ({ trace, screenshot, video }, info: TestInfo) => {
  expect(trace).toBe('off'); expect(screenshot).toBe('off'); expect(video).toBe('off');
  const scope = bindEditorIndentNativeCase(info, binding!, () => test.info()); cases.set(info, scope); scope.assertCurrent();
  assertQueryFileNativeKeyApproval(process.env, process.platform); scope.assertCurrent();
  const run = runtime!.createEditorIndentNativeRun(scope, approval);
  let fixture: Awaited<ReturnType<Fixture['createQueryFileNativeFixture']>> | undefined;
  let bridge: KeyBridge | undefined;
  try {
    const first = await run.launch(); await observe(run, first); await prepare(run, first);
    bridge = await run.step(first, () => keys!.createQueryFileNativeKeyBridge(run, scope, info, () => test.info()));
    fixture = await run.step(first, () => native!.createQueryFileNativeFixture(run, () => run.assert(first)));
    const originalFile = await run.step(first, () => fixture!.verify('initial', () => run.assert(first), true));
    const restoreFirstDialog = await run.step(first, () => native!.installQueryFileNativeDialog(first, fixture!, () => run.assert(first), 1));
    await run.step(first, () => first.page.locator('.query-tab:visible').getByRole('button', { name: text.open, exact: true }).click());
    const opening = first.page.getByRole('dialog', { name: text.open, exact: true }); await run.step(first, () => opening.getByRole('button', { name: text.openAction, exact: true }).click()); await run.step(first, () => expect(opening).toBeHidden());
    await run.step(first, () => expect(first.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox')).toBeEditable());
    const opened = await settings(run, first), document = opened.tabs.find(tab => tab.fileSourceBinding)!; expect(document).toBeDefined(); expect(document.title).toBe(recipe.name); expect(document.sourceBinding).toBeUndefined();
    const selected = await current(run, first); expect(selected.value.replaceAll('\r\n', '\n')).toBe(recipe.initial);
    await run.step(first, () => expect(first.page.locator('.query-tab:visible').getByLabel(text.fileSource, { exact: true })).toContainText('UTF-8 / UTF-8 BOM / CRLF'));
    await write(run, first, recipe.saved); await save(run, first, document.id, bridge, 'saved'); const savedFile = await run.step(first, () => fixture!.verify('saved', () => run.assert(first)));
    await write(run, first, recipe.draft); const draft = await current(run, first); expect([draft.editor, draft.model]).toEqual([selected.editor, selected.model]);
    await run.step(first, () => expect(first.page.locator('.query-tab:visible').getByLabel(text.fileSource, { exact: true })).toContainText(text.dirty)); await run.step(first, () => fixture!.verify('saved', () => run.assert(first), true));
    const externalFile = await run.step(first, () => fixture!.external(() => run.assert(first)));
    const beforeConflict = (await settings(run, first)).tabs.find(tab => tab.id === document.id)!;
    await run.step(first, () => bridge!.request(first, 'external', document.id, beforeConflict.fileSourceBinding!)); const recovery = first.page.getByRole('dialog', { name: text.recovery, exact: true });
    await run.step(first, () => expect(recovery.locator('.error-box')).toContainText('原文件已被外部修改，请重读、另存或取消')); await run.step(first, () => expect(recovery).toContainText(text.wroteNo));
    expect(await run.step(first, () => fixture!.verify('external', () => run.assert(first), true))).toEqual(externalFile); expect(await current(run, first)).toEqual(draft);
    await run.step(first, () => recovery.getByRole('button', { name: text.reread, exact: true }).click()); await run.step(first, () => expect(recovery).toBeHidden());
    await run.step(first, () => expect(first.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox')).toBeEditable()); expect((await current(run, first)).value.replaceAll('\r\n', '\n')).toBe(recipe.external);
    const reread = await settings(run, first), copy = reread.tabs.find(tab => tab.id === reread.activeTabId)!; expect(copy.id).not.toBe(document.id); expect(copy.sourceBinding).toBeUndefined(); expect(copy.fileSourceBinding).toBeUndefined(); expect(copy.sql?.replaceAll('\r\n', '\n')).toBe(recipe.external);
    const original = reread.tabs.find(tab => tab.id === document.id)!; expect(original.sql?.replaceAll('\r\n', '\n')).toBe(recipe.draft); expect(original.fileSourceBinding!.id).toBe(document.fileSourceBinding!.id);
    const hidden = (await editors(run, first)).find(value => value.paneIndex === reread.tabs.findIndex(tab => tab.id === document.id)); expect(hidden).toEqual({ ...draft, visible: false });
    // 重读确认后明确保存原正文，使正常退出不需要替换退出确认框；上面的外改冲突未写事实已独立证明。
    await select(run, first, document.id); await save(run, first, document.id, bridge, 'draft'); expect((await current(run, first)).value).toBe(draft.value); await run.step(first, () => fixture!.verify('draft', () => run.assert(first)));
    const firstDialog = await run.step(first, restoreFirstDialog); await noExecution(run, first); const savedSettings = await settled(run, first); await run.step(first, () => bridge!.release(first)); await run.close(first);
    const disk = await run.stopped(path => native!.readQueryFileNativeDatabase(path, () => run.assert(), run)); expect(disk.schema).toBe(9); expect(disk.settings.tabs).toEqual(savedSettings.tabs); expect(disk.sources).toHaveLength(1); expect(disk.sources[0]).toMatchObject({ tabId: document.id, path: fixture.path, ref: savedSettings.tabs.find(tab => tab.id === document.id)!.fileSourceBinding, encoding: 'utf8', bom: 'utf8', eol: 'crlf' });
    const second = await run.launch(); expect(second.application).not.toBe(first.application); await observe(run, second);
    const restoreSecondDialog = await run.step(second, () => native!.installQueryFileNativeDialog(second, fixture!, () => run.assert(second), 0));
    expect((await settings(run, second)).tabs).toEqual(savedSettings.tabs); await select(run, second, document.id); await run.step(second, () => expect(second.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox')).toBeEditable()); expect((await current(run, second)).value).toBe(draft.value);
    await run.step(second, () => expect(second.page.locator('.query-tab:visible').getByLabel(text.fileSource, { exact: true })).toContainText(recipe.name));
    await write(run, second, recipe.restarted); await save(run, second, document.id, bridge, 'restarted'); const restartedFile = await run.step(second, () => fixture!.verify('restarted', () => run.assert(second)));
    const secondDialog = await run.step(second, restoreSecondDialog); await noExecution(run, second); const restartedSettings = await settled(run, second); await run.step(second, () => bridge!.release(second)); await run.close(second);
    const finalDisk = await run.stopped(path => native!.readQueryFileNativeDatabase(path, () => run.assert(), run)); expect(finalDisk.schema).toBe(9); expect(finalDisk.settings.tabs).toEqual(restartedSettings.tabs); expect(finalDisk.sources).toHaveLength(1); expect(finalDisk.sources[0].ref.id).toBe(disk.sources[0].ref.id); expect(finalDisk.sources[0].ref.revision).toBeGreaterThan(disk.sources[0].ref.revision);
    await run.stopped(path => bridge!.cleanup(path)); await run.stopped(path => fixture!.cleanup(path, () => run.assert())); await run.finish();
    await info.attach('文件原生终态', { body: Buffer.from(JSON.stringify({ accepted: true, schema: finalDisk.schema, originalFile, savedFile, externalFile, restartedFile, selection: [firstDialog, secondDialog], keyDiagnostics: bridge.diagnostics, keyBridgeRemoved: true, normalOwners: run.owners.map(owner => ({ confirmed: owner.confirmed, willQuit: owner.ready, closed: owner.closed, recordedPids: owner.ids.size })), fixtureRemoved: true, userdataRemoved: run.removed, sqlExecution: 0, systemClipboard: 0, osNativeSelectorProven: false })), contentType: 'application/json' });
  } catch (reason) {
    run.retained = true;
    try { await info.attach('文件原生保留现场', { body: Buffer.from(JSON.stringify({ directory: run.path, fixture: fixture?.path, keyDiagnostics: bridge?.diagnostics, owners: run.owners.map(owner => ({ confirmed: owner.confirmed, willQuit: owner.ready, closed: owner.closed, ids: [...owner.ids], sourceDiagnostics: owner.sourceDiagnostics ?? [] })), automaticRetry: false, automaticForceStop: false, userdataRemoved: run.removed, osNativeSelectorProven: false })), contentType: 'application/json' }); }
    catch (attachment) { throw new AggregateError([reason, attachment], '文件原生失败且现场附录失败', { cause: reason }); }
    throw reason;
  }
});
