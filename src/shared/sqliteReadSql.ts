import { sqliteTableBrowseLimits as limits, sqliteTablePageSchema, type SqliteTableColumn, type SqliteTableFilter, type SqliteTablePageInput } from './sqliteTableBrowse';

export type SqliteReadParameter = { kind: 'storage-type'; value: 'text' | 'integer' | 'real' | 'blob' } | { kind: 'operand'; value: NonNullable<SqliteTableFilter['value']> } | { kind: 'count'; value: number };
export const sqliteReadSqlLimits = { utf8Bytes: 4 * 1024 * 1024, utf16Bytes: 2 * 1024 * 1024, limit: 1000000 } as const;
/** 对准确目录标识符逐个引用；问号、引号与注释marker都仅为名称内容。 */
export function quoteSqliteIdentifier(name: string): string { return '"' + name.replaceAll('"', '""') + '"'; }

/** 绑定分页与字面查询共用同一构造器；由render决定占位/字面，不在SQL文本中猜问号。 */
function build(source: SqliteTablePageInput, columns: readonly SqliteTableColumn[], selected: readonly string[] | undefined, complete: boolean, render: (parameter: SqliteReadParameter) => string, project?: (qualifiedColumn: string) => string, explicitLimit?: number): string {
  const input = sqliteTablePageSchema.parse(source), names = new Set(columns.map(column => column.name));
  if (!columns.length || columns.length > limits.columns || names.size !== columns.length) throw Error('SQLite表没有可浏览列或列目录超过预算');
  const alias = project ? '"__dbark_source"' : undefined;
  const field = (name: string) => { if (!names.has(name)) throw Error('SQLite筛选或排序列已不存在，请刷新表结构'); return (alias ? alias + '.' : '') + quoteSqliteIdentifier(name); };
  const output = selected ?? columns.map(column => column.name);
  if (!output.length || output.length > limits.columns || new Set(output).size !== output.length) throw Error('SQLite导出列为空、重复或超过预算');
  const operators = { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;
  const filters = input.filters.flatMap(filter => {
    const column = field(filter.column);
    // 停用仍经过完整合同和字段白名单，不可借停用绕过名称、值格式或全组预算。
    if (filter.enabled === false) return [];
    if (filter.operator === 'isNull' || filter.operator === 'notNull') return [column + (filter.operator === 'isNull' ? ' IS NULL' : ' IS NOT NULL')];
    // 同型列表仍限制真实存储类型，NOT IN不把NULL或另一类型当成普通不等值。
    if (filter.operator === 'in' || filter.operator === 'notIn') {
      const values = filter.values!, kind = values[0].kind, type = render({ kind: 'storage-type', value: kind === 'blob' ? 'blob' : kind });
      return ['(typeof(' + column + ') = ' + type + ' AND ' + column + (filter.operator === 'in' ? ' IN (' : ' NOT IN (') + values.map(value => render({ kind: 'operand', value })).join(', ') + '))'];
    }
    const value = filter.value!, type = render({ kind: 'storage-type', value: value.kind === 'blob' ? 'blob' : value.kind }), operand = render({ kind: 'operand', value });
    // 原生BETWEEN包含两端，不重排边界；NOT BETWEEN仍保留原动态存储类型限制。
    if (filter.operator === 'between' || filter.operator === 'notBetween') return ['(typeof(' + column + ') = ' + type + ' AND ' + column + (filter.operator === 'between' ? ' BETWEEN ' : ' NOT BETWEEN ') + operand + ' AND ' + render({ kind: 'operand', value: filter.secondValue! }) + ')'];
    const comparison = filter.operator === 'contains' ? 'instr(' + column + ', ' + operand + ') > 0' : column + ' ' + operators[filter.operator] + ' ' + operand;
    return ['(typeof(' + column + ') = ' + type + ' AND ' + comparison + ')'];
  });
  const order = input.sort.map(sort => field(sort.column) + (sort.direction === 'asc' ? ' ASC' : ' DESC'));
  const pagination = complete ? explicitLimit === undefined ? '' : ' LIMIT ' + render({ kind: 'count', value: explicitLimit }) : ' LIMIT ' + render({ kind: 'count', value: input.limit + 1 }) + ' OFFSET ' + render({ kind: 'count', value: input.offset });
  return 'SELECT ' + output.map(name => project ? project(field(name)) + ' AS ' + quoteSqliteIdentifier(name) : field(name)).join(', ') + ' FROM "main".' + quoteSqliteIdentifier(input.table) + (alias ? ' AS ' + alias : '')
    + (filters.length ? ' WHERE ' + filters.join(input.mode === 'and' ? ' AND ' : ' OR ') : '') + (order.length ? ' ORDER BY ' + order.join(', ') : '') + pagination;
}

/** 原Main分页保留逐字SQL和参数顺序，typed token由Main转换为原driver绑定合同。 */
export function buildSqliteReadPlan(source: SqliteTablePageInput, columns: readonly SqliteTableColumn[], selected?: readonly string[], complete = false, project?: (qualifiedColumn: string) => string): { sql: string; parameters: SqliteReadParameter[] } {
  const parameters: SqliteReadParameter[] = [], sql = build(source, columns, selected, complete, parameter => { parameters.push(parameter); return '?'; }, project); return { sql, parameters };
}
/** 普通TEXT按数据库编码解释，控制换行不进入SQL原文，避免编辑器EOL规范化改变筛选值。 */
function textLiteral(value: string): string {
  const quote = (text: string) => "'" + text.replaceAll("'", "''") + "'";
  const controls = ['\0', '\r', '\n'].filter(character => value.includes(character));
  if (!controls.length) return quote(value);
  // 一次扫描集合后找缺失码点；连续控制字符不增加表达式深度，最多三层replace。
  const used = new Set<number>(); for (const point of value) used.add(point.codePointAt(0)!);
  let code = 0xe000, encoded = value;
  const replacements = controls.map(character => { while (used.has(code)) code++; const sentinel = String.fromCodePoint(code++); used.add(sentinel.codePointAt(0)!); encoded = encoded.replaceAll(character, sentinel); return { sentinel, point: character.codePointAt(0)! }; });
  return replacements.reduce((sql, item) => 'replace(' + sql + ', ' + quote(item.sentinel) + ', char(' + item.point + '))', quote(encoded));
}
/** 精确数值不加CAST亲和性；REAL整数文本补.0，仍保显式浮点类型与负零。 */
function literal(parameter: SqliteReadParameter): string {
  if (parameter.kind === 'storage-type') return "'" + parameter.value + "'";
  if (parameter.kind === 'count') return String(parameter.value);
  const value = parameter.value;
  if (value.kind === 'text') return textLiteral(value.value);
  if (value.kind === 'blob') return "X'" + value.value + "'";
  if (value.kind === 'integer') return BigInt(value.value).toString();
  const number = Number(value.value); if (Object.is(number, -0)) return '-0.0'; const canonical = String(number); return /[.eE]/.test(canonical) ? canonical : canonical + '.0';
}
/** 生成完整匹配SELECT，默认不带页长/offset；只能选择目录字段与显式受限LIMIT。 */
export function buildSqliteFilteredSelect(source: SqliteTablePageInput, columns: readonly SqliteTableColumn[], selected: readonly string[], limit?: number): string {
  if (!Array.isArray(selected)) throw Error('SQLite查询必须明确选择字段');
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > sqliteReadSqlLimits.limit)) throw Error('SQLite查询行数上限必须为1至1000000的整数');
  const sql = build(source, columns, selected, true, literal, undefined, limit);
  if (sql.length * 2 > sqliteReadSqlLimits.utf16Bytes || new TextEncoder().encode(sql).byteLength > sqliteReadSqlLimits.utf8Bytes) throw Error('SQLite生成查询超过文本预算，请减少字段或筛选条件'); return sql;
}
