import { test, expect, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { zh } from '../../src/renderer/locales/zh-CN';
import { queryFilesZh as text } from '../../src/renderer/locales/queryFiles.zh-CN';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import type { IndentNativeTestInfo } from './editor-indentation-native-gate';
import { createEditorIndentNativeRun, readIndentNativeSettings } from './editor-indentation-native-runtime';
import type { EditorIndentNativeRun, IndentNativeOwner } from './editor-indentation-native-owner';
import { queryFilesNativeCases, type bindQueryFilesNativeEnvironment } from '../helpers/queryFilesNativeGate';
import { recentSql, sourceSql, savedSql, draftSql, externalSql, utf16NativeBytes, assertSqlFilesModelText, installSqlFilesOpenAnswer, finishSqlFilesOpenAnswer, installSqlFilesDirtyExitAnswer, consumeSqlFilesDirtyExitAnswer } from '../helpers/queryFilesNative';
import { QueryFilesNativeFiles } from '../helpers/queryFilesNativeFiles';

type Binding = ReturnType<typeof bindQueryFilesNativeEnvironment>;
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
/** 只读原Main持久化事实，等待原防抖自然保存，不注入store或强制flush。 */
async function settings(run: EditorIndentNativeRun, owner: IndentNativeOwner) { return run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('settings.get', {}))); }
/** 官方getter观察实际模型；WeakMap仅编号原对象，绝不设值、切换模型或操作撤销栈。 */
async function models(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  return run.step(owner, () => owner.page.evaluate(() => {
    type Api = typeof import('monaco-editor');
    const root = window as Window & { monaco?: Api; __sqlFilesModels?: { ids: WeakMap<object, number>; next: number } };
    if (!root.monaco?.editor.getEditors) throw Error('原Monaco只读观察API不可用');
    const ids = root.__sqlFilesModels ??= { ids: new WeakMap(), next: 0 };
    const id = (value: object) => { if (!ids.ids.has(value)) ids.ids.set(value, ++ids.next); return ids.ids.get(value)!; };
    return root.monaco.editor.getEditors().filter(editor => editor.getContainerDomNode().isConnected && editor.getContainerDomNode().closest('.query-tab')).map(editor => {
      const node = editor.getContainerDomNode(), model = editor.getModel(); if (!model || model.isDisposed()) throw Error('原模型身份未知');
      const eol = model.getEOL(); if (eol !== '\n' && eol !== '\r\n') throw Error('原模型getter返回未知EOL');
      return { editor: id(editor), model: id(model), pane: Array.from(document.querySelectorAll('.tab-content .tab-pane')).indexOf(node.closest('.tab-pane')!), visible: node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden', sql: model.getValue(), eol, version: model.getVersionId() };
    }).sort((a, b) => a.pane - b.pane);
  }));
}
/** 唯一实际可见模型须对应原持久化活动标签，不先点击标签修复错误状态。 */
async function workspace(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const stored = await settings(run, owner), actual = await models(run, owner), visible = actual.filter(value => value.visible), index = stored.tabs.findIndex(tab => tab.id === stored.activeTabId);
  expect(visible).toHaveLength(1); expect(visible[0].pane).toBe(index); assertSqlFilesModelText(stored.tabs[index].sql, visible[0]); return { tabs: stored.tabs, activeTabId: stored.activeTabId, actual };
}
/** 打开官方只读getter并核实际Main版本；版本只是补充，入口仍先过完整批准manifest。 */
async function observe(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  expect(await run.step(owner, () => owner.application.evaluate(({ app }) => app.getVersion()))).toBe('0.28.0');
  await run.step(owner, () => owner.page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; }));
  await run.step(owner, () => owner.page.reload()); await run.step(owner, () => expect(owner.page.locator('.app-statusbar')).toBeVisible());
}
/** 正式无密码表单；原runtime预检必须已证明127.0.0.1:1拒连及原close，才有本例资源。 */
async function offlineQuery(run: EditorIndentNativeRun, owner: IndentNativeOwner, info: TestInfo) {
  const page = owner.page; await run.step(owner, () => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click());
  const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
  for (const [label, value] of [[zh.connections.text006, 'SQL文件原生离线'], [zh.connections.text009, '127.0.0.1'], [zh.connections.text010, '1'], [zh.common.user, 'offline'], [zh.connections.text011, ''], [zh.connections.text012, '']]) await run.step(owner, () => form.getByLabel(label, { exact: true }).fill(value));
  await run.step(owner, () => form.getByRole('checkbox', { name: zh.connections.text016, exact: true }).uncheck());
  // 仅观察原DOM事件与校验状态；不触发校验、代交表单、替换IPC或改变等待期限。
  await run.step(owner, () => form.evaluate(node => {
    const root = window as Window & { __sqlFilesFormDiagnostic?: { finish(): unknown } };
    if (root.__sqlFilesFormDiagnostic) throw Error('同一窗口已有表单观测，拒绝覆盖');
    const events: object[] = [], names = ['pointerdown', 'pointerup', 'click', 'submit', 'invalid']; let overflow = false;
    /** 只采类型、布尔、布局和按钮文案，不采输入正文或秘密。 */
    const snapshot = () => ({ connected: node.isConnected, focused: document.hasFocus(), visibility: document.visibilityState,
      fields: Array.from(node.querySelectorAll<HTMLInputElement>('input')).map(input => ({ type: input.type, valid: input.validity.valid, missing: input.validity.valueMissing, range: input.validity.rangeOverflow || input.validity.rangeUnderflow, step: input.validity.stepMismatch, typeMismatch: input.validity.typeMismatch, badInput: input.validity.badInput })),
      buttons: Array.from(node.querySelectorAll('button')).map(button => { const rect = button.getBoundingClientRect(); return { text: button.textContent?.slice(0, 128), type: button.type, disabled: button.disabled, originalForm: button.form === node.querySelector('form'), originalDocument: button.ownerDocument === document, formConnected: button.form?.isConnected ?? false, x: rect.x, y: rect.y, width: rect.width, height: rect.height }; }),
      error: Array.from(node.querySelectorAll('.error-box')).map(value => value.textContent?.slice(0, 512)) });
    const before = snapshot();
    /** 捕获与冒泡分别记录，区分未产生提交、原生invalid与React实际preventDefault。 */
    const listener = (event: Event) => {
      if (!(event.target instanceof Element) || !node.contains(event.target)) return;
      if (events.length >= 128) { overflow = true; return; }
      events.push({ type: event.type, phase: event.eventPhase, trusted: event.isTrusted, prevented: event.defaultPrevented, target: event.target.tagName, button: event.target.closest('button')?.textContent?.slice(0, 128) });
    };
    for (const name of names) { document.addEventListener(name, listener, true); document.addEventListener(name, listener); }
    root.__sqlFilesFormDiagnostic = { finish() { for (const name of names) { document.removeEventListener(name, listener, true); document.removeEventListener(name, listener); } return { before, events, after: snapshot(), overflow }; } };
  }));
  await run.step(owner, async () => {
    let originalFailure: unknown;
    try { await form.getByRole('button', { name: zh.connections.text036, exact: true }).click(); run.assert(owner); await expect(form).toBeHidden(); }
    catch (reason) { originalFailure = reason; throw reason; }
    finally {
      try {
        // 原断言失败尚未离开同一step时读取证据；失效或过期owner不能继续读页面。
        run.assert(owner); const diagnostic = await page.evaluate(() => { const root = window as Window & { __sqlFilesFormDiagnostic?: { finish(): unknown } }; if (!root.__sqlFilesFormDiagnostic) throw Error('原表单观测缺失'); const value = root.__sqlFilesFormDiagnostic.finish(); delete root.__sqlFilesFormDiagnostic; return value; }); run.assert(owner);
        await info.attach('离线连接原表单事件观测', { body: Buffer.from(JSON.stringify(diagnostic)), contentType: 'application/json' }); run.assert(owner);
      } catch (reason) {
        if (!originalFailure) throw reason;
        // 诊断失败只能附注，不能覆盖原点击或原断言错误，也不能为取证重开失效页面。
        info.annotations.push({ type: '表单观测未完成', description: reason instanceof Error ? reason.message : String(reason) });
      }
    }
  });
  const profiles = await run.step(owner, () => page.evaluate(() => window.dbark.invoke('connections.list', {})));
  expect(profiles).toHaveLength(1); expect(profiles[0]).toMatchObject({ host: '127.0.0.1', port: 1, user: 'offline', rememberPassword: false }); expect(Boolean(profiles[0].hasPassword || profiles[0].ssh?.enabled || profiles[0].tls?.enabled)).toBe(false);
  await run.step(owner, () => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newQuery, exact: true }).click()); const query = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
  await run.step(owner, () => expect(query.locator('.error-box')).toContainText(/ECONNREFUSED|连接被拒绝|拒绝连接/i, { timeout: 20000 })); await run.step(owner, () => query.getByRole('button', { name: zh.app.text053, exact: true }).click()); await run.step(owner, () => expect(query).toBeHidden());
}
/** 所有正文写入只经过真实键盘，保存快捷键使用同一个输入区。 */
async function write(run: EditorIndentNativeRun, owner: IndentNativeOwner, sql: string) {
  const input = owner.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox'); await run.step(owner, () => input.focus()); await run.step(owner, () => owner.page.keyboard.press(modifier + '+A')); await run.step(owner, () => owner.page.keyboard.insertText(sql));
  await expect.poll(() => settings(run, owner).then(value => value.tabs.find(tab => tab.id === value.activeTabId)?.sql)).toBe(sql); expect((await workspace(run, owner)).actual.find(value => value.visible)?.sql).toBe(sql);
}
/** 仅替换本次原OpenDialog回答，正文/来源/任务仍由真实UI和Main完成。 */
async function openFile(run: EditorIndentNativeRun, owner: IndentNativeOwner, path?: string) {
  const nonce = randomUUID(); await run.step(owner, () => installSqlFilesOpenAnswer(owner.application, { nonce, path }));
  await run.step(owner, () => owner.page.locator('.query-tab:visible').getByRole('button', { name: text.open, exact: true }).click()); const dialog = owner.page.getByRole('dialog', { name: text.open, exact: true });
  await run.step(owner, () => dialog.getByRole('combobox', { name: text.encoding, exact: true }).selectOption('utf8')); await run.step(owner, () => dialog.getByRole('button', { name: text.openAction, exact: true }).click());
  await expect.poll(() => run.step(owner, () => owner.application.evaluate(() => (globalThis as typeof globalThis & { __sqlFilesOpenAnswer?: { calls: number } }).__sqlFilesOpenAnswer?.calls))).toBe(1);
  expect(await run.step(owner, () => finishSqlFilesOpenAnswer(owner.application, nonce))).toEqual({ calls: 1, restored: true });
  if (path) await run.step(owner, () => expect(dialog).toBeHidden()); else { await run.step(owner, () => expect(dialog).toBeVisible()); await run.step(owner, () => dialog.getByRole('button', { name: zh.common.cancel, exact: true }).click()); await run.step(owner, () => expect(dialog).toBeHidden()); }
}
/** 最近ID取真实列表，只作为所见UI选择及只读对照，绝不发送路径或伪造打开IPC。 */
async function recent(run: EditorIndentNativeRun, owner: IndentNativeOwner, path: string, expectedId?: string) {
  await run.step(owner, () => owner.page.locator('.query-tab:visible').getByRole('button', { name: text.recent, exact: true }).click()); const dialog = owner.page.getByRole('dialog', { name: text.recent, exact: true }), select = dialog.getByRole('combobox', { name: text.recentSelection, exact: true });
  await run.step(owner, () => expect(select).toBeEnabled()); await run.step(owner, () => expect(select).toHaveValue('')); await run.step(owner, () => expect(dialog.getByRole('button', { name: text.openRecent, exact: true })).toBeDisabled());
  const values = await settings(run, owner), entries = await run.step(owner, () => owner.page.evaluate(tabId => window.dbark.invoke('queryFileSources.recent', { tabId }), values.activeTabId!));
  expect(entries).toHaveLength(1); expect(entries[0]).toMatchObject({ name: basename(path), displayPath: path }); if (expectedId) expect(entries[0].id).toBe(expectedId);
  await run.step(owner, () => select.selectOption(entries[0].id)); await run.step(owner, () => expect(select).toHaveValue(entries[0].id)); await run.step(owner, () => expect(dialog.getByRole('combobox', { name: text.encoding, exact: true })).toHaveValue(entries[0].encoding)); return { dialog, id: entries[0].id };
}
/** 来源引用只从Main只读status核对，不能以renderer路径或相似标题代替真实授权。 */
async function bound(run: EditorIndentNativeRun, owner: IndentNativeOwner, tabId: string) {
  const stored = await settings(run, owner), tab = stored.tabs.find(value => value.id === tabId)!; expect(tab.fileSourceBinding).toBeDefined();
  const status = await run.step(owner, () => owner.page.evaluate(tabId => window.dbark.invoke('queryFileSources.status', { tabId }), tabId)); expect(status.state).toBe('bound'); if (status.state !== 'bound') throw Error('原Main来源未绑定'); expect(status.binding.ref).toEqual(tab.fileSourceBinding); return status.binding;
}
/** 文件任务可以存在；不允许数据库执行、历史或仍在运行的任务。 */
async function noSql(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  expect(await run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]);
  const tasks = await run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks.every(value => value.kind.startsWith('queryFileSources.') && value.status !== 'running')).toBe(true); expect(owner.errors).toEqual([]);
}
/** 原来源摘要异步检查完成且标签无脏标记后才走无提示退出；不确认提示或改写dirty。 */
async function cleanFileSources(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const state = await settings(run, owner);
  for (const [index, tab] of state.tabs.entries()) if (tab.fileSourceBinding) await run.step(owner, () => expect(owner.page.locator('.query-tab').nth(index).getByRole('status', { name: text.fileSource, exact: true, includeHidden: true })).toContainText(text.clean));
  await run.step(owner, () => expect(owner.page.locator('.workspace-tab-button .dirty-dot')).toHaveCount(0));
}
/** 第一次正常退出/PID后读原SQLite，再启动同一私有profile，活动标签和模型由产品自行恢复。 */
async function restart(run: EditorIndentNativeRun, first: IndentNativeOwner, files: QueryFilesNativeFiles, dirtyClose?: () => Promise<unknown>) {
  const before = await workspace(run, first); await noSql(run, first); if (dirtyClose) await dirtyClose(); else { await cleanFileSources(run, first); await noSql(run, first); await run.close(first); }
  const disk = await run.stopped(async path => { await files.assertDirectory(); return readIndentNativeSettings(path, () => run.assert()); }); expect(disk.schema).toBe(9); expect(disk.settings.tabs).toEqual(before.tabs); expect(disk.settings.activeTabId).toBe(before.activeTabId);
  const second = await run.launch(); await run.step(second, () => files.assertDirectory()); await observe(run, second); await expect.poll(() => settings(run, second).then(value => ({ tabs: value.tabs, activeTabId: value.activeTabId }))).toEqual({ tabs: before.tabs, activeTabId: before.activeTabId });
  const restored = await workspace(run, second); expect(restored.actual).toHaveLength(before.actual.length);
  // 重启产生独立模型，EOL可重新检测；Main/SQLite原草稿已逐字核对，所有新模型按各自实际EOL核完整正文。
  for (const [index, model] of restored.actual.entries()) { expect(model.pane).toBe(before.actual[index].pane); assertSqlFilesModelText(before.tabs[model.pane].sql, model); }
  return second;
}

