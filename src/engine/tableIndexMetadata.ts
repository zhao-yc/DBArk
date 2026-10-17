import { tableDefinitionTokens } from './tableColumnDefinition';
import { readControlledTimestampDefault, type TableColumnDefinition, type TableDefinitionContext } from '../shared/tableColumnPatches';
import type { IndexPlanOptions, ParsedIndex, TrustedIndexColumn } from '../shared/tableIndexPatches';

export interface IndexCapabilityMetadata {
  dialect: 'mysql' | 'mariadb'; serverVersion: string; engine: string; rowFormat: string;
  pageSize: number | string; largePrefix?: boolean;
}
export interface IndexCapabilityResult { writable: boolean; capabilities?: IndexPlanOptions['capabilities']; reasons: string[]; }
export interface IndexColumnMetadata {
  COLUMN_NAME: string; DATA_TYPE: string; COLUMN_TYPE: string; IS_NULLABLE: 'YES' | 'NO';
  CHARACTER_SET_NAME: string | null; COLLATION_NAME: string | null;
  CHARACTER_MAXIMUM_LENGTH: string | number | null; CHARACTER_OCTET_LENGTH: string | number | null;
  EXTRA: string; SRS_ID?: unknown;
}
export interface IndexColumnContext { definitionContext: TableDefinitionContext; charsetMaxBytes?: string | number; }
export interface IndexColumnMetadataResult { column: TrustedIndexColumn; writable: boolean; reasons: string[]; }

/** 这里只转换目录中的长度/序号，不接受负数、精度已经丢失的数值或数据行内容。 */
function metadataInteger(value: unknown, name: string, allowZero = false): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value) || value.length > 16)) throw new Error(`${name} 不是可信非负目录整数`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1)) throw new Error(`${name} 超出可信目录整数范围`);
  return number;
}

/** 可写能力只覆盖 run01 已证明的五个基线，不按大版本或相似页大小外推。 */
export function deriveIndexCapabilities(input: IndexCapabilityMetadata): IndexCapabilityResult {
  const reasons: string[] = [];
  const version = /^(\d+\.\d+\.\d+)(?:$|-)/.exec(input.serverVersion)?.[1];
  const baseline = input.dialect === 'mysql' ? ['5.7.44', '8.0.46', '8.4.11'] : ['10.11.19', '11.4.13'];
  if (!version || !baseline.includes(version) || (input.dialect === 'mysql' && /mariadb/i.test(input.serverVersion))) reasons.push('该服务器版本尚无本批索引能力实证');
  if (input.engine.toUpperCase() !== 'INNODB') reasons.push('首批索引修改只支持已证明的 InnoDB');
  if (input.rowFormat.toUpperCase() !== 'DYNAMIC') reasons.push('该行格式尚未证明键长度和索引操作能力');
  try { if (metadataInteger(input.pageSize, '页大小') !== 16384) reasons.push('首批仅证明 16 KiB InnoDB 页大小'); } catch { reasons.push('无法确认实际 InnoDB 页大小'); }
  if (version === '5.7.44' && input.largePrefix !== true) reasons.push('MySQL 5.7 必须确认 innodb_large_prefix 已开启');
  if (reasons.length) return { writable: false, reasons };
  // 官方 InnoDB 限制分别为 MySQL 16 列、MariaDB 32 列，不能用共享输入预算代替服务器上限。
  return { writable: true, reasons: [], capabilities: { renameIndex: true, descendingIndexes: version !== '5.7.44', maxKeyParts: input.dialect === 'mysql' ? 16 : 32, maxIndexNameCharacters: 64,
    // 1024 UTF-8 字节是客户端保守预算，不宣称五版服务器都按字节限制注释。
    maxIndexCommentBytes: 1024, maxKeyBytes: 3072, specialIndexes: { fulltext: true, spatial: true, spatialRequiresSrid: input.dialect === 'mysql' && version?.startsWith('8.') === true } } };
}

