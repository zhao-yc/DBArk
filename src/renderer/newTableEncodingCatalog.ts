import type { TableCreateDraft, TableCreateEncodingCatalog, TableCreateGetOutput } from '../shared/tableCreate';
import type { TableCreateServices } from './tableCreateServices';
import { tableCreateColumnEncodingZh as text } from './locales/tableCreateColumnEncoding.zh-CN';

export interface NewTableEncodingCatalog { readonly digest: string; readonly candidates: readonly Readonly<{ charset: string; collation: string }>[]; readonly warnings: readonly string[]; }
export interface NewTableEncodingDirectory extends NewTableEncodingCatalog { readonly expiresAt: string; }
/** 只读自有数据属性；访问器、未知键和缺项不能借类型断言进入候选。 */
function ownRecord(value: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(text.unavailable);
  const keys = Reflect.ownKeys(value), descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some(key => typeof key !== 'string' || !allowed.includes(key)) || required.some(key => !Object.hasOwn(descriptors, key))) throw Error(text.unavailable);
  const result: Record<string, unknown> = {};
  for (const key of keys as string[]) { const entry = descriptors[key]; if (!entry.enumerable || !Object.hasOwn(entry, 'value')) throw Error(text.unavailable); result[key] = entry.value; }
  return result;
}
/** 稠密数组也逐元素读数据描述符，避免getter、额外属性或稀疏数据绕过有界目录。 */
function ownArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value)) throw Error(text.unavailable);
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Reflect.ownKeys(value).length !== length + 1) throw Error(text.unavailable);
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) { const entry = Object.getOwnPropertyDescriptor(value, String(index)); if (!entry?.enumerable || !Object.hasOwn(entry, 'value')) throw Error(text.unavailable); result.push(entry.value); }
  return result;
}
/** Schema字段区与确认页共用真实目录验证；不猜版本、名称前缀或静态配对。 */
export function readNewTableEncodingCatalog(raw: TableCreateEncodingCatalog | undefined): NewTableEncodingCatalog {
  const value = ownRecord(raw, ['digest', 'candidates', 'warnings', 'reasons'], ['candidates', 'warnings', 'reasons']);
  let bytes = 128;
  const strings = (raw: unknown) => ownArray(raw, 256).map(item => { if (typeof item !== 'string' || item.length > 4096) throw Error(text.unavailable); bytes += new TextEncoder().encode(item).length + 8; if (bytes > 2 * 1024 * 1024) throw Error(text.unavailable); return item; });
  const reasons = strings(value.reasons), warnings = strings(value.warnings);
  if (reasons.length) throw Error(reasons.join('\n'));
  if (typeof value.digest !== 'string' || !/^[a-f0-9]{64}$/.test(value.digest)) throw Error(text.unavailable);
  const seen = new Set<string>(), candidates = ownArray(value.candidates, 8192).map(item => {
    const pair = ownRecord(item, ['charset', 'collation'], ['charset', 'collation']);
    if (typeof pair.charset !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(pair.charset) || typeof pair.collation !== 'string' || !/^[A-Za-z0-9_]{1,255}$/.test(pair.collation) || seen.has(pair.collation)) throw Error(text.unavailable);
    seen.add(pair.collation); bytes += pair.charset.length + pair.collation.length + 48; if (bytes > 2 * 1024 * 1024) throw Error(text.unavailable);
    return Object.freeze({ charset: pair.charset, collation: pair.collation });
  });
  if (!candidates.length) throw Error(text.unavailable);
  return Object.freeze({ digest: value.digest, candidates: Object.freeze(candidates), warnings: Object.freeze(warnings) });
}