/** 只给第二例这个owner的已知dirty原草稿退出一次；暂停原提示后再核父进程门，不改dirty或退出实现。 */
async function closeDirtyOwner(run: EditorIndentNativeRun, owner: IndentNativeOwner, scope: { assertCurrent(): void }, info: IndentNativeTestInfo, witnesses: object[]) {
  const application = owner.application, page = owner.page, before = await workspace(run, owner), dirty = before.tabs.map((tab, index) => ({ tab, index })).filter(value => value.tab.fileSourceBinding && value.tab.sql === draftSql);
  // 重读后来源草稿位于非活动标签；只读核对其脏标记，不切换当前标签或改写草稿。
  expect(dirty).toHaveLength(1); await run.step(owner, () => expect(page.locator('.query-tab').nth(dirty[0].index).getByRole('status', { name: text.fileSource, exact: true, includeHidden: true })).toContainText(text.dirty)); await noSql(run, owner);
  const handle = await run.step(owner, () => application.browserWindow(page)), window = await run.step(owner, () => handle.evaluate(value => ({ window: value.id, contents: value.webContents.id }))); await run.step(owner, () => handle.dispose());
  const start = Object.hasOwn(info, '_startWallTime') ? info._startWallTime : Number(info.startTime), choice = { ...window, nonce: randomUUID(), deadline: Number(start) + 120000 };
  const witness = { owner: run.owners.indexOf(owner), ...window, nonce: choice.nonce, pid: 0, pending: 0, consumed: 0, failed: false, completed: false }; witnesses.push(witness);
  let installed: Awaited<ReturnType<typeof installSqlFilesDirtyExitAnswer>> | undefined, receipt: Awaited<ReturnType<typeof consumeSqlFilesDirtyExitAnswer>> | undefined, consuming: Promise<void> | undefined, failure: unknown, pending = 0, consumed = 0;
  /** close在途不能再run.step；仅复核同一原owner和原TestInfo，关闭后也沿原私有退出事实检查。 */
  function current() { scope.assertCurrent(); run.assert(owner, true); if (owner.application !== application || owner.page !== page) throw Error('dirty退出原owner/app/page漂移'); }
  function preserve(reason: unknown) { failure ??= reason; witness.failed = true; run.retained = true; }
  const listener = (message: { text(): string }) => {
    const text = message.text();
    try {
      if (text === 'DBARK_SQL_FILES_DIRTY_PENDING:' + choice.nonce) {
        current(); witness.pending = ++pending; if (pending !== 1 || consuming || !installed) throw Error('dirty退出提示重复或安装未确认');
        consuming = (async () => { current(); receipt = await consumeSqlFilesDirtyExitAnswer(application, choice); current(); expect(receipt).toEqual({ pid: installed!.pid, ...window, calls: 1, restored: true, consumed: true }); })(); void consuming.catch(preserve);
      } else if (text === 'DBARK_SQL_FILES_DIRTY_CONSUMED:' + choice.nonce) { current(); witness.consumed = ++consumed; if (consumed !== 1 || pending !== 1 || !consuming) throw Error('dirty退出消费重复或缺少原提示'); }
      else if (text === 'DBARK_SQL_FILES_DIRTY_FAILED:' + choice.nonce) throw Error('原dirty退出提示/期限/窗口未知，保留现场');
    } catch (reason) { preserve(reason); }
  };
  application.on('console', listener);
  try {
    installed = await run.step(owner, () => installSqlFilesDirtyExitAnswer(application, choice)); witness.pid = installed.pid; expect(await workspace(run, owner)).toEqual(before);
    await run.close(owner); if (consuming) await consuming; current(); if (failure !== undefined) throw failure;
    expect([pending, consumed, !!receipt]).toEqual([1, 1, true]); witness.completed = true; application.removeListener('console', listener); return receipt!;
  } catch (reason) { preserve(reason); throw failure === reason || failure === undefined ? reason : new AggregateError([failure, reason], '原dirty退出失败及正常退出门失败', { cause: failure }); }
}

