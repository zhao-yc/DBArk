import { test, expect, type TestInfo } from '@playwright/test';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import type { IndentNativeTestInfo } from './editor-indentation-native-gate';
import { createEditorIndentNativeRun, readIndentNativeSettings } from './editor-indentation-native-runtime';
import type { EditorIndentNativeRun, IndentNativeOwner } from './editor-indentation-native-owner';
import { formatEolCases, formatEolSource, formatEolExpected, assertFormatEolInitial, type FormatEolModel, type bindFormatEolEnvironment } from '../helpers/queryFormatEolNative';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqlFormattingZh } from '../../src/renderer/locales/sqlFormatting.zh-CN';
import { queryFilesZh as text } from '../../src/renderer/locales/queryFiles.zh-CN';
import { queryFileSourceHasChanges } from '../../src/shared/queryFileSources';
import { QueryFilesNativeFiles } from '../helpers/queryFilesNativeFiles';
import { installSqlFilesOpenAnswer, finishSqlFilesOpenAnswer, installSqlFilesDirtyExitAnswer, consumeSqlFilesDirtyExitAnswer } from '../helpers/queryFilesNative';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
/** 只读Main真实持久化事实，等待原防抖，不调用flush或任何workspace setter。 */
async function settings(run: EditorIndentNativeRun, owner: IndentNativeOwner) { return run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('settings.get', {}))); }
/** 官方getter与只读内容事件计数标识原对象；不调用模型/选区/EOL/Undo setter。 */
async function model(run: EditorIndentNativeRun, owner: IndentNativeOwner): Promise<FormatEolModel> {
  return run.step(owner, () => owner.page.evaluate(() => {
    type Monaco = typeof import('monaco-editor'); type Entry = { id: number; model: object; changes: number };
    const root = window as Window & { monaco?: Monaco; __formatEolObservation?: { next: number; values: WeakMap<object, Entry> } };
    const editors = root.monaco?.editor.getEditors().filter(editor => { const node = editor.getContainerDomNode(); return node.isConnected && node.closest('.query-tab') && node.getClientRects().length > 0; });
    if (editors?.length !== 1) throw Error('首次格式化原编辑器不唯一'); const editor = editors[0], current = editor.getModel(); if (!current || current.isDisposed()) throw Error('原模型不可观察');
    const book = root.__formatEolObservation ??= { next: 0, values: new WeakMap() }; let item = book.values.get(editor);
    if (!item) { item = { id: ++book.next, model: current, changes: 0 }; book.values.set(editor, item); const captured = item; editor.onDidChangeModelContent(() => { captured.changes++; }); }
    if (item.model !== current) throw Error('原编辑器已更换模型');
    return { id: item.id, value: current.getValue(), eol: current.getEOL(), version: current.getVersionId(), changes: item.changes, focused: editor.hasTextFocus(), selections: editor.getSelections()?.map(range => ({ start: current.getOffsetAt(range.getStartPosition()), end: current.getOffsetAt(range.getEndPosition()) })) };
  }));
}
/** 启动后沿原严格Main来源门才开启官方观察API；不设模型正文或EOL。 */
async function observe(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  expect(await run.step(owner, () => owner.application.evaluate(({ app }) => app.getVersion()))).toBe('0.28.0');
  await run.step(owner, () => owner.page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; }));
  await run.step(owner, () => owner.page.reload()); await run.step(owner, () => expect(owner.page.locator('.app-statusbar')).toBeVisible());
}
/** 真实表单创建无密码回环概要及空查询；每个UI动作单独消费父门，不在浏览器串行发两次写RPC。 */
async function prepareOfflineQuery(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const page = owner.page; await run.step(owner, async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, () => run.assert(owner))).click());
  const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
  for (const [label, value] of [[zh.connections.text006, '首次文件EOL离线'], [zh.connections.text009, '127.0.0.1'], [zh.connections.text010, '1'], [zh.common.user, 'offline'], [zh.connections.text011, ''], [zh.connections.text012, '']]) await run.step(owner, () => form.getByLabel(label, { exact: true }).fill(value));
  await run.step(owner, () => form.getByRole('checkbox', { name: zh.connections.text016, exact: true }).uncheck()); await run.step(owner, async () => (await navigationMenuItem(form, { name: zh.connections.text036, exact: true }, () => run.assert(owner))).click()); await run.step(owner, () => expect(form).toBeHidden());
  const profiles = await run.step(owner, () => page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; })))); expect(profiles).toHaveLength(1); expect(profiles[0]).toMatchObject({ host: '127.0.0.1', port: 1, user: 'offline', rememberPassword: false }); expect(Boolean(profiles[0].hasPassword || profiles[0].ssh?.enabled || profiles[0].tls?.enabled)).toBe(false);
  await run.step(owner, async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newQuery, exact: true }, () => run.assert(owner))).click()); const query = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
  await run.step(owner, () => expect(query.locator('.error-box')).toContainText(/ECONNREFUSED|连接被拒绝|拒绝连接/i, { timeout: 20000 })); await run.step(owner, async () => (await navigationMenuItem(query, { name: zh.app.text053, exact: true }, () => run.assert(owner))).click()); await run.step(owner, () => expect(query).toBeHidden());
}
/** 原正式文件入口先建空placeholder，再异步加载自有LF字节；只有一次准确OpenDialog回答。 */
async function openFileSource(run: EditorIndentNativeRun, owner: IndentNativeOwner, path: string) {
  const nonce = randomUUID(); await run.step(owner, () => installSqlFilesOpenAnswer(owner.application, { nonce, path }));
  await run.step(owner, async () => (await navigationMenuItem(owner.page.locator('.query-tab:visible'), { name: text.open, exact: true }, () => run.assert(owner))).click()); const dialog = owner.page.getByRole('dialog', { name: text.open, exact: true });
  await run.step(owner, () => dialog.getByRole('combobox', { name: text.encoding, exact: true }).selectOption('utf8')); await run.step(owner, async () => (await navigationMenuItem(dialog, { name: text.openAction, exact: true }, () => run.assert(owner))).click());
  await expect.poll(() => run.step(owner, () => owner.application.evaluate(() => (globalThis as typeof globalThis & { __sqlFilesOpenAnswer?: { calls: number } }).__sqlFilesOpenAnswer?.calls))).toBe(1);
  expect(await run.step(owner, () => finishSqlFilesOpenAnswer(owner.application, nonce))).toEqual({ calls: 1, restored: true }); await run.step(owner, () => expect(dialog).toBeHidden());
  await run.step(owner, () => expect(owner.page.locator('.query-tab:visible .monaco-editor')).toBeVisible());
}
/** 每个Main只读RPC也各自消费原run.step；文件来源、基线、任务和历史只读，不伪造clean。 */
async function facts(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const state = await settings(run, owner), tabs = state.tabs; expect(tabs).toHaveLength(2); expect(tabs[0].sql ?? '').toBe(''); const tab = tabs[1]; expect(state.activeTabId).toBe(tab.id); expect(tab.sourceBinding).toBeUndefined(); expect(tab.fileSourceBinding).toBeDefined();
  const status = await run.step(owner, () => owner.page.evaluate(tabId => window.dbark.invoke('queryFileSources.status', { tabId }), tab.id)); expect(status.state).toBe('bound'); if (status.state !== 'bound') throw Error('首次格式化文件来源未绑定'); expect(status.binding.ref).toEqual(tab.fileSourceBinding);
  expect(status.binding).toMatchObject({ encoding: 'utf8', bom: 'none', eol: 'lf', savedSqlDigest: createHash('sha256').update(formatEolSource).digest('hex') });
  const queries = await run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('queries.list', {}))), tasks = await run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('tasks.list', {}))), history = await run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('history.list', {})));
  expect(history).toEqual([]); expect(tasks.every(task => task.kind.startsWith('queryFileSources.') && task.status !== 'running')).toBe(true); expect(queries).toEqual([]); expect(owner.errors).toEqual([]);
  expect(state.editorTabSize ?? 2).toBe(2); expect(state.editorInsertSpaces ?? true).toBe(true); expect(state.sqlKeywordCase ?? 'preserve').toBe('preserve');
  const { sql: _sql, ...metadata } = tab; return { state, tab, binding: status.binding, effects: { metadata, binding: status.binding, queries, tasks, history } };
}
/** 文件标签位于第二项；Undo后store沿真实事件为模型EOL，文件原字节和来源基线不得变化。 */
async function exact(run: EditorIndentNativeRun, owner: IndentNativeOwner, expected: string) {
  await expect.poll(() => model(run, owner).then(value => value.value)).toBe(expected);
  await expect.poll(() => settings(run, owner).then(value => value.tabs[1]?.sql)).toBe(expected);
}

