import { test, expect, type TestInfo } from '@playwright/test';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { editorIndentationZh as text } from '../../src/renderer/locales/editorIndentation.zh-CN';
import { editorIndentNativeActive, bindEditorIndentNativeEnvironment, bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import type { EditorIndentNativeRun, IndentNativeOwner } from './editor-indentation-native-owner';

const active = editorIndentNativeActive(process.env, process.argv);
const binding = active ? bindEditorIndentNativeEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform })) : undefined;
type Runtime = typeof import('./editor-indentation-native-runtime');
const runtime: Runtime | undefined = active ? require('./editor-indentation-native-runtime') as Runtime : undefined;
test.skip(!active, '默认关闭：Root审核后显式开启DBARK_EDITOR_INDENT_NATIVE_TEST=1且integration=0');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
const cases = new WeakMap<TestInfo, ReturnType<typeof bindEditorIndentNativeCase>>();
// 无论成功、失败或超时都消费原TestInfo权限；迟到Promise不得借同一环境继续领取资源。
test.afterEach(({}, info) => { cases.get(info)?.retain(); });
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const bottom = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
const top = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home';
const redo = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';

/** 官方公开API只做观察，沿已有原生caret基架在空白App/独立重启后启用，不替换产品模型。 */
async function observe(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  await run.step(owner, () => owner.page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; }));
  await run.step(owner, () => owner.page.reload());
  await run.step(owner, () => expect(owner.page.locator('.app-statusbar')).toBeVisible());
}
/** 当前Monaco公开getter与独立WeakMap身份；不调用模型、正文、Undo或选区写入API。 */
async function snapshots(run: EditorIndentNativeRun, owner: IndentNativeOwner, scope = '.query-tab', visible = true, observeAnimation = false) {
  return run.step(owner, () => owner.page.evaluate(({ scope, visible, observeAnimation }) => {
    type Api = typeof import('monaco-editor');
    const root = window as Window & { monaco?: Api; __indentObservation?: { ids: WeakMap<object, number>; next: number } };
    if (!root.monaco?.editor.getEditors) throw Error('原生缩进专项缺少官方Monaco观察API');
    const registry = root.__indentObservation ??= { ids: new WeakMap(), next: 0 };
    const id = (value: object) => { if (!registry.ids.has(value)) registry.ids.set(value, ++registry.next); return registry.ids.get(value)!; };
    return root.monaco.editor.getEditors().filter(editor => { const node = editor.getContainerDomNode(); return node.isConnected && node.closest(scope) && (!visible || node.getClientRects().length > 0 && getComputedStyle(node).visibility === 'visible'); }).map(editor => {
      const model = editor.getModel(); if (!model || model.isDisposed()) throw Error('原生缩进专项模型未知');
      if (observeAnimation && typeof editor.hasPendingScrollAnimation !== 'function') throw Error('原生缩进专项缺少公共滚动动画getter');
      const options = model.getOptions(), raw = editor.getRawOptions() as import('monaco-editor').editor.IEditorOptions & import('monaco-editor').editor.IGlobalEditorOptions;
      const pane = editor.getContainerDomNode().closest('.tab-pane'), paneIndex = pane ? Array.from(document.querySelectorAll('.tab-content .tab-pane')).indexOf(pane) : -1;
      return { editor: id(editor), model: id(model), paneIndex, value: model.getValue(), eol: model.getEOL(), version: model.getVersionId(), alternativeVersion: model.getAlternativeVersionId(), selections: editor.getSelections()?.map(selection => ({ startLineNumber: selection.startLineNumber, startColumn: selection.startColumn, endLineNumber: selection.endLineNumber, endColumn: selection.endColumn, positionLineNumber: selection.positionLineNumber, positionColumn: selection.positionColumn })), scrollTop: editor.getScrollTop(), scrollLeft: editor.getScrollLeft(), readOnly: raw.readOnly === true, tabSize: options.tabSize, indentSize: options.indentSize, insertSpaces: options.insertSpaces, detectIndentation: raw.detectIndentation, ...(observeAnimation ? { pendingAnimation: editor.hasPendingScrollAnimation() } : {}) };
    }).sort((a, b) => a.paneIndex - b.paneIndex || a.editor - b.editor);
  }, { scope, visible, observeAnimation }));
}
/** 只读原settings IPC；以主进程持久化观察防抖完成，不以DOM相似替代正文保存。 */
async function settings(run: EditorIndentNativeRun, owner: IndentNativeOwner) { return run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('settings.get', {}))); }
async function current(run: EditorIndentNativeRun, owner: IndentNativeOwner) { const values = await snapshots(run, owner); expect(values).toHaveLength(1); return values[0]; }
type ScrollPoint = Pick<Awaited<ReturnType<typeof current>>, 'editor' | 'model' | 'scrollTop' | 'scrollLeft'>;
type ScrollFrame = ScrollPoint & { pending: boolean; accepted: boolean };
const scrollProofs = new WeakMap<IndentNativeOwner, { stage: string; samples: number; pendingSamples: number; first?: ScrollFrame; last?: ScrollFrame }[]>();
/** 首次热更只接受连续两次无挂起且坐标一致的原子只读样本；保留首样本，不改写原期待。 */
async function settledCurrent(run: EditorIndentNativeRun, owner: IndentNativeOwner, stage: '首次四空格前' | '首次四空格后') {
  const proof: { stage: string; samples: number; pendingSamples: number; first?: ScrollFrame; last?: ScrollFrame } = { stage, samples: 0, pendingSamples: 0 };
  const proofs = scrollProofs.get(owner) ?? []; proofs.push(proof); scrollProofs.set(owner, proofs);
  const point = (value: ScrollPoint): ScrollPoint => ({ editor: value.editor, model: value.model, scrollTop: value.scrollTop, scrollLeft: value.scrollLeft });
  let target: string | undefined, previous: ScrollPoint | undefined, result: Awaited<ReturnType<typeof current>> | undefined, failed = false, failure: unknown;
  await expect.poll(async () => {
    try {
      proof.samples++; const values = await snapshots(run, owner, '.query-tab', true, true); expect(values).toHaveLength(1);
      const { pendingAnimation, ...sample } = values[0], key = JSON.stringify([sample.editor, sample.model, sample.paneIndex]); target ??= key;
      if (key !== target) throw Error('滚动等待的原编辑器或模型已变化');
      if (typeof pendingAnimation !== 'boolean') throw Error('没有取得公共滚动动画状态');
      const frame: ScrollFrame = { ...point(sample), pending: pendingAnimation, accepted: false }; proof.first ??= frame; proof.last = frame;
      if (pendingAnimation) { proof.pendingSamples++; previous = undefined; return false; }
      frame.accepted = !!previous && previous.scrollTop === sample.scrollTop && previous.scrollLeft === sample.scrollLeft; previous = point(sample);
      if (frame.accepted) result = sample; return frame.accepted;
    } catch (reason) { failed = true; failure = reason; return true; }
  }, { timeout: 5000, intervals: [20, 50, 100], message: '首次偏好切换的原编辑器须无挂起滚动动画且取样坐标一致' }).toBe(true);
  if (failed) throw failure; run.assert(owner);
  if (!result) throw Error('没有取得原编辑器的稳定滚动样本'); return result;
}
/** 当前活动查询仅通过真实键盘输入，测试不会注入store或调用execute。 */
async function write(run: EditorIndentNativeRun, owner: IndentNativeOwner, value: string) {
  const input = owner.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox');
  await run.step(owner, () => input.focus()); await run.step(owner, () => owner.page.keyboard.press(`${modifier}+A`)); await run.step(owner, () => owner.page.keyboard.insertText(value));
  await expect.poll(async () => { const state = await settings(run, owner); return state.tabs.find(tab => tab.id === state.activeTabId)?.sql?.replaceAll('\r\n', '\n'); }).toBe(value);
}
/** 先输入无缩进多行种子，再用真实键盘补原Tab，避免后续换行继承该Tab；期望正文始终预先固定。 */
async function seedOriginalTab(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const head = "SELECT '900719925474099312345', '🚢';\n", comment = '-- 原始Tab不能自动转换\n';
  const tail = Array.from({ length: 65 }, (_, index) => '-- 缩进滚动探针 ' + index).join('\n');
  const plain = head + comment + tail, expected = head + '\t' + comment + tail;
  await write(run, owner, plain);
  await run.step(owner, () => owner.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox').focus());
  await run.step(owner, () => owner.page.keyboard.press(top)); await run.step(owner, () => owner.page.keyboard.press('ArrowDown'));
  const before = await current(run, owner); expect(before.value.replaceAll('\r\n', '\n')).toBe(plain);
  expect(before.selections).toEqual([{ startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 1, positionLineNumber: 2, positionColumn: 1 }]);
  // 插入字面Tab而非Tab快捷键；后面没有换行输入，不触发多行缩进继承。
  await run.step(owner, () => owner.page.keyboard.insertText('\t'));
  await expect.poll(async () => { const state = await settings(run, owner); return state.tabs.find(tab => tab.id === state.activeTabId)?.sql?.replaceAll('\r\n', '\n'); }).toBe(expected);
  expect((await current(run, owner)).value.replaceAll('\r\n', '\n')).toBe(expected);
}
/** 真正新建查询表单保留原端口拒连；不伪造连接成功，不建立SQL会话。 */
async function newQuery(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const page = owner.page;
  await run.step(owner, () => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newQuery, exact: true }).click());
  const dialog = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
  await run.step(owner, () => expect(dialog.locator('.error-box')).toContainText(/ECONNREFUSED|连接被拒绝|拒绝连接/i, { timeout: 20000 }));
  await run.step(owner, () => dialog.getByRole('button', { name: zh.app.text053, exact: true }).click());
  await run.step(owner, () => expect(dialog).toBeHidden()); await run.step(owner, () => expect(page.locator('.query-tab:visible .monaco-editor').getByRole('textbox')).toBeEditable());
}
/** 创建无密码、无SSH的固定回环概要；连接测试按钮和所有执行按钮都不使用。 */
async function prepareQuery(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const page = owner.page;
  await run.step(owner, () => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click());
  const dialog = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
  for (const [name, value] of [[zh.connections.text006, '缩进原生离线'], [zh.connections.text009, '127.0.0.1'], [zh.connections.text010, '1'], [zh.common.user, 'offline'], [zh.connections.text011, ''], [zh.connections.text012, '']]) await run.step(owner, () => dialog.getByLabel(name, { exact: true }).fill(value));
  await run.step(owner, () => dialog.getByRole('checkbox', { name: zh.connections.text016, exact: true }).uncheck());
  await run.step(owner, () => dialog.getByRole('button', { name: zh.connections.text036, exact: true }).click());
  await run.step(owner, () => expect(dialog).toBeHidden()); await newQuery(run, owner);
}
/** 只有正式App入口可以更改偏好；等待存储与模型选项同时完成，不自动格式化。 */
async function preference(run: EditorIndentNativeRun, owner: IndentNativeOwner, width: number, spaces: boolean) {
  const page = owner.page; await run.step(owner, () => page.locator('.app-commandbar').getByRole('button', { name: text.entry, exact: true }).click());
  const dialog = page.getByRole('dialog', { name: text.title, exact: true });
  await run.step(owner, () => dialog.getByLabel(text.width, { exact: true }).fill(String(width))); await run.step(owner, () => dialog.getByLabel(text.style, { exact: true }).selectOption(spaces ? 'spaces' : 'tabs'));
  await run.step(owner, () => dialog.getByRole('button', { name: text.save, exact: true }).click()); await run.step(owner, () => expect(dialog).toBeHidden());
  await expect.poll(() => settings(run, owner).then(state => [state.editorTabSize, state.editorInsertSpaces])).toEqual([width, spaces]);
  await expect.poll(() => snapshots(run, owner, '.query-tab', false).then(values => values.map(value => [value.tabSize, value.indentSize, value.insertSpaces, value.detectIndentation]))).toEqual(Array((await snapshots(run, owner, '.query-tab', false)).length).fill([width, width, spaces, false]));
}
/** 模型身份/版本/正文、选区及滚动应逐项保持；只排除本次明确修改的四个选项。 */
function contentSnapshot(value: Awaited<ReturnType<typeof current>>) { const { tabSize: _tab, indentSize: _indent, insertSpaces: _spaces, detectIndentation: _detect, ...content } = value; return content; }
/** 内置片段提供现有只读SqlEditor，不写片段、不绕过产品模态门。 */
async function readonlyPreview(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const page = owner.page;
  await run.step(owner, () => page.locator('.query-tab:visible').getByRole('button', { name: zh.snippets.title, exact: true }).click());
  const dialog = page.getByRole('dialog', { name: zh.snippets.title, exact: true });
  await run.step(owner, () => dialog.getByRole('button', { name: formatText(zh.snippets.selectName, zh.snippets.selectColumns), exact: true }).click());
  await run.step(owner, () => expect(dialog.locator('.monaco-editor')).toBeVisible());
  const before = await snapshots(run, owner, '.snippet-details'); expect(before).toHaveLength(1); expect(before[0]).toMatchObject({ readOnly: true, tabSize: 8, indentSize: 8, insertSpaces: false, detectIndentation: false });
  await run.step(owner, () => dialog.locator('.monaco-editor').getByRole('textbox').focus()); await run.step(owner, () => page.keyboard.insertText('禁止修改只读预览'));
  expect((await snapshots(run, owner, '.snippet-details')).map(value => ({ editor: value.editor, model: value.model, value: value.value, version: value.version, readOnly: value.readOnly }))).toEqual(before.map(value => ({ editor: value.editor, model: value.model, value: value.value, version: value.version, readOnly: value.readOnly })));
  await run.step(owner, () => dialog.getByRole('button', { name: zh.common.close, exact: true }).click()); await run.step(owner, () => expect(dialog).toBeHidden());
}
/** 只读本地记录证明没有SQL执行、任务或保存查询，页面错误也必须为空。 */
async function noExecution(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const value = await run.step(owner, () => owner.page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}), queries: await window.dbark.invoke('queries.list', {}) })));
  expect(value).toEqual({ tasks: [], history: [], queries: [] }); expect(owner.errors).toEqual([]);
}

