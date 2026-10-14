import { describe, expect, it } from 'vitest';
import { StructurePatchCache, structureCacheLimits } from '../../src/engine/structurePatchCache';

interface Entry { connectionId: string; expires: number; bytes: number; content: string; }
/** 两个独立功能视图引用同一个缓存，时间可控而不依靠实际睡眠。 */
function fixture() {
  let time = 1000;
  const cache = new StructurePatchCache(() => time);
  const binding = (value: Entry) => value;
  return { cache, columns: cache.scope('columns', 'snapshot', binding), indexes: cache.scope('indexes', 'snapshot', binding), previews: cache.scope('indexes', 'preview', binding), setTime(value: number) { time = value; }, entry(bytes = 1, connectionId = 'a'): Entry { return { connectionId, expires: time + structureCacheLimits.ttlMs, bytes, content: '可信快照' }; } };
}

describe('字段和索引的统一结构缓存', () => {
  it('32个快照是两入口合计额度，预览使用单独但同样合计的32项上限', () => {
    const f = fixture();
    for (let index = 0; index < 20; index++) f.columns.set('c'+index, f.entry());
    for (let index = 0; index < 12; index++) f.indexes.set('i'+index, f.entry());
    expect(() => f.indexes.set('overflow', f.entry())).toThrow('上限');
    for (let index = 0; index < 32; index++) f.previews.set('p'+index, f.entry());
    expect(() => f.previews.set('overflow', f.entry())).toThrow('上限');
    expect(f.columns.size + f.indexes.size).toBe(32);
  });

  it('16MiB同时累计字段、索引和预览，不给新入口重复分配额度', () => {
    const f = fixture();
    f.columns.set('c', f.entry(12 * 1024 * 1024));
    f.previews.set('p', f.entry(4 * 1024 * 1024));
    expect(() => f.indexes.set('i', f.entry())).toThrow('上限');
    f.previews.delete('p'); f.indexes.set('i', f.entry(4 * 1024 * 1024));
    expect([...f.indexes.values()].map(value => value.bytes)).toEqual([4 * 1024 * 1024]);
  });

  it('从另一个用途访问也回收所有过期的真实记录，再允许新快照占用额度', () => {
    const f = fixture(); f.columns.set('old', f.entry(structureCacheLimits.bytes));
    f.setTime(121000); f.indexes.set('new', f.entry(structureCacheLimits.bytes));
    expect(f.columns.get('old')).toBeUndefined(); expect([...f.columns]).toEqual([]);
    expect(f.indexes.has('new')).toBe(true);
  });

  it('相同字符串令牌在用途和类别之间隔离，不会取到或删除其他功能数据', () => {
    const f = fixture(); const c = {...f.entry(), content:'字段'}, i = {...f.entry(), content:'索引'}, p = {...f.entry(), content:'预览'};
    f.columns.set('same', c); f.indexes.set('same', i); f.previews.set('same', p);
    expect(f.columns.get('same')).toBe(c); expect(f.indexes.get('same')).toBe(i); expect(f.previews.get('same')).toBe(p);
    f.indexes.delete('same'); expect(f.columns.has('same')).toBe(true); expect(f.previews.has('same')).toBe(true);
  });

  it('连接关闭跨两种用途释放该连接，其他连接与预览保持', () => {
    const f = fixture(); f.columns.set('a-c', f.entry()); f.indexes.set('a-i', f.entry()); f.previews.set('b-p', f.entry(1,'b'));
    f.cache.release('a'); expect(f.columns.size + f.indexes.size).toBe(0); expect(f.previews.size).toBe(1);
    f.cache.release(); expect(f.previews.size).toBe(0);
  });

  it('读准备期间其它请求占满后，最终入表重新检查，不以旧capacity检查绕过上限', () => {
    const f = fixture();
    for (let index = 0; index < 31; index++) f.columns.set('c'+index, f.entry());
    f.cache.capacity(1,'snapshot'); f.indexes.set('winner', f.entry());
    expect(() => f.columns.set('late', f.entry())).toThrow('上限'); expect(f.columns.has('late')).toBe(false);
  });

  it('非法期限、计量、目标和重复令牌均拒绝，旧记录保持', () => {
    const f = fixture(); const original = f.entry(); f.columns.set('kept', original);
    expect(() => f.columns.set('kept', {...f.entry(),content:'替换'})).toThrow('重复');
    expect(f.columns.get('kept')).toBe(original);
    for (const value of [{...f.entry(), expires:1000}, {...f.entry(),expires:121001}, {...f.entry(),bytes:-1}, {...f.entry(),bytes:NaN}, {...f.entry(),connectionId:''}]) expect(() => f.indexes.set('bad',value)).toThrow();
    expect(f.indexes.size).toBe(0);
  });
});
