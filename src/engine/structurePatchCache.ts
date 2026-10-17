export type StructurePatchPurpose = 'columns' | 'indexes' | 'foreignKeys' | 'tableComment' | 'tableDrop' | 'tableTruncate' | 'tableDefaultEncoding' | 'databaseCreate' | 'tableCopyStructure' | 'tableRename' | 'tableAutoIncrement';
export type StructureCacheKind = 'snapshot' | 'preview';
export const structureCacheLimits = { ttlMs: 120000, snapshots: 32, previews: 32, bytes: 16 * 1024 * 1024 } as const;
export interface StructureCacheBinding { connectionId: string; expires: number; bytes: number; }
interface CacheEntry extends StructureCacheBinding { id: string; purpose: StructurePatchPurpose; kind: StructureCacheKind; value: unknown; }

/** 仅给可信执行模块使用的有类型视图；字段和索引合计使用同一份总额度。 */
export interface StructureCacheScope<T> extends Iterable<[string, T]> {
  readonly size: number;
  get(id: string): T | undefined;
  has(id: string): boolean;
  set(id: string, value: T): this;
  delete(id: string): boolean;
  values(): IterableIterator<T>;
  entries(): IterableIterator<[string, T]>;
}

/** 缓存实际持有值并统一过期回收，不能只释放账面额度却在另一个入口继续保留大快照。 */
export class StructurePatchCache {
  private readonly records = new Map<string, CacheEntry>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  /** 三元组序列化避免跨用途、类别或包含分隔符的令牌碰撞。 */
  private key(purpose: StructurePatchPurpose, kind: StructureCacheKind, id: string): string { return JSON.stringify([purpose, kind, id]); }
  /** 所有视图都调用同一清理，释放真实引用后才计算总内存。 */
  private sweep(): void { for (const [key, value] of this.records) if (value.expires <= this.now()) this.records.delete(key); }
  /** 预读准备和最终入表均可核对容量；不会静默驱逐仍有效的预览。 */
  capacity(bytes: number, kind: StructureCacheKind): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('结构缓存计量无效');
    this.sweep();
    let used = 0, count = 0;
    for (const value of this.records.values()) { used += value.bytes; if (value.kind === kind) count++; }
    const limit = kind === 'snapshot' ? structureCacheLimits.snapshots : structureCacheLimits.previews;
    if (bytes + used > structureCacheLimits.bytes || count >= limit) throw new Error('结构预览缓存已达上限，请关闭旧预览或等待两分钟后重试');
  }
  /** 连接关闭或执行进程退出时，按可信连接身份精确释放全部结构用途。 */
  release(connectionId?: string): void { for (const [key, entry] of this.records) if (!connectionId || entry.connectionId === connectionId) this.records.delete(key); }

  /** 描述器只读取引擎构造的内部记录，绝不接受 renderer 提交的大小或过期时间。 */
  scope<T>(purpose: StructurePatchPurpose, kind: StructureCacheKind, describe: (value: T) => StructureCacheBinding): StructureCacheScope<T> {
    const cache = this;
    const values = function* (): IterableIterator<[string, T]> {
      cache.sweep();
      for (const entry of cache.records.values()) if (entry.purpose === purpose && entry.kind === kind) yield [entry.id, entry.value as T];
    };
    return {
      get size() { return [...values()].length; },
      get(id) { cache.sweep(); return cache.records.get(cache.key(purpose, kind, id))?.value as T | undefined; },
      has(id) { cache.sweep(); return cache.records.has(cache.key(purpose, kind, id)); },
      set(id, value) {
        const binding = describe(value), key = cache.key(purpose, kind, id);
        if (!id || cache.records.has(key)) throw new Error('结构缓存令牌重复，不能覆盖现有快照或预览');
        if (!binding.connectionId || !Number.isSafeInteger(binding.expires) || binding.expires <= cache.now() || binding.expires > cache.now() + structureCacheLimits.ttlMs) throw new Error('结构缓存期限或目标无效');
        cache.capacity(binding.bytes, kind);
        cache.records.set(key, { ...binding, id, purpose, kind, value }); return this;
      },
      delete(id) { return cache.records.delete(cache.key(purpose, kind, id)); },
      entries: values,
      *values() { for (const [, value] of values()) yield value; },
      [Symbol.iterator]: values,
    };
  }
}
