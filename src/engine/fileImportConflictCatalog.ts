import { createHash } from 'node:crypto';
import type { TableInfo } from '../shared/contracts';
import type { FileImportKeyCatalog } from '../shared/fileImportConflict';
import { definitionOmittingSqlModes } from '../shared/tableColumnPatches';
import type { ManagedConnection } from './connection';
import * as metadata from './metadata';
import { parseTableColumnDefinition, tableDefinitionTokens } from './tableColumnDefinition';
import { readTableIndexDefinition } from './tableIndexDefinition';
import { crossCheckIndexStatistics, deriveStatisticsCapabilities } from './tableIndexMetadata';

export interface FileImportTarget { connectionId: string; database: string; table: string; }
export type FileImportCatalogQuery = <T>(sql: string, params?: (string | number | boolean | null | Buffer)[]) => Promise<T>;
export interface FileImportCatalogRead { catalog: FileImportKeyCatalog; info: TableInfo; }

/** 结构摘要不含自增下一个值；仅在表尾选项层删除AUTO_INCREMENT，列属性及字符串原样参与摘要。 */
function structuralTail(raw: string, context: Parameters<typeof tableDefinitionTokens>[1]): unknown[] {
  const tokens = tableDefinitionTokens(raw, context), result: unknown[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind === 'word' && token.value.toUpperCase() === 'AUTO_INCREMENT') {
      let next = index + 1; if (tokens[next]?.value === '=') next++;
      if (tokens[next]?.kind === 'number' && /^\d+$/.test(tokens[next].value)) { index = next; continue; }
    }
    result.push([token.kind, token.value]);
  }
  return result;
}

