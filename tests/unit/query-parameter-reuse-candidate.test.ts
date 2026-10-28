import { describe, expect, it } from 'vitest';
import { QueryParameterReuseCache, type QueryParameterReuseScope } from '../../src/renderer/queryParameterReuse';
import { QueryParameterReuseCandidate, queryParameterReuseCandidateTtlMs, type QueryParameterReuseCandidateView } from '../../src/renderer/queryParameterReuseCandidate';
import type { QueryParameter, QueryParameterNames } from '../../src/shared/queryParameters';

/** 真实RAM缓存配合可同步观察的来源；不伪造参数校验结果，不使用IPC、SQL或存储。 */
function fixture() {
  let view: QueryParameterReuseCandidateView | null = { scope: { tabId: 'tab', connectionId: 'connection', connectionVersion: 1, sessionId: 'session', editorIdentity: {}, modelIdentity: {}, modelVersion: 1, source: 'SELECT :value', rangeIdentity: 'all', savedSourceIdentity: null, fileSourceIdentity: null, defaultDatabaseIdentity: {} }, databaseKey: 'known:db', databaseKnown: true, formIdentity: {}, taskId: 'previous' };
  let time = 1000, failRead = false, failClock = false;
  const cache = new QueryParameterReuseCache(() => view?.scope ?? null);
  const info: QueryParameterNames = { names: ['value'], warnings: [], noBackslashEscapes: false, ansiQuotes: false, maxDecimalScale: 30, allowTimeEndpointFraction: false };
  const params: QueryParameter[] = [{ name: 'value', type: 'text', value: '原值😀\r\n\0' }];
  const lease = cache.setOptIn(cache.begin()!, true)!; expect(cache.remember(lease, info, params)).toBe(true);
  const reader = () => { if (failRead) throw Error('来源不可读'); return view; }, now = () => { if (failClock) throw Error('时钟不可读'); return time; };
  const candidate = QueryParameterReuseCandidate.capture(cache, lease, info, reader, now)!;
  return { cache, info, params, candidate, view: () => view!, set: (value: QueryParameterReuseCandidateView | null) => { view = value; cache.observe(); }, clock: (value: number) => { time = value; }, failRead: () => { failRead = true; }, failClock: () => { failClock = true; } };
}
/** 模拟runQuery已同步签发task，然后在原known状态标记即将执行恢复记账。 */
function ledger(f = fixture()) { f.set({ ...f.view(), taskId: 'task' }); expect(f.candidate.bind('task')).toBe(true); expect(f.candidate.beforeLedger('task')).toBe(true); return f; }
/** 实际协议库确认仍为原库，但其对象token可以因unknown恢复而改变。 */
function known(f: ReturnType<typeof fixture>) { f.set({ ...f.view(), databaseKnown: true, databaseKey: 'known:db', scope: { ...f.view().scope, defaultDatabaseIdentity: {} } }); }
/** 明确打开新的读取lease，核缓存是否真正可用而非只检查候选返回值。 */
function cached(f: ReturnType<typeof fixture>, info = f.info) { return f.cache.read(f.cache.begin()!, info); }