/** 只读自有数据字段，目录缺失或访问器都不能冒充显式 NULL。 */
function field(row: object, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(row, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error(`目录缺少可信字段 ${name}`);
  return descriptor.value;
}
function textField(row: object, name: string, empty = false): string {
  const value = field(row, name);
  if (typeof value !== 'string' || (!empty && !value) || value.length > 65536 || value.includes('\0')) throw new Error(`目录字段 ${name} 无效`);
  return value;
}
function nullableTextField(row: object, name: string): string | null {
  return field(row, name) === null ? null : textField(row, name);
}
/** 类型仅做词法规范化，不删除 UNSIGNED/ZEROFILL、精度或枚举文字量。 */
function typeTokens(type: string, context: TableDefinitionContext): string {
  return JSON.stringify(tableDefinitionTokens(type, context).map(token => [token.kind, token.kind === 'word' ? token.value.toUpperCase() : token.value]));
}

/** 数字/时间使用公开存储上界，不声称估计磁盘索引页、记录头或压缩后的精确成本。
 * 依据：https://dev.mysql.com/doc/refman/8.4/en/storage-requirements.html
 * https://mariadb.com/docs/server/reference/data-types/data-type-storage-requirements
 */
function scalarKeyBound(type: string, columnType: string): number | undefined {
  const integers = new Map([['TINYINT', 1], ['SMALLINT', 2], ['MEDIUMINT', 3], ['INT', 4], ['INTEGER', 4], ['BIGINT', 8]]);
  if (integers.has(type) && /^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)(?:\(\d+\))?(?: UNSIGNED)?(?: ZEROFILL)?$/i.test(columnType)) return integers.get(type);
  if (/^(?:FLOAT|DOUBLE)(?:\(\d+(?:,\d+)?\))?(?: UNSIGNED)?(?: ZEROFILL)?$/i.test(columnType)) return 8;
  const bit = /^BIT(?:\((\d+)\))?$/i.exec(columnType);
  if (type === 'BIT' && bit) { const width = Number(bit[1] ?? 1); return width >= 1 && width <= 64 ? Math.ceil(width / 8) : undefined; }
  const decimal = /^(?:DECIMAL|NUMERIC)\((\d+),(\d+)\)(?: UNSIGNED)?(?: ZEROFILL)?$/i.exec(columnType);
  if (decimal && ['DECIMAL', 'NUMERIC'].includes(type)) {
    const precision = Number(decimal[1]), scale = Number(decimal[2]);
    if (precision < 1 || precision > 65 || scale < 0 || scale > 38 || scale > precision) return undefined;
    const packed = (digits: number) => Math.floor(digits / 9) * 4 + [0, 1, 1, 2, 2, 3, 3, 4, 4][digits % 9];
    return packed(precision - scale) + packed(scale);
  }
  if (type === 'DATE' && /^DATE$/i.test(columnType)) return 3;
  if (type === 'YEAR' && /^YEAR(?:\(4\))?$/i.test(columnType)) return 1;
  if (/^(?:TIME|DATETIME|TIMESTAMP)(?:\([0-6]\))?$/i.test(columnType)) return type === 'TIME' ? 6 : type === 'DATETIME' ? 8 : 7;
  return undefined;
}

