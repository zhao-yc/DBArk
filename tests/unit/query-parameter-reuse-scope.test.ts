import { describe, expect, it } from 'vitest';
import { QueryParameterReuseScopeReader, type QueryParameterReusePosition, type QueryParameterReuseRange, type QueryParameterReuseSelection, type QueryParameterReuseScopeInput } from '../../src/renderer/queryParameterReuseScope';
import { QueryParameterReuseCache } from '../../src/renderer/queryParameterReuse';
import { QueryParameterReuseCandidate } from '../../src/renderer/queryParameterReuseCandidate';
import type { QueryParameterNames } from '../../src/shared/queryParameters';

/** 最小文本模型结构端口，不导入Monaco/React；偏移按UTF16计算并保留CRLF。 */
function model(text = 'SELECT :value;\r\nSELECT :other; --😀') {
  const value = { text, version: 1, disposed: false, fail: false, mismatch: false, onRead: undefined as undefined | (() => void),
    getValue() { if (value.fail) throw Error('模型不可读'); value.onRead?.(); return value.text; },
    getVersionId() { return value.version; }, isDisposed() { return value.disposed; },
    getOffsetAt(position: QueryParameterReusePosition) { const lines = value.text.split('\n'); return lines.slice(0, position.lineNumber - 1).reduce((total, line) => total + line.length + 1, 0) + position.column - 1; },
    getValueInRange(range: QueryParameterReuseRange) { return value.mismatch ? '不一致选区' : value.text.slice(value.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn }), value.getOffsetAt({ lineNumber: range.endLineNumber, column: range.endColumn })); }
  }; return value;
}
/** 合法位置由独立偏移推导；边界反例可以准确指定CRLF/代理对内部位置。 */
function selection(value: ReturnType<typeof model>, start: number, end: number): QueryParameterReuseSelection {
  const position = (offset: number) => { const prefix = value.text.slice(0, offset).split('\n'); return { lineNumber: prefix.length, column: prefix.at(-1)!.length + 1 }; }, a = position(start), b = position(end);
  return { startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column, getStartPosition: () => ({ ...a }), getEndPosition: () => ({ ...b }) };
}
/** 工作区每次可返回新对象；只有明确语义字段变化才改变三个单槽token。 */
function fixture() {
  const value = model(); let currentModel: ReturnType<typeof model> | null = value, currentSelection: QueryParameterReuseSelection | null = selection(value, 0, 0), failRead = false;
  const editor = { getModel: () => currentModel, getSelection: () => currentSelection };
  let input: QueryParameterReuseScopeInput | null = { tabId: 'tab', connectionId: 'connection', connectionVersion: 2, sessionId: 'session', editor, present: true, draft: value.text, savedSourceKey: '', fileSourceKey: '', databaseKey: 'known:db', databaseKnown: true, formIdentity: {}, taskId: 'previous' };
  const reader = new QueryParameterReuseScopeReader(() => { if (failRead) throw Error('工作区不可读'); return input ? { ...input } : null; });
  return { value, editor, reader, input: () => input!, set: (next: QueryParameterReuseScopeInput | null) => { input = next; }, choose: (start: number, end: number) => { currentSelection = selection(value, start, end); }, select: (next: QueryParameterReuseSelection | null) => { currentSelection = next; }, attach: (next: ReturnType<typeof model> | null) => { currentModel = next; }, fail: (next: boolean) => { failRead = next; } };
}
const info: QueryParameterNames = { names: ['value'], warnings: [], noBackslashEscapes: false, ansiQuotes: false, maxDecimalScale: 30, allowTimeEndpointFraction: false };

