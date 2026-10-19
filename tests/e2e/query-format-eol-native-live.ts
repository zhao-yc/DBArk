import { test, expect, type TestInfo } from '@playwright/test';
import { isDeepStrictEqual } from 'node:util';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { createEditorIndentNativeRun, readIndentNativeSettings } from './editor-indentation-native-runtime';
import type { EditorIndentNativeRun, IndentNativeOwner } from './editor-indentation-native-owner';
import { formatEolCases, formatEolSource, formatEolExpected, assertFormatEolInitial, type FormatEolModel, type bindFormatEolEnvironment } from '../helpers/queryFormatEolNative';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqlFormattingZh } from '../../src/renderer/locales/sqlFormatting.zh-CN';

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
/** 唯一写入只是正式Main创建自有无密码概要/保存查询；不执行SQL，不伪造打开响应。 */
async function openSavedSource(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const saved = await run.step(owner, () => owner.page.evaluate(async sql => {
    const connection = await window.dbark.invoke('connections.save', { id: '', name: '首次EOL格式化离线', group: '', color: '#51bda5', dialect: 'mysql', host: '127.0.0.1', port: 1, user: 'offline', rememberPassword: false });
    const result = await window.dbark.invoke('queries.create', { name: '首次EOL格式化原LF', connectionId: connection.id, context: { state: 'known', database: null }, sql }); return result.source;
  }, formatEolSource));
  await run.step(owner, () => owner.page.reload()); await run.step(owner, () => expect(owner.page.locator('.app-statusbar')).toBeVisible());
  await run.step(owner, () => owner.page.locator('.app-commandbar').getByRole('button', { name: zh.common.historyQueries, exact: true }).click());
  const dialog = owner.page.getByRole('dialog', { name: zh.activity.text003, exact: true }); await run.step(owner, () => dialog.getByRole('button', { name: zh.activity.text005, exact: true }).click());
  const card = dialog.locator('.history-card').filter({ has: owner.page.getByText('首次EOL格式化原LF', { exact: true }) }); await run.step(owner, () => expect(card).toHaveCount(1));
  await run.step(owner, () => card.getByRole('button', { name: zh.activity.text010, exact: true }).click()); await run.step(owner, () => expect(dialog).toBeHidden());
  await run.step(owner, () => expect(owner.page.locator('.query-tab:visible .monaco-editor')).toBeVisible()); return saved;
}
/** 允许原保存查询分页任务，但禁止SQL执行、历史、活动任务及文件来源；不改任何dirty标记。 */
async function facts(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const state = await settings(run, owner), tabs = state.tabs; expect(tabs).toHaveLength(1); const tab = tabs[0]; expect(state.activeTabId).toBe(tab.id); expect(tab.fileSourceBinding).toBeUndefined();
  const value = await run.step(owner, () => owner.page.evaluate(async () => ({ queries: await window.dbark.invoke('queries.list', {}), tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}) })));
  expect(value.history).toEqual([]); expect(value.tasks.every(task => /^(?:queries|history)\./.test(task.kind) && task.status !== 'running')).toBe(true); expect(value.queries).toHaveLength(1); expect(value.queries[0].sql).toBe(formatEolSource); expect(owner.errors).toEqual([]);
  expect(state.editorTabSize ?? 2).toBe(2); expect(state.editorInsertSpaces ?? true).toBe(true); expect(state.sqlKeywordCase ?? 'preserve').toBe('preserve');
  const { sql: _sql, ...metadata } = tab; return { state, tab, effects: { metadata, ...value } };
}
/** 每次只用真实model及Main草稿核独立期望；Undo后store允许正常回传模型EOL，保存查询仍须原LF。 */
async function exact(run: EditorIndentNativeRun, owner: IndentNativeOwner, expected: string) {
  await expect.poll(() => model(run, owner).then(value => value.value)).toBe(expected);
  await expect.poll(() => settings(run, owner).then(value => value.tabs[0]?.sql)).toBe(expected);
}

