import type { SqliteTableColumn, SqliteTablePage, SqliteTablePageInput } from '../shared/sqliteTableBrowse';
import { sqliteTablePageSchema } from '../shared/sqliteTableBrowse';
import { buildSqliteFilteredSelect, sqliteReadSqlLimits } from '../shared/sqliteReadSql';
import type { SqliteTableQuery } from './sqliteTableBrowser';
import { sqliteFilteredSelectZh as text } from './locales/sqliteFilteredSelect.zh-CN';

export const sqliteFilteredSelectMessages = { invalid: text.invalid, stale: text.stale, budget: text.budget, limit: text.invalidLimit } as const;
export interface SqliteFilteredSelectPlan { readonly sql: string; readonly columns: readonly string[]; readonly limit?: number; }
interface Snapshot { target: SqliteTablePage['target']; columns: SqliteTableColumn[]; input: SqliteTablePageInput; refs: unknown[]; schemaKey: string; }
const plans = new WeakMap<SqliteFilteredSelectPlan, { owner: SqliteFilteredSelectIntent; revision: number; used: boolean }>();
const encoder = new TextEncoder(), invalid = () => Error(sqliteFilteredSelectMessages.invalid);
/** 只取所需自有data字段；page.result／edit即使为访问器也不会被触碰。 */
function own(raw: unknown, key: string): unknown { if (!raw || typeof raw !== 'object') throw invalid(); const descriptor = Object.getOwnPropertyDescriptor(raw, key); if (!descriptor?.enumerable || !('value' in descriptor)) throw invalid(); return descriptor.value; }
/** 严格小型记录拒绝原型、额外键与访问器，避免输入把任意表达式提升为字段。 */
function record(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw invalid(); const keys = Reflect.ownKeys(raw); if (keys.length > allowed.length || keys.some(key => typeof key !== 'string' || !allowed.includes(key))) throw invalid();
  return Object.fromEntries(keys.map(key => [key, own(raw, key as string)]));
}
/** 长度先界定，数组必须稠密且没有隐藏字段，不先map未知巨大length。 */
function array(raw: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > maximum || Reflect.ownKeys(raw).length !== raw.length + 1) throw invalid(); for (let i = 0; i < raw.length; i++) own(raw, String(i)); return raw;
}
/** 只复制目录与已应用query，不读取结果行、编辑快照或未提交草稿。 */
function capture(page: SqliteTablePage, query: SqliteTableQuery): Snapshot {
  const rawTarget = own(page, 'target'), target = record(rawTarget, ['connectionId', 'database', 'table', 'kind']), rawColumns = own(page, 'columns'), columns = array(rawColumns, 1024), schemaKey = own(page, 'schemaKey');
  if (!['table', 'view'].includes(target.kind as string) || typeof schemaKey !== 'string' || !/^[a-f0-9]{64}$/.test(schemaKey) || !columns.length) throw invalid();
  // 表达式可重建文本换行，标识符不能用表达式代替；不能将编辑器EOL转换成另一个对象名称。
  if (typeof target.table === 'string' && /[\r\n]/.test(target.table) || columns.some(raw => { const name = own(raw, 'name'); return typeof name === 'string' && /[\r\n]/.test(name); })) throw Error(text.identifierLineBreak);
  const source = record(query, ['limit', 'mode', 'filters', 'sort']), filters = array(source.filters, 32), sorts = array(source.sort, 8), refs: unknown[] = [page, query, rawTarget, rawColumns, source.filters, source.sort]; let bytes = 0;
  /** 目录本身也有界，保primitive引用而非复制巨量原文，原过滤值最终仍由原Schema验证。 */
  const string = (value: unknown, maximum: number) => { if (typeof value !== 'string' || value.length > maximum) throw invalid(); bytes += encoder.encode(value).byteLength; if (bytes > 16 * 1024 * 1024) throw invalid(); return value; };
  const copiedColumns = columns.map(raw => { refs.push(raw); const value = record(raw, ['name', 'declaredType', 'generated']); if (value.generated !== undefined && typeof value.generated !== 'boolean') throw invalid(); const name = string(value.name, 512); if (!name || name.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(name)) throw invalid(); return { name, declaredType: string(value.declaredType, 1024 * 1024), ...(value.generated === undefined ? {} : { generated: value.generated }) }; });
  if (new Set(copiedColumns.map(column => column.name)).size !== copiedColumns.length) throw invalid();
  const copiedFilters = filters.map(raw => { refs.push(raw); const value = record(raw, ['column', 'operator', 'value', 'secondValue', 'values', 'selectedValues', 'enabled']), copied = { ...value }; for (const key of ['value', 'secondValue']) if (Object.hasOwn(value, key)) { refs.push(value[key]); copied[key] = record(value[key], ['kind', 'value']); } for (const key of ['values', 'selectedValues']) if (Object.hasOwn(value, key)) { refs.push(value[key]); copied[key] = array(value[key], 128).map(item => { refs.push(item); return record(item, ['kind', 'value']); }); } return copied; });
  const copiedSorts = sorts.map(raw => { refs.push(raw); return record(raw, ['column', 'direction']); });
  const input = sqliteTablePageSchema.parse({ connectionId: target.connectionId, database: target.database, table: target.table, taskId: 'sqlite-filtered-select-validation', offset: 0, limit: source.limit, mode: source.mode, filters: copiedFilters, sort: copiedSorts });
  const names = new Set(copiedColumns.map(column => column.name)); if (input.filters.some(filter => !names.has(filter.column)) || input.sort.some(sort => !names.has(sort.column))) throw invalid();
  return { target: { connectionId: input.connectionId, database: 'main', table: input.table, kind: target.kind as 'table' | 'view' }, columns: copiedColumns, input, refs, schemaKey };
}
/** 明确目标、字段元数据、每个query引用与值都必须相同，schemaKey相同不能替代准确原对象。 */
function same(before: Snapshot, after: Snapshot): boolean { return before.refs.length === after.refs.length && before.refs.every((ref, index) => ref === after.refs[index]) && before.schemaKey === after.schemaKey && JSON.stringify(before.target) === JSON.stringify(after.target) && before.columns.length === after.columns.length && before.columns.every((column, i) => column.name === after.columns[i].name && column.declaredType === after.columns[i].declaredType && column.generated === after.columns[i].generated) && JSON.stringify(before.input) === JSON.stringify(after.input); }

