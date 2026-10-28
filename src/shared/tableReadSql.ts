import type { CellValue, ColumnInfo, FilterGroup, FilterMode, FilterRule, SortRule, TableInfo } from './contracts';
import { copyFilterRules, validateFilterGroup } from './filtering';

export const tableReadSqlLimits = Object.freeze({ columns: 4096, sorts: 20, sqlBytes: 2 * 1024 * 1024, limit: 100000 });
export const tableReadSqlText = Object.freeze({
  invalid: '生成SELECT的表元数据、字段或条件无效',
  columns: '请选择1～4096个不重复的有效字段，并保留所需列顺序',
  sorts: '排序只接受最多20条不重复的有效字段、ASC或DESC方向，以及可选FIRST或LAST的NULL位置',
  limit: '结果行数上限必须是1～100000的整数',
  sqlBytes: '完整SELECT超过2MiB，请缩小筛选条件；未截断语句',
  unicode: '名称或筛选值包含无效Unicode字符，未生成语句',
});
const encoder = new TextEncoder();
/** UTF8编码之前拒绝孤立代理项，不把原名称或原值悄然改为替代字符。 */
function unicode(value: string): void {
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw Error(tableReadSqlText.unicode);
}
/** 与真实表页exportLiteral文本分支逐字节相同，浏览器用TextEncoder而不引入Node Buffer。 */
function tableReadTextLiteral(value: string): string {
  unicode(value);
  return `_utf8mb4 X'${Array.from(encoder.encode(value), byte => byte.toString(16).padStart(2, '0')).join('')}'`;
}
/** 标识符独立引用，问号、反引号和点号均作为原名称保留。 */
export function tableReadIdentifier(value: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 64 || value.includes('\0')) throw Error('数据库对象名称必须为1～64个字符且不能包含NUL');
  unicode(value); return '`' + value.replaceAll('`', '``') + '`';
}
/** 精确数值参数显式转为 DECIMAL，防止 MySQL 将字符串与 BIGINT 比较时降为 DOUBLE。 */
function filterParameter(column: ColumnInfo, value: string, pattern: boolean): string {
  if (pattern || !/^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|FIXED|BIT|YEAR)\b/i.test(column.type)) return '?';
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) throw new Error(`字段 ${column.name} 的筛选值必须为普通十进制数，不接受科学计数法或其他文本`);
  const [integer, fraction = ''] = value.replace(/^[+-]/, '').split('.');
  const integerDigits = integer.replace(/^0+/, '').length;
  // MySQL 支持 30 位小数；元数据明确给出更高位数时保留 MariaDB 该列已支持的尺度。
  const declaredScale = Number(/^(?:DECIMAL|NUMERIC|FIXED)\(\d+,\s*(\d+)\)/i.exec(column.type)?.[1] ?? 0);
  const maxScale = Math.max(30, declaredScale);
  if (fraction.length > maxScale || integerDigits + fraction.length > 65) throw new Error(`字段 ${column.name} 的筛选值超出精确比较范围：最多 65 位数字和 ${maxScale} 位小数`);
  // 5.7将UNSIGNED整列与高位DECIMAL常量比较会产生1292；仅真实整型且范围已证明的非负整数定型为UNSIGNED。
  // 沿BIT写值的双层定型：先DECIMAL(20,0)保住8.4预处理参数高位；负号、分数或UINT64溢出仍走原DECIMAL，不取模/截断。
  if (/^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)(?:\(\d{1,5}\))?\s+UNSIGNED(?:\s+ZEROFILL)?$/i.test(column.type.trim()) && /^\+?\d+$/.test(value) && BigInt(value) <= 18446744073709551615n) return 'CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED)';
  return `CAST(? AS DECIMAL(65,${fraction.length}))`;
}

