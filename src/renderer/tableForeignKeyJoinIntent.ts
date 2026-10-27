import type { TableInfo } from '../shared/contracts';
import { buildForeignKeyJoin, foreignKeyJoinChoices, foreignKeyJoinMetadataKey, type ForeignKeyJoinOptions } from './tableForeignKeyJoin';
import { tableForeignKeyJoinZh as text } from './locales/tableForeignKeyJoin.zh-CN';

export interface ForeignKeyJoinTarget { connectionId: string; database: string; table: string; }
export type ForeignKeyJoinRead = (target: ForeignKeyJoinTarget) => Promise<TableInfo>;
export interface ForeignKeyJoinPreview {
  readonly parent: TableInfo; readonly parentKey: string; readonly childKey: string; readonly foreignKey: string;
  readonly kind: 'LEFT' | 'INNER'; readonly options: ForeignKeyJoinOptions; readonly sql: string;
}

/** 只保留结构和来源身份，不持有行、选中记录或服务器筛选，也不修改父页草稿。 */
export class TableForeignKeyJoinIntent {
  readonly source: TableInfo; readonly metadataKey: string;
  private readonly values: readonly unknown[]; private dead = false; private consumed = false;
  private readonly listeners = new Set<() => void>();
  constructor(source: TableInfo, readonly connectionId: string, readonly limit: number, values: readonly unknown[], private readonly guard: () => boolean) {
    this.metadataKey = foreignKeyJoinMetadataKey(source); foreignKeyJoinChoices(source);
    this.source = immutable(structuredClone(source)); this.values = [...values];
  }
  /** 所见来源离开过一次即永久失效，A→B→A和相同SQL不能重新授予打开权限。 */
  observe(values: readonly unknown[]): void { if (values.length !== this.values.length || values.some((value, index) => !Object.is(value, this.values[index]))) this.invalidate(); }
  current(): boolean {
    if (!this.dead && !this.consumed) { try { if (!this.guard() || foreignKeyJoinMetadataKey(this.source) !== this.metadataKey) this.invalidate(); } catch { this.invalidate(); } }
    return !this.dead && !this.consumed;
  }
  invalidate(): void { if (this.dead) return; this.dead = true; queueMicrotask(() => { for (const listener of this.listeners) listener(); }); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** 打开只消费一次；确认SQL仍由同一结构和选列生成，不信任旧按钮携带的字符串。 */
  consume(preview: ForeignKeyJoinPreview): string {
    if (!this.current() || preview.childKey !== this.metadataKey || foreignKeyJoinMetadataKey(preview.parent) !== preview.parentKey || buildForeignKeyJoin(this.source, preview.parent, preview.foreignKey, preview.kind, this.limit, preview.options).sql !== preview.sql) throw Error(text.stale);
    this.consumed = true; return preview.sql;
  }
}

/** 原目录回包需满足真实父目标；helper同时检查对应FK字段存在且关系方向匹配。 */
export function foreignKeyJoinPreview(intent: TableForeignKeyJoinIntent, parent: TableInfo, foreignKey: string, kind: 'LEFT' | 'INNER', options: ForeignKeyJoinOptions): ForeignKeyJoinPreview {
  if (!intent.current()) throw Error(text.stale);
  const target = immutable(structuredClone(parent)), selection = immutable(structuredClone(options));
  const result = buildForeignKeyJoin(intent.source, target, foreignKey, kind, intent.limit, selection);
  return Object.freeze({ parent: target, parentKey: foreignKeyJoinMetadataKey(target), childKey: intent.metadataKey, foreignKey, kind, options: selection, sql: result.sql });
}

/** 原预览不自动换SQL；打开前串行只读重核双方相关结构，自关联只读取一次。 */
export async function revalidateForeignKeyJoin(intent: TableForeignKeyJoinIntent, preview: ForeignKeyJoinPreview, read: ForeignKeyJoinRead, current: () => boolean): Promise<void> {
  const assert = () => { if (!intent.current() || !current()) throw Error(text.stale); };
  assert();
  const child = await read({ connectionId: intent.connectionId, database: intent.source.database, table: intent.source.name });
  assert();
  if (foreignKeyJoinMetadataKey(child) !== preview.childKey) { intent.invalidate(); throw Error(text.stale); }
  const self = preview.parent.database === intent.source.database && preview.parent.name === intent.source.name;
  const parent = self ? child : await read({ connectionId: intent.connectionId, database: preview.parent.database, table: preview.parent.name });
  assert();
  if (foreignKeyJoinMetadataKey(parent) !== preview.parentKey || buildForeignKeyJoin(child, parent, preview.foreignKey, preview.kind, intent.limit, preview.options).sql !== preview.sql) { intent.invalidate(); throw Error(text.stale); }
}

/** 冻结仅用于本地只读结构快照，不改变正式metadata回包或原表页对象。 */
function immutable<T>(value: T): T { if (value && typeof value === 'object') { for (const item of Object.values(value)) immutable(item); Object.freeze(value); } return value; }