/** 预览回执必须逐列按原0基位置、名字及完整配对匹配；空设计也不能接受额外回执。 */
export function matchesNewTableColumnEncodingReceipt(design: TableCreateDraft, catalog: NewTableEncodingCatalog | undefined, raw: unknown): boolean {
  const expected = design.columns.flatMap((column, ordinal) => column.collation ? [{ ordinal, name: column.name, ...column.collation }] : []);
  if (!expected.length) return raw === undefined;
  try {
    const value = ownRecord(raw, ['catalogDigest', 'selections'], ['catalogDigest', 'selections']);
    if (!catalog || value.catalogDigest !== catalog.digest) return false;
    const selections = ownArray(value.selections, 1000); if (selections.length !== expected.length) return false;
    return selections.every((raw, index) => { const value = ownRecord(raw, ['ordinal', 'name', 'charset', 'collation'], ['ordinal', 'name', 'charset', 'collation']), planned = expected[index]; return Number.isSafeInteger(value.ordinal) && value.ordinal === planned.ordinal && value.name === planned.name && value.charset === planned.charset && value.collation === planned.collation; });
  } catch { return false; }
}

/** 独立只读候选租约：get返回的可写快照必须先实际释放，候选才允许发布。 */
export class NewTableEncodingDirectoryReader {
  private readonly snapshots = new Set<string>();
  private readonly releases = new Map<string, Promise<void>>();
  private pending?: Promise<void>;
  private active?: { taskId: string; cancelled: boolean };
  private disposed = false;
  constructor(private readonly services: TableCreateServices) {}
  get busy(): boolean { return this.pending !== undefined; }
  /** 同步锁先于服务调用，取消ACK、迟到响应或释放失败均不能提前认领下一次操作。 */
  read(input: { connectionId: string; database: string; taskId: string }, current: () => boolean, publish: (value: NewTableEncodingDirectory) => void): Promise<void> {
    if (this.disposed || this.pending) return this.pending ?? Promise.resolve();
    const operation = { taskId: input.taskId, cancelled: false }; this.active = operation;
    const accepted = () => !this.disposed && this.active === operation && !operation.cancelled && current();
    const promise = Promise.resolve().then(async () => {
      await this.releaseAll(); if (!accepted()) return;
      const value: TableCreateGetOutput = await this.services.get({ ...input, includeEncodings: true }, accepted);
      const snapshotId = value.snapshotId, expiresAt = value.expiresAt;
      if (typeof snapshotId !== 'string' || !snapshotId || snapshotId.length > 256) throw Error(text.unavailable);
      this.snapshots.add(snapshotId);
      let releaseAttempted = false;
      try {
        if (!accepted()) return;
        if (value.target.connectionId !== input.connectionId || value.target.database !== input.database || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) throw Error(text.unavailable);
        const catalog = readNewTableEncodingCatalog(value.encodings);
        releaseAttempted = true; await this.release(snapshotId);
        if (accepted() && Date.parse(expiresAt) > Date.now()) publish(Object.freeze({ ...catalog, expiresAt }));
      } finally { if (!releaseAttempted && this.snapshots.has(snapshotId)) await this.release(snapshotId); }
    });
    this.pending = promise.finally(() => { if (this.active === operation) this.active = undefined; this.pending = undefined; });
    return this.pending;
  }
  /** 只请求取消原任务；原get及释放承诺真正settle前busy保持。 */
  async cancel(): Promise<void> { const operation = this.active; if (!operation || operation.cancelled) return; operation.cancelled = true; await this.services.cancel(operation.taskId); }
  /** 同一个快照的并发释放共享Promise；失败仍保留责任供显式重试。 */
  private async release(id: string): Promise<void> {
    let promise = this.releases.get(id);
    if (!promise) { promise = Promise.resolve().then(() => this.services.release({ snapshotId: id })).then(() => { this.snapshots.delete(id); }); this.releases.set(id, promise); }
    try { await promise; } finally { if (this.releases.get(id) === promise) this.releases.delete(id); }
  }
  /** 调用者关闭或重新读取之前先收回原快照，不把失败当作已释放。 */
  async releaseAll(): Promise<void> { for (const id of [...this.snapshots]) await this.release(id); }
  /** 卸载立即失效；get迟到后仍由原read的finally精准释放它自己的快照。 */
  async dispose(): Promise<void> { this.disposed = true; try { await this.cancel(); } finally { await this.releaseAll(); } }
}