/** 两入口各自独立启动，第一轮格式化之前绝不先追加Space或其它正文。 */
export function registerFormatEolNative(binding: ReturnType<typeof bindFormatEolEnvironment>) {
  test.use({ trace: 'off', screenshot: 'off', video: 'off' }); test.describe.configure({ mode: 'serial', timeout: 120000, retries: 0 });
  const scopes = new WeakMap<TestInfo, ReturnType<typeof bindEditorIndentNativeCase>>(); test.afterEach(({}, info) => scopes.get(info)?.retain());
  for (const [entry, name] of formatEolCases.entries()) test(name, async ({ trace, screenshot, video }, info) => {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); const scope = bindEditorIndentNativeCase(info, binding, () => test.info()); scopes.set(info, scope);
    const run = createEditorIndentNativeRun(scope, binding.approval); let witness: object | undefined;
    try {
      const first = await run.launch(); await observe(run, first); const source = await openSavedSource(run, first); const before = await facts(run, first), initial = await model(run, first);
      expect(before.tab.sourceBinding).toEqual(source); witness = assertFormatEolInitial(before.effects.queries[0].sql, before.tab.sql ?? '', initial, process.platform);
      const box = first.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox'); await run.step(first, () => box.focus()); await run.step(first, () => first.page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home'));
      const ready = await model(run, first); expect({ ...ready, focused: initial.focused, selections: initial.selections }).toEqual(initial); expect(ready.focused).toBe(true); expect(ready.selections).toEqual([{ start: 0, end: 0 }]);
      // 紧邻实际触发再核原LF草稿及零内容事件，不能靠预编辑使store追平模型EOL。
      const untouched = await facts(run, first); assertFormatEolInitial(untouched.effects.queries[0].sql, untouched.tab.sql ?? '', ready, process.platform);
      if (entry === 0) await run.step(first, () => first.page.getByRole('button', { name: sqlFormattingZh.action, exact: true }).click()); else await run.step(first, () => first.page.keyboard.press('Alt+Shift+f'));
      const expected = formatEolExpected.replaceAll('\n', initial.eol); await exact(run, first, expected); const changed = await model(run, first); expect(changed.id).toBe(initial.id); expect(changed.eol).toBe(initial.eol); expect(changed.version).toBeGreaterThan(initial.version); expect(changed.changes).toBe(1); expect(changed.focused).toBe(true);
      // 一次Undo必须恢复格式化前模型全文；不先补焦点，也不通过setter恢复store或Undo栈。
      await run.step(first, () => first.page.keyboard.press(modifier + '+z')); await exact(run, first, initial.value); expect((await model(run, first)).changes).toBe(2);
      await run.step(first, () => first.page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y')); await exact(run, first, expected);
      await run.step(first, () => first.page.keyboard.press(modifier + '+z')); await exact(run, first, initial.value); const undone = await facts(run, first); expect(isDeepStrictEqual(undone.effects, before.effects)).toBe(true);
      await run.close(first); const disk = await run.stopped(value => readIndentNativeSettings(value, () => run.assert())); expect(disk.schema).toBe(9); expect(disk.settings.tabs).toEqual(undone.state.tabs); expect(disk.settings.activeTabId).toBe(undone.state.activeTabId);
      const second = await run.launch(); expect(second.application).not.toBe(first.application); await observe(run, second); await exact(run, second, initial.value); const restarted = await facts(run, second); expect(restarted.tab.id).toBe(before.tab.id); expect(restarted.tab.sourceBinding).toEqual(source); expect((await model(run, second)).value).toBe(initial.value);
      await run.close(second); await run.finish(); expect(run.removed).toBe(true);
      await info.attach('首次EOL格式化原生终态', { body: Buffer.from(JSON.stringify({ entry: entry === 0 ? '按钮' : '快捷键', witness, accepted: true, singleUndo: true, sqliteSchema: disk.schema, directoryRemoved: run.removed, normalOwners: run.owners.map(owner => ({ confirmed: owner.confirmed, willQuit: owner.ready, closed: owner.closed, recordedPids: owner.ids.size })), sqlExecution: 0, systemClipboard: 0 })), contentType: 'application/json' });
    } catch (reason) {
      run.retained = true;
      try { await info.attach('首次EOL格式化保留现场', { body: Buffer.from(JSON.stringify({ witness, directory: run.path, directoryRemoved: run.removed, owners: run.owners.map(owner => ({ confirmed: owner.confirmed, willQuit: owner.ready, closed: owner.closed, ids: [...owner.ids], sourceDiagnostics: owner.sourceDiagnostics ?? [] })), automaticRetry: false, automaticForceStop: false })), contentType: 'application/json' }); }
      catch (attachment) { throw new AggregateError([reason, attachment], '原格式化失败与现场附录失败', { cause: reason }); } throw reason;
    }
  });
}