/** 两例均只注册本专项；生命周期、原TestInfo期限和正常退出门完整复用旧实现。 */
export function registerQueryFilesNative(binding: Binding) {
  test.use({ trace: 'off', screenshot: 'off', video: 'off' }); test.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  const scopes = new WeakMap<TestInfo, ReturnType<typeof bindEditorIndentNativeCase>>(); test.afterEach(({}, info) => scopes.get(info)?.retain());
  for (const [scenario, name] of queryFilesNativeCases.entries()) test(name, async ({ trace, screenshot, video }, info) => {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); const scope = bindEditorIndentNativeCase(info, binding, () => test.info()); scopes.set(info, scope); scope.assertCurrent();
    const run = createEditorIndentNativeRun(scope, binding.approval); let files: QueryFilesNativeFiles | undefined, failure: unknown; const dirtyExits: object[] = [];
    try {
      const first = await run.launch(); await observe(run, first); await offlineQuery(run, first, info); await write(run, first, "SELECT '最初草稿保持';"); const initial = await workspace(run, first);
      files = new QueryFilesNativeFiles(run.path!, () => run.assert()); await run.step(first, () => files!.start()); const path = files.paths.source;
      const originalIdentity = await run.step(first, () => files!.create(path, scenario === 0 ? Buffer.from(recentSql) : utf16NativeBytes(sourceSql))); await openFile(run, first, path);
      await expect.poll(() => settings(run, first).then(value => value.tabs.length)).toBe(2); const opened = await workspace(run, first), fileTab = opened.tabs.find(value => value.id === opened.activeTabId)!;
      expect(opened.tabs[0]).toEqual(initial.tabs[0]); expect(fileTab.id).not.toBe(initial.activeTabId); expect(fileTab.sql).toBe(scenario === 0 ? recentSql : sourceSql); expect(opened.actual[0]).toEqual({ ...initial.actual[0], visible: false });
      const source = await bound(run, first, fileTab.id); expect(source.displayPath).toBe(path); expect((await run.step(first, () => files!.read(path, originalIdentity))).bytes).toEqual(scenario === 0 ? Buffer.from(recentSql) : utf16NativeBytes(sourceSql));
      if (scenario === 0) {
        expect(source).toMatchObject({ encoding: 'utf8', bom: 'none', eol: 'lf' });
        const selected = await recent(run, first, path); await run.step(first, () => selected.dialog.getByRole('button', { name: text.cancelRecent, exact: true }).click()); expect(await workspace(run, first)).toEqual(opened);
        const again = await recent(run, first, path, selected.id); await run.step(first, () => again.dialog.getByRole('button', { name: text.openRecent, exact: true }).click()); await run.step(first, () => expect(again.dialog).toBeHidden()); await expect.poll(() => settings(run, first).then(value => value.tabs.length)).toBe(3);
        const reopened = await workspace(run, first); expect(reopened.tabs.slice(0, 2)).toEqual(opened.tabs); expect(reopened.tabs[2].sql).toBe(recentSql); expect(reopened.tabs[2].id).not.toBe(fileTab.id); expect(reopened.actual.slice(0, 2).map(value => ({ ...value, visible: false }))).toEqual(opened.actual.map(value => ({ ...value, visible: false }))); await bound(run, first, reopened.activeTabId!);
        await openFile(run, first); expect(await workspace(run, first)).toEqual(reopened);
        await run.step(first, () => files!.move(path, files!.paths.missing, originalIdentity)); const unavailable = await recent(run, first, path, selected.id); await run.step(first, () => unavailable.dialog.getByRole('button', { name: text.openRecent, exact: true }).click());
        const recovery = first.page.getByRole('dialog', { name: text.recovery, exact: true }); await run.step(first, () => expect(recovery).toContainText(text.wroteNo)); await run.step(first, () => expect(recovery.locator('.error-box')).toContainText(/文件|来源/)); await expect.poll(() => settings(run, first).then(value => value.tabs.length)).toBe(3); expect(await workspace(run, first)).toEqual(reopened);
        await run.step(first, () => recovery.getByRole('button', { name: zh.common.cancel, exact: true }).click()); await run.step(first, () => files!.move(files!.paths.missing, path, originalIdentity));
        const second = await restart(run, first, files), restored = await recent(run, second, path, selected.id); await run.step(second, () => restored.dialog.getByRole('button', { name: text.openRecent, exact: true }).click()); await run.step(second, () => expect(restored.dialog).toBeHidden()); await expect.poll(() => settings(run, second).then(value => value.tabs.length)).toBe(4);
        const final = await workspace(run, second); expect(final.tabs.slice(0, 3)).toEqual(reopened.tabs); expect(final.tabs[3].sql).toBe(recentSql); await bound(run, second, final.activeTabId!); await run.step(second, () => files!.read(path, originalIdentity)); await noSql(run, second); await cleanFileSources(run, second); await noSql(run, second); await run.close(second);
      } else {
        expect(source).toMatchObject({ encoding: 'utf16le', bom: 'utf16le', eol: 'crlf' }); await write(run, first, savedSql); await run.step(first, () => expect(first.page.locator('.query-tab:visible').getByRole('status', { name: text.fileSource, exact: true })).toContainText(text.dirty)); await run.step(first, () => first.page.keyboard.press(modifier + '+s'));
        await run.step(first, () => expect(first.page.locator('.query-tab:visible').getByRole('status', { name: text.fileSource, exact: true })).toContainText(text.clean)); const saved = await run.step(first, () => files!.read(path)); expect(saved.bytes).toEqual(utf16NativeBytes(savedSql)); const savedSource = await bound(run, first, fileTab.id); expect(savedSource.ref.id).toBe(source.ref.id); expect(savedSource.ref.revision).toBeGreaterThan(source.ref.revision); expect(savedSource).toMatchObject({ encoding: 'utf16le', bom: 'utf16le', eol: 'crlf' });
        await write(run, first, draftSql); const draft = await workspace(run, first), incoming = await run.step(first, () => files!.create(files!.paths.replacement, utf16NativeBytes(externalSql))); expect([incoming.dev, incoming.ino]).not.toEqual([saved.identity.dev, saved.identity.ino]); await run.step(first, () => files!.move(files!.paths.replacement, path, incoming, saved.identity));
        await run.step(first, () => first.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox').focus()); await run.step(first, () => first.page.keyboard.press(modifier + '+s')); const recovery = first.page.getByRole('dialog', { name: text.recovery, exact: true });
        await run.step(first, () => expect(recovery).toContainText(text.wroteNo)); await run.step(first, () => expect(recovery.locator('.error-box')).toContainText('原文件已被替换')); expect(await workspace(run, first)).toEqual(draft); expect((await run.step(first, () => files!.read(path, incoming))).bytes).toEqual(utf16NativeBytes(externalSql));
        await run.step(first, () => recovery.getByRole('button', { name: text.reread, exact: true }).click()); await run.step(first, () => expect(recovery).toBeHidden()); await expect.poll(() => settings(run, first).then(value => value.tabs.length)).toBe(3); const reread = await workspace(run, first);
        expect(reread.tabs[1].id).toBe(fileTab.id); expect(reread.tabs[1].sql).toBe(draftSql); expect(reread.tabs[1].fileSourceBinding?.id).toBe(savedSource.ref.id); expect(reread.tabs[1].fileSourceBinding!.revision).toBeGreaterThan(savedSource.ref.revision); expect(reread.tabs[2]).toMatchObject({ sql: externalSql, title: basename(path) + text.rereadSuffix }); expect(reread.tabs[2].fileSourceBinding).toBeUndefined(); expect(reread.tabs[2].sourceBinding).toBeUndefined(); expect(reread.activeTabId).toBe(reread.tabs[2].id);
        expect({ ...reread.actual[1], visible: true }).toEqual(draft.actual[1]); expect(reread.actual[2].model).not.toBe(draft.actual[1].model); await bound(run, first, fileTab.id); expect((await run.step(first, () => files!.read(path, incoming))).bytes).toEqual(utf16NativeBytes(externalSql));
        const second = await restart(run, first, files, () => closeDirtyOwner(run, first, scope, info, dirtyExits)); const final = await workspace(run, second); expect(final.tabs[1].sql).toBe(draftSql); expect(final.tabs[2].sql).toBe(externalSql); await bound(run, second, fileTab.id); await run.step(second, () => files!.read(path, incoming)); await noSql(run, second); await closeDirtyOwner(run, second, scope, info, dirtyExits); expect(dirtyExits).toHaveLength(2);
      }
      await files.closeHandles(); await run.stopped(() => files!.assertDirectory()); await run.finish(); expect(run.removed).toBe(true);
      await info.attach('SQL文件原生准备终态', { body: Buffer.from(JSON.stringify({ scenario, version: '0.28.0', owners: run.owners.map(owner => ({ confirmed: owner.confirmed, willQuit: owner.ready, closed: owner.closed, pids: owner.ids.size })), dirtyExits, files: files.records, directoryRemoved: run.removed, sqlExecution: 0, systemClipboard: 0, nativeDialogAnswerOnly: true })), contentType: 'application/json' });
    } catch (reason) {
      failure = reason; run.retained = true;
      try { await info.attach('SQL文件原生保留现场', { body: Buffer.from(JSON.stringify({ directory: run.path, dirtyExits, files: files?.records, owners: run.owners.map(owner => ({ confirmed: owner.confirmed, willQuit: owner.ready, closed: owner.closed, ids: [...owner.ids] })), automaticReplay: false, automaticForceStop: false, directoryRemoved: run.removed })), contentType: 'application/json' }); }
      catch (attachment) { throw failure = new AggregateError([reason, attachment], '原失败与现场附录失败', { cause: reason }); } throw reason;
    } finally { try { await files?.closeHandles(); } catch (closing) { run.retained = true; throw new AggregateError(failure === undefined ? [closing] : [failure, closing], '原文件句柄关闭失败，保留首因', { cause: failure }); } }
  });
}
