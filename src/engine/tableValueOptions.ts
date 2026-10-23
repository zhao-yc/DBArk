import { createHash } from 'node:crypto';
import type { CellValue, ColumnInfo, TableInfo } from '../shared/contracts';
import { tableValueOptionsColumnCapability, tableValueOptionsLimits as limits, tableValueOptionsMessages as text, tableValueOptionsSearchPattern, validateTableValueOptionValue, validateTableValueOptionsOutput, type TableValueOption, type TableValueOptionsCapability, type TableValueOptionsInput, type TableValueOptionsOutput } from '../shared/tableValueOptions';
import { readIncomingReferenceTable } from './incomingReferences';
import { consumeQueryFrames } from './queryStreamProtocol';
import { buildTableFilterSql, identifier, inlineParameters, qualified } from './sql';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { tableStatisticsSourceIdentity } from './tableStatistics';

export interface TableValueOptionsPlan { sql: string; aliases: readonly ['value', 'count', 'valueBytes', 'groupBytes']; column: ColumnInfo; capability: TableValueOptionsCapability; searchPattern?: string; }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unsigned = (value: unknown): value is string => typeof value === 'string' && /^(?:0|[1-9]\d{0,31})$/.test(value);

/** 原列直接参与GROUP BY与ORDER BY；展示投影不反向影响原列相等、NULL或排序语义。 */
export function planTableValueOptions(source: TableInfo, input: Pick<TableValueOptionsInput, 'column' | 'filters' | 'filterMode' | 'filterGroup' | 'searchPattern'>): TableValueOptionsPlan {
  const matches = source.columns.filter(column => column.name === input.column);
  if (matches.length !== 1) throw Error(text.invalid);
  const column = matches[0], capability = tableValueOptionsColumnCapability(column.type), searchPattern = tableValueOptionsSearchPattern(input.searchPattern);
  if (capability === 'unsupported') throw Error(text.unsupported);
  const filter = buildTableFilterSql(source, input.filters, input.filterMode, input.filterGroup), name = identifier(column.name), conditions = filter.where ? [`(${filter.where})`] : [], params = [...filter.params];
  if (searchPattern !== undefined) { conditions.push(`${name} LIKE ?`); params.push(searchPattern); }
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  // 整型/DECIMAL输出显式服务器文本，避免小整型走number；浮点坚持原二进制字段，不伪造精确十进制。
  const value = capability === 'integer' || capability === 'decimal' || capability === 'temporal' ? 'CAST(`g`.`v` AS CHAR)' : '`g`.`v`';
  const bytes = `OCTET_LENGTH(CONVERT(${value} USING utf8mb4))`;
  // ENUM/SET跨派生表可能以文本暴露，显式保留服务器原序号排序，不能在外层悄悄改成文本顺序。
  const ordinal = /^(?:ENUM|SET)\s*\(/i.test(column.type), order = ordinal ? '`g`.`s`' : '`g`.`v`';
  // 分组长度必须取组内MAX，不能让前缀相同的超长行被短代表值或PAD SPACE相等组掩盖。
  const sql = inlineParameters(`SELECT CASE WHEN \`g\`.\`b\`<=${limits.cellBytes} THEN ${value} ELSE NULL END AS \`value\`,CAST(\`g\`.\`n\` AS CHAR) AS \`count\`,CAST(${bytes} AS CHAR) AS \`valueBytes\`,CAST(\`g\`.\`b\` AS CHAR) AS \`groupBytes\` FROM (SELECT ${name} AS \`v\`,COUNT(*) AS \`n\`,MAX(OCTET_LENGTH(CONVERT(${name} USING utf8mb4))) AS \`b\`${ordinal ? `,MIN(${name}+0) AS \`s\`` : ''} FROM ${qualified(source.database, source.name)}${where} GROUP BY ${name} ORDER BY ${name} LIMIT ${limits.groups + 1}) AS \`g\` ORDER BY ${order}`, params);
  if (Buffer.byteLength(sql) > limits.bytes) throw Error(text.budget);
  return { sql, aliases: ['value', 'count', 'valueBytes', 'groupBytes'], column, capability, ...(searchPattern !== undefined ? { searchPattern } : {}) };
}

