import { z } from 'zod';
import { sqliteTableEditPreviewSchema, sqliteTableChangeSchema, type SqliteOriginalValue, type SqliteTableChange } from './sqliteTableEdit';
import type { SqliteTablePage } from './sqliteTableBrowse';
import { sqliteTablePageSchema, sqliteTableBrowseLimits } from './sqliteTableBrowse';

/** 文件只保存已暂存修改、完整旧行及可靠定位；不保存SQL、配置路径、凭据或旧能力令牌。 */
export const sqliteTableDraftLimits = { bytes: 8 * 1024 * 1024, cells: 200000, nodes: 700000, depth: 12 } as const;
export const sqliteTableDraftMessages = {
  invalid: 'SQLite草稿格式、原值或定位无效，未恢复任何修改',
  budget: 'SQLite草稿超过8MiB、500条变化或字段预算，未保存或恢复部分内容',
  changed: 'SQLite草稿的原文件、表结构、定位或原行已变化，未恢复任何修改',
  readonly: 'SQLite草稿恢复仅允许可编辑物理表及独立只读核验连接',
} as const;
const text = sqliteTableDraftMessages, name = sqliteTablePageSchema.shape.table, hash = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.string().regex(/^(?:0|-?[1-9][0-9]*)$/).max(20).refine(value => { try { const n = BigInt(value); return n >= -9223372036854775808n && n <= 9223372036854775807n; } catch { return false; } });
/** 原REAL可为无穷；用户新输入仍沿原严格有限值合同。BLOB使用规范小写Hex且空字节不等于NULL。 */
export const sqliteDraftOriginalSchema = z.union([
  z.object({ kind: z.literal('null') }).strict(),
  z.object({ kind: z.literal('integer'), value: integer }).strict(),
  z.object({ kind: z.literal('real'), value: z.string().max(32).refine(value => ['Infinity', '-Infinity', '-0'].includes(value) || Number.isFinite(Number(value)) && String(Number(value)) === value) }).strict(),
  z.object({ kind: z.literal('text'), value: z.string().max(1024 * 1024) }).strict(),
  z.object({ kind: z.literal('blob'), value: z.string().max(2 * 1024 * 1024).regex(/^(?:[0-9a-f]{2})*$/) }).strict(),
]);
const column = z.object({ name, declaredType: z.string().max(65536), generated: z.boolean(), nullable: z.boolean(), hasDefault: z.boolean() }).strict();
const locator = z.object({ kind: z.enum(['rowid', 'primary-key', 'unique-key']), columns: z.array(name).max(1024), collations: z.array(z.enum(['BINARY', 'NOCASE', 'RTRIM'])).min(1).max(1024), rowid: z.enum(['rowid', '_rowid_', 'oid']).optional() }).strict().superRefine((value, ctx) => {
  if (value.kind === 'rowid' ? !value.rowid || value.columns.length !== 0 || value.collations.length !== 1 || value.collations[0] !== 'BINARY' : value.rowid !== undefined || !value.columns.length || value.collations.length !== value.columns.length || new Set(value.columns).size !== value.columns.length) ctx.addIssue({ code: 'custom', message: text.invalid });
});
const before = z.array(sqliteDraftOriginalSchema).min(1).max(1024), key = z.array(sqliteDraftOriginalSchema).min(1).max(1024);
const values = sqliteTableChangeSchema.options[0].shape.values;
const savedChange = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('insert'), values }).strict(),
  z.object({ kind: z.literal('update'), before, key, values }).strict(),
  z.object({ kind: z.literal('delete'), before, key }).strict(),
]);
/** 原页归属仅组织变更，不携带旧快照令牌，也不代表当前数据库分页。 */
const workspace = z.object({ activeOffset: z.number().int().min(0).max(sqliteTableBrowseLimits.offset), pages: z.array(z.object({ offset: z.number().int().min(0).max(sqliteTableBrowseLimits.offset), limit: z.number().int().min(1).max(sqliteTableBrowseLimits.pageSize), changes: z.number().int().min(1).max(500) }).strict()).min(1).max(16) }).strict();
const shape = z.object({
  kind: z.literal('tabrelio.sqlite-table-draft'), version: z.union([z.literal(1), z.literal(2)]), endpointKey: hash,
  target: z.object({ connectionId: z.string().min(1).max(200), database: z.literal('main'), table: name }).strict(),
  fileKey: hash, schemaKey: hash, schemaVersion: integer, columns: z.array(column).min(1).max(1024), locator,
  relation: sqliteTablePageSchema.shape.relation,
  changes: z.array(savedChange).min(1).max(500),
  workspace: workspace.optional(),
}).strict();
export type SqliteTableDraftDocument = z.infer<typeof shape>;
/** 只有完整核验及准确只读进程退出后才发布；调用方仍须明确暂存及预览提交。 */
export interface SqliteDraftRestoredPage { page: SqliteTablePage; changes: SqliteTableChange[]; }
export interface SqliteDraftRestored extends SqliteDraftRestoredPage { additionalPages?: SqliteDraftRestoredPage[]; }
/** 每个分组重新从零编号原行；新增不占原行编号，组间不能共用 row 索引。 */
export function sqliteDraftGroups(document: SqliteTableDraftDocument): { offset: number; limit: number; changes: SqliteTableDraftDocument['changes'] }[] {
  let offset = 0;
  return document.workspace ? document.workspace.pages.map(group => ({ offset: group.offset, limit: group.limit, changes: document.changes.slice(offset, offset += group.changes) })) : [{ offset: 0, limit: Math.max(1, document.changes.filter(change => change.kind !== 'insert').length), changes: document.changes }];
}
/** 恢复视图的原行连续编号只属于新快照，不能沿用保存时任意一页的row编号。 */
export function sqliteDraftChanges(document: SqliteTableDraftDocument): SqliteTableChange[] {
  let row = 0;
  return document.changes.map(change => change.kind === 'insert' ? { kind: 'insert', values: change.values } : change.kind === 'delete' ? { kind: 'delete', row: row++ } : { kind: 'update', row: row++, values: change.values });
}
/** 在任何深解析前复制有界自有data；拒绝getter／toJSON／稀疏数组／额外键和坏Unicode。 */
function boundedCopy(input: unknown): unknown {
  let bytes = 0, nodes = 0;
  const add = (amount: number) => { if ((bytes += amount) > sqliteTableDraftLimits.bytes) throw Error(text.budget); };
  const string = (value: string) => {
    if (value.length > sqliteTableDraftLimits.bytes) throw Error(text.budget);
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw Error(text.invalid);
    add(2);
    for (let i = 0; i < value.length; i++) { const code = value.charCodeAt(i); if (code >= 0xd800 && code <= 0xdbff) { add(4); i++; } else add(code === 34 || code === 92 || [8,9,10,12,13].includes(code) ? 2 : code < 32 ? 6 : code < 128 ? 1 : code < 2048 ? 2 : 3); }
    return value;
  };
  const own = (value: object, key: string) => { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || !('value' in descriptor)) throw Error(text.invalid); return descriptor.value; };
  const copy = (value: unknown, depth: number): unknown => {
    if (++nodes > sqliteTableDraftLimits.nodes || depth > sqliteTableDraftLimits.depth) throw Error(text.budget);
    if (value === null) { add(4); return null; } if (typeof value === 'boolean') { add(value ? 4 : 5); return value; }
    if (typeof value === 'string') return string(value);
    if (typeof value === 'number' && Number.isFinite(value)) { add(String(value).length); return value; }
    if (!value || typeof value !== 'object') throw Error(text.invalid);
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > sqliteTableDraftLimits.cells || Reflect.ownKeys(value).length !== value.length + 1) throw Error(text.budget);
      add(2 + Math.max(0, value.length - 1)); const result: unknown[] = [];
      for (let i = 0; i < value.length; i++) result.push(copy(own(value, String(i)), depth + 1)); return result;
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error(text.invalid);
    const keys = Reflect.ownKeys(value); if (keys.length > 32) throw Error(text.invalid);
    add(2 + Math.max(0, keys.length - 1)); const pairs: [string, unknown][] = [];
    for (const key of keys) { if (typeof key !== 'string') throw Error(text.invalid); string(key); add(1); pairs.push([key, copy(own(value, key), depth + 1)]); } return Object.fromEntries(pairs);
  };
  return copy(input, 0);
}
/** 字段、旧行和可靠键的完整性一起验证；任何后字段失败整份拒绝，不返回部分文件。 */
export function parseSqliteTableDraft(input: unknown): SqliteTableDraftDocument {
  const parsed = shape.safeParse(boundedCopy(input)); if (!parsed.success) throw Error(text.invalid); const document = parsed.data;
  if (document.version !== (document.workspace ? 2 : 1)) throw Error(text.invalid);
  if (document.workspace) {
    const groups = document.workspace.pages;
    if (!groups.some(group => group.offset === document.workspace!.activeOffset) || groups.reduce((n, group) => n + group.changes, 0) !== document.changes.length || groups.some((group, index) => group.limit !== groups[0].limit || index > 0 && group.offset <= groups[index - 1].offset)) throw Error(text.invalid);
    if (sqliteDraftGroups(document).some(group => group.changes.filter(change => change.kind !== 'insert').length > group.limit)) throw Error(text.invalid);
  }
  const names = document.columns.map(column => column.name), editable = new Set(document.columns.filter(column => !column.generated).map(column => column.name));
  if (new Set(names).size !== names.length || document.locator.columns.some(column => !names.includes(column))) throw Error(text.invalid);
  let cells = 0; const touched = new Set<string>();
  for (const change of document.changes) {
    if (change.kind !== 'insert') {
      cells += change.before.length + change.key.length;
      if (change.before.length !== names.length || change.key.length !== (document.locator.kind === 'rowid' ? 1 : document.locator.columns.length) || change.key.some(value => value.kind === 'null') || document.locator.kind === 'rowid' && change.key[0].kind !== 'integer') throw Error(text.invalid);
      if (document.locator.kind !== 'rowid' && document.locator.columns.some((column, index) => JSON.stringify(change.key[index]) !== JSON.stringify(change.before[names.indexOf(column)]))) throw Error(text.invalid);
      // 文件不能重复恢复同一可靠键；TEXT按原NOCASE／RTRIM规则比较，不借不同原页重复修改。
      const key = JSON.stringify(change.key.map((value, index) => value.kind === 'null' ? ['null'] : [value.kind, value.kind === 'text' && document.locator.collations[index] === 'NOCASE' ? value.value.replace(/[A-Z]/g, letter => letter.toLowerCase()) : value.kind === 'text' && document.locator.collations[index] === 'RTRIM' ? value.value.replace(/ +$/, '') : value.value]));
      if (touched.has(key)) throw Error(text.invalid); touched.add(key);
    }
    if (change.kind !== 'delete') { cells += change.values.length; if (change.values.some(field => !editable.has(field.column))) throw Error(text.invalid); }
    if (cells > sqliteTableDraftLimits.cells) throw Error(text.budget);
  }
  sqliteTableEditPreviewSchema.parse({ snapshotId: 'sqlite-draft', taskId: 'sqlite-draft', changes: sqliteDraftChanges(document) });
  return document;
}
/** typed值全部使用显式字符串，INTEGER／REAL／TEXT／NULL／空BLOB不会被JSON数值转换。 */
export function encodeSqliteTableDraft(document: SqliteTableDraftDocument): string { return JSON.stringify(parseSqliteTableDraft(document)); }
/** 原始UTF-8门先于JSON.parse；文件IO还须严格UTF-8解码和单句柄身份核对。 */
export function decodeSqliteTableDraft(source: string): SqliteTableDraftDocument {
  if (typeof source !== 'string' || source.length > sqliteTableDraftLimits.bytes || new TextEncoder().encode(source).byteLength > sqliteTableDraftLimits.bytes) throw Error(text.budget);
  let parsed: unknown; try { parsed = JSON.parse(source); } catch { throw Error(text.invalid); } return parseSqliteTableDraft(parsed);
}
/** 只用于Main内部转换；完整原值仍按正式driver类型保存，不由Renderer提供定位。 */
export type SqliteDraftOriginal = SqliteOriginalValue;
/** 公开文件IPC只给原窗口原目标；路径、端点和恢复时的存活回调均由Main补入。 */
export const sqliteDraftSaveSchema = z.object({ source: sqliteTableEditPreviewSchema, activeSnapshotId: z.string().min(1).max(200).optional() }).strict();
export const sqliteDraftOpenSchema = z.object({ target: shape.shape.target }).strict();
export const sqliteDraftRestoreSchema = shape.shape.target.extend({ taskId: z.string().min(1).max(200), document: z.unknown().transform(value => parseSqliteTableDraft(value)) }).strict();