/** 目录与原列定义逐项核对；未证明的类型保留展示，但不提供可写键字节数。 */
export function deriveTrustedIndexColumn(parsed: TableColumnDefinition, metadata: IndexColumnMetadata, context: IndexColumnContext): IndexColumnMetadataResult {
  const mode = context.definitionContext;
  const name = textField(metadata, 'COLUMN_NAME'), type = textField(metadata, 'DATA_TYPE').toUpperCase(), columnType = textField(metadata, 'COLUMN_TYPE');
  if (name !== parsed.name) throw new Error('字段目录名称与定义不一致');
  if (typeTokens(parsed.type.raw, mode) !== typeTokens(columnType, mode)) throw new Error('字段目录类型与完整原定义不一致');
  if (tableDefinitionTokens(columnType, mode)[0]?.value.toUpperCase() !== type) throw new Error('字段基本类型与 COLUMN_TYPE 不一致');
  const nullableText = textField(metadata, 'IS_NULLABLE');
  if (nullableText !== 'YES' && nullableText !== 'NO') throw new Error('字段目录可空状态未知');
  const nullable = nullableText === 'YES';
  if (parsed.nullable !== undefined && parsed.nullable !== nullable) throw new Error('字段可空状态与原定义不一致');
  const charset = nullableTextField(metadata, 'CHARACTER_SET_NAME'), collation = nullableTextField(metadata, 'COLLATION_NAME');
  if ((charset === null) !== (collation === null)) throw new Error('字段字符集和排序规则目录不完整');
  for (const attribute of parsed.attributes.filter(value => value.kind === 'charset' || value.kind === 'collation')) {
    const tokens = tableDefinitionTokens(attribute.raw, mode), declared = tokens.at(-1);
    if (!declared || !['word', 'identifier'].includes(declared.kind) || declared.value !== (attribute.kind === 'charset' ? charset : collation)) throw new Error('字段字符集或排序规则与原定义不一致');
  }
  const rawLength = field(metadata, 'CHARACTER_MAXIMUM_LENGTH'), rawOctets = field(metadata, 'CHARACTER_OCTET_LENGTH');
  const length = rawLength === null ? undefined : metadataInteger(rawLength, '字段最大字符长度', true);
  const octets = rawOctets === null ? undefined : metadataInteger(rawOctets, '字段最大字节长度', true);
  if ((length === undefined) !== (octets === undefined)) throw new Error('字段字符长度和字节长度目录不完整');
  const extra = textField(metadata, 'EXTRA', true);
  const generated = /\b(?:VIRTUAL|STORED|PERSISTENT) GENERATED\b/i.test(extra), hidden = /\bINVISIBLE\b/i.test(extra);
  const generatedDefinition = parsed.attributes.find(attribute => attribute.kind === 'generated');
  const generatedAttribute = Boolean(generatedDefinition);
  const visibility = parsed.attributes.find(attribute => attribute.kind === 'visibility');
  const rawInvisible = visibility ? tableDefinitionTokens(visibility.raw, mode).some(token => token.kind === 'word' && token.value.toUpperCase() === 'INVISIBLE') : undefined;
  if (generated !== generatedAttribute || (rawInvisible !== undefined && rawInvisible !== hidden)) throw new Error('字段生成或可见性属性与目录不一致');
  if (hidden && rawInvisible === undefined && !parsed.attributes.some(attribute => attribute.kind === 'opaque')) throw new Error('目录不可见字段未在原定义中显示');
  if (generatedDefinition) {
    const kind = tableDefinitionTokens(generatedDefinition.raw, mode).at(-1)?.value.toUpperCase();
    const stored = kind === 'STORED' || kind === 'PERSISTENT';
    if (stored !== /\b(?:STORED|PERSISTENT) GENERATED\b/i.test(extra)) throw new Error('生成列存储方式与目录不一致');
  }
  if (/\bauto_increment\b/i.test(extra) !== parsed.attributes.some(attribute => attribute.kind === 'auto-increment')) throw new Error('字段自增属性与目录不一致');
  const update = /\bon update\s+(?:CURRENT_TIMESTAMP(?:\(\d?\))?|NOW\(\d?\))/i.exec(extra);
  if (Boolean(update) !== parsed.attributes.some(attribute => attribute.kind === 'on-update')) throw new Error('字段自动更新时间属性与目录不一致');
  if (update) {
    const attribute = parsed.attributes.find(value => value.kind === 'on-update')!;
    const declared = readControlledTimestampDefault(attribute.raw.replace(/^ON\s+UPDATE\s+/i, ''));
    const actual = readControlledTimestampDefault(update[0].replace(/^on update\s+/i, ''));
    if (!declared || !actual || declared.precision !== actual.precision) throw new Error('字段自动更新时间精度与目录不一致');
  }
  if (/\bDEFAULT_GENERATED\b/i.test(extra) && parsed.default.kind === 'none') throw new Error('目录生成默认值未在原定义中显示');
  const reasons: string[] = [];
  const remaining = extra.replace(/\b(?:VIRTUAL|STORED|PERSISTENT) GENERATED\b/ig, '').replace(/\b(?:DEFAULT_GENERATED|auto_increment|INVISIBLE|VISIBLE)\b/ig, '').replace(/\bon update\s+(?:CURRENT_TIMESTAMP(?:\(\d?\))?|NOW\(\d?\))/ig, '').trim();
  if (remaining || parsed.attributes.some(attribute => attribute.kind === 'opaque')) reasons.push('字段含未证明的附加属性');
  if (generated) reasons.push('生成列索引首批只读');
  if (hidden) reasons.push('不可见字段索引首批只读');
  if (name.toUpperCase() === 'FTS_DOC_ID') reasons.push('全文文档定位列不开放普通索引修改');
  const column: TrustedIndexColumn = { name, nullable, dataType: type, columnType, generated, hidden,
    ...(charset === null ? {} : { charset, collation: collation! }),
    ...(length === undefined ? {} : { characterMaxLength: String(length), characterOctetLength: String(octets) }),
    prefix: { kind: 'unknown', reason: '该类型的前缀能力尚未证明' } };
  const binary = ['BINARY', 'VARBINARY'].includes(type) || /^(?:TINY|MEDIUM|LONG)?BLOB$/.test(type);
  const character = ['CHAR', 'VARCHAR', 'ENUM', 'SET'].includes(type) || /^(?:TINY|MEDIUM|LONG)?TEXT$/.test(type);
  const large = /^(?:TINY|MEDIUM|LONG)?(?:TEXT|BLOB)$/.test(type);
  if (binary || character) {
    if (length === undefined || octets === undefined || length < 1 || octets < 1 || (binary ? charset !== null : charset === null)) throw new Error('字符或二进制字段目录长度/字符集无效');
    let unit = 1;
    if (character) { unit = metadataInteger(context.charsetMaxBytes, '真实字符集 MAXLEN'); column.charsetMaxBytes = unit; }
    if ((binary && length !== octets) || (character && (!Number.isSafeInteger(length * unit) || octets > length * unit || octets < length))) throw new Error('字符长度、字节长度与真实字符集 MAXLEN 冲突');
    const declared = /^(?:CHAR|VARCHAR|BINARY|VARBINARY)\((\d+)\)$/i.exec(columnType);
    if (declared && metadataInteger(declared[1], '原定义长度') !== length) throw new Error('目录长度与字段声明长度不一致');
    if (declared && !binary && octets !== length * unit) throw new Error('完整字符字段字节长度与真实 MAXLEN 不一致');
    // CHAR/BINARY沿用真实目录长度；字符前缀计字符，二进制前缀计字节，不默认声明长度。
    if (['CHAR', 'VARCHAR', 'BINARY', 'VARBINARY'].includes(type) || large) column.prefix = { kind: 'allowed', unit: binary ? 'bytes' : 'characters', maxLength: length };
    else column.prefix = { kind: 'forbidden', reason: '该类型的前缀索引尚无本批实证' };
    if (!large && !['ENUM', 'SET'].includes(type)) column.fullKeyBytes = octets;
    if (['ENUM', 'SET'].includes(type)) reasons.push('枚举或集合的索引字节成本首批未证明');
  } else {
    const scalar = /^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|BIT|DATE|YEAR|TIME|DATETIME|TIMESTAMP)$/.test(type);
    if (scalar && (charset !== null || length !== undefined)) throw new Error('非字符字段不应具有字符目录属性');
    column.prefix = { kind: 'forbidden', reason: '数字、位、时间或其他非字符字段不接受受控前缀' };
    const bound = scalarKeyBound(type, columnType.replace(/\s+/g, ' ').trim());
    if (bound === undefined) reasons.push('该字段普通 BTREE 字节成本尚未证明'); else column.fullKeyBytes = bound;
  }
  if (reasons.length) { delete column.fullKeyBytes; column.prefix = { kind: 'unknown', reason: reasons.join('；') }; }
  return { column, writable: reasons.length === 0, reasons };
}

