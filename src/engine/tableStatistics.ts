import { createHash } from 'node:crypto';
import type { CellValue, ColumnInfo, TableInfo } from '../shared/contracts';
import { tableStatisticsColumnKind, tableStatisticsLimits as limits, tableStatisticsMessages as text, type TableColumnStatistics, type TableStatisticsInput, type TableStatisticsOutput } from '../shared/tableStatistics';
import { buildTableFilterSql, identifier, inlineParameters, qualified } from './sql';
import { incomingReferenceSourceDigest, readIncomingReferenceTable } from './incomingReferences';
import { consumeQueryFrames } from './queryStreamProtocol';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';

interface Capability { kind: 'numeric' | 'ordered' | 'count-only'; representation: 'text' | 'binary' | 'scalar'; approximate: boolean; }
export interface TableStatisticsPlan { sql: string; aliases: string[]; columns: { column: ColumnInfo; capability: Capability; distinct?: true }[]; }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** 能力只决定固定聚合种类，列类型正文从不作为SQL片段拼接。 */
export function tableStatisticsColumnCapability(column: ColumnInfo): Capability {
  // 前后端共用类型类别；传输表现仍单独区分文字、原字节与标量。
  const type = column.type.trim(), kind = tableStatisticsColumnKind(type);
  const representation = /^(?:CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|ENUM|SET)\b/i.test(type) ? 'text' : /^(?:BINARY|VARBINARY|TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB)\b/i.test(type) ? 'binary' : 'scalar';
  return { kind, representation, approximate: kind === 'numeric' && /^(?:FLOAT|DOUBLE|REAL)\b/i.test(type) };
}
/** 只生成一个派生聚合SELECT；外层先证明实际输出字节再回传原值，绝不截断大文本/二进制。 */
export function planTableStatistics(source: TableInfo, input: Pick<TableStatisticsInput, 'columns' | 'filters' | 'filterMode' | 'filterGroup' | 'distinct'>): TableStatisticsPlan {
  if (input.distinct !== undefined && typeof input.distinct !== 'boolean') throw Error(text.invalid);
  if (!Array.isArray(input.columns) || input.columns.length > limits.columns || new Set(input.columns).size !== input.columns.length) throw Error(text.invalid);
  const columns: TableStatisticsPlan['columns'] = input.columns.map(name => { const matches = source.columns.filter(column => column.name === name); if (matches.length !== 1) throw Error(text.invalid); const capability = tableStatisticsColumnCapability(matches[0]); return { column: matches[0], capability, ...(input.distinct && capability.kind !== 'count-only' ? { distinct: true as const } : {}) }; });
  const inner = ['COUNT(*) AS `s_rows`'], outer = ['CAST(`s_rows` AS CHAR) AS `rowCount`'], aliases = ['rowCount'];
  for (const [{ column, capability, distinct }, index] of columns.map((value, index) => [value, index] as const)) {
    const name = identifier(column.name), base = `c${index}`;
    // BIT原值是二进制字节；全部数值聚合先由服务器显式转无符号，保留BIT64高位而不依赖隐式转换。
    const aggregateValue = /^BIT\b/i.test(column.type.trim()) ? `CAST(${name} AS UNSIGNED)` : name;
    inner.push(`COUNT(${name}) AS \`${base}_count\``);
    outer.push(`CAST(\`${base}_count\` AS CHAR) AS \`${base}_nonNull\``, `CAST(\`s_rows\`-\`${base}_count\` AS CHAR) AS \`${base}_nulls\``); aliases.push(`${base}_nonNull`, `${base}_nulls`);
    if (capability.kind === 'count-only') continue;
    // DISTINCT直接消费原列，保留字符排序规则及BIT/二进制原值的服务器相等语义，不复用数值CAST。
    if (distinct) { const alias = `${base}_distinct`; inner.push(`COUNT(DISTINCT ${name}) AS ${identifier(alias)}`); outer.push(`CAST(${identifier(alias)} AS CHAR) AS ${identifier(alias)}`); aliases.push(alias); }
    for (const operation of ['min', 'max'] as const) {
      const alias = `${base}_${operation}`; inner.push(`${operation.toUpperCase()}(${aggregateValue}) AS ${identifier(alias)}`);
      const value = identifier(alias), length = capability.representation === 'text' ? `OCTET_LENGTH(CONVERT(${value} USING utf8mb4))` : `OCTET_LENGTH(${value})`;
      outer.push(`CASE WHEN ${length}<=${limits.cellBytes} THEN ${value} ELSE NULL END AS ${value}`, `CAST(${length} AS CHAR) AS ${identifier(alias + 'Bytes')}`); aliases.push(alias, alias + 'Bytes');
    }
    if (capability.kind === 'numeric') for (const operation of ['sum', 'avg'] as const) { const alias = `${base}_${operation}`; inner.push(`${operation.toUpperCase()}(${aggregateValue}) AS ${identifier(alias)}`); outer.push(`CAST(${identifier(alias)} AS CHAR) AS ${identifier(alias)}`); aliases.push(alias); }
  }
  const filter = buildTableFilterSql(source, input.filters, input.filterMode, input.filterGroup), where = filter.where ? ' WHERE ' + filter.where : '';
  const sql = inlineParameters(`SELECT ${outer.join(',')} FROM (SELECT ${inner.join(',')} FROM ${qualified(source.database, source.name)}${where}) AS \`dbark_statistics\``, filter.params);
  if (Buffer.byteLength(sql) > limits.bytes) throw Error(text.budget); return { sql, aliases, columns };
}
/** 任意合法表SHOW无法完整解析时绑定全部DDL；视图始终绑定完整定义，绝不丢掉定义校验。 */
export function tableStatisticsSourceIdentity(source: TableInfo, context: StructureTaskContext): { digest: string; conservative: boolean } {
  if (context.managed.sqlMode === undefined) throw Error(text.invalid);
  const modes = context.managed.sqlMode.split(','), definitionContext = { dialect: context.managed.status.dialect, mode: { noBackslashEscapes: modes.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: modes.includes('ANSI_QUOTES') } };
  if (source.objectKind === 'view') return { digest: hash([source, definitionContext]), conservative: false };
  try { return { digest: incomingReferenceSourceDigest(source, definitionContext), conservative: false }; }
  catch { return { digest: hash([source, definitionContext]), conservative: true }; }
}
const integer = (value: CellValue): string => { if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value) || value.length > 32) throw Error(text.invalid); return value; };
/** 统计极值只保留原CellValue，服务端字节事实及实际收到值必须同时在预算内。 */
function extremum(value: CellValue, bytesValue: CellValue, representation: Capability['representation']): CellValue {
  if (bytesValue === null) { if (value !== null) throw Error(text.invalid); return null; }
  const bytes = BigInt(integer(bytesValue)); if (bytes > BigInt(limits.cellBytes)) throw Error(text.budget);
  if (value === null) throw Error(text.invalid);
  const actual = typeof value === 'string' ? Buffer.byteLength(value) : typeof value === 'object' ? Buffer.from(value.base64, 'base64').length : String(value).length;
  if (actual > limits.cellBytes) throw Error(text.budget);
  if (representation === 'text' && (typeof value !== 'string' || BigInt(actual) !== bytes) || representation === 'binary' && (typeof value !== 'object' || BigInt(actual) !== bytes)) throw Error(text.invalid);
  return value;
}
/** 只按固定服务器别名解码；所有计数保持十进制串，SUM/AVG保持服务器文本而不经过Number。 */
export function decodeTableStatistics(plan: TableStatisticsPlan, values: CellValue[]): Pick<TableStatisticsOutput, 'rowCount' | 'columns'> {
  if (values.length !== plan.aliases.length) throw Error(text.invalid);
  if (Buffer.byteLength(JSON.stringify(values)) > limits.bytes) throw Error(text.budget);
  const row = new Map(plan.aliases.map((alias, index) => [alias, values[index]])), rowCount = integer(row.get('rowCount')!);
  const columns: TableColumnStatistics[] = plan.columns.map(({ column, capability, distinct }, index) => {
    const base = `c${index}`, nonNull = integer(row.get(base + '_nonNull')!), nulls = integer(row.get(base + '_nulls')!);
    if (BigInt(nonNull) + BigInt(nulls) !== BigInt(rowCount)) throw Error(text.invalid);
    const counts = { name: column.name, type: column.type, nonNull, nulls };
    if (capability.kind === 'count-only') return { ...counts, kind: 'count-only', reason: text.countOnly };
    const distinctCount = distinct ? integer(row.get(base + '_distinct')!) : undefined;
    if (distinctCount !== undefined && (BigInt(distinctCount) > BigInt(nonNull) || (nonNull === '0' ? distinctCount !== '0' : distinctCount === '0'))) throw Error(text.invalid);
    const distinctResult = distinctCount === undefined ? {} : { distinct: distinctCount };
    const min = extremum(row.get(base + '_min')!, row.get(base + '_minBytes')!, capability.representation), max = extremum(row.get(base + '_max')!, row.get(base + '_maxBytes')!, capability.representation);
    if (nonNull === '0' ? min !== null || max !== null : min === null || max === null) throw Error(text.invalid);
    if (capability.kind === 'ordered') return { ...counts, kind: 'ordered', min, max, ...distinctResult };
    const sum = row.get(base + '_sum')!, avg = row.get(base + '_avg')!;
    const numeric = (value: CellValue): value is string | null => value === null || typeof value === 'string' && value.length <= 256 && (capability.approximate ? /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/ : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/).test(value);
    for (const value of [min, max]) if (value !== null && (typeof value === 'number' ? !Number.isFinite(value) || !capability.approximate && !Number.isSafeInteger(value) : !numeric(value))) throw Error(text.invalid);
    if (!numeric(sum) || !numeric(avg) || (nonNull === '0' ? sum !== null || avg !== null : sum === null || avg === null)) throw Error(text.invalid);
    return { ...counts, kind: 'numeric', min, max, sum, avg, approximate: capability.approximate, ...distinctResult };
  }); return { rowCount, columns };
}

