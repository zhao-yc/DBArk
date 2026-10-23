import type { CellValue, FilterGroup, FilterMode, FilterRule, TableInfo } from './contracts';

export const tableValueOptionsLimits = { groups: 500, pageSize: 50, searchCharacters: 256, cellBytes: 256 * 1024, bytes: 8 * 1024 * 1024, metadataRows: 4096, sortBufferBytes: 8 * 1024 * 1024 } as const;
export interface TableValueOptionsInput { connectionId: string; database: string; table: string; column: string; filters: FilterRule[]; filterMode?: FilterMode; filterGroup?: FilterGroup; searchPattern?: string; taskId: string; }
export interface TableValueOption { value: CellValue; count: string; }
export interface TableValueOptionsOutput { source: TableInfo; sourceDigest: string; column: string; searchPattern?: string; values: TableValueOption[]; truncated: boolean; warnings: string[]; }
export type TableValueOptionsCapability = 'text' | 'integer' | 'decimal' | 'floating' | 'temporal' | 'unsupported';
export const tableValueOptionsMessages = {
  invalid: '服务器不同值、字段元数据或原读取来源无效，请重新读取。',
  unsupported: 'JSON、二进制、BIT、空间及尚未证明的类型暂不支持从服务器选择不同值。',
  stale: '不同值读取期间表或视图定义或服务器身份已变化，未发布混合来源的候选。',
  budget: '不同值候选超过有界预算；不会截断值或将超限值当作NULL，请缩小服务器LIKE范围。',
  serverWarning: '服务器分组返回警告或警告状态无法确认，未发布可能截断或转换的候选。',
  scope: '按当前服务器筛选读取全部匹配行的分组；独立只读会话不包含用户会话尚未提交的数据。',
  equality: '分组与顺序遵循原列服务器相等语义和排序规则；一个代表值可能对应大小写、重音或尾空格不同的多行。',
  truncated: '仅返回服务器排序前500组；可明确输入LIKE模式再次查询全部匹配行，未读取的分组不会自动选中。',
  search: '服务器LIKE使用原列语义，%和_是通配符；非空模式只显示匹配组，NULL组需清空模式后重新读取。',
  approximate: 'FLOAT、DOUBLE、REAL保留二进制协议原有限数值，属于浮点近似；不是精确十进制。',
  conservative: '复杂表定义按完整原文绑定，任何定义文本变化都会使本次候选失效。',
} as const;

/** 以原服务器字段类别决定能力；不让回包或未知类型自行升级为文本筛选。 */
export function tableValueOptionsColumnCapability(type: string): TableValueOptionsCapability {
  const name = type.trim();
  if (/^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|BOOL|BOOLEAN|YEAR)\b/i.test(name)) return 'integer';
  if (/^(?:DECIMAL|NUMERIC|FIXED)\b/i.test(name)) return 'decimal';
  if (/^(?:FLOAT|DOUBLE|REAL)\b/i.test(name)) return 'floating';
  if (/^(?:CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|ENUM|SET)\b/i.test(name)) return 'text';
  if (/^(?:DATE|TIME|DATETIME|TIMESTAMP)\b/i.test(name)) return 'temporal';
  return 'unsupported';
}

/** 搜索模式不修剪、不补通配符；空串等价未搜索，拒绝无效Unicode以免UTF8替换偷换来源。 */
export function tableValueOptionsSearchPattern(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || Array.from(value).length > tableValueOptionsLimits.searchCharacters || /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value)) throw Error(tableValueOptionsMessages.invalid);
  return value;
}

/** 只接受普通可克隆数据及可选字段undefined，拒绝getter、稀疏数组与循环，然后做总字节计量。 */
function plainData(value: unknown, seen = new Set<object>(), depth = 0): void {
  if (depth > 32) throw Error(tableValueOptionsMessages.invalid);
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || seen.has(value) || !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw Error(tableValueOptionsMessages.invalid);
  seen.add(value);
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value) && (keys.length !== value.length + 1 || value.length > 65536)) throw Error(tableValueOptionsMessages.invalid);
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw Error(tableValueOptionsMessages.invalid);
    plainData(descriptor.value, seen, depth + 1);
  }
  seen.delete(value);
}
const byteLength = (value: string) => new TextEncoder().encode(value).length;
const name = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 64 && !value.includes('\0');
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/** 前后端共用原值型别校验，计数始终保持正十进制串，不经过Number。 */
export function validateTableValueOptionValue(value: unknown, capability: TableValueOptionsCapability): asserts value is CellValue {
  if (capability === 'unsupported') throw Error(tableValueOptionsMessages.unsupported);
  if (value === null) return;
  if (capability === 'floating') { if (typeof value !== 'number' || !Number.isFinite(value)) throw Error(tableValueOptionsMessages.invalid); return; }
  if (typeof value !== 'string' || byteLength(value) > tableValueOptionsLimits.cellBytes) throw Error(tableValueOptionsMessages.budget);
  if (capability === 'integer' && !/^[+-]?\d+$/.test(value) || capability === 'decimal' && !decimal.test(value)) throw Error(tableValueOptionsMessages.invalid);
}

