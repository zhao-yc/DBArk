import { createHash, randomUUID } from 'node:crypto';
import { structureTaskQuery, readStructureDefinition, structureDocumentOf, assertStructureDefinitionUnchanged, type StructureDefinitionRead, type StructureTaskContext } from './structureDefinition';
import { readTableIndexDefinition, editableIndexDefinition } from './tableIndexDefinition';
import { crossCheckIndexStatistics, deriveIndexCapabilities, deriveStatisticsCapabilities, deriveTrustedIndexColumn, type IndexColumnMetadata } from './tableIndexMetadata';
import { readIndexDependencies } from './tableIndexDependencyRead';
import type { TableIndexPatchTarget } from '../shared/tableIndexTasks';
import type { IndexPlanOptions, IndexPlanSnapshot, TrustedIndexColumn, TrustedIndexDefinition } from '../shared/tableIndexPatches';

export interface IndexStructureRead extends StructureDefinitionRead {
  model: IndexPlanSnapshot; options?: IndexPlanOptions; warnings: string[];
  /** 元数据摘要不含统计基数、连接编号或数据行，外部子表新增外键也会使摘要变化。 */
  catalogDigest: string; dependencyDigest: string; bytes: number;
}
export interface IndexReferenceNames { columns: ReadonlyMap<string, string>; indexes: ReadonlyMap<string, string>; }
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** 目标字面量只从已校验名称转 UTF-8 十六进制，不依赖会话字符串转义规则。 */
const literal = (value: string): string => `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;
/** 变量仅用于可信目录能力，不将损失精度的数值或空结果视为关闭。 */
function flag(value: unknown, label: string): boolean {
  if (value === 0 || value === '0' || value === 'OFF') return false;
  if (value === 1 || value === '1' || value === 'ON') return true;
  throw new Error(`无法确认${label}`);
}
function reference(names: ReadonlyMap<string, string> | undefined, name: string): string {
  const matches = names ? [...names].filter(([, value]) => value === name) : [];
  if (matches.length > 1) throw new Error('结构引用名称重复');
  return matches[0]?.[0] ?? randomUUID();
}

/** 专用会话主动开启两类检查；MySQL GIPK 显示也只改本会话，不触碰全局或查询标签。 */
async function prepare(context: StructureTaskContext): Promise<{ generatedPrimaryKeys?: boolean; restrictForeignKeysToUnique?: boolean }> {
  await structureTaskQuery(context, 'SET SESSION foreign_key_checks = 1, unique_checks = 1');
  const row = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SELECT @@SESSION.foreign_key_checks AS fkChecks, @@SESSION.unique_checks AS uniqueChecks')).rows;
  if (row.length !== 1 || !flag(row[0].fkChecks, '外键检查状态') || !flag(row[0].uniqueChecks, '唯一性检查状态')) throw new Error('结构会话外键和唯一检查必须实际开启');
  const mysql = context.managed.status.dialect === 'mysql', version = /^(\d+)\.(\d+)\.(\d+)/.exec(context.managed.status.version);
  const major = Number(version?.[1]), minor = Number(version?.[2]), patch = Number(version?.[3]);
  const facts: { generatedPrimaryKeys?: boolean; restrictForeignKeysToUnique?: boolean } = {};
  if (mysql && (major > 8 || (major === 8 && (minor > 0 || patch >= 30)))) {
    await structureTaskQuery(context, 'SET SESSION show_gipk_in_create_table_and_information_schema = ON');
    const state = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SELECT @@SESSION.show_gipk_in_create_table_and_information_schema AS showGipk, @@SESSION.sql_generate_invisible_primary_key AS generateGipk')).rows;
    if (state.length !== 1 || !flag(state[0].showGipk, '生成不可见主键显示状态')) throw new Error('无法确认完整生成主键显示状态');
    facts.generatedPrimaryKeys = flag(state[0].generateGipk, '自动生成不可见主键状态');
  }
  if (mysql && (major > 8 || (major === 8 && minor >= 4))) {
    const state = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SELECT @@restrict_fk_on_non_standard_key AS restrictForeignKeys')).rows;
    if (state.length !== 1) throw new Error('无法确认父外键唯一性规则');
    facts.restrictForeignKeysToUnique = flag(state[0].restrictForeignKeys, '父外键唯一性规则');
  }
  return facts;
}

/** 读取原定义和实际目录并交叉证明索引能力；未知能力保留只读显示，不推断可写。 */
export async function readIndexStructure(context: StructureTaskContext, target: TableIndexPatchTarget, refs?: IndexReferenceNames): Promise<IndexStructureRead> {
  const flags = await prepare(context);
  const read = await readStructureDefinition(context, target, true), definition = structureDocumentOf(read), indexDocument = readTableIndexDefinition(definition);
  const db = literal(target.database), table = literal(target.table);
  const facts = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SELECT @@lower_case_table_names AS lowerCaseTableNames, @@version_compile_os AS compileOs, @@innodb_page_size AS pageSize')).rows;
  if (facts.length !== 1 || ![0, 1, 2, '0', '1', '2'].includes(facts[0].lowerCaseTableNames as number) || typeof facts[0].compileOs !== 'string') throw new Error('无法确认服务器标识符和页大小能力');
  let largePrefix: boolean | undefined;
  if (read.context.dialect === 'mysql' && /^5\.7\./.test(read.serverVersion)) {
    const state = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SELECT @@innodb_large_prefix AS largePrefix')).rows;
    if (state.length !== 1) throw new Error('无法确认大前缀能力');
    largePrefix = flag(state[0].largePrefix, '大前缀能力');
  }
  const tables = (await structureTaskQuery<{ ENGINE: string; ROW_FORMAT: string }[]>(context, `SELECT ENGINE, ROW_FORMAT FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${db} AND TABLE_NAME = ${table} LIMIT 2`)).rows;
  if (tables.length !== 1 || typeof tables[0].ENGINE !== 'string' || typeof tables[0].ROW_FORMAT !== 'string') throw new Error('无法唯一确认表引擎和行格式');
  const capability = deriveIndexCapabilities({ dialect: read.context.dialect, serverVersion: read.serverVersion, engine: tables[0].ENGINE, rowFormat: tables[0].ROW_FORMAT, pageSize: facts[0].pageSize as number, largePrefix });
  const rawColumns = (await structureTaskQuery<IndexColumnMetadata[]>(context, `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME, COLLATION_NAME, CHARACTER_MAXIMUM_LENGTH, CHARACTER_OCTET_LENGTH, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ${db} AND TABLE_NAME = ${table} ORDER BY ORDINAL_POSITION LIMIT 4097`)).rows;
  if (rawColumns.length !== definition.columns.length || rawColumns.length > 4096) throw new Error('索引字段目录数量与原定义不一致或超过预算');
  const charsetRows = (await structureTaskQuery<{ CHARACTER_SET_NAME: string; MAXLEN: number | string }[]>(context, 'SELECT CHARACTER_SET_NAME, MAXLEN FROM information_schema.CHARACTER_SETS ORDER BY CHARACTER_SET_NAME LIMIT 257')).rows;
  if (!charsetRows.length || charsetRows.length > 256) throw new Error('字符集能力目录为空或超过预算');
  const charsets = new Map<string, number | string>();
  for (const row of charsetRows) {
    if (typeof row.CHARACTER_SET_NAME !== 'string' || charsets.has(row.CHARACTER_SET_NAME)) throw new Error('字符集能力目录名称无效或重复');
    charsets.set(row.CHARACTER_SET_NAME, row.MAXLEN);
  }
  const columns = new Map<string, TrustedIndexColumn>(), warnings = [...capability.reasons];
  for (const [position, parsed] of definition.columns.entries()) {
    const metadata = rawColumns[position], derived = deriveTrustedIndexColumn(parsed, metadata, { definitionContext: read.context, charsetMaxBytes: metadata.CHARACTER_SET_NAME === null ? undefined : charsets.get(metadata.CHARACTER_SET_NAME) });
    columns.set(reference(refs?.columns, parsed.name), derived.column);
    if (derived.reasons.length) warnings.push(`字段 ${JSON.stringify(parsed.name)}：${derived.reasons.join('；')}`);
  }
  const statisticsColumns = (await structureTaskQuery<{ COLUMN_NAME: string }[]>(context, "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'information_schema' AND TABLE_NAME = 'STATISTICS' ORDER BY ORDINAL_POSITION LIMIT 65")).rows;
  const statsCapabilities = deriveStatisticsCapabilities(statisticsColumns.map(row => row.COLUMN_NAME));
  const selected = ['INDEX_NAME', 'COLUMN_NAME', 'SEQ_IN_INDEX', 'NON_UNIQUE', 'INDEX_TYPE', 'COLLATION', 'SUB_PART', 'INDEX_COMMENT', ...(statsCapabilities.expression ? ['EXPRESSION'] : []), ...(statsCapabilities.visibility ? ['IS_VISIBLE'] : []), ...(statsCapabilities.ignored ? ['IGNORED'] : [])];
  const statistics = (await structureTaskQuery<Record<string, unknown>[]>(context, `SELECT ${selected.join(', ')} FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ${db} AND TABLE_NAME = ${table} ORDER BY INDEX_NAME, SEQ_IN_INDEX LIMIT 8193`)).rows;
  if (statistics.length > 8192 || Buffer.byteLength(JSON.stringify(statistics)) > 4 * 1024 * 1024) throw new Error('索引目录超过条目或字节预算');
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of statistics) {
    if (typeof row.INDEX_NAME !== 'string') throw new Error('索引目录名称缺失');
    const group = groups.get(row.INDEX_NAME) ?? []; group.push(row); groups.set(row.INDEX_NAME, group);
  }
  if (groups.size !== indexDocument.indexes.length || indexDocument.indexes.some(index => !groups.has(index.name))) throw new Error('索引目录未完整对应原定义');
  const indexes = new Map<string, TrustedIndexDefinition>();
  for (const parsed of indexDocument.indexes) {
    const rows = groups.get(parsed.name)!, checked = crossCheckIndexStatistics(parsed, rows, statsCapabilities);
    const value = editableIndexDefinition(parsed, columns);
    // 原定义完整、引用列均普通且目录无表达式时，才能排除隐藏函数键或 GIPK；自动外键键来源另行保护。
    const mysqlEight = read.context.dialect === 'mysql' && /^8\./.test(read.serverVersion);
    const expressionsAbsent = mysqlEight ? statsCapabilities.expression && rows.every(row => row.EXPRESSION === null) : !statsCapabilities.expression || rows.every(row => row.EXPRESSION === null);
    const knownPlain = !!value && expressionsAbsent && value.keyParts.every(part => { const column = columns.get(part.columnRef)!; return !column.generated && !column.hidden; }) && !parsed.opaqueReasons.length;
    let visible = checked.visible;
    if (visible === 'unknown' && capability.writable && knownPlain && ((read.context.dialect === 'mysql' && /^5\.7\.44(?:$|-)/.test(read.serverVersion) && !statsCapabilities.visibility) || (read.context.dialect === 'mariadb' && statsCapabilities.ignored && rows.every(row => row.IGNORED === 'NO')))) visible = true;
    indexes.set(reference(refs?.indexes, parsed.name), { parsed, ...(value ? { definition: value } : {}), visible, generated: knownPlain ? false : 'unknown' });
  }
  const dependencyRead = await readIndexDependencies(context, target, definition, columns, indexes, { dialect: read.context.dialect, serverVersion: read.serverVersion, lowerCaseTableNames: Number(facts[0].lowerCaseTableNames), compileOs: facts[0].compileOs as string, ...flags });
  warnings.push(...dependencyRead.warnings);
  // 多次目录查询之间若目标自身发生 DDL，不能把前后两个表结构拼成一个可执行快照。
  const endRead = await readStructureDefinition(context, target, false);
  assertStructureDefinitionUnchanged(read, { ...endRead, originalMode: read.originalMode });
  const options: IndexPlanOptions | undefined = capability.capabilities ? { database: target.database, dialect: read.context.dialect, serverVersion: read.serverVersion, engine: 'InnoDB', sqlMode: read.context.mode, capabilities: capability.capabilities, checks: { foreignKeyChecks: 1, uniqueChecks: 1 } } : undefined;
  const model: IndexPlanSnapshot = { definition, indexDocument, columns, indexes, dependencies: dependencyRead.dependencies };
  const catalogDigest = digest({ facts, flags, largePrefix, tables, rawColumns, charsets: charsetRows, statsCapabilities, statistics });
  const bytes = Buffer.byteLength(read.source) * 2 + Buffer.byteLength(JSON.stringify([...columns])) + Buffer.byteLength(JSON.stringify([...indexes])) + Buffer.byteLength(JSON.stringify(rawColumns)) + Buffer.byteLength(JSON.stringify(statistics)) + dependencyRead.bytes + 4096;
  return { ...read, model, options, warnings: [...new Set(warnings)], catalogDigest, dependencyDigest: dependencyRead.digest, bytes };
}

/** 预览和执行必须复用同一快照引用，且目录/依赖摘要与完整定义均未变化。 */
export function assertIndexStructureUnchanged(before: IndexStructureRead, after: IndexStructureRead): void {
  assertStructureDefinitionUnchanged(before, after);
  if (before.catalogDigest !== after.catalogDigest || before.dependencyDigest !== after.dependencyDigest || JSON.stringify(before.options) !== JSON.stringify(after.options)) throw new Error('索引目录、能力或关联依赖已变化，请重新读取和预览；未发送 DDL');
}

/** 名称映射只在内部传递，不接受客户端提供目标列名或索引名替代快照引用。 */
export function indexReferenceNames(read: IndexStructureRead): IndexReferenceNames {
  return { columns: new Map([...read.model.columns].map(([ref, column]) => [ref, column.name])), indexes: new Map([...read.model.indexes].map(([ref, index]) => [ref, index.parsed.name])) };
}
