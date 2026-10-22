import type { ColumnPatch, TableColumnGetOutput, TableColumnPreviewOutput, TableColumnView } from '../shared/tableColumnPatches';
import { sameTableEncodingPair, tableDefaultEncodingLimits, validateTableEncodingPair, type TableEncodingPair } from '../shared/tableDefaultEncoding';
import { columnEncodingZh as text } from './locales/columnEncoding.zh-CN';

export const columnEncodingRequiredAcknowledgements = ['ddl-implicit-commit', 'external-ddl-window', 'column-encoding-copy'] as const;
/** 专属属性按自有键识别，显式undefined也不能落回普通字段路径。 */
export function hasColumnEncodingPatch(patches: readonly ColumnPatch[]): boolean { return patches.some(patch => patch.kind === 'alter' && Object.hasOwn(patch.changes, 'encoding')); }
/** 完整目录按真实名称及唯一配对验证；不从排序规则前缀推断字符集。 */
function catalogPairs(catalog: readonly TableEncodingPair[] | undefined): readonly TableEncodingPair[] {
  if (!catalog?.length || catalog.length > tableDefaultEncodingLimits.candidates || new TextEncoder().encode(JSON.stringify(catalog)).byteLength > tableDefaultEncodingLimits.catalogBytes) throw Error(text.catalog);
  const seen = new Set<string>();
  return Object.freeze(catalog.map(value => { if (Object.keys(value).length !== 2) throw Error(text.catalog); const pair = validateTableEncodingPair(value); if (seen.has(pair.collation)) throw Error(text.catalog); seen.add(pair.collation); return Object.freeze(pair); }));
}
/** 明确原投影为唯一权限来源；普通七属性、类型和相似服务器版本不能代替授权。 */
export function makeColumnEncodingAlter(column: TableColumnView, value: TableEncodingPair, catalog: readonly TableEncodingPair[] | undefined): ColumnPatch | null {
  const projection = column.encoding;
  if (!projection || projection.access.editable !== true) throw Error(projection?.access.reason || text.readonly);
  const original = validateTableEncodingPair(projection.current), next = validateTableEncodingPair(value), candidates = catalogPairs(catalog);
  if (!candidates.some(pair => sameTableEncodingPair(pair, original)) || !candidates.some(pair => sameTableEncodingPair(pair, next))) throw Error(text.invalid);
  if (sameTableEncodingPair(original, next)) return null;
  if (original.charset === next.charset) throw Error(text.sameCharset);
  return { kind: 'alter', columnRef: column.columnRef, changes: { encoding: next } };
}

/** 一次读取共用一份目录及对象图，避免宽表为每列重复复制整份快照；任何已观察漂移单向失效。 */
export class ColumnEncodingSource {
  #invalid = false; readonly #check: (value: TableColumnGetOutput | null) => boolean;
  readonly candidates: readonly TableEncodingPair[];
  constructor(readonly snapshot: TableColumnGetOutput) {
    this.candidates = catalogPairs(snapshot.encodingCatalog);
    const columns = snapshot.columns, catalog = snapshot.encodingCatalog!, pairs = catalog.slice(), entries = columns.map(column => ({ column, projection: column.encoding, current: column.encoding?.current, access: column.encoding?.access })), key = JSON.stringify(snapshot);
    this.#check = value => value === snapshot && value.columns === columns && columns.length === entries.length && columns.every((column, index) => column === entries[index].column && column.encoding === entries[index].projection && column.encoding?.current === entries[index].current && column.encoding?.access === entries[index].access)
      && value.encodingCatalog === catalog && catalog.length === pairs.length && catalog.every((pair, index) => pair === pairs[index]) && Number.isFinite(Date.parse(value.expiresAt)) && Date.now() < Date.parse(value.expiresAt) && JSON.stringify(value) === key;
  }
  /** 缺失、过期、同对象内容或对象身份变化后，恢复旧值也不能重新授权。 */
  current(value: TableColumnGetOutput | null): boolean { if (this.#invalid) return false; try { if (this.#check(value)) return true; } catch { /* 损坏快照必须重新读取。 */ } this.invalidate(); return false; }
  /** 目标变化、释放和重读同步撤销所有依赖此读取的意图。 */
  invalidate(): void { this.#invalid = true; }
}

/** 列意图在读取时创建；编辑器不能拿后继投影重新授权旧读取。 */
export class ColumnEncodingIntent {
  readonly source: ColumnEncodingSource; readonly candidates: readonly TableEncodingPair[];
  constructor(snapshot: TableColumnGetOutput, readonly column: TableColumnView, source = new ColumnEncodingSource(snapshot)) {
    if (source.snapshot !== snapshot || !snapshot.columns.includes(column) || snapshot.columns.filter(item => item.columnRef === column.columnRef).length !== 1) throw Error(text.stale);
    const projection = column.encoding;
    if (!projection || projection.access.editable !== true) throw Error(projection?.access.reason || text.readonly);
    const current = validateTableEncodingPair(projection.current);
    if (!source.candidates.some(pair => sameTableEncodingPair(pair, current))) throw Error(text.invalid);
    this.source = source;
    // 目录由读取源统一验证；逐列仅选择候选，避免每列再次序列化完整目录。
    this.candidates = Object.freeze(source.candidates.filter(pair => pair.charset !== current.charset || sameTableEncodingPair(pair, current)));
  }
  /** 当前原列、有效目录和完整读取必须同时有效。 */
  current(snapshot: TableColumnGetOutput | null): boolean { return this.source.current(snapshot) && this.column.encoding?.access.editable === true; }
  /** 一列发现全快照漂移时，同份读取的其它列也不能保留旧授权。 */
  invalidate(): void { this.source.invalidate(); }
}

/** 预览绑定原补丁、原目录和整个回执；不在客户端推导或重写服务器SQL。 */
export class ColumnEncodingPreview {
  #invalid = false; #consumed = false; readonly #payload: string; readonly #receipt: string;
  constructor(readonly intent: ColumnEncodingIntent, readonly patches: ColumnPatch[], readonly preview: TableColumnPreviewOutput) {
    this.#payload = JSON.stringify(patches); this.#receipt = JSON.stringify(preview);
    if (!Array.isArray(preview.requiredAcknowledgements) || new Set(preview.requiredAcknowledgements).size !== preview.requiredAcknowledgements.length || !columnEncodingRequiredAcknowledgements.every(id => preview.requiredAcknowledgements.includes(id))) this.#invalid = true;
  }
  get consumed(): boolean { return this.#consumed; }
  /** applying只供消费后的本次父守卫复核，旧事件不能再次消费已用令牌。 */
  current(snapshot: TableColumnGetOutput | null, patches: ColumnPatch[], preview: TableColumnPreviewOutput | null, applying = false): boolean {
    if (this.#invalid || this.#consumed && !applying) return false;
    try { if (preview === this.preview && patches === this.patches && this.intent.current(snapshot) && JSON.stringify(patches) === this.#payload && JSON.stringify(preview) === this.#receipt && Number.isFinite(Date.parse(preview.expiresAt)) && Date.now() < Date.parse(preview.expiresAt)) return true; } catch { /* 迟到或被修改的回执不能获得执行权限。 */ }
    this.#invalid = true; return false;
  }
  /** 调用可重入的父数据草稿守卫之前消费，失败后也不复活旧事件。 */
  consume(): void { this.#consumed = true; }
}
