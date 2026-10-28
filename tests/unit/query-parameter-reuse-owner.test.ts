import { describe, expect, it } from 'vitest';
import { QueryParameterReuseOwner, type QueryParameterReuseOwnerInput } from '../../src/renderer/queryParameterReuseOwner';
import type { QueryParameterReusePort } from '../../src/renderer/queryParameterReusePort';
import type { QueryParameterNames } from '../../src/shared/queryParameters';
import type { QueryParameterReuseRange, QueryParameterReuseSelection } from '../../src/renderer/queryParameterReuseScope';

const info: QueryParameterNames = { names: ['value'], warnings: [], noBackslashEscapes: false, ansiQuotes: false, maxDecimalScale: 30, allowTimeEndpointFraction: false };
const params = (value = '原值😀\r\n\0') => [{ name: 'value', type: 'text' as const, value }];
/** 实际组合三层RAM类；仅Monaco/workspace边界使用最小结构，不替换内部校验和候选生命周期。 */
function fixture(pending = false) {
  const model = { text: 'SELECT :value', version: 1, disposed: false, getValue() { return model.text; }, getVersionId() { return model.version; }, isDisposed() { return model.disposed; }, getOffsetAt(position: { lineNumber: number; column: number }) { return position.column - 1; }, getValueInRange(range: QueryParameterReuseRange) { return model.text.slice(range.startColumn - 1, range.endColumn - 1); } };
  let selection: QueryParameterReuseSelection | null = null, input: QueryParameterReuseOwnerInput | null;
  const editor = { getModel: () => model, getSelection: () => selection };
  input = { tabId: 'tab', connectionId: 'connection', connectionVersion: 1, sessionId: pending ? null : 'session', editor, present: true, draft: model.text, savedSourceKey: '', fileSourceKey: '', databaseKey: pending ? 'unknown' : 'known:db', databaseKnown: !pending, taskId: 'previous' };
  const owner = new QueryParameterReuseOwner(() => input ? { ...input } : null);
  return { owner, model, input: () => input!, set(patch: Partial<QueryParameterReuseOwnerInput>) { input = { ...input!, ...patch }; owner.observe(); }, closeSource() { input = null; owner.observe(); }, select(end: number) { selection = end ? { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: end + 1, getStartPosition: () => ({ lineNumber: 1, column: 1 }), getEndPosition: () => ({ lineNumber: 1, column: end + 1 }) } : null; owner.observe(); } };
}
/** 正常打开并重新识别；新表单不自动opt-in或填入旧组。 */
function open(f: ReturnType<typeof fixture>): QueryParameterReusePort { const port = f.owner.begin(f.model.text)!; expect(port).not.toBeNull(); expect(f.owner.recognized(port)).toBe(true); return port; }
/** 模拟父runQuery已同步签发新task，再允许仅本次恢复记账unknown。 */
function handoff(f: ReturnType<typeof fixture>, port: QueryParameterReusePort, taskId: string) {
  const databaseKey = f.input().databaseKey; f.set({ taskId }); expect(f.owner.bind(port, taskId)).toBe(true); expect(port.current()).toBe(false); f.owner.beforeLedger(taskId); f.set({ databaseKnown: false, databaseKey: 'unknown' }); return databaseKey;
}
/** 只有成功终态和实际原库确认两者都完成，才能重新读取到已发布组。 */
function complete(f: ReturnType<typeof fixture>, value: string, taskId: string) {
  const port = open(f); expect(port.setOptIn(true)).toBe(true); expect(port.stage(info, params(value))).toBe(true); expect(port.current()).toBe(true);
  const key = handoff(f, port, taskId); f.owner.settled(taskId, true); f.set({ databaseKnown: true, databaseKey: key }); expect(f.owner.confirmed(taskId, key)).toBe(true); return port;
}

