import { describe, expect, it, vi } from 'vitest';
import { QueryParameterReuseCache, queryParameterInfo, type QueryParameterReuseScope } from '../../src/renderer/queryParameterReuse';
import { QueryParameterReuseCandidate, type QueryParameterReuseCandidateView } from '../../src/renderer/queryParameterReuseCandidate';
import type { QueryParameter, QueryParameterNames } from '../../src/shared/queryParameters';

const info = (): QueryParameterNames => ({ dialect: 'sqlite', names: ['value'], warnings: [], noBackslashEscapes: true, ansiQuotes: true, ansiQuotesKnown: true, noBackslashEscapesKnown: true, maxDecimalScale: 38, allowTimeEndpointFraction: true });
const params: QueryParameter[] = [{ name: 'value', type: 'date', value: '0001-01-01' }];
function fixture() { let scope: QueryParameterReuseScope | null = { tabId: 'tab', connectionId: 'sqlite', connectionVersion: 1, sessionId: 'sqlite:s', editorIdentity: {}, modelIdentity: {}, modelVersion: 1, source: 'SELECT :value', rangeIdentity: 'all', savedSourceIdentity: null, fileSourceIdentity: null, defaultDatabaseIdentity: {} }; const cache = new QueryParameterReuseCache(() => scope), lease = cache.setOptIn(cache.begin()!, true)!; return { cache, lease, scope: () => scope!, set(next: QueryParameterReuseScope | null) { scope = next; cache.observe(); } }; }
describe('SQLite 参数RAM元数据分发与隐私边界', () => {
  it('按SQLite校验并保留原typed副本，不降级MySQL日期或把值变字面量', () => { const f = fixture(); expect(f.cache.remember(f.lease, info(), params)).toBe(true); const copy = f.cache.read(f.lease, info())!; expect(copy).toEqual(params); copy[0].value = '后改'; expect(f.cache.read(f.lease, info())).toEqual(params); });
  it('SQLite exact names不暂存extra或missing，失败清原组且不会发布部分参数', () => { const f = fixture(); expect(f.cache.remember(f.lease, info(), params)).toBe(true); expect(f.cache.remember(f.lease, info(), [...params, { name: 'extra', type: 'null' }])).toBe(false); expect(f.cache.read(f.lease, info())).toBeNull(); expect(f.cache.remember(f.lease, info(), [])).toBe(false); });
  it.each(['mysql', 'mariadb', 'absent'] as const)('dialect变为%s再恢复不能复活旧组，方言参与完整指纹', dialect => { const f = fixture(); expect(f.cache.remember(f.lease, info(), params)).toBe(true); const next = { ...info() }; if (dialect === 'absent') delete next.dialect; else next.dialect = dialect; expect(f.cache.read(f.lease, next)).toBeNull(); expect(f.cache.read(f.lease, info())).toBeNull(); expect(f.cache.remember(f.lease, info(), params)).toBe(false); });
  it('dialect访问器/未知值/扩展字段和不一致SQLite词法事实均拒绝，无getter执行', () => { const getter = vi.fn(() => 'sqlite'), accessed = info(); Object.defineProperty(accessed, 'dialect', { enumerable: true, get: getter });
    for (const raw of [accessed, { ...info(), dialect: 'unknown' }, { ...info(), extra: true }, { ...info(), ansiQuotesKnown: false }, { ...info(), maxDecimalScale: 30 }, { ...info(), noBackslashEscapes: false }]) expect(() => queryParameterInfo(raw)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('元数据快照不借外部数组引用，warnings不缓存但dialect保持', () => { const raw = info(); raw.warnings.push('仅UI文案'); const copied = queryParameterInfo(raw); raw.names[0] = 'mutated'; raw.warnings[0] = '后改'; expect(copied.names).toEqual(['value']); expect(copied.warnings).toEqual(['仅UI文案']); expect(copied.dialect).toBe('sqlite'); });
  it('模型/会话/连接来源ABA仍清秘密，只读缓存不发SQL或持久化', () => { const f = fixture(); expect(f.cache.remember(f.lease, info(), params)).toBe(true); const original = f.scope(); f.set({ ...original, sessionId: 'sqlite:other' }); f.set(original); expect(f.cache.read(f.lease, info())).toBeNull(); });
  it('成功候选复制dialect直到原main确认再发布，date0001不能因漏字段降级被丢弃', () => {
    const f = fixture(); expect(f.cache.remember(f.lease, info(), params)).toBe(true); let view: QueryParameterReuseCandidateView = { scope: f.scope(), databaseKey: '["main"]', databaseKnown: true, formIdentity: {}, taskId: 'previous' };
    const candidate = QueryParameterReuseCandidate.capture(f.cache, f.lease, info(), () => view, () => 1)!; expect(candidate).not.toBeNull(); view = { ...view, taskId: 'task' }; expect(candidate.bind('task')).toBe(true); expect(candidate.beforeLedger('task')).toBe(true); expect(candidate.settled('task', true)).toBe(true); expect(candidate.publish('task', '["main"]', f.cache)).toBe(true); expect(f.cache.read(f.cache.begin()!, info())).toEqual(params);
  });
});
