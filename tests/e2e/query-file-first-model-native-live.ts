import { test, expect, type TestInfo } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { createEditorIndentNativeRun, readIndentNativeSettings } from './editor-indentation-native-runtime';
import type { EditorIndentNativeRun, IndentNativeOwner } from './editor-indentation-native-owner';
import { fileFirstModelCases, assertFirstFileInitial, assertFirstFileTransition, type FileFirstModelCase, type FirstModelObservation } from '../helpers/queryFileFirstModelNative';
import type { bindFileFirstModelEnvironment } from '../helpers/queryFileFirstModelNativeGate';
import { QueryFilesNativeFiles } from '../helpers/queryFilesNativeFiles';
import { installSqlFilesOpenAnswer, finishSqlFilesOpenAnswer } from '../helpers/queryFilesNative';
import { queryFileSourceHasChanges } from '../../src/shared/queryFileSources';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqlFormattingZh } from '../../src/renderer/locales/sqlFormatting.zh-CN';
import { queryFilesZh as text } from '../../src/renderer/locales/queryFiles.zh-CN';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const redo = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';
type FirstModelFile = { files: QueryFilesNativeFiles; path: string; bytes: Buffer; identity: Awaited<ReturnType<QueryFilesNativeFiles['create']>> };
/** 每个Main只读RPC单独消费原父门，不在renderer异步闭包串联命令。 */
async function settings(run: EditorIndentNativeRun, owner: IndentNativeOwner) { return run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('settings.get', {}))); }
/** 严格Main来源已由原launch确认；只开放官方观察入口，不修改模型或选区。 */
async function observe(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  expect(await run.step(owner, () => owner.application.evaluate(({ app }) => app.getVersion()))).toBe('0.28.0');
  await run.step(owner, () => owner.page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; }));
  await run.step(owner, () => owner.page.reload());
  await run.step(owner, () => expect(owner.page.locator('.app-statusbar')).toBeVisible());
}
/** 官方getter及被动事件观察同一editor/model；事件只记录原事件字段，不读取或改写正文。 */
async function model(run: EditorIndentNativeRun, owner: IndentNativeOwner): Promise<FirstModelObservation> {
  return run.step(owner, () => owner.page.evaluate(() => {
    type Api = typeof import('monaco-editor');
    type Entry = { editorId: number; modelId: number; model: import('monaco-editor').editor.ITextModel; events: { version: number; eol: string; undo: boolean; redo: boolean; eolChange: boolean; flush: boolean }[]; overflow: number };
    const root = window as Window & { monaco?: Api; __fileFirstModelObservation?: { next: number; entries: WeakMap<object, Entry> } };
    const editors = root.monaco?.editor.getEditors().filter(editor => { const node = editor.getContainerDomNode(); return node.isConnected && node.closest('.query-tab') && node.getClientRects().length > 0; });
    if (editors?.length !== 1) throw Error('首次文件模型当前编辑器不唯一');
    const editor = editors[0], current = editor.getModel(); if (!current || current.isDisposed()) throw Error('首次文件原模型不可观察');
    const book = root.__fileFirstModelObservation ??= { next: 0, entries: new WeakMap() }; let item = book.entries.get(editor);
    if (!item) {
      item = { editorId: ++book.next, modelId: ++book.next, model: current, events: [], overflow: 0 }; book.entries.set(editor, item); const captured = item;
      current.onDidChangeContent(event => { if (captured.events.length >= 64) { captured.overflow++; return; } captured.events.push({ version: event.versionId, eol: event.eol, undo: event.isUndoing, redo: event.isRedoing, eolChange: event.isEolChange, flush: event.isFlush }); });
    }
    if (item.model !== current) throw Error('首次文件原editor已替换model');
    const options = current.getOptions();
    return { editorId: item.editorId, modelId: item.modelId, value: current.getValue(), eol: current.getEOL(), version: current.getVersionId(), alternative: current.getAlternativeVersionId(), focused: editor.hasTextFocus(), overflow: item.overflow, events: item.events.map(value => ({ ...value })), options: { tabSize: options.tabSize, indentSize: options.indentSize, insertSpaces: options.insertSpaces, readOnly: editor.getRawOptions().readOnly === true }, selections: editor.getSelections()?.map(range => ({ start: current.getOffsetAt(range.getStartPosition()), end: current.getOffsetAt(range.getEndPosition()), anchor: current.getOffsetAt({ lineNumber: range.selectionStartLineNumber, column: range.selectionStartColumn }), position: current.getOffsetAt({ lineNumber: range.positionLineNumber, column: range.positionColumn }) })) ?? null };
  }));
}
/** 真实无密码表单与原127.0.0.1:1拒连流程，不伪造连接成功或创建SQL会话。 */
async function prepareOfflineQuery(run: EditorIndentNativeRun, owner: IndentNativeOwner, key: string) {
  const page = owner.page;
  await run.step(owner, async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, () => run.assert(owner))).click());
  const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
  for (const [label, value] of [[zh.connections.text006, '首次模型离线-' + key], [zh.connections.text009, '127.0.0.1'], [zh.connections.text010, '1'], [zh.common.user, 'offline'], [zh.connections.text011, ''], [zh.connections.text012, '']]) await run.step(owner, () => form.getByLabel(label, { exact: true }).fill(value));
  await run.step(owner, () => form.getByRole('checkbox', { name: zh.connections.text016, exact: true }).uncheck());
  await run.step(owner, async () => (await navigationMenuItem(form, { name: zh.connections.text036, exact: true }, () => run.assert(owner))).click());
  await run.step(owner, () => expect(form).toBeHidden());
  await run.step(owner, async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newQuery, exact: true }, () => run.assert(owner))).click());
  const query = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
  await run.step(owner, () => expect(query.locator('.error-box')).toContainText(/ECONNREFUSED|连接被拒绝|拒绝连接/i, { timeout: 15000 }));
  await run.step(owner, async () => (await navigationMenuItem(query, { name: zh.app.text053, exact: true }, () => run.assert(owner))).click());
  await run.step(owner, () => expect(query).toBeHidden());
}
/** 仅回答本owner的准确SQL OpenDialog一次；随后恢复原函数，不替换文件IPC或加载结果。 */
async function openFile(run: EditorIndentNativeRun, owner: IndentNativeOwner, path: string) {
  const nonce = randomUUID();
  await run.step(owner, () => installSqlFilesOpenAnswer(owner.application, { nonce, path }));
  await run.step(owner, async () => (await navigationMenuItem(owner.page.locator('.query-tab:visible'), { name: text.open, exact: true }, () => run.assert(owner))).click());
  const dialog = owner.page.getByRole('dialog', { name: text.open, exact: true });
  await run.step(owner, () => dialog.getByRole('combobox', { name: text.encoding, exact: true }).selectOption('utf8'));
  await run.step(owner, async () => (await navigationMenuItem(dialog, { name: text.openAction, exact: true }, () => run.assert(owner))).click());
  await expect.poll(() => run.step(owner, () => owner.application.evaluate(() => (globalThis as typeof globalThis & { __sqlFilesOpenAnswer?: { calls: number } }).__sqlFilesOpenAnswer?.calls))).toBe(1);
  expect(await run.step(owner, () => finishSqlFilesOpenAnswer(owner.application, nonce))).toEqual({ calls: 1, restored: true });
  await run.step(owner, () => expect(dialog).toBeHidden());
  await run.step(owner, () => expect(owner.page.locator('.query-tab:visible .monaco-editor')).toBeVisible());
}
/** 完整settings、来源、唯一终态文件任务和零SQL/查询库写入，均从真实Main分别读取。 */
async function facts(run: EditorIndentNativeRun, owner: IndentNativeOwner, value: FileFirstModelCase) {
  const state = await settings(run, owner); expect(state.tabs).toHaveLength(2); expect(state.tabs[0].sql ?? '').toBe('');
  const tab = state.tabs[1]; expect(state.activeTabId).toBe(tab.id); expect(tab.kind).toBe('query'); expect(tab.sourceBinding).toBeUndefined(); expect(tab.fileSourceBinding).toBeDefined();
  const status = await run.step(owner, () => owner.page.evaluate(input => window.dbark.invoke('queryFileSources.status', input), { tabId: tab.id, source: tab.fileSourceBinding }));
  expect(status.state).toBe('bound'); if (status.state !== 'bound') throw Error('首次模型来源未绑定');
  expect(status.binding.ref).toEqual(tab.fileSourceBinding); expect(status.binding).toMatchObject({ encoding: 'utf8', bom: 'none', eol: value.eol === '\n' ? 'lf' : 'crlf', savedSqlDigest: createHash('sha256').update(Buffer.from(value.source, 'utf8')).digest('hex') });
  const profiles = await run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; })))); expect(profiles).toHaveLength(1); expect(profiles[0]).toMatchObject({ host: '127.0.0.1', port: 1, user: 'offline', rememberPassword: false }); expect(Boolean(profiles[0].hasPassword || profiles[0].ssh?.enabled || profiles[0].tls?.enabled)).toBe(false); expect(tab.connectionId).toBe(profiles[0].id);
  const queries = await run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('queries.list', {})));
  const history = await run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('history.list', {})));
  const tasks = await run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('tasks.list', {})));
  expect(queries).toEqual([]); expect(history).toEqual([]); expect(tasks).toHaveLength(1); expect(tasks[0]).toMatchObject({ kind: 'queryFileSources.open', status: 'completed', progress: 100 }); expect(owner.errors).toEqual([]);
  expect(state.editorTabSize ?? 2).toBe(2); expect(state.editorInsertSpaces ?? true).toBe(true); expect(state.sqlKeywordCase ?? 'preserve').toBe('preserve');
  const { sql: _sql, ...metadata } = tab;
  return { state, tab, binding: status.binding, effects: { state: { ...state, tabs: [state.tabs[0], metadata] }, profiles, binding: status.binding, queries, history, tasks: tasks.map(({ id, kind, status, progress }) => ({ id, kind, status, progress })) } };
}
/** 模型与Main都逐字等待原值，既不变换实际文本也不写入工作区。 */
async function exact(run: EditorIndentNativeRun, owner: IndentNativeOwner, expected: string) {
  await expect.poll(() => model(run, owner).then(value => value.value)).toBe(expected);
  await expect.poll(() => settings(run, owner).then(value => value.tabs[1]?.sql)).toBe(expected);
}
/** 严格摘要、原来源状态和tab dirty点共同证明；小窗口隐藏caption也须读其原状态文本。 */
async function checkpoint(run: EditorIndentNativeRun, owner: IndentNativeOwner, value: FileFirstModelCase, baseline: Awaited<ReturnType<typeof facts>>, expected: string, dirty: boolean, file: FirstModelFile) {
  await exact(run, owner, expected);
  const current = await facts(run, owner, value); expect(current.effects).toEqual(baseline.effects);
  expect(await run.step(owner, () => queryFileSourceHasChanges(current.tab.sql ?? '', current.binding))).toBe(dirty);
  await run.step(owner, () => expect(owner.page.locator('.query-tab:visible').getByRole('status', { name: text.fileSource, exact: true, includeHidden: true })).toContainText(dirty ? text.dirty : text.clean));
  await run.step(owner, () => expect(owner.page.locator('.tab-strip .workspace-tab-button').nth(1).locator('.dirty-dot')).toHaveCount(dirty ? 1 : 0));
  const original = await run.step(owner, () => file.files.read(file.path, file.identity)); expect(original.bytes).toEqual(file.bytes);
  return { facts: current, fileIdentity: original.identity, model: await model(run, owner) };
}
/** 四个原TestInfo各自领取两owner/一个自有文件，成功须clean正常退出；任何dirty提示都不自动回答。 */
export function registerFileFirstModelNative(binding: ReturnType<typeof bindFileFirstModelEnvironment>) {
  test.use({ trace: 'off', screenshot: 'off', video: 'off' }); test.describe.configure({ mode: 'serial', timeout: 120000, retries: 0 });
  const scopes = new WeakMap<TestInfo, ReturnType<typeof bindEditorIndentNativeCase>>(); test.afterEach(({}, info) => scopes.get(info)?.retain());
  for (const value of fileFirstModelCases) test(value.title, async ({ trace, screenshot, video }, info) => {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); const scope = bindEditorIndentNativeCase(info, binding, () => test.info()); scopes.set(info, scope);
    const run = createEditorIndentNativeRun(scope, binding.approval), witnesses: object[] = []; let files: QueryFilesNativeFiles | undefined, failure: unknown;
    try {
      const first = await run.launch(); await observe(run, first); await prepareOfflineQuery(run, first, value.key);
      files = new QueryFilesNativeFiles(run.path!, () => run.assert()); await run.step(first, () => files!.start());
      const path = files.paths.source, originalBytes = Buffer.from(value.source, 'utf8'), identity = await run.step(first, () => files!.create(path, originalBytes));
      const source: FirstModelFile = { files, path, bytes: originalBytes, identity };
      await openFile(run, first, path); await exact(run, first, value.source);
      const baseline = await facts(run, first, value), initial = await model(run, first), original = await run.step(first, () => files!.read(path, identity)); expect(baseline.binding.displayPath).toBe(path);
      witnesses.push({ stage: '首次模型且尚无用户编辑', initial: assertFirstFileInitial(value, original.bytes, baseline.tab.sql ?? '', initial), identity });
      await checkpoint(run, first, value, baseline, value.source, false, source);
      await run.step(first, () => first.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox').focus());
      await run.step(first, () => first.page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home'));
      const pristine = await model(run, first); expect({ ...pristine, focused: initial.focused, selections: initial.selections }).toEqual(initial); expect(pristine.focused).toBe(true); expect(pristine.selections).toEqual([{ start: 0, end: 0, anchor: 0, position: 0 }]);
      await run.step(first, () => first.page.keyboard.press('x'));
      await run.step(first, () => first.page.keyboard.press('Escape'));
      const typed = await checkpoint(run, first, value, baseline, 'x' + value.source, true, source); assertFirstFileTransition(pristine, typed.model, 'x' + value.source, 'edit', [{ start: 1, end: 1, anchor: 1, position: 1 }]); witnesses.push({ stage: '普通字符编辑', model: typed.model });
      await run.step(first, () => first.page.keyboard.press(modifier + '+z'));
      const textUndone = await checkpoint(run, first, value, baseline, value.source, false, source); assertFirstFileTransition(typed.model, textUndone.model, value.source, 'undo', pristine.selections); expect(textUndone.model.alternative).toBe(pristine.alternative); witnesses.push({ stage: '普通字符一次Undo且clean', model: textUndone.model });
      expect((await run.step(first, () => files!.read(path, identity))).bytes).toEqual(originalBytes);
      if (value.entry === 'button') await run.step(first, async () => (await navigationMenuItem(first.page, { name: sqlFormattingZh.action, exact: true }, () => run.assert(first))).click());
      else await run.step(first, () => first.page.keyboard.press('Alt+Shift+f'));
      const formatted = await checkpoint(run, first, value, baseline, value.formatted, true, source); assertFirstFileTransition(textUndone.model, formatted.model, value.formatted, 'format'); witnesses.push({ stage: '首次格式化', model: formatted.model });
      await run.step(first, () => first.page.keyboard.press(modifier + '+z'));
      const undone = await checkpoint(run, first, value, baseline, value.source, false, source); assertFirstFileTransition(formatted.model, undone.model, value.source, 'undo', textUndone.model.selections); expect(undone.model.alternative).toBe(textUndone.model.alternative); witnesses.push({ stage: '格式化一次Undo且clean', model: undone.model });
      await run.step(first, () => first.page.keyboard.press(redo));
      const redone = await checkpoint(run, first, value, baseline, value.formatted, true, source); assertFirstFileTransition(undone.model, redone.model, value.formatted, 'redo', formatted.model.selections); expect(redone.model.alternative).toBe(formatted.model.alternative); witnesses.push({ stage: '格式化Redo', model: redone.model });
      await run.step(first, () => first.page.keyboard.press(modifier + '+z'));
      const final = await checkpoint(run, first, value, baseline, value.source, false, source); assertFirstFileTransition(redone.model, final.model, value.source, 'undo', textUndone.model.selections); expect(final.model.alternative).toBe(textUndone.model.alternative); witnesses.push({ stage: '最终Undo且clean', model: final.model });
      expect((await run.step(first, () => files!.read(path, identity))).bytes).toEqual(originalBytes);
      await run.step(first, () => files!.closeHandles()); await run.close(first);
      await run.stopped(() => files!.assertDirectory());
      const disk = await run.stopped(path => readIndentNativeSettings(path, () => run.assert())); expect(disk.schema).toBe(9); expect(disk.settings.tabs).toEqual(final.facts.state.tabs); expect(disk.settings.activeTabId).toBe(final.facts.state.activeTabId);
      const second = await run.launch(); expect(second.application).not.toBe(first.application); await observe(run, second);
      const restarted = await checkpoint(run, second, value, baseline, value.source, false, source); expect(restarted.facts.state.tabs).toEqual(disk.settings.tabs); expect(restarted.facts.state.activeTabId).toBe(disk.settings.activeTabId); expect(restarted.model.eol).toBe(value.eol); expect(restarted.model.value).toBe(value.source); witnesses.push({ stage: '独立重启且clean', model: restarted.model });
      expect((await run.step(second, () => files!.read(path, identity))).bytes).toEqual(originalBytes);
      await run.step(second, () => files!.closeHandles()); await run.close(second);
      await run.stopped(() => files!.assertDirectory()); await run.finish(); expect(run.removed).toBe(true);
      await info.attach('文件首次模型原生终态', { body: Buffer.from(JSON.stringify({ caseKey: value.key, entry: value.entry, sourceEol: value.eol, identity, witnesses, files: files.records, accepted: true, ordinarySingleUndo: true, formatSingleUndo: true, sqliteSchema: disk.schema, directoryRemoved: run.removed, normalOwners: run.owners.map(owner => ({ confirmed: owner.confirmed, willQuit: owner.ready, closed: owner.closed, recordedPids: owner.ids.size })), sqlExecution: 0, queryLibraryWrites: 0, systemClipboard: 0, dirtyAnswerInstalled: false })), contentType: 'application/json' });
    } catch (reason) {
      failure = reason; run.retained = true;
      // 只附父端已经持有的内存；失败后不读SDK、窗口、文件、PID或SQLite，不补清理。
      try { await info.attach('文件首次模型保留现场', { body: Buffer.from(JSON.stringify({ caseKey: value.key, witnesses, files: files?.records, directory: run.path, directoryRemoved: run.removed, owners: run.owners.map(owner => ({ confirmed: owner.confirmed, willQuit: owner.ready, closed: owner.closed, ids: [...owner.ids], sourceDiagnostics: owner.sourceDiagnostics ?? [] })), automaticRetry: false, automaticForceStop: false, dirtyAnswerInstalled: false })), contentType: 'application/json' }); }
      catch (attachment) { failure = new AggregateError([reason, attachment], '文件首次模型原失败及内存附录失败', { cause: reason }); throw failure; }
      throw reason;
    } finally {
      // 仅关闭已经持有的自有FD；不核路径、读文件、退出未知owner或清理目录。
      try { await files?.closeHandles(); }
      catch (closing) { run.retained = true; throw new AggregateError(failure === undefined ? [closing] : [failure, closing], '文件首次模型原失败及句柄关闭失败', { cause: failure }); }
    }
  });
}

/** 原门进入具体动作后才加载真实菜单导航，不改变默认/列表阶段的资源边界。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args); }