/** 表页及整范围聚合共用同一元数据白名单、启停及分组语义，不重新解析任意SQL。 */
export function buildTableFilterSql(info: TableInfo, filters: FilterRule[], filterMode: FilterMode = 'all', filterGroup?: FilterGroup, parameterLiteral?: (value: string) => string): { where: string | undefined; params: CellValue[] } {
  const admitted=copyFilterRules(filters),group=validateFilterGroup(admitted,filterMode,filterGroup);
  const columns = new Map(info.columns.map(column => [column.name, column]));
  const params: CellValue[] = [];
  // 停用只排除谓词及参数；目录校验和总预算仍覆盖保留的所有条件。
  for (const filter of admitted) if (!columns.has(filter.column)) throw new Error(`未知筛选字段：${filter.column}`);
  /** 叶参数在实际遍历到该叶时才绑定，嵌套分组保持DFS顺序及原精确占位符。 */
  const clause = (filter:FilterRule):string => {
    const metadata = columns.get(filter.column);
    if (!metadata) throw new Error(`未知筛选字段：${filter.column}`);
    const column = tableReadIdentifier(filter.column);
    if (filter.operator === 'IS NULL' || filter.operator === 'IS NOT NULL') return `${column} ${filter.operator}`;
    /** 参数按条件原顺序加入，不拆分逗号、裁剪空白或转换为 JavaScript 数值。 */
    const parameter = (value: string) => {
      const sql = filterParameter(metadata, value, filter.operator === 'LIKE' || filter.operator === 'NOT LIKE'); params.push(value);
      if (!parameterLiteral) return sql;
      // 这里只替换本叶内部生成的唯一值孔位，列名中的问号永远不进入此模板。
      const literal = parameterLiteral(value); return sql.replace('?', () => literal);
    };
    if (filter.operator === 'IN' || filter.operator === 'NOT IN') return `${column} ${filter.operator} (${filter.values!.map(parameter).join(', ')})`;
    if (filter.operator === 'BETWEEN') return `${column} BETWEEN ${parameter(filter.values![0])} AND ${parameter(filter.values![1])}`;
    return `${column} ${filter.operator} ${parameter(filter.value ?? '')}`;
  };
  /** 全停用子树省略，不能让空OR变成真或用缺省谓词放宽其它分支。 */
  function grouped(node:FilterGroup):string|undefined{
    const children=node.children.map(child=>typeof child==='number'?(admitted[child].enabled===false?undefined:`(${clause(admitted[child])})`):grouped(child)).filter((value):value is string=>value!==undefined);
    return children.length?'('+children.join(node.mode==='all'?' AND ':' OR ')+')':undefined;
  }
  // 未提供group时沿用旧字节模板，旧平铺参数仍严格按filters顺序。
  const where=group?grouped(group):(()=>{const clauses=admitted.filter(filter=>filter.enabled!==false).map(clause);return clauses.length?'('+clauses.map(clause=>`(${clause})`).join(filterMode==='all'?' AND ':' OR ')+')':undefined;})();
  return { where, params };
}

/** 有界复制数组自有数据项，不读取访问器或跳过空洞，也不使用未知迭代器。 */
function list<T>(value: readonly T[], maximum: number, message: string): T[] {
  if (!Array.isArray(value)) throw Error(message);
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Reflect.ownKeys(value).length !== length + 1) throw Error(message);
  const output: T[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error(message);
    output.push(descriptor.value as T);
  }
  return output;
}

