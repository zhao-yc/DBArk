import { createHash } from 'node:crypto';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { tableDefinitionTokens, type TableDefinitionToken } from './tableColumnDefinition';
import type { TableColumnDefinitionDocument, TableColumnPatchTarget } from '../shared/tableColumnPatches';
import type { DependencyCoverage, ForeignKeyDependency, IndexDependencyInput, TrustedIndexColumn, TrustedIndexDefinition } from '../shared/tableIndexPatches';

export interface IndexDependencyFacts {
  dialect: 'mysql' | 'mariadb'; serverVersion: string; lowerCaseTableNames: number; compileOs: string;
  restrictForeignKeysToUnique?: boolean; generatedPrimaryKeys?: boolean;
}
export interface IndexDependencyRead { dependencies: IndexDependencyInput; digest: string; bytes: number; warnings: string[]; }
const limits = { foreignKeys: 256, parts: 8192, partitions: 4096, bytes: 4 * 1024 * 1024 } as const;
type Row = Record<string, unknown>;
type PartialReason = Extract<DependencyCoverage, { kind: 'partial' }>['reason'];
class DirectoryProblem extends Error { constructor(readonly reason: PartialReason, message: string) { super(message); } }
interface SourceForeignKey { name: string; child: string[]; parent: string[]; database: string; table: string; }
interface ForeignHeader { id: string; child: string; parent: string; count: number; type: number; childColumns: string[]; parentColumns: string[]; }
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** 外键语义引用包含动作及两侧完整身份/列序，不包含支持索引候选，合法新增索引不会改写引用。 */
function foreignReference(header: ForeignHeader): string {
  return digest(['innodb-foreign-v1', 'dictionary', header.id, header.child, header.parent, header.childColumns, header.parentColumns, header.type]);
}
/** 所有目录名称来自固定程序白名单；对象值使用 UTF-8 hex，不受引号或 NBE 模式影响。 */
function literal(value: string): string { return `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`; }
function word(token: TableDefinitionToken | undefined): string { return token?.kind === 'word' ? token.value.toUpperCase() : ''; }
function symbol(token: TableDefinitionToken | undefined, value: string): boolean { return token?.kind === 'symbol' && token.value === value; }
function isName(token: TableDefinitionToken | undefined): token is TableDefinitionToken { return !!token && ['word', 'identifier'].includes(token.kind); }
function text(row: Row, key: string): string {
  const value = row[key]; if (typeof value !== 'string' || !value || value.includes('\0')) throw new DirectoryProblem('inconsistent', '依赖目录名称缺失或无效'); return value;
}
function integer(value: unknown, min: number, max: number): number {
  if ((typeof value !== 'number' && (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value))) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new DirectoryProblem('inconsistent', '依赖目录计数或序号无效'); return Number(value);
}
/** 对目录权限拒绝和明确缺少系统表降级；网络错误、取消和其他 SQL 错误必须传播。 */
function knownFailure(error: unknown): PartialReason | undefined {
  const value = error as { code?: string; errno?: number };
  if (['ER_SPECIFIC_ACCESS_DENIED_ERROR', 'ER_TABLEACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_COLUMNACCESS_DENIED_ERROR'].includes(value?.code ?? '') || [1227, 1142, 1044, 1143].includes(value?.errno ?? 0)) return 'permission';
  if (['ER_UNKNOWN_TABLE', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(value?.code ?? '') || [1109, 1146, 1054].includes(value?.errno ?? 0)) return 'unsupported-catalog';
  return undefined;
}
/** 只接受列名列表，不把函数、前缀长度或表达式当作列引用。 */
function nameList(tokens: TableDefinitionToken[], start: number): { names: string[]; end: number } | undefined {
  if (!symbol(tokens[start], '(')) return undefined;
  const names: string[] = []; let cursor = start + 1;
  if (symbol(tokens[cursor], ')')) return { names, end: cursor + 1 };
  while (cursor < tokens.length) {
    if (!isName(tokens[cursor])) return undefined;
    names.push(tokens[cursor++].value);
    if (symbol(tokens[cursor], ')')) return { names, end: cursor + 1 };
    if (!symbol(tokens[cursor++], ',')) return undefined;
  }
  return undefined;
}
/** 从完整源定义读取出向约束，字面量和普通注释不会伪造 FOREIGN KEY。 */
function sourceForeignKeys(document: TableColumnDefinitionDocument, database: string): { keys: SourceForeignKey[]; complete: boolean } {
  const keys: SourceForeignKey[] = []; let complete = true;
  for (const item of document.items) {
    if (item.kind !== 'constraint') continue;
    const tokens = tableDefinitionTokens(item.raw, document.context);
    let cursor = 0, name: string | undefined;
    if (word(tokens[cursor]) === 'CONSTRAINT') { cursor++; if (isName(tokens[cursor]) && !['FOREIGN', 'CHECK', 'PRIMARY', 'UNIQUE'].includes(word(tokens[cursor]))) name = tokens[cursor++].value; }
    if (tokens[cursor]?.kind === 'executable') { complete = false; continue; }
    if (word(tokens[cursor]) !== 'FOREIGN') continue;
    if (tokens.some(token => token.kind === 'executable')) { complete = false; continue; }
    if (!name || word(tokens[++cursor]) !== 'KEY') { complete = false; continue; } cursor++;
    if (isName(tokens[cursor])) cursor++;
    const child = nameList(tokens, cursor); if (!child?.names.length || word(tokens[child.end]) !== 'REFERENCES') { complete = false; continue; }
    cursor = child.end + 1;
    if (!isName(tokens[cursor])) { complete = false; continue; }
    let parentDatabase = database, table = tokens[cursor++].value;
    if (symbol(tokens[cursor], '.')) { cursor++; if (!isName(tokens[cursor])) { complete = false; continue; } parentDatabase = table; table = tokens[cursor++].value; }
    const parent = nameList(tokens, cursor);
    if (!parent || parent.names.length !== child.names.length || child.names.length > 32) { complete = false; continue; }
    keys.push({ name, child: child.names, parent: parent.names, database: parentDatabase, table });
    if (keys.length > limits.foreignKeys) throw new DirectoryProblem('budget', '源外键数量超过预算');
  }
  if (new Set(keys.map(key => key.name)).size !== keys.length) complete = false;
  return { keys, complete };
}

/** 显式目录和源分区都为简单真实列名列表时才返回依赖列；空 KEY() 保留隐式选择风险。 */
function partitionDependency(document: TableColumnDefinitionDocument, rows: Row[], resolve: (name: string) => string | undefined): IndexDependencyInput['partition'] {
  const unknown = (reason: string): IndexDependencyInput['partition'] => ({ kind: 'unknown', reason });
  const tokens = tableDefinitionTokens(document.tail.raw, document.context).flatMap(token => {
    if (token.kind !== 'executable') return [token];
    const body = token.value.replace(/^\/\*(?:!|M!)(?:\d{5,6})?\s*/, '').replace(/\*\/$/, '');
    return tableDefinitionTokens(body, document.context);
  });
  const start = tokens.findIndex(token => word(token) === 'PARTITION');
  if (!rows.length) return unknown('分区目录未返回目标表');
  const first = rows[0];
  if (first.PARTITION_NAME === null) return rows.length === 1 && first.PARTITION_METHOD === null && first.PARTITION_EXPRESSION === null && first.SUBPARTITION_METHOD === null && first.SUBPARTITION_EXPRESSION === null && start < 0 ? { kind: 'none' } : unknown('分区目录与原定义不一致');
  if (start < 0) return unknown('原定义未显示目录中的分区');
  for (const row of rows) {
    if (typeof row.PARTITION_NAME !== 'string' || !row.PARTITION_NAME) return unknown('分区目录名称不完整');
    for (const key of ['PARTITION_METHOD', 'PARTITION_EXPRESSION', 'SUBPARTITION_METHOD', 'SUBPARTITION_EXPRESSION']) if (row[key] !== first[key]) return unknown('分区目录表达式不一致');
  }
  const all = new Set<string>(); let implicit = false, mainPartition = false;
  for (const [keyword, methodField, expressionField] of [['PARTITION', 'PARTITION_METHOD', 'PARTITION_EXPRESSION'], ['SUBPARTITION', 'SUBPARTITION_METHOD', 'SUBPARTITION_EXPRESSION']] as const) {
    const offset = tokens.findIndex((token, index) => word(token) === keyword && word(tokens[index + 1]) === 'BY');
    if (offset < 0) { if (first[methodField] !== null) return unknown('子分区目录与原定义不一致'); continue; }
    if (keyword === 'PARTITION') mainPartition = true;
    let cursor = offset + 2, method = '';
    if (word(tokens[cursor]) === 'LINEAR') { method = 'LINEAR '; cursor++; }
    const base = word(tokens[cursor++]); if (!['KEY', 'HASH', 'RANGE', 'LIST'].includes(base)) return unknown('分区方法尚未证明'); method += base;
    if (word(tokens[cursor]) === 'COLUMNS') { method += ' COLUMNS'; cursor++; }
    if (base === 'KEY' && word(tokens[cursor]) === 'ALGORITHM') { cursor++; if (symbol(tokens[cursor], '=')) cursor++; if (tokens[cursor]?.kind !== 'number' || !['1', '2'].includes(tokens[cursor++].value)) return unknown('KEY 分区算法未知'); }
    const list = nameList(tokens, cursor);
    if (!list || typeof first[methodField] !== 'string' || (first[methodField] as string).toUpperCase() !== method) return unknown('分区不是已证明的简单列名列表');
    if (!list.names.length && base === 'KEY') { implicit = true; continue; }
    if (typeof first[expressionField] !== 'string') return unknown('分区目录未提供表达式');
    const catalog = nameList(tableDefinitionTokens('(' + first[expressionField] + ')', document.context), 0);
    if (!catalog || catalog.end !== tableDefinitionTokens('(' + first[expressionField] + ')', document.context).length) return unknown('目录分区表达式尚未证明');
    if (!list.names.length) { if (base !== 'KEY') return unknown('分区空列列表无法确认'); implicit = true; continue; }
    const sourceRefs = list.names.map(resolve), catalogRefs = catalog.names.map(resolve);
    if (sourceRefs.some(ref => !ref) || catalogRefs.some(ref => !ref) || JSON.stringify(sourceRefs) !== JSON.stringify(catalogRefs)) return unknown('分区引用不能与真实字段唯一对应');
    sourceRefs.forEach(ref => all.add(ref!));
  }
  if (!mainPartition) return unknown('未能定位源定义中的主分区方法');
  return implicit ? { kind: 'implicit-key', reason: '空 KEY() 的隐式主键或唯一键选择必须保留' } : { kind: 'explicit', requiredColumnRefs: [...all] };
}

/** 依赖目录只通过共享结构查询发送，保留真实命令终态、取消和任务代次保护。 */
export async function readIndexDependencies(context: StructureTaskContext, target: TableColumnPatchTarget, definition: TableColumnDefinitionDocument, columns: ReadonlyMap<string, TrustedIndexColumn>, indexes: ReadonlyMap<string, TrustedIndexDefinition>, facts: IndexDependencyFacts): Promise<IndexDependencyRead> {
  if (definition.table !== target.table || (definition.database !== undefined && definition.database !== target.database) || definition.context.dialect !== facts.dialect) throw new Error('依赖读取目标与可信原定义不一致');
  let bytes = 0, coverage: DependencyCoverage = { kind: 'partial', reason: 'identity-unproven' };
  const warnings: string[] = [], evidence: unknown[] = [];
  const addBytes = (size: number): void => {
    bytes += size;
    if (bytes > limits.bytes) throw new DirectoryProblem('budget', '依赖目录超过 4 MiB');
  };
  /** 累积解码后的目录数据，达到预算即停止，不能把截断清单当完整证明。 */
  const charge = (value: unknown): void => {
    if (value === null) addBytes(4);
    else if (typeof value === 'string') {
      // 先按原始 UTF-8 大小拒绝超大单值，再计算 JSON 转义开销，快照摘要也不能突破预算。
      if (Buffer.byteLength(value, 'utf8') > limits.bytes - bytes) { bytes = limits.bytes + 1; throw new DirectoryProblem('budget', '依赖目录超过 4 MiB'); }
      addBytes(Buffer.byteLength(JSON.stringify(value), 'utf8'));
    }
    else if (typeof value === 'number' && Number.isFinite(value)) addBytes(String(value).length);
    else throw new DirectoryProblem('inconsistent', '依赖目录包含非标量值');
  };
  const query = async (sql: string, max: number): Promise<Row[]> => {
    context.checkCancelled(); if (bytes > limits.bytes) throw new DirectoryProblem('budget', '依赖目录超过 4 MiB');
    const rows = (await structureTaskQuery<Row[]>(context, sql)).rows;
    context.checkCancelled();
    if (!Array.isArray(rows)) throw new DirectoryProblem('inconsistent', '依赖目录结果不是行集');
    if (rows.length > max) throw new DirectoryProblem('budget', '依赖目录数量超过预算');
    addBytes(2);
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new DirectoryProblem('inconsistent', '依赖目录行无效');
      addBytes(3);
      for (const [key, value] of Object.entries(row)) { charge(key); charge(value); addBytes(2); }
    }
    evidence.push(rows); return rows;
  };
  const degrade = (error: unknown): PartialReason => {
    context.checkCancelled(); const reason = error instanceof DirectoryProblem ? error.reason : knownFailure(error);
    if (!reason) throw error;
    warnings.push(reason === 'permission' ? '当前权限无法读取完整依赖目录' : reason === 'budget' ? '依赖目录达到数量或字节预算，不能证明完整' : '依赖目录能力或内容无法完整核对'); return reason;
  };
  const resolve = (name: string): string | undefined => {
    const exact = [...columns].filter(([, column]) => column.name === name);
    const matches = exact.length ? exact : [...columns].filter(([, column]) => column.name.toLowerCase() === name.toLowerCase());
    return matches.length === 1 ? matches[0][0] : undefined;
  };
  let source = { keys: [] as SourceForeignKey[], complete: false };
  try { source = sourceForeignKeys(definition, target.database); } catch (error) { degrade(error); }
  const mysql8 = facts.dialect === 'mysql' && /^(?:8\.0\.46|8\.4\.11)(?:$|-)/.test(facts.serverVersion);
  const sys = (facts.dialect === 'mysql' && /^5\.7\.44(?:$|-)/.test(facts.serverVersion)) || (facts.dialect === 'mariadb' && /^(?:10\.11\.19|11\.4\.13)(?:$|-)/.test(facts.serverVersion));
  // 仅接受已核对的 Linux 构建标识；不能靠包含 linux 的任意字符串扩大目录身份证明。
  const provedLinux = /^linux$/i.test(facts.compileOs) || (facts.dialect === 'mariadb' && /^(?:10\.11\.19|11\.4\.13)(?:$|-)/.test(facts.serverVersion) && facts.compileOs === 'debian-linux-gnu');
  const provedEnvironment = (mysql8 || sys) && facts.lowerCaseTableNames === 0 && provedLinux;
  /** SYS 名称只接受实证可直接映射的 ASCII 子集，不实现未经证明的通用文件名编码器。 */
  const engineName = (database: string, table: string): string | undefined => provedEnvironment && (mysql8 || (/^[A-Za-z0-9_]+$/.test(database) && /^[A-Za-z0-9_]+$/.test(table))) ? database + '/' + table : undefined;
  const targetName = engineName(target.database, target.table), headers: ForeignHeader[] = [];
  if (targetName !== undefined) {
    try {
      const prefix = mysql8 ? 'INNODB_FOREIGN' : 'INNODB_SYS_FOREIGN';
      const headRows = await query(`SELECT ID, FOR_NAME, REF_NAME, N_COLS, TYPE FROM information_schema.${prefix} WHERE BINARY FOR_NAME = BINARY ${literal(targetName)} OR BINARY REF_NAME = BINARY ${literal(targetName)} ORDER BY ID LIMIT 257`, limits.foreignKeys);
      const seen = new Set<string>();
      for (const row of headRows) {
        const header: ForeignHeader = { id: text(row, 'ID'), child: text(row, 'FOR_NAME'), parent: text(row, 'REF_NAME'), count: integer(row.N_COLS, 1, 32), type: integer(row.TYPE, 0, 63), childColumns: [], parentColumns: [] };
        if (seen.has(header.id) || (header.child !== targetName && header.parent !== targetName)) throw new DirectoryProblem('inconsistent', '外键头与目标身份不一致'); seen.add(header.id); headers.push(header);
      }
      if (headers.length) {
        const cols = await query(`SELECT ID, FOR_COL_NAME, REF_COL_NAME, POS FROM information_schema.${prefix}_COLS WHERE BINARY ID IN (${headers.map(header => 'BINARY ' + literal(header.id)).join(', ')}) ORDER BY ID, POS LIMIT 8193`, limits.parts);
        const byId = new Map(headers.map(header => [header.id, header]));
        for (const row of cols) {
          const header = byId.get(text(row, 'ID')); if (!header) throw new DirectoryProblem('inconsistent', '外键列映射不属于已读头目录');
          if (integer(row.POS, mysql8 ? 1 : 0, 32) !== header.childColumns.length + (mysql8 ? 1 : 0)) throw new DirectoryProblem('inconsistent', '外键列序号不连续');
          header.childColumns.push(text(row, 'FOR_COL_NAME')); header.parentColumns.push(text(row, 'REF_COL_NAME'));
        }
        if (headers.some(header => header.childColumns.length !== header.count || new Set(header.childColumns).size !== header.count || new Set(header.parentColumns).size !== header.count)) throw new DirectoryProblem('inconsistent', '外键列数与头目录不一致');
      }
      coverage = { kind: 'complete', source: 'innodb-dictionary' };
    } catch (error) { coverage = { kind: 'partial', reason: degrade(error) }; headers.length = 0; }
  } else warnings.push('当前名称、操作系统或大小写设置没有完整 InnoDB 目录映射证明');

  let outgoingComplete = false;
  try {
    const rows = await query(`SELECT CONSTRAINT_NAME, COLUMN_NAME, ORDINAL_POSITION, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ${literal(target.database)} AND TABLE_NAME = ${literal(target.table)} AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION LIMIT 8193`, limits.parts);
    const groups = new Map<string, { child: string[]; parent: string[]; database: string; table: string }>();
    for (const row of rows) {
      const name = text(row, 'CONSTRAINT_NAME'), database = text(row, 'REFERENCED_TABLE_SCHEMA'), table = text(row, 'REFERENCED_TABLE_NAME');
      let group = groups.get(name); if (!group) { group = { child: [], parent: [], database, table }; groups.set(name, group); }
      if (groups.size > limits.foreignKeys) throw new DirectoryProblem('budget', '出向外键超过预算');
      if (group.database !== database || group.table !== table || integer(row.ORDINAL_POSITION, 1, 32) !== group.child.length + 1) throw new DirectoryProblem('inconsistent', '出向外键列映射不连续');
      group.child.push(text(row, 'COLUMN_NAME')); group.parent.push(text(row, 'REFERENCED_COLUMN_NAME'));
    }
    outgoingComplete = source.complete && groups.size === source.keys.length && source.keys.every(key => {
      const group = groups.get(key.name); return group && key.database === group.database && key.table === group.table && JSON.stringify(key.child.map(resolve)) === JSON.stringify(group.child.map(resolve)) && key.child.every(name => resolve(name)) && JSON.stringify(key.parent) === JSON.stringify(group.parent);
    });
  } catch (error) { degrade(error); }
  if (coverage.kind === 'complete') {
    const outbound = headers.filter(header => header.child === targetName);
    // 源约束数和有序元组必须与全局目录互相覆盖，目录可见不代表可以忽略不一致定义。
    const matches = source.keys.map(key => outbound.filter(header => header.parent === engineName(key.database, key.table) && JSON.stringify(header.childColumns.map(resolve)) === JSON.stringify(key.child.map(resolve)) && JSON.stringify(header.parentColumns) === JSON.stringify(key.parent)));
    if (!source.complete || outbound.length !== source.keys.length || matches.some(list => list.length !== 1) || new Set(matches.flat().map(header => header.id)).size !== outbound.length) {
      outgoingComplete = false; warnings.push('完整外键目录与源定义无法唯一对应');
    } else outgoingComplete = true;
  }
  if (!outgoingComplete) warnings.push('出向外键与完整源定义尚未全部核对');
  const foreignKeys: ForeignKeyDependency[] = [];
  const candidateRefs = (refs: string[]): string[] => [...indexes].filter(([, index]) => index.visible === true && index.generated === false && index.definition?.method === 'BTREE' && index.definition.keyParts.length >= refs.length && refs.every((ref, position) => index.definition!.keyParts[position].columnRef === ref && index.definition!.keyParts[position].prefixLength === undefined)).map(([ref]) => ref);
  const hiddenDependencies: IndexDependencyInput['hiddenDependencies'][number][] = [];
  const parentDependency = (foreignKeyRef: string, names: string[], self: boolean): void => {
    const refs = names.map(resolve);
    if (refs.some(ref => !ref)) { hiddenDependencies.push({ indexRefs: [...indexes.keys()], reason: '入向外键列无法与目标字段唯一对应' }); warnings.push('入向外键字段映射不完整'); return; }
    foreignKeys.push({ foreignKeyRef, direction: self ? 'self' : 'incoming', targetColumnRefs: refs as string[], support: { kind: 'unknown', reason: '父索引实际绑定及历史非标准键不能仅由目录列组或 restrict 变量推定' } });
    if (!candidateRefs(refs as string[]).length) hiddenDependencies.push({ indexRefs: [...indexes.keys()], reason: '入向父键可能依赖隐藏追加列，无法定位真实支持索引' });
  };
  const representedSelf = new Set<string>();
  for (const key of source.keys) {
    const refs = key.child.map(resolve), matching = headers.filter(header => header.child === targetName && header.parent === engineName(key.database, key.table) && JSON.stringify(header.childColumns.map(resolve)) === JSON.stringify(refs) && JSON.stringify(header.parentColumns) === JSON.stringify(key.parent));
    const foreignKeyRef = matching.length === 1 ? foreignReference(matching[0]) : digest(['source', target.database, target.table, key.name]);
    if (refs.some(ref => !ref)) { outgoingComplete = false; continue; }
    const candidates = candidateRefs(refs as string[]), self = key.database === target.database && key.table === target.table;
    foreignKeys.push({ foreignKeyRef, direction: self ? 'self' : 'outgoing', targetColumnRefs: refs as string[], support: candidates.length ? { kind: 'known', candidateIndexRefs: candidates, rule: 'child-leading-full' } : { kind: 'unknown', reason: '无法证明子表支持键的完整列顺序与属性' } });
    if (self) { parentDependency(foreignKeyRef, key.parent, true); if (matching.length === 1) representedSelf.add(matching[0].id); }
  }
  for (const header of headers) if (header.parent === targetName && !representedSelf.has(header.id)) parentDependency(foreignReference(header), header.parentColumns, header.child === targetName);
  const autoIncrementColumnRefs = definition.columns.filter(column => column.attributes.some(attribute => attribute.kind === 'auto-increment')).map(column => resolve(column.name));
  if (autoIncrementColumnRefs.some(ref => !ref)) throw new Error('自增列无法与可信字段引用对应');
  for (const [ref, index] of indexes) if (!index.definition || index.visible !== true || index.generated !== false || index.definition.keyParts.some(part => columns.get(part.columnRef)?.generated || columns.get(part.columnRef)?.hidden)) hiddenDependencies.push({ indexRefs: [ref], reason: '旧索引存在生成、隐藏或不透明依赖，不能修改该索引' });
  if (![...indexes.values()].some(index => index.parsed.kind === 'primary')) hiddenDependencies.push({ indexRefs: [], reason: '无显式主键时的隐式聚簇键选择尚未证明，不能改变相关唯一键或主键' });
  let partition: IndexDependencyInput['partition'] = { kind: 'unknown', reason: '分区目录尚未完整核对' };
  try {
    const rows = await query(`SELECT PARTITION_NAME, PARTITION_METHOD, PARTITION_EXPRESSION, SUBPARTITION_METHOD, SUBPARTITION_EXPRESSION FROM information_schema.PARTITIONS WHERE TABLE_SCHEMA = ${literal(target.database)} AND TABLE_NAME = ${literal(target.table)} ORDER BY PARTITION_ORDINAL_POSITION, SUBPARTITION_ORDINAL_POSITION LIMIT 4097`, limits.partitions);
    partition = partitionDependency(definition, rows, resolve);
  } catch (error) { degrade(error); }
  const dependencies: IndexDependencyInput = { incomingCoverage: coverage, outgoingComplete, foreignKeys, autoIncrementColumnRefs: autoIncrementColumnRefs as string[], partition, hiddenDependencies,
    automaticForeignKeyIndexProvenance: source.keys.length || !outgoingComplete || coverage.kind !== 'complete' ? { kind: 'unknown' } : { kind: 'known', indexRefs: [] } };
  context.checkCancelled();
  return { dependencies, digest: digest({ facts, dependencies, evidence }), bytes, warnings: [...new Set(warnings)] };
}