/** 解码原行必须同时满足服务器长度事实与完整原值预算；超长保护NULL不是实际NULL候选。 */
export function decodeTableValueOption(plan: TableValueOptionsPlan, cells: CellValue[]): TableValueOption {
  if (!Array.isArray(cells) || cells.length !== plan.aliases.length) throw Error(text.invalid);
  const [value, count, bytes, groupBytes] = cells;
  if (!unsigned(count) || count === '0') throw Error(text.invalid);
  if (groupBytes === null) { if (bytes !== null || value !== null || plan.searchPattern !== undefined || !plan.column.nullable) throw Error(text.invalid); return { value: null, count }; }
  if (!unsigned(groupBytes)) throw Error(text.invalid);
  if (BigInt(groupBytes) > BigInt(limits.cellBytes)) throw Error(text.budget);
  if (!unsigned(bytes) || BigInt(bytes) > BigInt(groupBytes)) throw Error(text.invalid);
  if (value === null) throw Error(text.invalid);
  validateTableValueOptionValue(value, plan.capability);
  // 浮点length反映服务器显示文本，不假装与binary实际IEEE宽化值的String一致。
  if (typeof value === 'string' && BigInt(Buffer.byteLength(value)) !== BigInt(bytes)) throw Error(text.invalid);
  return { value, count };
}

/** 同一真实连接前后读取身份、字符会话及版本；任何未知项都不能默认为同一来源。 */
export async function readTableValueOptionsServerIdentity(context: StructureTaskContext): Promise<string> {
  const uuid = context.managed.status.dialect === 'mysql' ? '@@server_uuid' : 'NULL';
  const fields = ['version', 'hostname', 'port', 'serverId', 'currentUser', 'connectionId', 'lowerNames', 'sqlMode', 'charset', 'collation', 'quoteShowCreate', 'maxSortLength', 'sortBufferSize', 'uuid'];
  // MariaDB布尔系统变量直接CAST CHAR会返回ON/OFF；先原生数值化，再统一严格核验十进制1。
  const rows = (await structureTaskQuery<Record<string, unknown>[]>(context, `SELECT @@version AS version,@@hostname AS hostname,CAST(@@port AS CHAR) AS port,CAST(@@server_id AS CHAR) AS serverId,CURRENT_USER() AS currentUser,CAST(CONNECTION_ID() AS CHAR) AS connectionId,CAST(@@lower_case_table_names AS CHAR) AS lowerNames,@@SESSION.sql_mode AS sqlMode,@@character_set_connection AS charset,@@collation_connection AS collation,CAST((@@sql_quote_show_create+0) AS CHAR) AS quoteShowCreate,CAST(@@SESSION.max_sort_length AS CHAR) AS maxSortLength,CAST(@@SESSION.sort_buffer_size AS CHAR) AS sortBufferSize,${uuid} AS uuid`)).rows;
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || Reflect.ownKeys(rows[0]).length !== fields.length) throw Error(text.invalid);
  const row = rows[0];
  for (const field of fields) {
    const property = Object.getOwnPropertyDescriptor(row, field);
    if (!property?.enumerable || !Object.hasOwn(property, 'value')) throw Error(text.invalid);
    if (field === 'uuid' && context.managed.status.dialect === 'mariadb' ? row[field] !== null : typeof row[field] !== 'string') throw Error(text.invalid);
  }
  if (row.maxSortLength !== String(limits.cellBytes) || row.sortBufferSize !== String(limits.sortBufferBytes)) throw Error(text.invalid);
  if (row.version !== context.managed.status.version || !row.hostname || !row.currentUser || !unsigned(row.port) || BigInt(row.port) < 1n || BigInt(row.port) > 65535n || !unsigned(row.serverId) || !unsigned(row.connectionId) || BigInt(row.connectionId) !== BigInt(context.managed.connection.threadId) || !['0', '1', '2'].includes(String(row.lowerNames)) || typeof row.sqlMode !== 'string' || !/^[A-Z0-9_,]*$/i.test(row.sqlMode) || row.charset !== 'utf8mb4' || typeof row.collation !== 'string' || !/^utf8mb4_/i.test(row.collation) || row.quoteShowCreate !== '1' || context.managed.status.dialect === 'mysql' && (typeof row.uuid !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(row.uuid))) throw Error(text.invalid);
  return hash(fields.map(field => [field, row[field]]));
}

