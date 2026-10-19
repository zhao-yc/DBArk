import { test, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { queryLayoutZh as layoutText } from '../../src/renderer/locales/queryLayout.zh-CN';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { queryLayoutNativeActive, bindQueryLayoutNativeEnvironment } from './query-layout-native-gate';
import type { EditorIndentNativeRun, IndentNativeOwner } from './editor-indentation-native-owner';
import { readQueryLayoutNativeGeometry } from '../helpers/queryLayoutNativeGeometry';

const active = queryLayoutNativeActive(process.env, process.argv);
const binding = active ? bindQueryLayoutNativeEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform })) : undefined;
const approval = active ? Object.freeze({ manifestPath: process.env.DBARK_QUERY_LAYOUT_MANIFEST!, approvedHash: process.env.DBARK_QUERY_LAYOUT_MANIFEST_SHA256! }) : undefined;
type Runtime = typeof import('./editor-indentation-native-runtime');
const runtime: Runtime | undefined = active ? require('./editor-indentation-native-runtime') as Runtime : undefined;
test.skip(!active, '默认关闭：Root批准后才可开启DBARK_QUERY_LAYOUT_NATIVE_TEST=1，integration=0且旧缩进门关闭');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
const cases = new WeakMap<TestInfo, ReturnType<typeof bindEditorIndentNativeCase>>();
// 复用原TestInfo/原120秒期限；用例结束留下墓碑，迟到动作不得再次领取资源。
test.afterEach(({}, info) => { cases.get(info)?.retain(); });
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const bottom = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
const redo = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';

/** 官方公开API只做观察，沿已有原生caret基架在空白App/独立重启后启用，不替换产品模型。 */
async function observe(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  await run.step(owner, () => owner.page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; }));
  await run.step(owner, () => owner.page.reload());
  await run.step(owner, () => expect(owner.page.locator('.app-statusbar')).toBeVisible());
}
/** 当前Monaco公开getter与独立WeakMap身份；不调用模型、正文、Undo或选区写入API。 */
async function snapshots(run: EditorIndentNativeRun, owner: IndentNativeOwner, scope = '.query-tab', visible = true) {
  return run.step(owner, () => owner.page.evaluate(({ scope, visible }) => {
    type Api = typeof import('monaco-editor');
    const root = window as Window & { monaco?: Api; __layoutObservation?: { ids: WeakMap<object, number>; next: number } };
    if (!root.monaco?.editor.getEditors) throw Error('原生分栏专项缺少官方Monaco观察API');
    const registry = root.__layoutObservation ??= { ids: new WeakMap(), next: 0 };
    const id = (value: object) => { if (!registry.ids.has(value)) registry.ids.set(value, ++registry.next); return registry.ids.get(value)!; };
    return root.monaco.editor.getEditors().filter(editor => { const node = editor.getContainerDomNode(); return node.isConnected && node.closest(scope) && (!visible || node.getClientRects().length > 0 && getComputedStyle(node).visibility === 'visible'); }).map(editor => {
      const model = editor.getModel(); if (!model || model.isDisposed()) throw Error('原生分栏专项模型未知');
      const options = model.getOptions(), raw = editor.getRawOptions() as import('monaco-editor').editor.IEditorOptions & import('monaco-editor').editor.IGlobalEditorOptions;
      const pane = editor.getContainerDomNode().closest('.tab-pane'), paneIndex = pane ? Array.from(document.querySelectorAll('.tab-content .tab-pane')).indexOf(pane) : -1;
      return { editor: id(editor), model: id(model), paneIndex, value: model.getValue(), eol: model.getEOL(), version: model.getVersionId(), alternativeVersion: model.getAlternativeVersionId(), selections: editor.getSelections()?.map(selection => ({ startLineNumber: selection.startLineNumber, startColumn: selection.startColumn, endLineNumber: selection.endLineNumber, endColumn: selection.endColumn, positionLineNumber: selection.positionLineNumber, positionColumn: selection.positionColumn })), scrollTop: editor.getScrollTop(), scrollLeft: editor.getScrollLeft(), readOnly: raw.readOnly === true, tabSize: options.tabSize, indentSize: options.indentSize, insertSpaces: options.insertSpaces, detectIndentation: raw.detectIndentation };
    }).sort((a, b) => a.paneIndex - b.paneIndex || a.editor - b.editor);
  }, { scope, visible }));
}

