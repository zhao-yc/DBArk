import { createHash, randomUUID } from 'node:crypto';
import { readStructureDefinition, structureDocumentOf, assertStructureDefinitionUnchanged, structureTaskQuery, type StructureDefinitionRead, type StructureTaskContext } from './structureDefinition';
import { readTableCheckDefinition, assertTableCheckExpression, tableCheckVersionCapabilities, type ParsedTableCheck, type TableCheckDefinitionRead } from './tableCheckDefinition';
import { tableColumnDefaultRisks, tableColumnDefaultRiskMessage, hasUnprovenBinaryDefault, type TableColumnDefinitionDocument } from '../shared/tableColumnPatches';
import { tableCheckLimits as limits, tableCheckMessages as text, type TableCheckTarget, type TableCheckView } from '../shared/tableChecks';

export interface TableCheckRead extends StructureDefinitionRead {
  definition: TableColumnDefinitionDocument; checkDefinition: TableCheckDefinitionRead;
  checks: Map<string, { view: TableCheckView; parsed: ParsedTableCheck }>; constraintNames: string[];
  coverage: 'complete' | 'unknown'; writable: boolean; allowsNotEnforced: boolean;
  reasons: string[]; warnings: string[]; tableId?: string; catalogFingerprint: string;
  engine: string; rowFormat: string; autoIncrement: string | null; bytes: number;
}
type Row = Record<string, string | number | null>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const literal = (value: string) => `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;
const where = (target: TableCheckTarget, schema = 'TABLE_SCHEMA', table = 'TABLE_NAME') => `CAST(${schema} AS BINARY)=CAST(${literal(target.database)} AS BINARY) AND CAST(${table} AS BINARY)=CAST(${literal(target.table)} AS BINARY)`;

/** 每次只投影明确列，先核目录数量和字节，再保留副本；访问器/稀疏/超限不变成空目录。 */
function reader(context: StructureTaskContext) {
  let used = 0;
  return async (sql: string, fields: readonly string[], maximum: number): Promise<Row[]> => {
    const value = (await structureTaskQuery<unknown>(context, sql)).rows;
    if (!Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) throw Error(text.incomplete);
    const result: Row[] = [];
    for (let index = 0; index < value.length; index++) {
      const item = Object.getOwnPropertyDescriptor(value, String(index)); if (!item || !('value' in item) || !item.value || typeof item.value !== 'object' || Array.isArray(item.value)) throw Error(text.incomplete);
      const row = item.value as object; if (Reflect.ownKeys(row).length !== fields.length) throw Error(text.incomplete);
      const copy: Row = Object.create(null) as Row;
      for (const field of fields) {
        const descriptor = Object.getOwnPropertyDescriptor(row, field); if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw Error(text.incomplete);
        const data: unknown = descriptor.value;
        if (!(data === null || typeof data === 'string' || typeof data === 'number' && Number.isSafeInteger(data))) throw Error(text.incomplete);
        used += typeof data === 'string' ? Buffer.byteLength(data) : 32; if (used > limits.metadataBytes) throw Error(text.incomplete);
        copy[field] = data;
      }
      result.push(copy);
    }
    return result;
  };
}

/** 仅调整独立结构连接，保持CHECK/FK/唯一检查打开并显式显示GIPK，不改变原查询会话。 */
async function prepare(context: StructureTaskContext, read: ReturnType<typeof reader>): Promise<void> {
  await structureTaskQuery(context, 'SET SESSION foreign_key_checks = 1, unique_checks = 1');
  const flags = await read('SELECT @@SESSION.foreign_key_checks AS fk, @@SESSION.unique_checks AS uq', ['fk', 'uq'], 1);
  if (flags.length !== 1 || ![1, '1'].includes(flags[0].fk as number | string) || ![1, '1'].includes(flags[0].uq as number | string)) throw Error(text.readonly);
  if (context.managed.status.dialect === 'mariadb') {
    await structureTaskQuery(context, 'SET SESSION check_constraint_checks = ON');
    const checks = await read('SELECT @@SESSION.check_constraint_checks AS checks', ['checks'], 1);
    if (checks.length !== 1 || ![1, '1', 'ON'].includes(checks[0].checks as number | string)) throw Error(text.readonly);
  } else {
    const version = /^(\d+)\.(\d+)\.(\d+)/.exec(context.managed.status.version);
    if (version && (Number(version[1]) > 8 || Number(version[1]) === 8 && (Number(version[2]) > 0 || Number(version[3]) >= 30))) {
      await structureTaskQuery(context, 'SET SESSION show_gipk_in_create_table_and_information_schema = ON');
      const show = await read('SELECT @@SESSION.show_gipk_in_create_table_and_information_schema AS showGipk', ['showGipk'], 1);
      if (show.length !== 1 || ![1, '1'].includes(show[0].showGipk as number | string)) throw Error(text.readonly);
    }
  }
}

/** 原生表编号沿既有可证明名称映射；没有编号只展示，哈希不冒充物理表身份。 */
async function physical(read: ReturnType<typeof reader>, context: StructureTaskContext, target: TableCheckTarget, engine: string): Promise<string> {
  if (engine !== 'InnoDB' || !/^[A-Za-z0-9_]+$/.test(target.database) || !/^[A-Za-z0-9_]+$/.test(target.table)) throw Error('当前物理表名称映射或引擎尚未证明，仅可查看检查约束');
  const mapping = await read('SELECT @@version_compile_os AS os, @@lower_case_table_names AS lowerNames', ['os', 'lowerNames'], 1);
  if (mapping.length !== 1 || typeof mapping[0].os !== 'string' || !['linux', 'debian-linux-gnu'].includes(mapping[0].os.toLowerCase()) || ![0, '0'].includes(mapping[0].lowerNames as number | string)) throw Error('无法证明服务器名称到物理表的精确映射');
  const partitions = await read(`SELECT PARTITION_NAME AS name FROM information_schema.PARTITIONS WHERE ${where(target)} LIMIT 2`, ['name'], 2);
  if (partitions.length !== 1 || partitions[0].name !== null) throw Error('分区目标的物理表身份尚未证明，当前仅可查看');
  const catalog = context.managed.status.dialect === 'mysql' && /^8\./.test(context.managed.status.version) ? 'INNODB_TABLES' : 'INNODB_SYS_TABLES';
  const rows = await read(`SELECT CAST(TABLE_ID AS CHAR) AS id, NAME AS name FROM information_schema.${catalog} WHERE CAST(NAME AS BINARY)=CAST(${literal(target.database + '/' + target.table)} AS BINARY) LIMIT 2`, ['id', 'name'], 2);
  if (rows.length !== 1 || typeof rows[0].id !== 'string' || !/^[1-9]\d{0,19}$/.test(rows[0].id) || rows[0].name !== target.database + '/' + target.table) throw Error('无法唯一证明检查约束目标的InnoDB物理表身份');
  return rows[0].id;
}

/** 真实TC与CC同时按准确库表筛选，Maria不假定ENFORCED/LEVEL列存在。 */
export async function readTableChecks(context: StructureTaskContext, target: TableCheckTarget): Promise<TableCheckRead> {
  const read = reader(context); await prepare(context, read);
  const base = await readStructureDefinition(context, target, true), definition = structureDocumentOf(base), checkDefinition = readTableCheckDefinition(definition, base.serverVersion);
  const reasons = [...checkDefinition.reasons], warnings: string[] = [], dialect = base.context.dialect, capable = tableCheckVersionCapabilities(dialect, base.serverVersion).writable;
  if (!capable) reasons.push(text.unsupported);
  if (base.originalMode.split(',').some(value => ['ANSI', 'ORACLE', 'DB2', 'MAXDB', 'MSSQL', 'POSTGRESQL', 'MYSQL323', 'MYSQL40'].includes(value.toUpperCase()))) reasons.push('原兼容SQL模式的表达式语义未能完整证明，当前只读');
  const risks = tableColumnDefaultRisks(definition); if (risks.length) reasons.push(tableColumnDefaultRiskMessage(risks));
  if (definition.columns.some(hasUnprovenBinaryDefault)) reasons.push('二进制文字默认值的原始字节不能完整证明，当前只读');
  const properties = await read(`SELECT TABLE_TYPE AS kind, ENGINE AS engine, ROW_FORMAT AS rowFormat, CAST(AUTO_INCREMENT AS CHAR) AS autoIncrement FROM information_schema.TABLES WHERE ${where(target)} LIMIT 2`, ['kind', 'engine', 'rowFormat', 'autoIncrement'], 2);
  const property = properties[0];
  if (properties.length !== 1 || property.kind !== 'BASE TABLE' || typeof property.engine !== 'string' || typeof property.rowFormat !== 'string' || !(property.autoIncrement === null || typeof property.autoIncrement === 'string' && /^\d+$/.test(property.autoIncrement))) throw Error(text.incomplete);
  let tableId: string | undefined;
  try { tableId = await physical(read, context, target, property.engine); } catch (reason) { context.checkCancelled(); reasons.push(reason instanceof Error ? reason.message : text.readonly); }
  let constraints: Row[] = [], clauses: Row[] = [], namespace: Row[] = [], complete = capable && checkDefinition.coverage === 'complete';
  if (checkDefinition.checks.length > limits.checks) throw Error(text.incomplete);
  if (capable) try {
    constraints = await read(`SELECT CONSTRAINT_SCHEMA AS schemaName, TABLE_SCHEMA AS databaseName, TABLE_NAME AS tableName, CONSTRAINT_NAME AS name, CONSTRAINT_TYPE AS type, ${dialect === 'mysql' ? 'ENFORCED' : 'NULL'} AS enforced FROM information_schema.TABLE_CONSTRAINTS WHERE ${where(target)} ORDER BY CONSTRAINT_NAME, CONSTRAINT_TYPE LIMIT 4097`, ['schemaName', 'databaseName', 'tableName', 'name', 'type', 'enforced'], 4096);
    const checkWhere = dialect === 'mysql' ? where(target, 't.TABLE_SCHEMA', 't.TABLE_NAME') : where(target, 'c.CONSTRAINT_SCHEMA', 'c.TABLE_NAME');
    const join = dialect === 'mysql' ? ' JOIN information_schema.TABLE_CONSTRAINTS t ON CAST(c.CONSTRAINT_SCHEMA AS BINARY)=CAST(t.CONSTRAINT_SCHEMA AS BINARY) AND CAST(c.CONSTRAINT_NAME AS BINARY)=CAST(t.CONSTRAINT_NAME AS BINARY)' : '';
    clauses = await read(`SELECT c.CONSTRAINT_SCHEMA AS schemaName, ${dialect === 'mysql' ? 't.TABLE_NAME' : 'c.TABLE_NAME'} AS tableName, c.CONSTRAINT_NAME AS name, c.CHECK_CLAUSE AS expression FROM information_schema.CHECK_CONSTRAINTS c${join} WHERE ${checkWhere}${dialect === 'mysql' ? " AND t.CONSTRAINT_TYPE='CHECK'" : ''} ORDER BY c.CONSTRAINT_NAME LIMIT ${limits.checks + 1}`, ['schemaName', 'tableName', 'name', 'expression'], limits.checks);
    if (constraints.some(row => row.schemaName !== target.database || row.databaseName !== target.database || row.tableName !== target.table || typeof row.name !== 'string' || !row.name || !['CHECK', 'PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY'].includes(String(row.type))) || clauses.some(row => row.schemaName !== target.database || row.tableName !== target.table || typeof row.name !== 'string' || !row.name || typeof row.expression !== 'string' || !row.expression)) throw Error(text.incomplete);
    const checkRows = constraints.filter(row => row.type === 'CHECK');
    if (checkRows.length !== clauses.length || clauses.length !== checkDefinition.checks.length || new Set(clauses.map(row => row.name)).size !== clauses.length || clauses.some(row => checkRows.filter(candidate => candidate.name === row.name).length !== 1)) throw Error(text.incomplete);
    if (dialect === 'mariadb') {
      // 只把库/表限制为准确字节；名字相等留给真实TC列排序规则，不能用JS大小写猜Unicode/重音等价。
      namespace = await read(`SELECT a.CONSTRAINT_NAME AS checkName, b.CONSTRAINT_NAME AS name, b.CONSTRAINT_TYPE AS type FROM information_schema.TABLE_CONSTRAINTS a JOIN information_schema.TABLE_CONSTRAINTS b ON a.CONSTRAINT_NAME=b.CONSTRAINT_NAME WHERE ${where(target, 'a.TABLE_SCHEMA', 'a.TABLE_NAME')} AND ${where(target, 'b.TABLE_SCHEMA', 'b.TABLE_NAME')} AND a.CONSTRAINT_TYPE='CHECK' ORDER BY a.CONSTRAINT_NAME, b.CONSTRAINT_NAME, b.CONSTRAINT_TYPE LIMIT 4097`, ['checkName', 'name', 'type'], 4096);
      if (namespace.some(row => typeof row.checkName !== 'string' || typeof row.name !== 'string' || !['CHECK', 'PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY'].includes(String(row.type)) || !checkRows.some(check => check.name === row.checkName))) throw Error(text.incomplete);
      for (const check of checkRows) {
        const matches = namespace.filter(row => row.checkName === check.name);
        if (matches.length !== 1 || matches[0].type !== 'CHECK' || matches[0].name !== check.name) throw Error(text.incomplete);
      }
    }
  } catch (reason) { context.checkCancelled(); complete = false; reasons.push(text.incomplete); }
  const checks = new Map<string, { view: TableCheckView; parsed: ParsedTableCheck }>(), consumed = new Set<ParsedTableCheck>();
  if (capable && complete) for (const row of clauses) {
    try {
      const expression = row.expression as string, key = assertTableCheckExpression(expression, base.context).key;
      const candidates = checkDefinition.checks.filter(parsed => !consumed.has(parsed) && (parsed.name !== undefined ? parsed.name === row.name : parsed.location !== 'column' || parsed.columnName === row.name) && assertTableCheckExpression(parsed.expression, base.context).key === key);
      if (candidates.length !== 1) throw Error(text.incomplete); const parsed = candidates[0], constraint = constraints.find(item => item.type === 'CHECK' && item.name === row.name)!;
      const enforced = dialect === 'mariadb' ? true : constraint.enforced === 'YES' ? true : constraint.enforced === 'NO' ? false : null;
      if (enforced === null || parsed.enforced !== null && parsed.enforced !== enforced) throw Error(text.incomplete);
      consumed.add(parsed); const checkRef = randomUUID(), local = [...parsed.opaqueReasons];
      const allowed = !local.length, access = () => ({ allowed, reasons: [...local] });
      const view: TableCheckView = { checkRef, name: row.name as string, expression, location: parsed.location, ...(parsed.columnName ? { columnName: parsed.columnName } : {}), enforced, reasons: local, access: { drop: access(), replace: access(), enforcement: dialect === 'mysql' ? access() : { allowed: false, reasons: ['MariaDB基线不支持逐约束NOT ENFORCED，不能用会话总开关代替'] } } };
      checks.set(checkRef, { view, parsed });
    } catch { complete = false; reasons.push(text.incomplete); }
  }
  if (!complete) {
    for (const parsed of checkDefinition.checks) if (!consumed.has(parsed)) {
      const checkRef = randomUUID(), blocked = () => ({ allowed: false, reasons: [text.incomplete] });
      checks.set(checkRef, { parsed, view: { checkRef, name: parsed.name ?? parsed.columnName ?? '未确认名称', expression: parsed.expression, location: parsed.location, ...(parsed.columnName ? { columnName: parsed.columnName } : {}), enforced: capable ? parsed.enforced : null, reasons: [text.incomplete], access: { drop: blocked(), replace: blocked(), enforcement: blocked() } } });
    }
  }
  if (!complete) reasons.push(text.incomplete);
  const writable = capable && complete && !reasons.length && !!tableId;
  if (!writable) for (const { view } of checks.values()) for (const item of Object.values(view.access)) { item.allowed = false; item.reasons = [...new Set([...item.reasons, ...reasons])]; }
  const catalogFingerprint = hash(JSON.stringify([constraints, clauses, namespace, properties, tableId]));
  return { ...base, definition, checkDefinition, checks, constraintNames: constraints.map(row => row.name as string), coverage: complete ? 'complete' : 'unknown', writable, allowsNotEnforced: dialect === 'mysql' && capable, reasons: [...new Set(reasons)], warnings, tableId, catalogFingerprint, engine: property.engine, rowFormat: property.rowFormat, autoIncrement: property.autoIncrement as string | null, bytes: Buffer.byteLength(base.source) * 3 + Buffer.byteLength(JSON.stringify([constraints, clauses, namespace])) + 32768 };
}

/** 预览/执行前完整源、目录、模式和原生身份必须仍与原快照一致。 */
export function assertTableChecksUnchanged(before: TableCheckRead, after: TableCheckRead): void {
  assertStructureDefinitionUnchanged(before, after);
  if (!before.writable || !after.writable || !before.tableId || before.tableId !== after.tableId || before.catalogFingerprint !== after.catalogFingerprint || before.coverage !== 'complete' || after.coverage !== 'complete') throw Error(text.stale);
}
/** ALTER后只豁免真实CHECK范围；OK包和物理编号变化均不冒充完整后核验。 */
export function verifyTableCheckBase(before: TableCheckRead, after: TableCheckRead): boolean {
  return after.writable && before.identity === after.identity && before.tableId === after.tableId && before.normalizedMode === after.originalMode && before.normalizedMode === after.normalizedMode && before.checkDefinition.preserved === after.checkDefinition.preserved && JSON.stringify([before.nullability, before.encodings, before.tableEncoding, before.engine, before.rowFormat, before.autoIncrement]) === JSON.stringify([after.nullability, after.encodings, after.tableEncoding, after.engine, after.rowFormat, after.autoIncrement]);
}
export const tableCheckHash = hash;