/** 根据原元数据真实计算dirty并等待原UI；CRLF Undo不冒充LF基线clean。 */
async function dirtyState(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const current = await facts(run, owner), dirty = await run.step(owner, () => queryFileSourceHasChanges(current.tab.sql ?? '', current.binding));
  await run.step(owner, () => expect(owner.page.locator('.query-tab:visible').getByRole('status', { name: text.fileSource, exact: true })).toContainText(dirty ? text.dirty : text.clean)); return { current, dirty };
}
/** 只对已核真实dirty的这个owner复用原精确提示暂停/消费合同，仍由原run正常quit/PID门结算。 */
async function closeFileOwner(run: EditorIndentNativeRun, owner: IndentNativeOwner, scope: { assertCurrent(): void }, info: IndentNativeTestInfo, witnesses: object[]) {
  const before = await dirtyState(run, owner); if (!before.dirty) { witnesses.push({ owner: run.owners.indexOf(owner), dirty: false, answerInstalled: false }); await run.close(owner); return; }
  const application = owner.application, page = owner.page, handle = await run.step(owner, () => application.browserWindow(page)), window = await run.step(owner, () => handle.evaluate(value => ({ window: value.id, contents: value.webContents.id }))); await run.step(owner, () => handle.dispose());
  const start = Object.hasOwn(info, '_startWallTime') ? info._startWallTime : Number(info.startTime), choice = { ...window, nonce: randomUUID(), deadline: Number(start) + 120000 };
  const witness = { owner: run.owners.indexOf(owner), dirty: true, ...window, nonce: choice.nonce, pid: 0, pending: 0, consumed: 0, failed: false, completed: false }; witnesses.push(witness);
  let installed: Awaited<ReturnType<typeof installSqlFilesDirtyExitAnswer>> | undefined, receipt: Awaited<ReturnType<typeof consumeSqlFilesDirtyExitAnswer>> | undefined, consuming: Promise<void> | undefined, failure: unknown, pending = 0, consumed = 0;
  // close在途不能run.step；只复核同一原owner、原TestInfo，不另建生命周期或释放busy。
  function current() { scope.assertCurrent(); run.assert(owner, true); if (owner.application !== application || owner.page !== page) throw Error('格式化dirty退出原owner漂移'); }
  function preserve(reason: unknown) { failure ??= reason; witness.failed = true; run.retained = true; }
  const listener = (message: { text(): string }) => { const value = message.text(); try {
    if (value === 'DBARK_SQL_FILES_DIRTY_PENDING:' + choice.nonce) { current(); witness.pending = ++pending; if (pending !== 1 || consuming || !installed) throw Error('原dirty提示重复或未登记'); consuming = (async () => { current(); receipt = await consumeSqlFilesDirtyExitAnswer(application, choice); current(); expect(receipt).toEqual({ pid: installed!.pid, ...window, calls: 1, restored: true, consumed: true }); })(); void consuming.catch(preserve); }
    else if (value === 'DBARK_SQL_FILES_DIRTY_CONSUMED:' + choice.nonce) { current(); witness.consumed = ++consumed; if (consumed !== 1 || pending !== 1 || !consuming) throw Error('原dirty消费未知'); }
    else if (value === 'DBARK_SQL_FILES_DIRTY_FAILED:' + choice.nonce) throw Error('原dirty退出失败，保留现场');
  } catch (reason) { preserve(reason); } };
  application.on('console', listener);
  try { installed = await run.step(owner, () => installSqlFilesDirtyExitAnswer(application, choice)); witness.pid = installed.pid; expect((await facts(run, owner)).state).toEqual(before.current.state); await run.close(owner); if (consuming) await consuming; current(); if (failure !== undefined) throw failure; expect([pending, consumed, !!receipt]).toEqual([1, 1, true]); witness.completed = true; application.removeListener('console', listener); }
  catch (reason) { preserve(reason); throw failure === reason || failure === undefined ? reason : new AggregateError([failure, reason], '格式化原dirty与正常退出均未确认', { cause: failure }); }
}

