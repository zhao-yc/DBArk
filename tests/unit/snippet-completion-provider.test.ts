import { expect, it, vi } from 'vitest';
import type * as monaco from 'monaco-editor';
import type { SqlSnippet } from '../../src/shared/contracts';
import { createSnippetCompletionProvider } from '../../src/renderer/snippetCompletionProvider';

const row: SqlSnippet = {id: 'one', name: 'pg原文', group: '组', description: '', sql: "-- $1 ${name}😀\nSELECT '原样';", updatedAt: ''};
/** 只替换公开编辑器事件和本地读取端口，正式建议生成器处理范围、失效及普通文本规则。 */
function fixture() {
  let text = 'pg', version = 1, current = true, position = {lineNumber: 1, column: 3}, empty = true;
  let finish!: (rows: SqlSnippet[] | undefined) => void;
  const events = new Map<string, () => void>();
  const on = (name: string) => (listener: () => void) => { events.set(name, listener); return {dispose: () => events.delete(name)}; };
  const model = {isDisposed: () => false, getValue: () => text, getValueLength: () => text.length,
    getLineContent: () => text, getOffsetAt: (point: {column: number}) => point.column - 1, getVersionId: () => version} as unknown as monaco.editor.ITextModel;
  const editor = {getModel: () => model, getPosition: () => position, getSelections: () => [{}], getSelection: () => ({isEmpty: () => empty}),
    onDidChangeCursorSelection: on('cursor'), onDidChangeModel: on('model'), onDidDispose: on('dispose')} as unknown as monaco.editor.IStandaloneCodeEditor;
  const list = vi.fn(() => new Promise<SqlSnippet[] | undefined>(resolve => {finish = resolve;}));
  const token = {isCancellationRequested: false} as monaco.CancellationToken;
  const provider = createSnippetCompletionProvider({editor, dialect: 'postgresql', current: () => current, list, kind: 27, keepWhitespace: 1});
  const request = () => Promise.resolve(provider.provideCompletionItems(model, position as monaco.Position, {} as monaco.languages.CompletionContext, token));
  return {provider, request, list, token, events, finish: (rows: SqlSnippet[] | undefined = [row]) => finish(rows),
    change() {text = 'pq'; version++; text = 'pg'; version++;}, block() {current = false;}, selection() {empty = false;},
    cursorABA() {position = {lineNumber: 1, column: 2}; events.get('cursor')?.(); position = {lineNumber: 1, column: 3}; events.get('cursor')?.();}};
}
it('本地正文按普通文本规则插入准确前缀，不插值美元变量', async () => {
  const f = fixture(), pending = f.request(); f.finish();
  const result = await pending;
  expect(result?.suggestions).toMatchObject([{insertText: row.sql, insertTextRules: 1,
    range: {startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 3}}]);
  expect(f.list).toHaveBeenCalledTimes(1); f.provider.dispose(); expect(f.events.size).toBe(0);
});
it.each(['cursorABA', 'change', 'block', 'selection', 'invalidate', 'dispose', 'model', 'cancel'] as const)('本地读取期间%s永久撤销迟到建议', async action => {
  const f = fixture(), pending = f.request();
  if (action === 'invalidate' || action === 'dispose') f.provider[action]();
  else if (action === 'model') f.events.get('model')?.();
  else if (action === 'cancel') (f.token as {isCancellationRequested: boolean}).isCancellationRequested = true;
  else f[action]();
  f.finish(); expect(await pending).toBeUndefined(); f.provider.dispose();
});
it('共享本地回包只交付最新请求；失败和未就绪不生成替代正文', async () => {
  const f = fixture(); let finish!: (rows: SqlSnippet[]) => void;
  const shared = new Promise<SqlSnippet[]>(resolve => {finish = resolve;}); f.list.mockReturnValue(shared);
  const first = f.request(), second = f.request(); finish([row]);
  expect(await first).toBeUndefined(); expect((await second)?.suggestions).toHaveLength(1);
  f.list.mockRejectedValueOnce(Error('本地读取失败')); expect(await f.request()).toBeUndefined();
  f.block(); expect(await f.request()).toBeUndefined(); expect(f.list).toHaveBeenCalledTimes(3);
  f.provider.dispose();
});