/** 调用方先持目标事务MDL；只查询完整定义和STATISTICS，不调用索引设计器的SET/DDL能力准备。 */
export async function readFileImportKeyCatalog(managed: ManagedConnection, target: FileImportTarget, query: FileImportCatalogQuery): Promise<FileImportCatalogRead> {
  const connection = managed.connection, threadId = connection.threadId;
  const check = () => { const status = managed.serverStatus; if (managed.connection !== connection || connection.threadId !== threadId || managed.broken || managed.transactionStateKnown !== true || !Number.isInteger(status) || status! < 0 || status! > 65535 || !(status! & 1)) throw Error('读取匹配键时原连接事务或MDL保护未知'); };
  const read: FileImportCatalogQuery = async <T>(sql: string, params: (string | number | boolean | null | Buffer)[] = []) => { check(); const rows = await query<T>(sql, params); check(); return rows; };
  check();
  const info = await metadata.tableInfo(managed, target.database, target.table, async <T>(sql: string, params: (string | number | boolean | null | Buffer)[] = []) => ({ rows: await read<T>(sql, params), fields: [] }));
  check();
  if (info.objectKind !== 'table' || info.engine.toUpperCase() !== 'INNODB' || info.name !== target.table || info.database !== target.database) throw Error('冲突处理需要可确认的InnoDB基本表');
  if (!info.columns.length || info.columns.length > 4096 || info.indexes.length > 1024 || Buffer.byteLength(info.ddl) > 2 * 1024 * 1024 || managed.sqlMode === undefined) throw Error('目标结构或SQL模式无法完整证明，未生成匹配键目录');
  const modes = managed.sqlMode.split(','), context = { dialect: managed.status.dialect, mode: { noBackslashEscapes: modes.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: modes.includes('ANSI_QUOTES') } };
  if (modes.some(mode => (definitionOmittingSqlModes as readonly string[]).includes(mode))) throw Error('当前SQL模式会省略完整结构属性，不能证明导入匹配键');
  const document = parseTableColumnDefinition(info.ddl, context), indexDocument = readTableIndexDefinition(document);
  if (document.table !== target.table || document.database !== undefined && document.database !== target.database || document.columns.length !== info.columns.length || document.columns.some((column, position) => column.name !== info.columns[position].name) || indexDocument.indexes.length !== info.indexes.length) throw Error('目标完整定义与字段/索引目录不一致');
  const typeKey = (raw: string) => JSON.stringify(tableDefinitionTokens(raw, context).map(token => [token.kind, token.kind === 'word' ? token.value.toUpperCase() : token.value]));
  for (const [position, column] of document.columns.entries()) {
    const catalog = info.columns[position];
    if (typeKey(column.type.raw) !== typeKey(catalog.type) || column.nullable !== undefined && column.nullable !== catalog.nullable || column.attributes.some(attribute => attribute.kind === 'generated') !== catalog.generated) throw Error('字段类型、可空性或生成属性目录与完整定义不一致');
  }
  const headers = await read<{ COLUMN_NAME: string }[]>("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'information_schema' AND TABLE_NAME = 'STATISTICS' ORDER BY ORDINAL_POSITION LIMIT 65");
  if (!Array.isArray(headers)) throw Error('索引目录能力回包无效');
  const capabilities = deriveStatisticsCapabilities(headers.map(row => row.COLUMN_NAME));
  const selected = ['INDEX_NAME', 'COLUMN_NAME', 'SEQ_IN_INDEX', 'NON_UNIQUE', 'INDEX_TYPE', 'COLLATION', 'SUB_PART', 'INDEX_COMMENT', ...(capabilities.expression ? ['EXPRESSION'] : []), ...(capabilities.visibility ? ['IS_VISIBLE'] : []), ...(capabilities.ignored ? ['IGNORED'] : [])];
  const rows = await read<Record<string, unknown>[]>(`SELECT ${selected.join(', ')} FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX LIMIT 32769`, [target.database, target.table]);
  if (!Array.isArray(rows) || rows.length > 32768) throw Error('索引目录超过完整读取预算');
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    if (!row || typeof row.INDEX_NAME !== 'string') throw Error('索引目录名称无效');
    const group = groups.get(row.INDEX_NAME) ?? []; group.push(row); groups.set(row.INDEX_NAME, group);
  }
  if (groups.size !== indexDocument.indexes.length || new Set(indexDocument.indexes.map(index => index.name)).size !== groups.size) throw Error('索引目录与完整定义数量不一致');
  const keys: FileImportKeyCatalog['keys'] = [];
  for (const index of indexDocument.indexes) {
    const group = groups.get(index.name); if (!group) throw Error('索引目录缺失原定义中的键');
    const checked = crossCheckIndexStatistics(index, group, capabilities), columns = index.parts.flatMap(part => part.columnName ? [part.columnName] : []);
    const reasons: string[] = [];
    if (!['primary', 'unique'].includes(index.kind)) reasons.push('不是主键或唯一键');
    if (index.opaqueReasons.length || index.parts.some(part => part.opaqueReasons.length || part.expressionSql !== undefined)) reasons.push('表达式或不透明键不能用于匹配');
    if (index.method !== 'BTREE' || index.parts.some(part => part.prefixLength !== undefined)) reasons.push('需要完整BTREE键，不接受前缀键');
    if (!columns.length || new Set(columns).size !== columns.length || columns.length !== index.parts.length) reasons.push('匹配键列不完整或重复');
    if (columns.some(name => !info.columns.some(column => column.name === name && !column.nullable && !column.generated && !/\bINVISIBLE\b/i.test(column.extra)))) reasons.push('匹配键列必须普通、可见且不可为空');
    if (capabilities.expression && group.some(row => row.EXPRESSION !== null)) reasons.push('函数键不能用于匹配');
    // 5.7没有不可见索引功能；8.x必须由IS_VISIBLE证明，MariaDB必须由IGNORED=NO证明。
    const oldVisible = managed.status.dialect === 'mysql' && /^5\.7\.\d+(?:$|[-.])/.test(managed.status.version) && !capabilities.visibility;
    const visible = capabilities.visibility ? checked.visible === true : managed.status.dialect === 'mariadb' && capabilities.ignored ? group.every(row => row.IGNORED === 'NO') : oldVisible;
    if (!visible || capabilities.ignored && group.some(row => row.IGNORED !== 'NO')) reasons.push('索引不可见、已忽略或可见性尚未证明');
    if (managed.status.dialect === 'mysql' && /^8\./.test(managed.status.version) && !capabilities.expression) reasons.push('缺少函数索引目录证明');
    keys.push({ name: index.name, columns, reliable: reasons.length === 0, ...(reasons.length ? { reason: [...new Set(reasons)].join('；') } : {}) });
  }
  // SHOW CREATE尾部AUTO_INCREMENT随数据变化而变，其余结构/类型/排序规则/约束都参与稳定摘要。
  const structural = { dialect: managed.status.dialect, version: managed.status.version, database: target.database, table: target.table, engine: info.engine, charset: info.charset, collation: info.collation, columns: info.columns, items: document.items.map(item => item.raw), tail: structuralTail(document.tail.raw, context), statistics: rows.map(row => selected.map(name => row[name])) };
  const schemaHash = createHash('sha256').update(JSON.stringify(structural)).digest('hex');
  return { info, catalog: { ...target, schemaHash, keys } };
}