export interface IndexStatisticsCapabilities { expression: boolean; visibility: boolean; ignored: boolean; }
/** 解析实际目录列能力；缺必需字段拒绝，不能把访问失败或空列表解释成旧版本。 */
export function deriveStatisticsCapabilities(columnNames: readonly string[]): IndexStatisticsCapabilities {
  if (!columnNames.length || columnNames.length > 64) throw new Error('索引目录能力列表为空或超出预算');
  const names = new Set<string>();
  for (const name of columnNames) { if (typeof name !== 'string' || !/^[A-Z_]{1,64}$/i.test(name) || names.has(name.toUpperCase())) throw new Error('索引目录能力名称无效或重复'); names.add(name.toUpperCase()); }
  for (const name of ['INDEX_NAME', 'COLUMN_NAME', 'SEQ_IN_INDEX', 'NON_UNIQUE', 'INDEX_TYPE', 'COLLATION', 'SUB_PART', 'INDEX_COMMENT']) if (!names.has(name)) throw new Error('索引目录缺少必需能力字段');
  return { expression: names.has('EXPRESSION'), visibility: names.has('IS_VISIBLE'), ignored: names.has('IGNORED') };
}

/** 单索引行组与原片段交叉核对；STATISTICS 本身不证明系统生成来源，generated 始终保留未知。 */
export function crossCheckIndexStatistics(index: ParsedIndex, rows: readonly Record<string, unknown>[], capabilities: IndexStatisticsCapabilities): { visible: boolean | 'unknown'; generated: 'unknown'; reasons: string[] } {
  if (!rows.length || rows.length > 32 || rows.length !== index.parts.length) throw new Error('索引目录键部分数量不一致或超出预算');
  const ordered = [...rows].sort((left, right) => metadataInteger(field(left, 'SEQ_IN_INDEX'), '索引键序号') - metadataInteger(field(right, 'SEQ_IN_INDEX'), '索引键序号'));
  const reasons = [...index.opaqueReasons]; let visible: boolean | 'unknown' = 'unknown';
  for (let position = 0; position < ordered.length; position++) {
    const row = ordered[position], part = index.parts[position];
    if (metadataInteger(field(row, 'SEQ_IN_INDEX'), '索引键序号') !== position + 1 || textField(row, 'INDEX_NAME') !== index.name) throw new Error('索引目录名称或键序号不一致');
    const method = textField(row, 'INDEX_TYPE').toUpperCase();
    // InnoDB目录把R树报告为SPATIAL；不能要求目录出现DDL模型的RTREE名称。
    if (method !== (index.kind === 'spatial' && index.method === 'RTREE' ? 'SPATIAL' : index.method) || textField(row, 'INDEX_COMMENT', true) !== index.comment) throw new Error('索引目录方法或注释不一致');
    if (position && method !== textField(ordered[0], 'INDEX_TYPE').toUpperCase()) throw new Error('同一索引方法目录不一致');
    const unique = metadataInteger(field(row, 'NON_UNIQUE'), '索引唯一状态', true);
    if (unique > 1 || (index.kind === 'primary' || index.kind === 'unique') !== (unique === 0)) throw new Error('索引目录唯一属性不一致');
    if (field(row, 'COLUMN_NAME') !== (part.columnName ?? null)) throw new Error('索引目录字段映射与原定义不一致');
    const prefix = field(row, 'SUB_PART'), catalogPrefix = prefix === null ? undefined : metadataInteger(prefix, '索引前缀');
    // 完整空间字段的32字节MBR是服务器内部表示，不是用户输入的字段前缀。
    if (!(index.kind === 'spatial' && part.prefixLength === undefined && (catalogPrefix === undefined || catalogPrefix === 32)) && catalogPrefix !== part.prefixLength) throw new Error('索引目录前缀与原定义不一致');
    const direction = field(row, 'COLLATION');
    if (!index.opaqueReasons.length && !part.opaqueReasons.length && (index.kind === 'fulltext' ? direction !== null : direction !== (part.direction === 'desc' ? 'D' : 'A'))) throw new Error('索引目录方向与原定义不一致');
    if (capabilities.expression) { const expression = field(row, 'EXPRESSION'); if (expression !== null) reasons.push('表达式索引目录首批只读'); }
    let rowVisible: boolean | 'unknown' = 'unknown';
    if (capabilities.visibility) { const value = textField(row, 'IS_VISIBLE'); if (!['YES', 'NO'].includes(value)) throw new Error('索引可见性目录状态未知'); rowVisible = value === 'YES'; }
    if (capabilities.ignored) { const value = textField(row, 'IGNORED'); if (!['YES', 'NO'].includes(value)) throw new Error('索引忽略状态目录未知'); if (value === 'YES') rowVisible = false; }
    if (position && rowVisible !== visible) throw new Error('同一索引各行可见性状态不一致'); visible = rowVisible;
  }
  if (visible === 'unknown') reasons.push('目录未独立证明索引可见性');
  reasons.push('STATISTICS 不证明索引是否由服务器生成，需另有可信证据');
  return { visible, generated: 'unknown', reasons: [...new Set(reasons)] };
}