/** 原真实binary流逐行消费；过限停止当前代命令，原终包和strict关闭前绝不发布回包。 */
export async function readTableStatistics(context: StructureTaskContext, input: TableStatisticsInput, stop: () => Promise<void>): Promise<TableStatisticsOutput> {
  // 视图可能调用存储函数；服务器只读事务保护可见表，并固定RR隔离，不依赖全局READ-UNCOMMITTED设置。
  await structureTaskQuery(context, 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await structureTaskQuery(context, 'START TRANSACTION READ ONLY');
  const source = await readIncomingReferenceTable(context, input, true), identity = tableStatisticsSourceIdentity(source, context), plan = planTableStatistics(source, input);
  let values: CellValue[] | undefined, starts = 0, ends = 0, warningCount: number | undefined;
  await consumeQueryFrames(context.managed, plan.sql, 'binary', {
    statementOrdinal: 1, ordinals: { results: 0, rows: 0 }, checkCancelled: context.checkCancelled, commandStarted: context.commandStarted, stop,
    async consume(frame) {
      if (frame.kind === 'rows-start') { if (++starts !== 1 || frame.columns.length !== plan.aliases.length || frame.columns.some((column, index) => column.name !== plan.aliases[index])) throw Error(text.invalid); }
      else if (frame.kind === 'row') {
        if (values || starts !== 1 || frame.values.some(value => typeof value === 'string' && Buffer.byteLength(value) > limits.cellBytes || value !== null && typeof value === 'object' && Buffer.from(value.base64, 'base64').length > limits.cellBytes)) throw Error(text.budget);
        values = frame.values;
      } else if (frame.kind === 'rows-end') { ends++; warningCount = frame.warningCount; }
      else throw Error(text.invalid);
    },
  });
  // 紧跟原聚合诊断，任何其它身份/元数据SELECT都必须在其后，警告存在不返回部分统计。
  const warnings = (await structureTaskQuery<unknown>(context, 'SHOW WARNINGS LIMIT 21')).rows;
  if (!Array.isArray(warnings) || warnings.length || warningCount !== 0 || starts !== 1 || ends !== 1 || !values) throw Error(text.serverWarning);
  const result = decodeTableStatistics(plan, values); context.checkCancelled();
  const after = await readIncomingReferenceTable(context, input, true), afterIdentity = tableStatisticsSourceIdentity(after, context);
  if (identity.digest !== afterIdentity.digest || identity.conservative !== afterIdentity.conservative) throw Error(text.stale);
  const output: TableStatisticsOutput = { source, sourceDigest: identity.digest, ...result, warnings: [text.scope, ...(plan.columns.some(column => column.capability.approximate) ? [text.approximate] : []), ...(plan.columns.some(column => column.distinct) ? [text.distinct] : []), ...(identity.conservative ? [text.conservative] : [])] };
  if (Buffer.byteLength(JSON.stringify(output)) > limits.bytes) throw Error(text.budget);
  // 正常路径显式结束本独立只读事务；失败/取消只由原物理连接收尾，不开新连接回滚或重放。
  await structureTaskQuery(context, 'ROLLBACK AND NO CHAIN NO RELEASE'); context.checkCancelled(); return output;
}
