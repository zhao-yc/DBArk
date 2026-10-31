import type { SqliteTablePage } from '../shared/sqliteTableBrowse';
import { sqliteTablePageSchema } from '../shared/sqliteTableBrowse';
import { sqliteTableExportSchema, type SqliteTableExportInput, type SqliteTableExportOutput } from '../shared/sqliteTableExport';
import type { SqliteTableQuery } from './sqliteTableBrowser';
import { checkTableFilteredExportOutput } from './tableFilteredExportUi';
import { sqliteTableExportZh as text } from './locales/sqliteTableExport.zh-CN';

export type SqliteTableExportOptions = Pick<SqliteTableExportInput, 'format' | 'encoding' | 'csvDelimiter' | 'columns' | 'sqlContent'>;
export interface SqliteExportSource { target: SqliteTablePage['target']; columns: readonly { name: string; declaredType: string; generated: boolean }[]; schemaKey: string; }
/** 来源仅保留元数据，不把当前页行值当作完整导出的文件数据。 */
function source(page: SqliteTablePage): SqliteExportSource {
  const schemaKey = 'schemaKey' in page ? page.schemaKey : undefined;
  if (!page.target || page.target.database !== 'main' || !['table', 'view'].includes(page.target.kind) || typeof schemaKey !== 'string' || !/^[a-f0-9]{64}$/.test(schemaKey) || !Array.isArray(page.columns) || !page.columns.length) throw Error(text.invalid);
  const columns = page.columns.map(column => {
    const generated = 'generated' in column ? column.generated : false;
    if (typeof column.name !== 'string' || !column.name || typeof column.declaredType !== 'string' || generated !== undefined && typeof generated !== 'boolean') throw Error(text.invalid);
    return { name: column.name, declaredType: column.declaredType, generated: generated === true };
  });
  if (new Set(columns.map(column => column.name)).size !== columns.length) throw Error(text.invalid);
  return { target: { ...page.target }, columns, schemaKey };
}
/** 递归冻结准确条件与列目录，外部后改草稿不能改变已捕获请求。 */
function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
/** 选择是 SQLite 文件真实列名的显式顺序；SQL 只允许原 table 的非生成列。 */
export function selectSqliteExportColumns(source: SqliteExportSource, options: Pick<SqliteTableExportOptions, 'format' | 'columns' | 'sqlContent'>): string[] {
  if (Object.hasOwn(options, 'sqlContent') && (options.format !== 'sql' || !['data', 'structure', 'structure-data'].includes(options.sqlContent ?? ''))) throw Error(text.invalid);
  if (options.format === 'sql' && options.sqlContent === 'structure') { if (!Array.isArray(options.columns) || options.columns.length) throw Error(text.invalid); return []; }
  if (options.format === 'sql' && source.target.kind !== 'table') throw Error(text.viewSql);
  if (options.format === 'sql' && !source.columns.some(column => !column.generated)) throw Error(text.noSqlFields);
  if (!Array.isArray(options.columns) || !options.columns.length) throw Error(text.emptyFields);
  const names = new Set(source.columns.map(column => column.name));
  if (new Set(options.columns).size !== options.columns.length || options.columns.some(name => !names.has(name) || options.format === 'sql' && source.columns.find(column => column.name === name)?.generated)) throw Error(text.invalid);
  if (options.format === 'sql' && options.sqlContent === 'structure-data' && options.columns.length !== source.columns.filter(column => !column.generated).length) throw Error(text.structureDataFields);
  return [...options.columns];
}
/** 从准确当前页和已应用配置捕获意图；每次观察均留下来源 ABA 的永久失效墓碑。 */
export class SqliteTableExportIntent {
  readonly source: SqliteExportSource; readonly query: Readonly<Pick<SqliteTableQuery, 'mode' | 'filters' | 'sort'>>;
  private readonly values: readonly unknown[]; private readonly identity: string; private readonly queryIdentity: string;
  private dead = false; private checking = false; private listeners = new Set<() => void>();
  constructor(private readonly page: SqliteTablePage, private readonly applied: SqliteTableQuery, values: readonly unknown[], private readonly guard: () => boolean) {
    const metadata = source(page), parsed = sqliteTablePageSchema.parse({ connectionId: metadata.target.connectionId, database: metadata.target.database, table: metadata.target.table, taskId: 'sqlite-export-intent', offset: page.offset, limit: applied.limit, mode: applied.mode, filters: applied.filters, sort: applied.sort });
    if (applied.limit !== page.limit) throw Error(text.invalid);
    this.source = freeze(structuredClone(metadata)); this.query = freeze({ mode: parsed.mode, filters: structuredClone(parsed.filters), sort: structuredClone(parsed.sort) });
    this.identity = JSON.stringify(metadata); this.queryIdentity = JSON.stringify(applied); this.values = [...values];
  }
  /** 页面引用、已应用配置、活动标签和连接修订任一变化即失效，不比较最后值来复活。 */
  observe(values: readonly unknown[]): void { if (values.length !== this.values.length || values.some((value, index) => !Object.is(value, this.values[index]))) this.invalidate(); }
  /** 守卫只读真实工作区与原页；不创建会话，不替换已冻结来源。 */
  current(): boolean {
    if (this.dead || this.checking) return false; this.checking = true;
    try { if (this.guard() !== true || JSON.stringify(source(this.page)) !== this.identity || JSON.stringify(this.applied) !== this.queryIdentity) this.invalidate(); } catch { this.invalidate(); } finally { this.checking = false; }
    return !this.dead;
  }
  /** 微任务通知避免父渲染期间更新子状态；原请求的停止由对话框准确执行。 */
  invalidate(): void { if (this.dead) return; this.dead = true; queueMicrotask(() => { for (const listener of this.listeners) listener(); }); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** 严格 IPC 请求不含 offset/limit、路径、任意 SQL 或页行值，只保留冻结的真实SQLite 文件条件。 */
  input(options: SqliteTableExportOptions, fileToken: string, taskId: string): SqliteTableExportInput {
    if (!this.current()) throw Error(text.stale);
    if (options.format !== 'csv' && options.csvDelimiter !== undefined) throw Error(text.invalid);
    const columns = selectSqliteExportColumns(this.source, options);
    return sqliteTableExportSchema.parse({ connectionId: this.source.target.connectionId, database: 'main', table: this.source.target.table, schemaKey: this.source.schemaKey, mode: this.query.mode, filters: structuredClone(this.query.filters), sort: structuredClone(this.query.sort), columns, format: options.format, encoding: options.format === 'xlsx' ? 'utf8' : options.encoding, ...(options.format === 'csv' && options.csvDelimiter !== undefined ? { csvDelimiter: options.csvDelimiter } : {}), ...(options.format === 'sql' && options.sqlContent !== undefined ? { sqlContent: options.sqlContent } : {}), fileToken, taskId });
  }
}
/** 复用完整原子提交回执校验；任务进度与取消意图不能取代已保存事实。 */
export function checkSqliteTableExportOutput(value: unknown): SqliteTableExportOutput { try { return checkTableFilteredExportOutput(value); } catch { throw Error(text.invalid); } }