/** 只持有原表页与已应用筛选的本地意图，生成SQL不请求数据库，也不清理dirty草稿。 */
export class SqliteFilteredSelectIntent {
  readonly columns: readonly string[]; readonly target: Readonly<SqliteTablePage['target']>; readonly defaultLimit: number;
  private readonly snapshot: Snapshot; private valid = true; private revision = 0;
  constructor(private readonly page: SqliteTablePage, private readonly query: SqliteTableQuery, private readonly guard: () => boolean) { this.snapshot = capture(page, query); this.columns = Object.freeze(this.snapshot.columns.map(column => column.name)); this.target = Object.freeze({ ...this.snapshot.target }); this.defaultLimit = this.snapshot.input.limit; }
  /** 观察到来源或窗口失效即永久撤权，A→B→A不能让旧意图或旧计划复活。 */
  current(): boolean {
    if (!this.valid) return false;
    try { if (!this.guard() || !this.valid || !same(this.snapshot, capture(this.page, this.query)) || !this.guard() || !this.valid) this.invalidate(); }
    catch { this.invalidate(); } return this.valid;
  }
  /** 关闭或外来状态变化同步撤销全部计划，不影响表格、事务或原SQL标签。 */
  invalidate(): void { this.valid = false; this.revision++; }
  /** 只接收完整字段白名单与可选LIMIT，每次编译撤旧计划；默认无LIMIT且始终不生成OFFSET。 */
  compile(columns: readonly string[], limit?: number): SqliteFilteredSelectPlan {
    const revision = ++this.revision; if (!this.current()) throw Error(sqliteFilteredSelectMessages.stale);
    const raw = array(columns, 1024); if (!raw.length || raw.some(column => typeof column !== 'string' || !this.columns.includes(column)) || new Set(raw).size !== raw.length) throw invalid(); const selected = raw as readonly string[];
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > sqliteReadSqlLimits.limit)) throw Error(sqliteFilteredSelectMessages.limit);
    const sql = buildSqliteFilteredSelect(this.snapshot.input, this.snapshot.columns, selected, limit); if (!this.current() || this.revision !== revision) throw Error(sqliteFilteredSelectMessages.stale);
    const plan: SqliteFilteredSelectPlan = Object.freeze({ sql, columns: Object.freeze([...selected]), ...(limit === undefined ? {} : { limit }) }); plans.set(plan, { owner: this, revision, used: false }); return plan;
  }
  /** 仅最新准确计划可消费一次；成功同时消费本意图，旧Modal重入不能再开第二个查询。 */
  consume(plan: SqliteFilteredSelectPlan): boolean { const proof = plans.get(plan); if (!proof || proof.owner !== this || proof.used || proof.revision !== this.revision) return false; proof.used = true; if (!this.current() || proof.revision !== this.revision) return false; this.invalidate(); return true; }
}