/** 独立RR只读事务内有界流式分组；原终包、警告与前后定义全部通过后才发布候选。 */
export async function readTableValueOptions(context: StructureTaskContext, input: TableValueOptionsInput, stop: () => Promise<void>): Promise<TableValueOptionsOutput> {
  await structureTaskQuery(context, 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  // PAD SPACE的TEXT分组默认只比较前1024字节；扩大到完整可接纳值，并给15个排序tuple足够空间。
  // 只影响本独立会话，权限/变量失败或实际读回被截小均立即失败，不退回前缀分组。
  await structureTaskQuery(context, `SET SESSION max_sort_length = ${limits.cellBytes}`);
  await structureTaskQuery(context, `SET SESSION sort_buffer_size = ${limits.sortBufferBytes}`);
  await structureTaskQuery(context, 'START TRANSACTION READ ONLY');
  const source = await readIncomingReferenceTable(context, input, true), identity = tableStatisticsSourceIdentity(source, context), serverIdentity = await readTableValueOptionsServerIdentity(context), plan = planTableValueOptions(source, input);
  const values: TableValueOption[] = [], seen = new Set<string>();
  let starts = 0, ends = 0, warningCount: number | undefined, rows = 0, bytes = Buffer.byteLength(JSON.stringify(source));
  await consumeQueryFrames(context.managed, plan.sql, 'binary', {
    statementOrdinal: 1, ordinals: { results: 0, rows: 0 }, checkCancelled: context.checkCancelled, commandStarted: context.commandStarted, stop,
    async consume(frame) {
      if (frame.kind === 'rows-start') {
        if (++starts !== 1 || frame.columns.length !== plan.aliases.length || frame.columns.some((column, index) => column.name !== plan.aliases[index])) throw Error(text.invalid);
      } else if (frame.kind === 'row') {
        if (starts !== 1 || ends || ++rows > limits.groups + 1) throw Error(text.invalid);
        const option = decodeTableValueOption(plan, frame.values), key = JSON.stringify([typeof option.value, option.value]);
        if (seen.has(key)) throw Error(text.invalid); seen.add(key);
        bytes += Buffer.byteLength(JSON.stringify(option)); if (bytes > limits.bytes) throw Error(text.budget);
        if (rows <= limits.groups) values.push(option);
      } else if (frame.kind === 'rows-end') { if (++ends !== 1 || starts !== 1) throw Error(text.invalid); warningCount = frame.warningCount; }
      else throw Error(text.invalid);
    },
  });
  // 原分组诊断先于任何元数据/身份SELECT，禁止后续查询清掉警告证据。
  const warnings = (await structureTaskQuery<unknown>(context, 'SHOW WARNINGS LIMIT 21')).rows;
  if (!Array.isArray(warnings) || warnings.length || warningCount !== 0 || starts !== 1 || ends !== 1) throw Error(text.serverWarning);
  context.checkCancelled();
  const after = await readIncomingReferenceTable(context, input, true), afterIdentity = tableStatisticsSourceIdentity(after, context);
  if (identity.digest !== afterIdentity.digest || identity.conservative !== afterIdentity.conservative || serverIdentity !== await readTableValueOptionsServerIdentity(context)) throw Error(text.stale);
  const truncated = rows > limits.groups;
  // metadata含仅供旧设计器使用的非枚举内部标记；按原IPC克隆行为只投影公开枚举字段。
  // 原source继续用于完整前后身份核验，不放宽回执对非枚举字段或getter的拒绝。
  const output: TableValueOptionsOutput = { source: { ...source }, sourceDigest: hash([identity.digest, serverIdentity]), column: plan.column.name, ...(plan.searchPattern !== undefined ? { searchPattern: plan.searchPattern } : {}), values, truncated, warnings: [text.scope, text.equality, ...(plan.searchPattern !== undefined ? [text.search] : []), ...(truncated ? [text.truncated] : []), ...(plan.capability === 'floating' ? [text.approximate] : []), ...(identity.conservative ? [text.conservative] : [])] };
  validateTableValueOptionsOutput(output, input);
  // 正常结束本独立事务；失败/取消保持原连接真实收尾，不重放分组或借新连接回滚。
  await structureTaskQuery(context, 'ROLLBACK AND NO CHAIN NO RELEASE'); context.checkCancelled(); return output;
}