describe('本次成功提交后确认实际库才发布参数RAM组', () => {
  it('真实会话非空且已知库才允许捕获，拒绝时只清自己刚remember的组', () => {
    for (const unavailable of ['session', 'database']) {
      const f = fixture(); f.candidate.dispose();
      f.set({ ...f.view(), ...(unavailable === 'session' ? { scope: { ...f.view().scope, sessionId: null } } : { databaseKnown: false, databaseKey: 'unknown' }) });
      const lease = f.cache.setOptIn(f.cache.begin()!, true)!; expect(f.cache.remember(lease, f.info, f.params)).toBe(true);
      expect(QueryParameterReuseCandidate.capture(f.cache, lease, f.info, () => f.view(), () => 0)).toBeNull(); expect(cached(f)).toBeNull();
    }
  });
  it('候选捕获即撤下原组，unknown恢复记账后仍不发布，成功及原实际库确认才回写独立副本', () => {
    const f = ledger(), expected = f.params.map(item => ({ ...item })); expect(cached(f)).toBeNull();
    f.params[0].value = '外来修改'; f.set({ ...f.view(), databaseKnown: false, databaseKey: 'unknown', scope: { ...f.view().scope, defaultDatabaseIdentity: {} } }); expect(f.candidate.observe()).toBe(true);
    expect(f.candidate.settled('task', true)).toBe(true); expect(cached(f)).toBeNull(); known(f); expect(f.candidate.observe()).toBe(true);
    expect(f.candidate.publish('task', 'known:db', f.cache)).toBe(true); expect(cached(f)).toEqual(expected); expect(f.candidate.publish('task', 'known:db', f.cache)).toBe(false);
  });
  it('默认库新对象但同known语义保持候选，已知B到A则首次B永久清除', () => {
    const same = ledger(); known(same); expect(same.candidate.observe()).toBe(true); expect(same.candidate.settled('task', true)).toBe(true); expect(same.candidate.publish('task', 'known:db', same.cache)).toBe(true);
    const changed = ledger(); changed.set({ ...changed.view(), databaseKey: 'known:other' }); expect(changed.candidate.observe()).toBe(false); known(changed); expect(changed.candidate.settled('task', true)).toBe(false); expect(changed.candidate.publish('task', 'known:db', changed.cache)).toBe(false); expect(cached(changed)).toBeNull();
  });
  it('beforeLedger前unknown不被忙态或后续回A放行，重复或错误任务绑定不能转移候选', () => {
    const f = fixture(); f.set({ ...f.view(), taskId: 'task' }); expect(f.candidate.bind('task')).toBe(true); f.set({ ...f.view(), databaseKnown: false, databaseKey: 'unknown' }); expect(f.candidate.observe()).toBe(false); known(f); expect(f.candidate.beforeLedger('task')).toBe(false);
    const other = fixture(); other.set({ ...other.view(), taskId: 'actual' }); expect(other.candidate.bind('wrong')).toBe(false); expect(other.candidate.bind('actual')).toBe(false);
    const duplicate = ledger(); expect(duplicate.candidate.bind('task')).toBe(false); expect(duplicate.candidate.publish('task', 'known:db', duplicate.cache)).toBe(false);
  });
  it('runQuery忙态早退未签发新任务时原task不能bind，后来新任务也不能复活旧候选', () => {
    const f = fixture(); expect(f.view().taskId).toBe('previous'); expect(f.candidate.bind('previous')).toBe(false);
    expect(f.candidate.beforeLedger('previous')).toBe(false); expect(f.candidate.settled('previous', true)).toBe(false); expect(f.candidate.publish('previous', 'known:db', f.cache)).toBe(false);
    f.set({ ...f.view(), taskId: 'task' }); expect(f.candidate.bind('task')).toBe(false); expect(f.candidate.beforeLedger('task')).toBe(false); expect(f.candidate.publish('task', 'known:db', f.cache)).toBe(false); expect(cached(f)).toBeNull();
  });
  it('实际RPC失败或取消不发布；仅已有原缓存但未remember的空组也不能构造候选', () => {
    const f = ledger(); expect(f.candidate.settled('task', false)).toBe(false); expect(f.candidate.settled('task', true)).toBe(false); expect(f.candidate.publish('task', 'known:db', f.cache)).toBe(false); expect(cached(f)).toBeNull();
    const empty = new QueryParameterReuseCache(() => f.view().scope), lease = empty.begin()!; expect(QueryParameterReuseCandidate.capture(empty, lease, f.info, () => f.view(), () => 0)).toBeNull();
  });
  it('publish必须reader实际known且三方key一致，不能只传原库字符串冒充已确认', () => {
    const unknown = ledger(); unknown.set({ ...unknown.view(), databaseKnown: false, databaseKey: 'unknown' }); expect(unknown.candidate.settled('task', true)).toBe(true); expect(unknown.candidate.publish('task', 'known:db', unknown.cache)).toBe(false); known(unknown); expect(unknown.candidate.publish('task', 'known:db', unknown.cache)).toBe(false); expect(cached(unknown)).toBeNull();
    const wrong = ledger(); expect(wrong.candidate.settled('task', true)).toBe(true); expect(wrong.candidate.publish('task', 'known:other', wrong.cache)).toBe(false); expect(cached(wrong)).toBeNull();
    const cache = ledger(); expect(cache.candidate.settled('task', true)).toBe(true); const other = new QueryParameterReuseCache(() => cache.view().scope); expect(cache.candidate.publish('task', 'known:db', other)).toBe(false); expect(cached(cache)).toBeNull();
  });
  it('正文/范围/模型/会话/连接/来源与表单ABA均在第一次observe永久撤销', () => {
    const patches: Partial<QueryParameterReuseScope>[] = [{ source: 'SELECT :other' }, { rangeIdentity: 'selection:1:14' }, { modelVersion: 2 }, { modelIdentity: {} }, { editorIdentity: {} }, { sessionId: 'another' }, { connectionId: 'other' }, { connectionVersion: 2 }, { savedSourceIdentity: {} }, { fileSourceIdentity: {} }, { tabId: 'other' }];
    for (const patch of patches) { const f = ledger(), old = f.view(); f.set({ ...old, scope: { ...old.scope, ...patch } }); expect(f.candidate.observe()).toBe(false); f.set(old); expect(f.candidate.observe()).toBe(false); expect(f.candidate.settled('task', true)).toBe(false); expect(cached(f)).toBeNull(); }
    const form = ledger(), old = form.view(); form.set({ ...old, formIdentity: {} }); expect(form.candidate.observe()).toBe(false); form.set(old); expect(form.candidate.publish('task', 'known:db', form.cache)).toBe(false);
    const task = ledger(); task.set({ ...task.view(), taskId: 'new-task', databaseKnown: false }); expect(task.candidate.observe()).toBe(false);
  });
  it('TTL只从原成功settled起算，截止前可发布，截止点/回拨/重复settled不可续期', () => {
    const before = ledger(); before.clock(100_000); expect(before.candidate.observe()).toBe(true); expect(before.candidate.settled('task', true)).toBe(true); before.clock(100_000 + queryParameterReuseCandidateTtlMs - 1); expect(before.candidate.publish('task', 'known:db', before.cache)).toBe(true);
    const expired = ledger(); expect(expired.candidate.settled('task', true)).toBe(true); expired.clock(1000 + queryParameterReuseCandidateTtlMs); expect(expired.candidate.observe()).toBe(false); expired.clock(1000); expect(expired.candidate.publish('task', 'known:db', expired.cache)).toBe(false);
    const backward = ledger(); expect(backward.candidate.settled('task', true)).toBe(true); backward.clock(2000); expect(backward.candidate.observe()).toBe(true); backward.clock(1999); expect(backward.candidate.observe()).toBe(false);
    const repeated = ledger(); expect(repeated.candidate.settled('task', true)).toBe(true); repeated.clock(20_000); expect(repeated.candidate.settled('task', true)).toBe(false); expect(repeated.candidate.publish('task', 'known:db', repeated.cache)).toBe(false);
  });
  it('reader/clock异常、关闭或dispose清引用，迟到方法不能重新发布', () => {
    const reader = ledger(); reader.failRead(); expect(reader.candidate.observe()).toBe(false); expect(reader.candidate.publish('task', 'known:db', reader.cache)).toBe(false);
    const clock = ledger(); clock.failClock(); expect(clock.candidate.settled('task', true)).toBe(false); expect(clock.candidate.publish('task', 'known:db', clock.cache)).toBe(false);
    const closed = ledger(); closed.set(null); expect(closed.candidate.observe()).toBe(false); expect(closed.candidate.settled('task', true)).toBe(false);
    const disposed = ledger(); disposed.candidate.dispose(); expect(disposed.candidate.observe()).toBe(false); expect(disposed.candidate.publish('task', 'known:db', disposed.cache)).toBe(false); expect(disposed.candidate).toMatchObject({ cache: null, origin: null, info: null, params: null, reader: null, now: null });
  });
  it('缓存通知中换新表单并写新组时，旧候选发布失败但不清掉新writer的值', () => {
    const f = ledger(); expect(f.candidate.settled('task', true)).toBe(true); let armed = true;
    const unsubscribe = f.cache.subscribe(() => { if (!armed) return; armed = false; f.set({ ...f.view(), formIdentity: {} }); f.candidate.observe(); const writer = f.cache.setOptIn(f.cache.begin()!, true)!; expect(f.cache.remember(writer, f.info, [{ name: 'value', type: 'text', value: '新表单新组' }])).toBe(true); });
    expect(f.candidate.publish('task', 'known:db', f.cache)).toBe(false); unsubscribe(); expect(cached(f)).toEqual([{ name: 'value', type: 'text', value: '新表单新组' }]);
  });
});
