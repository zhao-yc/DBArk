import { createHash, randomUUID } from 'node:crypto';
import type { ColumnInfo, TableInfo } from '../shared/contracts';
import { csvExportFieldLimits as limits, csvExportTargetKey, validateCsvExportColumnNames, type CsvExportFieldsOutput, type CsvExportSelection, type CsvExportTarget } from '../shared/csvExportFields';
import { StructurePatchCache, structureCacheLimits, type StructureCacheScope } from './structurePatchCache';
import { parseTableColumnDefinition } from './tableColumnDefinition';
import type { ManagedConnection } from './connection';

export interface CsvExportFieldSnapshot { target: CsvExportTarget; revision: number; expires: number; digest: string; columns: string[]; bytes: number; }
interface PreparedCatalog { snapshot: CsvExportFieldSnapshot; columns: CsvExportFieldsOutput['columns']; }
/** 只摘要真实字段及其原定义，忽略表尾自增计数，普通数据插入不使选列目录伪过期。 */
function schemaDigest(target: CsvExportTarget, info: TableInfo, managed: ManagedConnection): string {
  if (info.database !== target.database || info.name !== target.table || !['table', 'view'].includes(info.objectKind ?? '') || typeof managed.sqlMode !== 'string') throw Error('CSV字段目录目标、对象种类或模式未知，请重新读取');
  if (!Array.isArray(info.columns) || info.columns.some(column => !column || typeof column.name !== 'string' || typeof column.type !== 'string' || !column.type)) throw Error('CSV实际字段名称或类型未知，请重新读取');
  validateCsvExportColumnNames(info.columns.map(column => column.name));
  if (typeof info.ddl !== 'string' || !info.ddl || Buffer.byteLength(info.ddl) > limits.ddlBytes || Buffer.byteLength(JSON.stringify(info.columns)) > limits.catalogBytes) throw Error('CSV字段目录不完整或超过预算，请重新读取');
  const mode = managed.sqlMode.toUpperCase().split(',');
  const definition = info.objectKind === 'table' ? parseTableColumnDefinition(info.ddl, { dialect: managed.status.dialect, mode: { noBackslashEscapes: mode.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: mode.includes('ANSI_QUOTES') } }) : undefined;
  if (definition && (definition.table !== target.table || definition.database !== undefined && definition.database !== target.database || definition.columns.length !== info.columns.length || definition.columns.some((column, position) => column.name !== info.columns[position].name))) throw Error('CSV字段目录与原定义不一致，请重新读取');
  return createHash('sha256').update(JSON.stringify([csvExportTargetKey(target), managed.status.dialect, managed.status.version, managed.sqlMode, info.objectKind, info.columns, definition ? definition.columns.map(column => column.raw) : info.ddl, info.charset, info.collation, info.engine])).digest('hex');
}
/** CSV表导出独立的有界目录用途；不保存行值，不与任意SQL结果导出混用。 */
export class CsvExportFieldCatalogs {
  private readonly snapshots: StructureCacheScope<CsvExportFieldSnapshot>;
  constructor(private readonly cache: StructurePatchCache, private readonly now = () => Date.now()) { this.snapshots = cache.scope('csvExport', 'snapshot', value => ({ connectionId: value.target.connectionId, bytes: value.bytes, expires: value.expires })); }
  /** 修订只由main注入，客户端提交的修订会被公开参数边界拒绝。 */
  private revision(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw Error('缺少可信CSV目录连接修订'); return value as number; }
  /** 校验在真实读取任务内完成，未知目录使任务失败而不是先报告完成。 */
  prepare(target: CsvExportTarget, info: TableInfo, managed: ManagedConnection, revision: unknown): PreparedCatalog {
    const digest = schemaDigest(target, info, managed), columns = info.columns.map(column => ({ name: column.name, type: column.type }));
    const snapshot = { target: { ...target }, revision: this.revision(revision), expires: this.now() + structureCacheLimits.ttlMs, digest, columns: columns.map(column => column.name), bytes: Buffer.byteLength(JSON.stringify(columns)) + 4096 };
    this.cache.capacity(snapshot.bytes, 'snapshot'); return { snapshot, columns };
  }
  /** 真实短连接关闭后再发布目录，异常不留下可用令牌，也不保留已关闭连接引用。 */
  publish({ snapshot, columns }: PreparedCatalog): CsvExportFieldsOutput {
    const catalogId = randomUUID(); this.snapshots.set(catalogId, snapshot); return { target: { ...snapshot.target }, catalogId, expiresAt: new Date(snapshot.expires).toISOString(), columns };
  }
  /** 窗口离开只释放本用途，不开放跨用途清理。 */
  release(catalogId: string): void { this.snapshots.delete(catalogId); }
  /** 开始导出前消费令牌；目标、修订和字段均须匹配，不在失败后自动复用。 */
  consume(selection: CsvExportSelection, target: CsvExportTarget, revision: unknown): CsvExportFieldSnapshot & { selected: string[] } {
    const snapshot = this.snapshots.get(selection.catalogId); this.snapshots.delete(selection.catalogId);
    if (!snapshot || snapshot.expires <= this.now() || snapshot.revision !== this.revision(revision) || csvExportTargetKey(snapshot.target) !== csvExportTargetKey(target)) throw Error('CSV字段目录已失效或目标变化，请重新读取');
    const selected = validateCsvExportColumnNames(selection.columns);
    if (selected.some(name => !snapshot.columns.includes(name))) throw Error('选择了不存在的CSV字段，请重新读取');
    return { ...snapshot, selected };
  }
  /** 已取得同事务MDL后重读实际字段；按选择顺序返回投影，不读取或过滤表数据。 */
  project(snapshot: CsvExportFieldSnapshot & { selected: string[] }, info: TableInfo, managed: ManagedConnection): ColumnInfo[] {
    if (snapshot.expires <= this.now() || snapshot.digest !== schemaDigest(snapshot.target, info, managed)) throw Error('CSV实际字段已变化或目录过期，请重新读取；未替换目标文件');
    const columns = new Map(info.columns.map(column => [column.name, column]));
    return snapshot.selected.map(name => { const column = columns.get(name); if (!column) throw Error('CSV字段已不存在，请重新读取'); return column; });
  }
}