describe('QueryTab参数复用Owner真实RAM组合', () => {
  it('只有原候选首次成功进入waiting才返回补读许可，旧任务不能消费原组', () => {
    const f = fixture(); try {
      const port = open(f); port.setOptIn(true); expect(port.stage(info, params())).toBe(true);
      const key = handoff(f, port, 'actual-task');
      expect(f.owner.settled('old-task', true)).toBe(false);
      expect(f.owner.settled('actual-task', true)).toBe(true);
      expect(f.owner.settled('old-task', false)).toBe(false);
      f.set({ databaseKnown: true, databaseKey: key }); expect(f.owner.confirmed('actual-task', key)).toBe(true);
      expect(f.owner.settled('actual-task', true)).toBe(false); expect(open(f).read(info)).toEqual(params());
    } finally { f.owner.dispose(); }
  });
  it('pending首建会话及实际库确认只允许一次，识别前current可用但不能读写参数', () => {
    const f = fixture(true), port = f.owner.begin(f.model.text)!; expect(port.current()).toBe(true); expect(port.has(info)).toBe(false); expect(port.read(info)).toBeNull(); expect(port.setOptIn(true)).toBe(false); expect(port.stage(info, params())).toBe(false); expect(f.owner.recognized(port)).toBe(false);
    f.set({ sessionId: 'first-session' }); expect(port.current()).toBe(true); f.set({ databaseKnown: true, databaseKey: '[null]' }); expect(port.current()).toBe(true); expect(f.owner.recognized(port)).toBe(true);
    expect(port.setOptIn(true)).toBe(true); expect(f.owner.recognized(port)).toBe(true); expect(port.stage(info, params())).toBe(true); expect(port.current()).toBe(true); f.owner.dispose();
  });
  it('pending会话先建立后换另一个或正文ABA，旧port不能靠再次recognized复活', () => {
    const f = fixture(true), port = f.owner.begin(f.model.text)!; f.set({ sessionId: 'first-session' }); f.set({ sessionId: 'second-session' }); expect(port.current()).toBe(false); f.set({ sessionId: 'first-session', databaseKnown: true, databaseKey: 'known:db' }); expect(f.owner.recognized(port)).toBe(false);
    const text = fixture(true), old = text.owner.begin(text.model.text)!; const initial = text.model.text; text.model.text = 'SELECT :other'; text.model.version++; text.owner.observe(); text.model.text = initial; text.model.version++; text.set({ sessionId: 'session', databaseKnown: true, databaseKey: 'known:db' }); expect(old.current()).toBe(false); expect(text.owner.recognized(old)).toBe(false); f.owner.dispose(); text.owner.dispose();
  });
  it('默认unchecked不stage，own checkbox轮换不使current瞬间失效，明确成功确认后新表单才可读', () => {
    const f = fixture(), port = open(f), notifications: boolean[] = []; const off = port.subscribe(() => { notifications.push(port.current()); });
    expect(port.stage(info, params())).toBe(false); expect(port.setOptIn(true)).toBe(true); expect(port.current()).toBe(true); expect(port.setOptIn(false)).toBe(true); expect(port.current()).toBe(true); expect(port.setOptIn(true)).toBe(true); expect(notifications.every(Boolean)).toBe(true);
    const values = params('9007199254740993.123456789012'); expect(port.stage(info, values)).toBe(true); values[0].value = '外来改动'; expect(port.read(info)).toBeNull(); expect(port.current()).toBe(true); expect(port.stage(info, params())).toBe(false);
    const key = handoff(f, port, 'task'); off(); f.owner.settled('task', true); f.set({ databaseKnown: true, databaseKey: key }); expect(f.owner.confirmed('task', key)).toBe(true);
    const next = open(f); expect(next.has(info)).toBe(true); const read = next.read(info)!; expect(read).toEqual(params('9007199254740993.123456789012')); read[0].value = '外部改动'; expect(next.read(info)).toEqual(params('9007199254740993.123456789012')); expect(next.stage(info, params())).toBe(false); f.owner.dispose();
  });
  it('completionState早确认不杀合法候选，失败或取消则不能发布', () => {
    const f = fixture(), port = open(f); expect(port.setOptIn(true)).toBe(true); expect(port.stage(info, params('完成后保存'))).toBe(true); f.set({ taskId: 'task' }); expect(f.owner.bind(port, 'task')).toBe(true);
    expect(f.owner.confirmed('task', 'known:db')).toBe(false); f.owner.beforeLedger('task'); expect(f.owner.confirmed('task', 'known:db')).toBe(false); f.set({ databaseKnown: false, databaseKey: 'unknown' }); f.owner.settled('task', true); f.set({ databaseKnown: true, databaseKey: 'known:db' }); expect(f.owner.confirmed('task', 'known:db')).toBe(true);
    const failed = open(f); expect(failed.setOptIn(true)).toBe(true); expect(failed.stage(info, params('失败不能留'))).toBe(true); const key = handoff(f, failed, 'failed'); f.owner.settled('failed', false); f.set({ databaseKnown: true, databaseKey: key }); expect(f.owner.confirmed('failed', key)).toBe(false); expect(open(f).read(info)).toBeNull(); f.owner.dispose();
  });
  it('已有已发布组的新begin默认unchecked，forget真正清组且原form可重新勾选stage', () => {
    const f = fixture(); complete(f, '已有组', 'one'); const port = open(f); expect(port.read(info)).toEqual(params('已有组')); port.forget(); expect(port.current()).toBe(true); expect(port.read(info)).toBeNull(); expect(port.setOptIn(true)).toBe(true); expect(port.stage(info, params('忘记后新组'))).toBe(true);
    const key = handoff(f, port, 'two'); f.owner.settled('two', true); f.set({ databaseKnown: true, databaseKey: key }); expect(f.owner.confirmed('two', key)).toBe(true); expect(open(f).read(info)).toEqual(params('忘记后新组')); f.owner.dispose();
  });
  it('forget通知中重入新begin，旧forget不能发新lease覆盖新表单opt-in', () => {
    const f = fixture(); complete(f, '原组', 'one'); const old = open(f); let current: QueryParameterReusePort | null = null, armed = true;
    old.subscribe(() => { if (!armed) return; armed = false; current = open(f); expect(current.setOptIn(true)).toBe(true); }); old.forget();
    const next = current as QueryParameterReusePort | null; expect(old.current()).toBe(false); expect(next).not.toBeNull(); expect(next!.current()).toBe(true); expect(next!.stage(info, params('重入新组'))).toBe(true);
    const key = handoff(f, next!, 'nested'); f.owner.settled('nested', true); f.set({ databaseKnown: true, databaseKey: key }); expect(f.owner.confirmed('nested', key)).toBe(true); expect(open(f).read(info)).toEqual(params('重入新组')); f.owner.dispose();
  });
  it('关闭和旧port回调保合法已发布组，旧task终态不能清掉新任务组', () => {
    const f = fixture(), old = complete(f, '原组', 'one'), canceled = open(f); expect(canceled.read(info)).toEqual(params('原组')); f.owner.close(canceled); expect(canceled.current()).toBe(false);
    const next = open(f); old.forget(); old.setOptIn(false); f.owner.close(old); expect(next.read(info)).toEqual(params('原组'));
    expect(next.setOptIn(true)).toBe(true); expect(next.stage(info, params('新组'))).toBe(true); const key = handoff(f, next, 'two'); f.owner.close(next); f.owner.settled('one', false); expect(f.owner.confirmed('one', key)).toBe(false); f.owner.settled('two', true); f.set({ databaseKnown: true, databaseKey: key }); expect(f.owner.confirmed('two', key)).toBe(true); expect(open(f).read(info)).toEqual(params('新组')); f.owner.dispose();
  });
  it('unchecked没有candidate的正常新task允许执行，旧task忙态早退不能bind或误留值', () => {
    const f = fixture(), port = open(f); f.set({ taskId: 'unchecked' }); expect(f.owner.bind(port, 'unchecked')).toBe(true); f.owner.beforeLedger('unchecked'); f.owner.settled('unchecked', true); expect(f.owner.confirmed('unchecked', 'known:db')).toBe(false); expect(open(f).read(info)).toBeNull();
    const busy = open(f); expect(busy.setOptIn(true)).toBe(true); expect(busy.stage(info, params())).toBe(true); expect(f.owner.bind(busy, 'unchecked')).toBe(false); f.owner.beforeLedger('unchecked'); f.owner.settled('unchecked', true); expect(f.owner.confirmed('unchecked', 'known:db')).toBe(false); f.owner.dispose();
  });
  it('scope/选区/连接ABA即时永久失效，不能对旧portrecognized重新begin能力', () => {
    for (const key of ['savedSourceKey', 'fileSourceKey', 'connectionVersion'] as const) {
      const f = fixture(), port = open(f), original = f.input()[key]; f.set({ [key]: key === 'connectionVersion' ? 2 : 'changed' }); expect(port.current()).toBe(false); f.set({ [key]: original }); expect(port.current()).toBe(false); expect(f.owner.recognized(port)).toBe(false); expect(port.setOptIn(true)).toBe(false); expect(port.stage(info, params())).toBe(false); f.owner.dispose();
    }
    const selection = fixture(), port = open(selection); selection.select(6); selection.select(0); expect(port.current()).toBe(false); expect(selection.owner.recognized(port)).toBe(false); selection.owner.dispose();
  });
  it('新begin清未发布候选；known B回A、会话改变、关闭和dispose均不能迟到发布', () => {
    for (const change of ['form', 'database', 'session', 'closed'] as const) {
      const f = fixture(), port = open(f); expect(port.setOptIn(true)).toBe(true); expect(port.stage(info, params())).toBe(true); const key = handoff(f, port, 'task');
      if (change === 'form') f.owner.begin(f.model.text); if (change === 'database') { f.set({ databaseKnown: true, databaseKey: 'known:other' }); f.set({ databaseKey: key }); } if (change === 'session') f.set({ sessionId: 'other' }); if (change === 'closed') f.closeSource();
      f.owner.settled('task', true); if (change !== 'closed') f.set({ databaseKnown: true, databaseKey: key }); expect(f.owner.confirmed('task', key)).toBe(false); f.owner.dispose();
    }
    const f = fixture(), port = open(f); let calls = 0; port.subscribe(() => { calls++; }); f.owner.dispose(); const terminalCalls = calls; expect(port.current()).toBe(false); expect(f.owner.begin(f.model.text)).toBeNull(); port.forget(); expect(port.stage(info, params())).toBe(false); f.owner.observe(); expect(calls).toBe(terminalCalls);
  });
});