/** 两入口各自独立启动，第一轮格式化之前绝不先追加Space或其它正文。 */
export function registerFormatEolNative(binding: ReturnType<typeof bindFormatEolEnvironment>) {
  test.use({ trace: 'off', screenshot: 'off', video: 'off' }); test.describe.configure({ mode: 'serial', timeout: 120000, retries: 0 });
  const scopes = new WeakMap<TestInfo, ReturnType<typeof bindEditorIndentNativeCase>>(); test.afterEach(({}, info) => scopes.get(info)?.retain());
  for (const [entry, name] of formatEolCases.entries()) test(name, async ({ trace, screenshot, video }, info) => {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); const scope = bindEditorIndentNativeCase(info, binding, () => test.info()); scopes.set(info, scope);
    const run = createEditorIndentNativeRun(scope, binding.approval); let witness: object | undefined, files: QueryFilesNativeFiles | undefined, failure: unknown; const dirtyExits: object[] = [];
    try {
      const first = await run.launch(); await observe(run, first); await prepareOfflineQuery(run, first);
      files = new QueryFilesNativeFiles(run.path!, () => run.assert()); await run.step(first, () => files!.start()); const path = files.paths.source, fileIdentity = await run.step(first, () => files!.create(path, Buffer.from(formatEolSource, 'utf8')));
      await openFileSource(run, first, path); const before = await facts(run, first), initial = await model(run, first), original = await run.step(first, () => files!.read(path, fileIdentity)); expect(before.binding.displayPath).toBe(path);
      witness = assertFormatEolInitial(original.bytes.toString('utf8'), before.tab.sql ?? '', initial, process.platform);
      const box = first.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox'); await run.step(first, () => box.focus()); await run.step(first, () => first.page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home'));
      const ready = await model(run, first); expect({ ...ready, focused: initial.focused, selections: initial.selections }).toEqual(initial); expect(ready.focused).toBe(true); expect(ready.selections).toEqual([{ start: 0, end: 0 }]);
      // 紧邻实际触发再核原LF草稿及零内容事件，不能靠预编辑使store追平模型EOL。
      const untouched = await facts(run, first), originalAgain = await run.step(first, () => files!.read(path, fileIdentity)); assertFormatEolInitial(originalAgain.bytes.toString('utf8'), untouched.tab.sql ?? '', ready, process.platform);
      if (entry === 0) await run.step(first, async () => (await navigationMenuItem(first.page, { name: sqlFormattingZh.action, exact: true }, () => run.assert(first))).click()); else await run.step(first, () => first.page.keyboard.press('Alt+Shift+f'));
      const expected = formatEolExpected.replaceAll('\n', initial.eol); await exact(run, first, expected); const changed = await model(run, first); expect(changed.id).toBe(initial.id); expect(changed.eol).toBe(initial.eol); expect(changed.version).toBeGreaterThan(initial.version); expect(changed.changes).toBe(1); expect(changed.focused).toBe(true);
      // 一次Undo必须恢复格式化前模型全文；不先补焦点，也不通过setter恢复store或Undo栈。
      await run.step(first, () => first.page.keyboard.press(modifier + '+z')); await exact(run, first, initial.value); expect((await model(run, first)).changes).toBe(2);
      await run.step(first, () => first.page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y')); await exact(run, first, expected);
      await run.step(first, () => first.page.keyboard.press(modifier + '+z')); await exact(run, first, initial.value); const undone = await facts(run, first); expect(isDeepStrictEqual(undone.effects, before.effects)).toBe(true); expect((await run.step(first, () => files!.read(path, fileIdentity))).bytes).toEqual(Buffer.from(formatEolSource)); await dirtyState(run, first);
      await closeFileOwner(run, first, scope, info, dirtyExits); const disk = await run.stopped(async value => { await files!.assertDirectory(); return readIndentNativeSettings(value, () => run.assert()); }); expect(disk.schema).toBe(9); expect(disk.settings.tabs).toEqual(undone.state.tabs); expect(disk.settings.activeTabId).toBe(undone.state.activeTabId);
      const second = await run.launch(); expect(second.application).not.toBe(first.application); await run.step(second, () => files!.assertDirectory()); await observe(run, second); await exact(run, second, initial.value); const restarted = await facts(run, second); expect(restarted.tab.id).toBe(before.tab.id); expect(restarted.tab.fileSourceBinding).toEqual(before.tab.fileSourceBinding); expect((await model(run, second)).value).toBe(initial.value); expect((await run.step(second, () => files!.read(path, fileIdentity))).bytes).toEqual(Buffer.from(formatEolSource));
      await closeFileOwner(run, second, scope, info, dirtyExits); await files.closeHandles(); await run.stopped(() => files!.assertDirectory()); await run.finish(); expect(run.removed).toBe(true);
      await info.attach('首次EOL格式化原生终态', { body: Buffer.from(JSON.stringify({ entry: entry === 0 ? '按钮' : '快捷键', witness, dirtyExits, fileIdentity, files: files.records, accepted: true, singleUndo: true, sqliteSchema: disk.schema, directoryRemoved: run.removed, normalOwners: run.owners.map(owner => ({ confirmed: owner.confirmed, willQuit: owner.ready, closed: owner.closed, recordedPids: owner.ids.size })), sqlExecution: 0, systemClipboard: 0 })), contentType: 'application/json' });
    } catch (reason) {
      failure = reason; run.retained = true;
      try { await info.attach('首次EOL格式化保留现场', { body: Buffer.from(JSON.stringify({ witness, dirtyExits, files: files?.records, directory: run.path, directoryRemoved: run.removed, owners: run.owners.map(owner => ({ confirmed: owner.confirmed, willQuit: owner.ready, closed: owner.closed, ids: [...owner.ids], sourceDiagnostics: owner.sourceDiagnostics ?? [] })), automaticRetry: false, automaticForceStop: false })), contentType: 'application/json' }); }
      catch (attachment) { throw failure = new AggregateError([reason, attachment], '原格式化失败与现场附录失败', { cause: reason }); } throw reason;
    } finally { try { await files?.closeHandles(); } catch (closing) { run.retained = true; throw new AggregateError(failure === undefined ? [closing] : [failure, closing], '格式化原文件句柄关闭失败', { cause: failure }); } }
  });
}

/** 原门进入具体动作后才加载真实菜单导航，不改变默认/列表阶段的资源边界。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args); }
