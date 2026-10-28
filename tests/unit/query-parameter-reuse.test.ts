import { describe, expect, it, vi } from 'vitest';
import { QueryParameterReuseCache, type QueryParameterReuseScope } from '../../src/renderer/queryParameterReuse';
import { queryParameterLimits, type QueryParameter, type QueryParameterNames } from '../../src/shared/queryParameters';

function fixture() {
  let scope: QueryParameterReuseScope | null = { tabId: 'tab', connectionId: 'connection', connectionVersion: 1, sessionId: 'session', editorIdentity: {}, modelIdentity: {}, modelVersion: 1, source: 'SELECT :value', rangeIdentity: 'all', savedSourceIdentity: null, fileSourceIdentity: null, defaultDatabaseIdentity: {} };
  let failure = false;
  const cache = new QueryParameterReuseCache(() => { if (failure) throw Error('reader失败'); return scope; });
  const info: QueryParameterNames = { names: ['value'], warnings: [], noBackslashEscapes: false, ansiQuotes: false, ansiQuotesKnown: true, noBackslashEscapesKnown: true, maxDecimalScale: 30, allowTimeEndpointFraction: false };
  const params: QueryParameter[] = [{ name: 'value', type: 'text', value: '原值😀\r\n\0' }];
  const lease = cache.begin()!;
  return { cache, info, params, lease, scope: () => scope!, replace: (next: QueryParameterReuseScope | null) => { scope = next; }, fail: (value: boolean) => { failure = value; } };
}
function opted(f = fixture()) { return { ...f, lease: f.cache.setOptIn(f.lease, true)! }; }