/** 服务回执严格绑定原目标及LIKE模式；元数据、计数和字节必须全部可信才能参与筛选。 */
export function validateTableValueOptionsOutput(value: unknown, expected: { database: string; table: string; column: string; searchPattern?: string }): TableValueOptionsOutput {
  plainData(value);
  if (byteLength(JSON.stringify(value)) > tableValueOptionsLimits.bytes) throw Error(tableValueOptionsMessages.budget);
  const output = value as TableValueOptionsOutput, source = output?.source;
  if (!output || !source || source.database !== expected.database || source.name !== expected.table || output.column !== expected.column || output.searchPattern !== tableValueOptionsSearchPattern(expected.searchPattern) || output.searchPattern !== tableValueOptionsSearchPattern(output.searchPattern) || !/^[a-f0-9]{64}$/.test(output.sourceDigest) || typeof output.truncated !== 'boolean' || !Array.isArray(output.values) || output.values.length > tableValueOptionsLimits.groups || output.truncated && output.values.length !== tableValueOptionsLimits.groups || !Array.isArray(output.warnings) || !output.warnings.length || output.warnings.some(item => typeof item !== 'string' || item.length > 4096)) throw Error(tableValueOptionsMessages.invalid);
  if (!['table', 'view'].includes(String(source.objectKind)) || typeof source.engine !== 'string' || typeof source.ddl !== 'string' || !source.ddl.length || !Array.isArray(source.columns) || !source.columns.length || source.columns.length > tableValueOptionsLimits.metadataRows || !Array.isArray(source.indexes) || !Array.isArray(source.foreignKeys) || !Array.isArray(source.primaryKey) || !Array.isArray(source.editableKey)) throw Error(tableValueOptionsMessages.invalid);
  const names = new Set<string>();
  for (const column of source.columns) {
    if (!column || !name(column.name) || names.has(column.name) || typeof column.type !== 'string' || !column.type.length || typeof column.nullable !== 'boolean' || column.defaultValue !== null && typeof column.defaultValue !== 'string' || typeof column.generated !== 'boolean' || typeof column.extra !== 'string' || typeof column.comment !== 'string' || column.characterSet !== undefined && column.characterSet !== null && typeof column.characterSet !== 'string') throw Error(tableValueOptionsMessages.invalid);
    names.add(column.name);
  }
  const namedColumns = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= tableValueOptionsLimits.metadataRows && new Set(value).size === value.length && value.every(item => name(item) && names.has(item));
  for (const key of [source.primaryKey, source.editableKey]) if (key.length && !namedColumns(key)) throw Error(tableValueOptionsMessages.invalid);
  const indexNames = new Set<string>(), foreignKeyNames = new Set<string>();
  if (source.indexes.length > tableValueOptionsLimits.metadataRows || source.foreignKeys.length > tableValueOptionsLimits.metadataRows) throw Error(tableValueOptionsMessages.invalid);
  for (const index of source.indexes) {
    // 函数索引可由现有目录表示为零个普通列；保留完整DDL绑定，不因此禁用无关列的只读候选。
    if (!index || !name(index.name) || indexNames.has(index.name) || typeof index.unique !== 'boolean' || !Array.isArray(index.columns) || index.columns.length > 0 && !namedColumns(index.columns)) throw Error(tableValueOptionsMessages.invalid);
    indexNames.add(index.name);
  }
  for (const foreignKey of source.foreignKeys) {
    if (!foreignKey || !name(foreignKey.name) || foreignKeyNames.has(foreignKey.name) || !namedColumns(foreignKey.columns) || !name(foreignKey.referencedDatabase) || !name(foreignKey.referencedTable) || !Array.isArray(foreignKey.referencedColumns) || foreignKey.referencedColumns.length !== foreignKey.columns.length || foreignKey.referencedColumns.some(item => !name(item)) || typeof foreignKey.onUpdate !== 'string' || typeof foreignKey.onDelete !== 'string') throw Error(tableValueOptionsMessages.invalid);
    foreignKeyNames.add(foreignKey.name);
  }
  const columns = source.columns.filter(column => column.name === expected.column);
  if (columns.length !== 1) throw Error(tableValueOptionsMessages.invalid);
  const capability = tableValueOptionsColumnCapability(columns[0].type), values = new Set<string>();
  for (const option of output.values) {
    if (!option || Reflect.ownKeys(option).length !== 2 || !Object.hasOwn(option, 'value') || typeof option.count !== 'string' || !/^[1-9]\d{0,31}$/.test(option.count)) throw Error(tableValueOptionsMessages.invalid);
    validateTableValueOptionValue(option.value, capability);
    if (output.searchPattern !== undefined && option.value === null || option.value === null && !columns[0].nullable) throw Error(tableValueOptionsMessages.invalid);
    const key = JSON.stringify([typeof option.value, option.value]); if (values.has(key)) throw Error(tableValueOptionsMessages.invalid); values.add(key);
  }
  if (capability === 'unsupported') throw Error(tableValueOptionsMessages.unsupported);
  return output;
}