/** 只读现有settings IPC，不注入store、不拦截或替换持久化方法。 */
async function settings(run: EditorIndentNativeRun, owner: IndentNativeOwner) { return run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('settings.get', {}))); }
/** 只比较内容和模型身份；分栏改变可视高度时滚动位置允许由真实布局调整。 */
function content(value: Awaited<ReturnType<typeof snapshots>>[number]) { const { scrollTop: _top, scrollLeft: _left, ...stable } = value; return stable; }
/** 活动编辑器只能有一个，隐藏标签观察始终由同一真实Monaco注册表给出。 */
async function current(run: EditorIndentNativeRun, owner: IndentNativeOwner) { const values = await snapshots(run, owner); expect(values).toHaveLength(1); return values[0]; }
/** 真正新建查询保留127.0.0.1:1原拒连表单；不伪造成功、连接测试或SQL会话。 */
async function newQuery(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const page = owner.page;
  await run.step(owner, () => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newQuery, exact: true }).click());
  const dialog = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
  await run.step(owner, () => expect(dialog.locator('.error-box')).toContainText(/ECONNREFUSED|连接被拒绝|拒绝连接/i, { timeout: 20000 }));
  await run.step(owner, () => dialog.getByRole('button', { name: zh.app.text053, exact: true }).click());
  await run.step(owner, () => expect(dialog).toBeHidden());
  await run.step(owner, () => expect(page.locator('.query-tab:visible .monaco-editor').getByRole('textbox')).toBeEditable());
}
/** 正式连接表单只填无秘密的固定回环概要；禁用SSH，不点击连接测试。 */
async function prepareQuery(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const page = owner.page;
  await run.step(owner, () => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click());
  const dialog = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
  for (const [name, value] of [[zh.connections.text006, '分栏原生离线'], [zh.connections.text009, '127.0.0.1'], [zh.connections.text010, '1'], [zh.common.user, 'offline'], [zh.connections.text011, ''], [zh.connections.text012, '']]) await run.step(owner, () => dialog.getByLabel(name, { exact: true }).fill(value));
  await run.step(owner, () => dialog.getByRole('checkbox', { name: zh.connections.text016, exact: true }).uncheck());
  await run.step(owner, () => dialog.getByRole('button', { name: zh.connections.text036, exact: true }).click());
  await run.step(owner, () => expect(dialog).toBeHidden()); await newQuery(run, owner);
}
/** 只使用真实键盘输入无前导缩进种子，不假定Monaco多行插入会去掉继承缩进。 */
async function seed(run: EditorIndentNativeRun, owner: IndentNativeOwner, label: string) {
  const value = [`SELECT '${label}';`, ...Array.from({ length: 45 }, (_, index) => `SELECT '${label} 行 ${index}';`)].join('\n');
  const input = owner.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox');
  await run.step(owner, () => input.focus()); await run.step(owner, () => owner.page.keyboard.press(`${modifier}+A`)); await run.step(owner, () => owner.page.keyboard.insertText(value));
  await expect.poll(() => current(run, owner).then(state => state.value.replaceAll('\r\n', '\n'))).toBe(value);
  await run.step(owner, () => owner.page.keyboard.press(bottom)); await run.step(owner, () => owner.page.keyboard.insertText(' /* 增量撤销探针 */'));
  const appended = (await current(run, owner)).value;
  await run.step(owner, () => owner.page.keyboard.press(`${modifier}+z`)); const undone = (await current(run, owner)).value; expect(undone).not.toBe(appended);
  await run.step(owner, () => owner.page.keyboard.press(redo)); expect((await current(run, owner)).value).toBe(appended);
  for (let index = 0; index < 4; index++) await run.step(owner, () => owner.page.keyboard.press('Shift+ArrowLeft'));
  const selected = await current(run, owner); expect(selected.selections?.some(value => value.startColumn !== value.endColumn || value.startLineNumber !== value.endLineNumber)).toBe(true);
  return { selected, appended, undone };
}
/** 正常布局后用真Undo/Redo验证原历史；不以相同版本号替代历史证据。 */
async function history(run: EditorIndentNativeRun, owner: IndentNativeOwner, original: Awaited<ReturnType<typeof seed>>) {
  await run.step(owner, () => owner.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox').focus());
  await run.step(owner, () => owner.page.keyboard.press(`${modifier}+z`)); expect((await current(run, owner)).value).toBe(original.undone);
  await run.step(owner, () => owner.page.keyboard.press(redo)); expect((await current(run, owner)).value).toBe(original.appended);
}
/** 在当前有效动作内附数字证据；附件失败只记通用注解，不遮盖原尺寸或断言错误。 */
async function attachGeometry(run: EditorIndentNativeRun, owner: IndentNativeOwner, info: TestInfo, name: string, value: unknown) {
  await run.step(owner, () => info.attach(name, { body: Buffer.from(JSON.stringify(value)), contentType: 'application/json' }).catch(() => {
    info.annotations.push({ type: '分栏几何附件失败', description: '原尺寸与布局断言继续保留；未额外访问窗口。' });
  }));
}
/** 官方窗口请求不等于完成；同一原期限内最多5秒读真实内容尺寸，未达到仍失败保留。 */
async function resize(run: EditorIndentNativeRun, owner: IndentNativeOwner, width: number, height: number, info: TestInfo) {
  const handle = await run.step(owner, () => owner.application.browserWindow(owner.page));
  await run.step(owner, () => handle.evaluate((window, size) => { window.setMinimumSize(720, 320); window.setContentSize(size.width, size.height); }, { width, height }));
  await expect.poll(async () => {
    const actual = await run.step(owner, () => handle.evaluate(window => window.getContentSize()));
    const page = await run.step(owner, () => owner.page.evaluate(readQueryLayoutNativeGeometry));
    await attachGeometry(run, owner, info, '分栏原生窗口尺寸', { requested: { width, height }, actual: { width: actual[0], height: actual[1] }, page });
    return actual;
  }, { timeout: 5000, intervals: [100, 200, 400], message: '原生内容窗口须真实达到请求尺寸；未达到不能继续分栏验收' }).toEqual([width, height]);
}
/** 只读真实编辑区几何及可访问像素值，两者都要随正式分栏变化。 */
async function geometry(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const observed = await run.step(owner, () => owner.page.evaluate(readQueryLayoutNativeGeometry));
  const { maximum, value } = observed.separator;
  if (!observed.editor || maximum === null || value === null) throw Error('分栏专项找不到实际编辑区或分隔条几何');
  return { height: observed.editor.height, value, maximum, observed };
}
/** 允许真实ResizeObserver在原5秒内完成；410物理准入及后续精确拖动目标不降低。 */
async function readyMaximum(run: EditorIndentNativeRun, owner: IndentNativeOwner, info: TestInfo) {
  await expect.poll(async () => {
    const value = await geometry(run, owner);
    await attachGeometry(run, owner, info, '分栏原生准入几何', value.observed);
    return value.maximum;
  }, { timeout: 5000, intervals: [100, 200, 400], message: '原生查询区须具备大于410像素的真实分栏空间' }).toBeGreaterThan(410);
}
/** 固定目标标签的持久偏好只读观察；主进程settings不是DOM相似度。 */
async function height(run: EditorIndentNativeRun, owner: IndentNativeOwner, id: string) { return (await settings(run, owner)).tabs.find(tab => tab.id === id)?.queryEditorHeight; }
/** 同一原期限内越过400毫秒防抖窗口，再比较完整settings，不能以即时DOM认定取消/resize没有保存。 */
async function unchangedAfterDebounce(run: EditorIndentNativeRun, owner: IndentNativeOwner, before: Awaited<ReturnType<typeof settings>>) {
  const start = await run.step(owner, () => owner.page.evaluate(() => performance.now()));
  await expect.poll(() => run.step(owner, () => owner.page.evaluate(() => performance.now())).then(now => now - start), { intervals: [100, 200, 400], timeout: 2500 }).toBeGreaterThanOrEqual(650);
  expect(await settings(run, owner)).toEqual(before);
}
/** 真实鼠标只从实际分隔条中心移动；取消必须在up前按Escape，迟到up不能提交。 */
async function drag(run: EditorIndentNativeRun, owner: IndentNativeOwner, delta: number, cancel = false) {
  const separator = owner.page.locator('.query-tab:visible').getByRole('separator', { name: layoutText.separator, exact: true });
  const box = await run.step(owner, () => separator.boundingBox()); if (!box) throw Error('分栏条无实际几何');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await run.step(owner, () => owner.page.mouse.move(x, y)); await run.step(owner, () => owner.page.mouse.down());
  await run.step(owner, () => owner.page.mouse.move(x, y + delta, { steps: 4 }));
  if (cancel) await run.step(owner, () => owner.page.keyboard.press('Escape'));
  await run.step(owner, () => owner.page.mouse.up());
}
/** 键盘和恢复按钮都经过原分栏事件，不写入settings或布局DOM。 */
async function key(run: EditorIndentNativeRun, owner: IndentNativeOwner, value: string) {
  const separator = owner.page.locator('.query-tab:visible').getByRole('separator', { name: layoutText.separator, exact: true });
  await run.step(owner, () => separator.focus()); await run.step(owner, () => owner.page.keyboard.press(value));
}
/** 标签切换只点正式App按钮，等待活动身份真实持久化。 */
async function select(run: EditorIndentNativeRun, owner: IndentNativeOwner, index: number, id: string) {
  await run.step(owner, () => owner.page.locator('.tab-strip .tab-select').nth(index).click());
  await expect.poll(() => settings(run, owner).then(state => state.activeTabId)).toBe(id);
}
/** 只读原任务/历史/保存查询证明本例没有SQL执行，页面错误也必须为空。 */
async function noExecution(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const observed = await run.step(owner, () => owner.page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}), queries: await window.dbark.invoke('queries.list', {}) })));
  expect(observed).toEqual({ tasks: [], history: [], queries: [] }); expect(owner.errors).toEqual([]);
}