describe('参数RAM来源的最小结构语义读取', () => {
  it('同语义工作区克隆保持token，真实模型身份/版本/session及form/task直接透传', () => {
    const f = fixture(), first = f.reader.read()!; f.set({ ...f.input() }); const next = f.reader.read()!;
    expect(next).not.toBe(first); expect(next.scope.savedSourceIdentity).toBe(first.scope.savedSourceIdentity); expect(next.scope.fileSourceIdentity).toBe(first.scope.fileSourceIdentity); expect(next.scope.defaultDatabaseIdentity).toBe(first.scope.defaultDatabaseIdentity);
    expect(next.scope).toMatchObject({ tabId: 'tab', connectionId: 'connection', connectionVersion: 2, sessionId: 'session', modelVersion: 1, source: f.value.text, rangeIdentity: 'all' }); expect(next.scope.editorIdentity).toBe(f.editor); expect(next.scope.modelIdentity).toBe(f.value); expect(next.formIdentity).toBe(f.input().formIdentity); expect(next.taskId).toBe('previous');
  });
  it('workspace草稿不替代模型原文，外来草稿先到及回旧值均产生新saved token', () => {
    const f = fixture(), first = f.reader.read()!; f.set({ ...f.input(), draft: '外来草稿' }); const changed = f.reader.read()!;
    expect(changed.scope.source).toBe(f.value.text); expect(changed.scope.savedSourceIdentity).not.toBe(first.scope.savedSourceIdentity); expect(changed.scope.fileSourceIdentity).toBe(first.scope.fileSourceIdentity);
    f.set({ ...f.input(), draft: f.value.text }); const restored = f.reader.read()!; expect(restored.scope.savedSourceIdentity).not.toBe(first.scope.savedSourceIdentity); expect(restored.scope.savedSourceIdentity).not.toBe(changed.scope.savedSourceIdentity);
  });
  it('saved/file来源各自单槽A-B-A换token，不保存历史tokenMap', () => {
    for (const key of ['savedSourceKey', 'fileSourceKey'] as const) {
      const f = fixture(), first = f.reader.read()!, identity = key === 'savedSourceKey' ? 'savedSourceIdentity' : 'fileSourceIdentity';
      f.set({ ...f.input(), [key]: '另一来源' }); const changed = f.reader.read()!; expect(changed.scope[identity]).not.toBe(first.scope[identity]);
      f.set({ ...f.input(), [key]: '' }); const restored = f.reader.read()!; expect(restored.scope[identity]).not.toBe(first.scope[identity]); expect(restored.scope[identity]).not.toBe(changed.scope[identity]);
    }
  });
  it('只有非空白选区改变实际source/range，空白选区及光标移动仍为全文', () => {
    const f = fixture(), first = f.reader.read()!; f.choose(0, 13); const selected = f.reader.read()!; expect(selected.scope).toMatchObject({ source: 'SELECT :value', rangeIdentity: 'selection:0:13' });
    f.choose(14, 16); const whitespace = f.reader.read()!; expect(whitespace.scope.source).toBe(f.value.text); expect(whitespace.scope.rangeIdentity).toBe('all');
    f.choose(2, 2); const cursor = f.reader.read()!; expect(cursor.scope.source).toBe(first.scope.source); expect(cursor.scope.rangeIdentity).toBe('all'); expect(cursor.scope.savedSourceIdentity).toBe(first.scope.savedSourceIdentity);
    f.select(null); expect(f.reader.read()!.scope.rangeIdentity).toBe('all');
  });
  it('父事件每次observe使正文Undo和有效范围A-B-A不能恢复旧缓存', () => {
    const f = fixture(), cache = new QueryParameterReuseCache(() => f.reader.read()?.scope ?? null); let lease = cache.setOptIn(cache.begin()!, true)!; expect(cache.remember(lease, info, [{ name: 'value', type: 'text', value: '仅RAM原值' }])).toBe(true);
    f.choose(0, 13); cache.observe(); f.choose(0, 0); cache.observe(); expect(cache.read(lease, info)).toBeNull();
    lease = cache.setOptIn(cache.begin()!, true)!; expect(cache.remember(lease, info, [{ name: 'value', type: 'text', value: '新一组' }])).toBe(true); const original = f.value.text;
    f.value.text = 'SELECT :other'; f.value.version++; cache.observe(); f.value.text = original; f.value.version++; cache.observe(); expect(cache.read(lease, info)).toBeNull(); expect(f.reader.read()!.scope.source).toBe(original); expect(f.reader.read()!.scope.modelVersion).toBe(3);
  });
  it('拒绝CRLF/代理对内部边界及不一致range，失败清memos后原key也生成新token', () => {
    const f = fixture(), first = f.reader.read()!, cr = f.value.text.indexOf('\r'); f.choose(cr + 1, cr + 2); expect(f.reader.read()).toBeNull(); f.choose(0, 0); expect(f.reader.read()!.scope.savedSourceIdentity).not.toBe(first.scope.savedSourceIdentity);
    const emoji = f.value.text.indexOf('😀'); f.choose(emoji + 1, emoji + 2); expect(f.reader.read()).toBeNull();
    f.choose(0, 13); f.value.mismatch = true; expect(f.reader.read()).toBeNull(); f.value.mismatch = false;
    const inconsistent = selection(f.value, 0, 13); inconsistent.startColumn = 2; f.select(inconsistent); expect(f.reader.read()).toBeNull();
  });
  it('普通Cache在unknown时换default token，Candidate按原实际库key确认后可重新发布', () => {
    const f = fixture(), cache = new QueryParameterReuseCache(() => f.reader.read()?.scope ?? null), lease = cache.setOptIn(cache.begin()!, true)!; expect(cache.remember(lease, info, [{ name: 'value', type: 'integer', value: '18446744073709551615' }])).toBe(true);
    const original = f.reader.read()!, candidate = QueryParameterReuseCandidate.capture(cache, lease, info, () => f.reader.read(), () => 0)!;
    f.set({ ...f.input(), taskId: 'task' }); expect(candidate.bind('task')).toBe(true); expect(candidate.beforeLedger('task')).toBe(true);
    f.set({ ...f.input(), databaseKnown: false }); cache.observe(); const unknown = f.reader.read()!; expect(unknown.scope.defaultDatabaseIdentity).not.toBe(original.scope.defaultDatabaseIdentity); expect(unknown.databaseKey).toBe('known:db'); expect(unknown.databaseKnown).toBe(false); expect(candidate.observe()).toBe(true); expect(candidate.settled('task', true)).toBe(true);
    f.set({ ...f.input(), databaseKnown: true }); cache.observe(); const restored = f.reader.read()!; expect(restored.databaseKey).toBe(original.databaseKey); expect(restored.scope.defaultDatabaseIdentity).not.toBe(original.scope.defaultDatabaseIdentity); expect(candidate.publish('task', restored.databaseKey, cache)).toBe(true); expect(cache.read(cache.begin()!, info)).toEqual([{ name: 'value', type: 'integer', value: '18446744073709551615' }]);
  });
  it('缺模型/关闭/异常不留旧token，dispose释放reader和memo后永不复活', () => {
    const f = fixture(), first = f.reader.read()!; f.attach(null); expect(f.reader.read()).toBeNull(); f.attach(f.value); expect(f.reader.read()!.scope.fileSourceIdentity).not.toBe(first.scope.fileSourceIdentity);
    f.set({ ...f.input(), present: false }); expect(f.reader.read()).toBeNull(); f.set({ ...f.input(), present: true }); f.fail(true); expect(f.reader.read()).toBeNull(); f.fail(false); f.value.disposed = true; expect(f.reader.read()).toBeNull(); f.value.disposed = false;
    f.reader.dispose(); expect(f.reader.read()).toBeNull(); expect(f.reader).toMatchObject({ reader: null, savedMemo: null, fileMemo: null, databaseMemo: null });
  });
  it('读取中模型或工作区来源同步变动拒绝混合快照，不发布伪稳定scope', () => {
    const f = fixture(); let once = true; f.value.onRead = () => { if (once) { once = false; f.set({ ...f.input(), fileSourceKey: '外来文件' }); } }; expect(f.reader.read()).toBeNull(); f.value.onRead = undefined; expect(f.reader.read()).not.toBeNull();
    let checks = 0; const original = f.value.getVersionId; f.value.getVersionId = () => { checks++; return checks === 1 ? 1 : 2; }; expect(f.reader.read()).toBeNull(); f.value.getVersionId = original;
  });
});