/** 排序只校显式20条预算；补可靠键不占该预算，原合法表页排序字节保持。 */
export function buildTableReadOrder(info: TableInfo, sort: readonly SortRule[]): string {
  const columns = new Set(info.columns.map(column => column.name)), seen = new Set<string>();
  const rules: SortRule[] = list(sort, tableReadSqlLimits.sorts, tableReadSqlText.sorts).map(rule => {
    if (!rule || typeof rule !== 'object' || Reflect.ownKeys(rule).some(key => key !== 'column' && key !== 'direction' && key !== 'nulls')) throw Error(tableReadSqlText.sorts);
    const column = Object.getOwnPropertyDescriptor(rule, 'column'), direction = Object.getOwnPropertyDescriptor(rule, 'direction'), nulls = Object.getOwnPropertyDescriptor(rule, 'nulls');
    if (!column || !direction || !('value' in column) || !('value' in direction) || !column.enumerable || !direction.enumerable || typeof column.value !== 'string' || !columns.has(column.value) || !['ASC', 'DESC'].includes(direction.value) || seen.has(column.value)) throw Error(tableReadSqlText.sorts);
    // 可选NULL位置也只读自有数据描述符；显式undefined与旧双字段规则使用相同数据库默认字节。
    if (nulls && (!('value' in nulls) || !nulls.enumerable || nulls.value !== undefined && nulls.value !== 'FIRST' && nulls.value !== 'LAST')) throw Error(tableReadSqlText.sorts);
    seen.add(column.value); return { column: column.value as string, direction: direction.value as 'ASC' | 'DESC', ...(nulls?.value === undefined ? {} : { nulls: nulls.value as 'FIRST' | 'LAST' }) };
  });
  const keys = list(info.editableKey, tableReadSqlLimits.columns, tableReadSqlText.invalid), keyNames = new Set<string>();
  for (const key of keys) {
    if (typeof key !== 'string' || !columns.has(key) || keyNames.has(key)) throw Error(tableReadSqlText.invalid);
    keyNames.add(key); if (!seen.has(key)) rules.push({ column: key, direction: 'ASC' });
  }
  // NULL分桶与值方向分别编译；空串、精确数值及二进制原值均不参与转换，补键仍只出现一次。
  return rules.flatMap(rule => {
    const column = tableReadIdentifier(rule.column), value = `${column} ${rule.direction}`;
    return rule.nulls === undefined ? [value] : [`(${column} IS NULL) ${rule.nulls === 'FIRST' ? 'DESC' : 'ASC'}`, value];
  }).join(', ');
}

export interface FilteredTableSelectInput {
  info: TableInfo;
  filters: FilterRule[];
  filterMode?: FilterMode;
  filterGroup?: FilterGroup;
  sort: SortRule[];
  columns: string[];
  limit: number;
}
export interface FilteredTableSelectOutput { sql: string; parameters: 0; }

/** 从同一筛选叶参数生成模式无关文字量；不扫描整条SQL替换问号，也不请求数据库。 */
export function buildFilteredTableSelect(input: FilteredTableSelectInput): FilteredTableSelectOutput {
  if (!input || typeof input !== 'object' || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > tableReadSqlLimits.limit) throw Error(tableReadSqlText.limit);
  const info = input.info;
  if (!info || typeof info !== 'object') throw Error(tableReadSqlText.invalid);
  const source = list(info.columns, tableReadSqlLimits.columns, tableReadSqlText.invalid), names = new Set<string>();
  if (!source.length) throw Error(tableReadSqlText.invalid);
  for (const column of source) {
    if (!column || typeof column.name !== 'string' || typeof column.type !== 'string' || !column.type.length || names.has(column.name)) throw Error(tableReadSqlText.invalid);
    tableReadIdentifier(column.name); names.add(column.name);
  }
  const selected = list(input.columns, tableReadSqlLimits.columns, tableReadSqlText.columns), selectedNames = new Set<string>();
  if (!selected.length) throw Error(tableReadSqlText.columns);
  for (const name of selected) {
    if (typeof name !== 'string' || !names.has(name) || selectedNames.has(name)) throw Error(tableReadSqlText.columns);
    tableReadIdentifier(name); selectedNames.add(name);
  }
  const filters = copyFilterRules(input.filters);
  // 停用条件也核原Unicode，不能在重新启用时才悄悄替换损坏字符串。
  for (const filter of filters) {
    if (typeof filter.column === 'string') unicode(filter.column);
    for (const value of filter.values ?? (filter.value === undefined ? [] : [filter.value])) if (typeof value === 'string') unicode(value);
  }
  let literalBytes = 0;
  const filter = buildTableFilterSql(info, filters, input.filterMode, input.filterGroup, value => {
    const literal = tableReadTextLiteral(value);
    literalBytes += literal.length;
    if (literalBytes > tableReadSqlLimits.sqlBytes) throw Error(tableReadSqlText.sqlBytes);
    return literal;
  });
  const order = buildTableReadOrder(info, input.sort);
  const sql = `SELECT ${selected.map(tableReadIdentifier).join(', ')} FROM ${tableReadIdentifier(info.database)}.${tableReadIdentifier(info.name)}${filter.where ? ' WHERE ' + filter.where : ''}${order ? ' ORDER BY ' + order : ''} LIMIT ${input.limit};`;
  if (encoder.encode(sql).length > tableReadSqlLimits.sqlBytes) throw Error(tableReadSqlText.sqlBytes);
  return { sql, parameters: 0 };
}