test('离线原生分栏：两查询独立拖动/键盘、取消/默认、视觉夹取、原模型历史及SQLite独立重启', async ({ trace, screenshot, video }, info: TestInfo) => {
  expect(trace).toBe('off'); expect(screenshot).toBe('off'); expect(video).toBe('off');
  const scope = bindEditorIndentNativeCase(info, binding!, () => test.info()); cases.set(info, scope); scope.assertCurrent();
  const run = runtime!.createEditorIndentNativeRun(scope, approval!);
  try {
    const first = await run.launch(); await observe(run, first); await resize(run, first, 1400, 1000, info); await prepareQuery(run, first);
    const a = (await settings(run, first)).activeTabId!; expect(a).toBeTruthy(); const originalA = await seed(run, first, '分栏A');
    await readyMaximum(run, first, info);
    await drag(run, first, 60); await expect.poll(() => height(run, first, a)).toBe(360); expect(content(await current(run, first))).toEqual(content(originalA.selected));
    await key(run, first, 'ArrowDown'); await expect.poll(() => height(run, first, a)).toBe(370); expect(content(await current(run, first))).toEqual(content(originalA.selected));
    const beforeCancel = await settings(run, first); await drag(run, first, 80, true); await unchangedAfterDebounce(run, first, beforeCancel); expect(content(await current(run, first))).toEqual(content(originalA.selected));
    await run.step(first, () => first.page.locator('.query-tab:visible').getByRole('button', { name: layoutText.restore, exact: true }).click());
    await expect.poll(() => height(run, first, a)).toBe(300); expect(content(await current(run, first))).toEqual(content(originalA.selected)); await history(run, first, originalA);
    await newQuery(run, first); const b = (await settings(run, first)).activeTabId!; expect(b).toBeTruthy(); expect(b).not.toBe(a); const originalB = await seed(run, first, '分栏B');
    await drag(run, first, 40); await expect.poll(() => height(run, first, b)).toBe(340); expect(content(await current(run, first))).toEqual(content(originalB.selected));
    await key(run, first, 'Shift+ArrowDown'); await expect.poll(() => height(run, first, b)).toBe(390); expect(content(await current(run, first))).toEqual(content(originalB.selected)); await history(run, first, originalB);
    await select(run, first, 0, a); expect((await current(run, first)).model).toBe(originalA.selected.model); expect((await current(run, first)).editor).toBe(originalA.selected.editor); await expect.poll(() => geometry(run, first).then(value => value.value)).toBe(300);
    await select(run, first, 1, b); const beforeSmall = await settings(run, first), stableModels = (await snapshots(run, first, '.query-tab', false)).map(content);
    expect(beforeSmall.tabs.map(tab => [tab.id, tab.queryEditorHeight])).toEqual([[a, 300], [b, 390]]);
    await resize(run, first, 1400, 480, info); await expect.poll(() => geometry(run, first).then(value => value.height)).toBeLessThan(390); await unchangedAfterDebounce(run, first, beforeSmall);
    expect((await snapshots(run, first, '.query-tab', false)).map(content)).toEqual(stableModels);
    await resize(run, first, 1400, 1000, info); await expect.poll(() => geometry(run, first).then(value => value.height)).toBeCloseTo(390, 0); expect(await settings(run, first)).toEqual(beforeSmall);
    await noExecution(run, first); const saved = await settings(run, first); await run.close(first);
    const disk = await run.stopped(path => runtime!.readIndentNativeSettings(path, () => run.assert())); expect(disk.schema).toBe(9); expect(disk.settings.tabs).toEqual(saved.tabs); expect(disk.settings.activeTabId).toBe(b);
    const second = await run.launch(); expect(second.application).not.toBe(first.application); await observe(run, second); await resize(run, second, 1400, 1000, info);
    expect(await settings(run, second)).toMatchObject({ tabs: saved.tabs, activeTabId: b }); const restored = await snapshots(run, second, '.query-tab', false); expect(restored).toHaveLength(2); expect(restored.map(value => value.value)).toEqual(saved.tabs.map(tab => tab.sql));
    await expect.poll(() => geometry(run, second).then(value => value.height)).toBeCloseTo(390, 0);
    await select(run, second, 0, a); await expect.poll(() => geometry(run, second).then(value => value.height)).toBeCloseTo(300, 0); await select(run, second, 1, b); await expect.poll(() => geometry(run, second).then(value => value.height)).toBeCloseTo(390, 0);
    await noExecution(run, second); await run.close(second); await run.finish();
    await info.attach('分栏原生终态', { body: Buffer.from(JSON.stringify({ accepted: true, normalOwners: run.owners.map(owner => ({ confirmed: owner.confirmed, willQuit: owner.ready, closed: owner.closed, recordedPids: owner.ids.size })), directoryRemoved: run.removed, schema: disk.schema, systemClipboard: 0, sqlExecution: 0 })), contentType: 'application/json' });
  } catch (reason) {
    run.retained = true;
    try { await info.attach('分栏原生保留现场', { body: Buffer.from(JSON.stringify({ directory: run.path, owners: run.owners.map(owner => ({ confirmed: owner.confirmed, willQuit: owner.ready, closed: owner.closed, ids: [...owner.ids], sourceDiagnostics: owner.sourceDiagnostics ?? [] })), automaticRetry: false, automaticForceStop: false, directoryRemoved: run.removed })), contentType: 'application/json' }); }
    catch (attachment) { throw new AggregateError([reason, attachment], '分栏用例失败且现场附录失败', { cause: reason }); }
    throw reason;
  }
});