describe('同标签显式参数RAM暂存', () => {
  it('默认不存、不读；显式同意后才存，重新打开不自动填值或执行', () => {
    const f = fixture(); expect(f.cache.remember(f.lease, f.info, f.params)).toBe(false); expect(f.cache.read(f.lease, f.info)).toBeNull();
    const token = f.cache.setOptIn(f.lease, true)!; expect(f.cache.remember(token, f.info, f.params)).toBe(true);
    const next = f.cache.begin()!; expect(f.cache.read(token, f.info)).toBeNull(); expect(f.cache.has(next, f.info)).toBe(true); expect(f.cache.read(next, f.info)).toEqual(f.params);
    expect(f.cache.remember(next, f.info, [{ name: 'value', type: 'text', value: '未勾选的新值' }])).toBe(false); expect(f.cache.read(next, f.info)).toEqual(f.params);
  });
  it('九类型真实校验，精确数字、NULL、空串、Unicode及可选值形状逐字独立复制', () => {
    const f = opted();
    const params: QueryParameter[] = [
      { name: 'text', type: 'text', value: '' }, { name: 'unicode', type: 'text', value: '中文😀\0\r\n' },
      { name: 'integer', type: 'integer', value: '+18446744073709551615' }, { name: 'decimal', type: 'decimal', value: '-9007199254740993.123456789012' },
      { name: 'boolean', type: 'boolean', value: 'false' }, { name: 'date', type: 'date', value: '2024-02-29' },
      { name: 'datetime', type: 'datetime', value: '2024-02-29 23:59:59.123456' }, { name: 'time', type: 'time', value: '-838:59:59.000000' },
      { name: 'binary', type: 'binary', value: '00FFa1' }, { name: 'nil', type: 'null' }, { name: 'nilEmpty', type: 'null', value: '' }, { name: 'nilUndefined', type: 'null', value: undefined },
    ];
    const info = { ...f.info, names: [] as string[] }; const expected = params.map(parameter => ({ ...parameter }));
    expect(f.cache.remember(f.lease, info, params)).toBe(true); params[1].value = '后来改动'; info.names.reverse();
    const actualInfo = { ...f.info, names: [] as string[] }, first = f.cache.read(f.lease, actualInfo)!;
    expect(first).toEqual(expected); expect(Object.hasOwn(first[9], 'value')).toBe(false); expect(Object.hasOwn(first[11], 'value')).toBe(true);
    first[0].value = '外部修改'; first.reverse(); expect(f.cache.read(f.lease, actualInfo)).toEqual(expected);
  });
  it.each([
    ['integer', '1e3'], ['decimal', 'NaN'], ['boolean', 'TRUE'], ['date', '2023-02-29'], ['datetime', '2024-02-29 24:00:00'],
    ['time', '839:00:00'], ['binary', 'abc'], ['null', 'NULL'], ['text', '\uD800'], ['text', 'x'.repeat(queryParameterLimits.valueBytes + 1)], ['unknown', 'x'],
  ])('沿真实九类型拒绝非法%s，失败不残留上次值', (type, value) => {
    const f = opted(); expect(f.cache.remember(f.lease, f.info, f.params)).toBe(true);
    expect(f.cache.remember(f.lease, f.info, [{ name: 'value', type, value } as QueryParameter])).toBe(false); expect(f.cache.read(f.lease, f.info)).toBeNull();
  });
  it('部分识别名称加手动参数保原完整顺序，缺识别名或重复仍拒绝', () => {
    const f = opted(), info = { ...f.info, names: ['required', 'second'] };
    const params: QueryParameter[] = [{ name: 'extra', type: 'text', value: '手动😀' }, { name: 'second', type: 'null' }, { name: 'required', type: 'integer', value: '18446744073709551615' }];
    expect(f.cache.remember(f.lease, info, params)).toBe(true); expect(f.cache.read(f.lease, info)).toEqual(params);
    expect(f.cache.remember(f.lease, info, params.slice(0, 2))).toBe(false); expect(f.cache.read(f.lease, info)).toBeNull();
    expect(f.cache.remember(f.lease, info, [...params, params[0]])).toBe(false);
  });
  it('30/38位小数及TIME端点沿真实能力校验，允许时保原精度', () => {
    const f = opted(), scale = { ...f.info, maxDecimalScale: 38 as const }, params: QueryParameter[] = [{ name: 'value', type: 'decimal', value: '0.' + '1'.repeat(38) }];
    expect(f.cache.remember(f.lease, f.info, params)).toBe(false); expect(f.cache.remember(f.lease, scale, params)).toBe(true); expect(f.cache.read(f.lease, scale)).toEqual(params);
    const other = opted(), time: QueryParameter[] = [{ name: 'value', type: 'time', value: '838:59:59.000001' }];
    expect(other.cache.remember(other.lease, other.info, time)).toBe(false); const endpoint = { ...other.info, allowTimeEndpointFraction: true };
    expect(other.cache.remember(other.lease, endpoint, time)).toBe(true); expect(other.cache.read(other.lease, endpoint)).toEqual(time);
  });
  it('名字/词法/能力A-B-A永久清值并撤销旧writer，warnings不缓存', () => {
    for (const patch of [{ names: ['other'] }, { names: ['value', 'extra'] }, { noBackslashEscapes: true }, { ansiQuotes: true }, { ansiQuotesKnown: false }, { noBackslashEscapesKnown: false }, { ansiQuotesKnown: undefined }, { maxDecimalScale: 38 as const }, { allowTimeEndpointFraction: true }]) {
      const f = opted(); expect(f.cache.remember(f.lease, f.info, f.params)).toBe(true);
      expect(f.cache.read(f.lease, { ...f.info, ...patch })).toBeNull(); expect(f.cache.read(f.lease, f.info)).toBeNull(); expect(f.cache.remember(f.lease, f.info, f.params)).toBe(false);
      const next = f.cache.begin()!; expect(f.cache.read(next, f.info)).toBeNull();
    }
    const f = opted(); expect(f.cache.remember(f.lease, f.info, f.params)).toBe(true); expect(f.cache.read(f.lease, { ...f.info, warnings: ['另一次识别提示'] })).toEqual(f.params);
    const ordered = opted(), params: QueryParameter[] = [{ name: 'first', type: 'null' }, { name: 'second', type: 'null' }], info = { ...ordered.info, names: ['first', 'second'] };
    expect(ordered.cache.remember(ordered.lease, info, params)).toBe(true); expect(ordered.cache.read(ordered.lease, { ...info, names: ['second', 'first'] })).toBeNull(); expect(ordered.cache.read(ordered.lease, info)).toBeNull();
  });
  it('无效元数据读取同样清秘密并撤销旧writer，不执行getter', () => {
    const f = opted(), getter = vi.fn(() => ['value']); expect(f.cache.remember(f.lease, f.info, f.params)).toBe(true);
    const info = { ...f.info }; Object.defineProperty(info, 'names', { enumerable: true, get: getter });
    expect(f.cache.read(f.lease, info)).toBeNull(); expect(f.cache.read(f.lease, f.info)).toBeNull(); expect(f.cache.remember(f.lease, f.info, f.params)).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
  it('200名称及1MiB总值仍按原预算，超过即拒绝，无部分缓存', () => {
    const f = opted(), params: QueryParameter[] = Array.from({ length: 200 }, (_, index) => ({ name: 'p' + index, type: 'text', value: '' })), info = { ...f.info, names: params.map(parameter => parameter.name) };
    expect(f.cache.remember(f.lease, info, params)).toBe(true); expect(f.cache.read(f.lease, info)).toHaveLength(200);
    const tooMany = [...params, { name: 'p200', type: 'text' as const, value: '' }]; expect(f.cache.remember(f.lease, { ...info, names: tooMany.map(parameter => parameter.name) }, tooMany)).toBe(false);
    const full: QueryParameter[] = Array.from({ length: 16 }, (_, index) => ({ name: 'p' + index, type: 'text', value: 'x'.repeat(65536) })), fullInfo = { ...f.info, names: full.map(parameter => parameter.name) };
    expect(f.cache.remember(f.lease, fullInfo, full)).toBe(true);
    const over = [...full, { name: 'extra', type: 'text' as const, value: '😀' }]; expect(f.cache.remember(f.lease, { ...fullInfo, names: over.map(parameter => parameter.name) }, over)).toBe(false); expect(f.cache.read(f.lease, fullInfo)).toBeNull();
  });
  it('不执行参数、数组及元数据getter，拒绝额外/symbol/稀疏/重复/缺名', () => {
    const f = opted(), getter = vi.fn(() => '敏感值');
    const accessed = { name: 'value', type: 'text' }; Object.defineProperty(accessed, 'value', { enumerable: true, get: getter });
    const sparse = new Array(1), arrayGetter: unknown[] = []; Object.defineProperty(arrayGetter, '0', { enumerable: true, get: getter });
    const bad: unknown[] = [[accessed], sparse, arrayGetter, Object.assign([...f.params], { extra: 1 }), Object.assign([...f.params], { [Symbol('x')]: 1 }), [{ ...f.params[0], extra: 'x' }], [{ ...f.params[0], [Symbol('x')]: 1 }], [f.params[0], f.params[0]]];
    for (const params of bad) expect(f.cache.remember(f.lease, f.info, params as QueryParameter[])).toBe(false);
    const names = Object.defineProperty({}, 'names', { enumerable: true, get: getter }); expect(f.cache.remember(f.lease, names as QueryParameterNames, f.params)).toBe(false);
    expect(f.cache.remember(f.lease, { ...f.info, extra: true } as QueryParameterNames, f.params)).toBe(false);
    expect(f.cache.remember(f.lease, { ...f.info, names: ['value', 'other'] }, [{ name: 'other', type: 'null' }])).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
  it('同一组覆盖旧值，旧optIn token及true/false/true事件永久失效', () => {
    const f = opted(); expect(f.cache.remember(f.lease, f.info, f.params)).toBe(true);
    const off = f.cache.setOptIn(f.lease, false)!; expect(f.cache.has(off, f.info)).toBe(false);
    const on = f.cache.setOptIn(off, true)!; expect(f.cache.remember(f.lease, f.info, f.params)).toBe(false); expect(f.cache.read(f.lease, f.info)).toBeNull(); expect(f.cache.setOptIn(f.lease, false)).toBeNull();
    const next: QueryParameter[] = [{ name: 'value', type: 'integer', value: '9007199254740993' }]; expect(f.cache.remember(on, f.info, next)).toBe(true); expect(f.cache.read(on, f.info)).toEqual(next);
    expect(f.cache.remember(on, f.info, f.params)).toBe(true); expect(f.cache.read(on, f.info)).toEqual(f.params);
  });
  it.each(['tabId', 'connectionId', 'connectionVersion', 'sessionId', 'editorIdentity', 'modelIdentity', 'modelVersion', 'source', 'rangeIdentity', 'savedSourceIdentity', 'fileSourceIdentity', 'defaultDatabaseIdentity'] as const)('来源%s漂移及恢复ABA不复活旧缓存或回调', key => {
    const f = opted(); expect(f.cache.remember(f.lease, f.info, f.params)).toBe(true); const original = f.scope();
    const changed = { ...original, [key]: key === 'connectionVersion' || key === 'modelVersion' ? 2 : key.endsWith('Identity') && key !== 'rangeIdentity' ? {} : '另一来源' };
    f.replace(changed); expect(f.cache.observe()).toBe(true); f.replace(original); expect(f.cache.observe()).toBe(true);
    expect(f.cache.read(f.lease, f.info)).toBeNull(); expect(f.cache.remember(f.lease, f.info, f.params)).toBe(false); const next = f.cache.begin()!; expect(f.cache.read(next, f.info)).toBeNull();
  });
  it('非法范围对象仍拒绝，恢复合法范围也不能找回旧参数', () => {
    const f = opted(), original = f.scope(); expect(f.cache.remember(f.lease, f.info, f.params)).toBe(true);
    // 故意越过静态类型构造外部坏形状；不放宽生产范围契约。
    f.replace({ ...original, rangeIdentity: {} } as unknown as QueryParameterReuseScope);
    expect(f.cache.observe()).toBe(false); f.replace(original); expect(f.cache.observe()).toBe(true);
    expect(f.cache.read(f.lease, f.info)).toBeNull(); expect(f.cache.remember(f.lease, f.info, f.params)).toBe(false);
  });
  it('原地来源修改也失效；reader消失/抛错、forget/dispose及时清引用', () => {
    const f = opted(), listener = vi.fn(), unsubscribe = f.cache.subscribe(listener);
    expect(f.cache.remember(f.lease, f.info, f.params)).toBe(true); f.scope().modelVersion++; expect(f.cache.read(f.lease, f.info)).toBeNull();
    let lease = f.cache.setOptIn(f.cache.begin()!, true)!; expect(f.cache.remember(lease, f.info, f.params)).toBe(true); f.fail(true); expect(f.cache.observe()).toBe(false); f.fail(false); expect(f.cache.read(lease, f.info)).toBeNull();
    lease = f.cache.setOptIn(f.cache.begin()!, true)!; expect(f.cache.remember(lease, f.info, f.params)).toBe(true); f.replace(null); expect(f.cache.observe()).toBe(false);
    f.replace({ ...fixture().scope() }); lease = f.cache.setOptIn(f.cache.begin()!, true)!; expect(f.cache.remember(lease, f.info, f.params)).toBe(true); f.cache.forget(); expect(f.cache.remember(lease, f.info, f.params)).toBe(false); expect(f.cache.read(f.cache.begin()!, f.info)).toBeNull();
    expect(listener).toHaveBeenCalled(); unsubscribe(); const calls = listener.mock.calls.length; f.cache.dispose(); expect(listener).toHaveBeenCalledTimes(calls); expect(f.cache.begin()).toBeNull(); expect(f.cache.setOptIn(lease, true)).toBeNull(); expect(f.cache.read(lease, f.info)).toBeNull(); expect(f.cache.remember(lease, f.info, f.params)).toBe(false);
  });
  it('不同cache的token不能互用，通知重入不能把其它表单token交给旧事件', () => {
    const first = opted(), second = opted(); expect(first.cache.remember(second.lease, first.info, first.params)).toBe(false);
    expect(first.cache.remember(first.lease, first.info, first.params)).toBe(true);
    const off = first.cache.setOptIn(first.lease, false)!; let successor: ReturnType<typeof first.cache.begin> = null;
    const unsubscribe = first.cache.subscribe(() => { successor = first.cache.begin(); });
    expect(first.cache.setOptIn(off, true)).toBeNull(); unsubscribe(); expect(successor).not.toBeNull();
    expect(first.cache.remember(off, first.info, first.params)).toBe(false); expect(first.cache.read(successor!, first.info)).toBeNull();
  });
  it.each(['forget', 'dispose', 'scope'] as const)('remember通知重入%s后不谎报已暂存', action => {
    const f = opted(); let unsubscribe: () => void = () => undefined; unsubscribe = f.cache.subscribe(() => {
      if (action === 'forget') { unsubscribe(); f.cache.forget(); }
      if (action === 'dispose') f.cache.dispose();
      if (action === 'scope') { unsubscribe(); f.replace({ ...f.scope(), modelVersion: 2 }); f.cache.observe(); }
    });
    // 先解绑再触发forget，避免订阅自行递归；dispose由helper幂等防护。
    expect(f.cache.remember(f.lease, f.info, f.params)).toBe(false); expect(f.cache.read(f.lease, f.info)).toBeNull();
  });
  it('begin观察来源触发通知时若被dispose，不再创建或返回token', () => {
    const f = opted(); expect(f.cache.remember(f.lease, f.info, f.params)).toBe(true);
    f.cache.subscribe(() => f.cache.dispose()); f.replace({ ...f.scope(), modelVersion: 2 });
    expect(f.cache.begin()).toBeNull(); expect(f.cache.begin()).toBeNull(); expect(f.cache.remember(f.lease, f.info, f.params)).toBe(false);
  });
  it('reader自有getter不执行，失效订阅异常也不能阻止清理', () => {
    const f = opted(), getter = vi.fn(() => 'SELECT :value'); expect(f.cache.remember(f.lease, f.info, f.params)).toBe(true);
    f.cache.subscribe(() => { throw Error('订阅失败'); }); const unsafe = { ...f.scope() }; Object.defineProperty(unsafe, 'source', { enumerable: true, get: getter }); f.replace(unsafe);
    expect(f.cache.observe()).toBe(false); expect(f.cache.read(f.lease, f.info)).toBeNull(); expect(getter).not.toHaveBeenCalled();
  });
});