test('离线原生缩进：两种样式热更、真实Tab/Undo/选区、新模型与只读、SQLite及独立重启', async ({ trace, screenshot, video }, info: TestInfo) => {
  // 实际解析选项先于端口、目录或Electron，CLI/配置不能暗中恢复录制。
  expect(trace).toBe('off'); expect(screenshot).toBe('off'); expect(video).toBe('off');
  const scope = bindEditorIndentNativeCase(info, binding!, () => test.info()); cases.set(info, scope); scope.assertCurrent();
  const run = runtime!.createEditorIndentNativeRun(scope);
  try {
    const first = await run.launch(); await observe(run, first); await prepareQuery(run, first);
    await seedOriginalTab(run, first); expect(await current(run, first)).toMatchObject({ tabSize: 2, indentSize: 2, insertSpaces: true, detectIndentation: false, readOnly: false });
    await run.step(first, () => first.page.keyboard.press(bottom)); await run.step(first, () => first.page.keyboard.insertText('\n-- 增量撤销探针'));
    const appended = (await current(run, first)).value; await run.step(first, () => first.page.keyboard.press(`${modifier}+z`)); const undone = (await current(run, first)).value; expect(undone).not.toBe(appended); await run.step(first, () => first.page.keyboard.press(redo)); expect((await current(run, first)).value).toBe(appended);
    for (let index = 0; index < 4; index++) await run.step(first, () => first.page.keyboard.press('Shift+ArrowLeft'));
    const before = await settledCurrent(run, first, '首次四空格前'); expect(before.selections?.some(selection => selection.startColumn !== selection.endColumn)).toBe(true);
    await preference(run, first, 4, true); expect(contentSnapshot(await settledCurrent(run, first, '首次四空格后'))).toEqual(contentSnapshot(before));
    await run.step(first, () => first.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox').focus()); await run.step(first, () => first.page.keyboard.press(`${modifier}+z`)); expect((await current(run, first)).value).toBe(undone); await run.step(first, () => first.page.keyboard.press(redo)); expect((await current(run, first)).value).toBe(appended);
    await newQuery(run, first); await write(run, first, 'SELECT\n'); const fresh = await current(run, first); expect(fresh).toMatchObject({ tabSize: 4, indentSize: 4, insertSpaces: true, detectIndentation: false });
    await run.step(first, () => first.page.keyboard.press(bottom)); await run.step(first, () => first.page.keyboard.press('Tab')); expect((await current(run, first)).value).toBe(fresh.value + '    ');
    // 为第二种样式单独建立真实增量/历史和非空选区，不能用当前版本相同代替Undo历史证明。
    await run.step(first, () => first.page.keyboard.insertText('-- Tab样式撤销探针'));
    const tabAppended = (await current(run, first)).value; await run.step(first, () => first.page.keyboard.press(`${modifier}+z`)); const tabUndone = (await current(run, first)).value; expect(tabUndone).not.toBe(tabAppended); await run.step(first, () => first.page.keyboard.press(redo)); expect((await current(run, first)).value).toBe(tabAppended);
    for (let index = 0; index < 4; index++) await run.step(first, () => first.page.keyboard.press('Shift+ArrowLeft'));
    const tabSelection = await current(run, first); expect(tabSelection.selections?.some(selection => selection.startColumn !== selection.endColumn)).toBe(true);
    const beforeTabs = await snapshots(run, first, '.query-tab', false); expect(beforeTabs).toHaveLength(2); await preference(run, first, 8, false); expect((await snapshots(run, first, '.query-tab', false)).map(contentSnapshot)).toEqual(beforeTabs.map(contentSnapshot));
    expect(contentSnapshot(await current(run, first))).toEqual(contentSnapshot(tabSelection));
    await run.step(first, () => first.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox').focus()); await run.step(first, () => first.page.keyboard.press(`${modifier}+z`)); expect((await current(run, first)).value).toBe(tabUndone); await run.step(first, () => first.page.keyboard.press(redo)); expect((await current(run, first)).value).toBe(tabAppended);
    await write(run, first, 'SELECT\n'); const tabStart = await current(run, first); await run.step(first, () => first.page.keyboard.press(bottom)); await run.step(first, () => first.page.keyboard.press('Tab')); const tabText = (await current(run, first)).value; expect(tabText).toBe(tabStart.value + '\t');
    await readonlyPreview(run, first); await noExecution(run, first); await expect.poll(() => settings(run, first).then(value => value.tabs.find(tab => tab.id === value.activeTabId)?.sql)).toBe(tabText); const saved = await settings(run, first); expect(saved.tabs).toHaveLength(2); expect(saved.tabs[0].sql).toBe(appended);
    await run.close(first); const disk = await run.stopped(path => runtime!.readIndentNativeSettings(path, () => run.assert())); expect(disk.schema).toBe(8); expect(disk.settings).toMatchObject({ editorTabSize: 8, editorInsertSpaces: false, tabs: saved.tabs, activeTabId: saved.activeTabId });
    const second = await run.launch(); expect(second.application).not.toBe(first.application); await observe(run, second);
    expect(await settings(run, second)).toMatchObject({ editorTabSize: 8, editorInsertSpaces: false, tabs: saved.tabs, activeTabId: saved.activeTabId });
    const restarted = await snapshots(run, second, '.query-tab', false); expect(restarted).toHaveLength(2); expect(restarted.map(value => [value.tabSize, value.indentSize, value.insertSpaces, value.readOnly, value.detectIndentation])).toEqual([[8, 8, false, false, false], [8, 8, false, false, false]]); expect(restarted.map(value => value.value)).toEqual(saved.tabs.map(tab => tab.sql));
    await readonlyPreview(run, second); await noExecution(run, second); await run.close(second); await run.finish();
    await info.attach('缩进原生终态', { body: Buffer.from(JSON.stringify({ accepted: true, normalOwners: run.owners.map(owner => ({ confirmed: owner.confirmed, willQuit: owner.ready, closed: owner.closed, recordedPids: owner.ids.size, scrollObservations: scrollProofs.get(owner) ?? [] })), directoryRemoved: run.removed, sqliteChecked: true, systemClipboard: 0, sqlExecution: 0 })), contentType: 'application/json' });
  } catch (reason) {
    run.retained = true;
    try { await info.attach('缩进原生保留现场', { body: Buffer.from(JSON.stringify({ directory: run.path, owners: run.owners.map(owner => ({ confirmed: owner.confirmed, willQuit: owner.ready, closed: owner.closed, ids: [...owner.ids], sourceDiagnostics: owner.sourceDiagnostics ?? [], pageErrors: owner.pageErrors ?? [], scrollObservations: scrollProofs.get(owner) ?? [] })), automaticRetry: false, automaticForceStop: false, directoryRemoved: run.removed })), contentType: 'application/json' }); }
    catch (attachment) { throw new AggregateError([reason, attachment], '缩进用例失败且现场附录失败', { cause: reason }); }
    throw reason;
  }
});
