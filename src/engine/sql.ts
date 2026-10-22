import { tableCreateDraftSchema, tableCreateHasPrefix, tableCreateIndexParts, type TableCreateDraft, type TableCreatePrefixFacts, type TableCreateEncodingCatalog } from '../shared/tableCreate';
import { tableCreateHasColumnEncoding, planTableCreateColumnEncodings, tableCreateColumnEncodingMessages } from '../shared/tableCreateColumnEncoding';
import { planTableCreateIndexes } from './tableCreateIndexPlan';
import { planTableCreateGeneratedColumns, type TableCreateGeneratedFacts } from './tableCreateGeneratedColumns';
import type { CellValue, ColumnInfo, DataRow, FilterGroup, FilterMode, FilterRule, RowChange, SortRule, SqlPreview, TableDesign, TableInfo } from '../shared/contracts';
import { tableCreateOnUpdateSql, type TableCreateTimeColumn } from '../shared/tableCreateOnUpdate';
import { copyFilterRules, validateFilterGroup } from '../shared/filtering';
import { validateReferenceValues } from '../shared/references';

/** 标识符始终作为标识符引用，不允许空值、NUL 或超过 MySQL 限制的名称。 */
export function identifier(value: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 64 || value.includes('\0')) throw new Error('数据库对象名称必须为 1～64 个字符且不能包含 NUL');
  return '`' + value.replaceAll('`', '``') + '`';
}
/** 数据库名与对象名分别引用，避免名称内的点号被误当作层级分隔符。 */
export const qualified = (database: string, table: string): string => `${identifier(database)}.${identifier(table)}`;

/** SQL 文本生成同时适配 NO_BACKSLASH_ESCAPES；执行数据写入仍使用预处理参数。 */
export function stringLiteral(value: string, noBackslashEscapes = false): string {
  if (value.includes('\0')) throw new Error('DDL 文本不能包含 NUL');
  return "'" + (noBackslashEscapes ? value : value.replaceAll('\\', '\\\\')).replaceAll("'", "''") + "'";
}

/** MariaDB 元数据用 SQL 引号区分文字量与表达式，界面编辑值必须先解码文字量。 */
export function mariaDefault(value: string | null, noBackslashEscapes = false): string | null {
  if (value === null || value === 'NULL') return null;
  if (!(value.startsWith("'") && value.endsWith("'"))) return value;
  const body = value.slice(1, -1); let result = '';
  const escapes: Record<string, string> = { '0': '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a' };
  for (let index = 0; index < body.length; index++) {
    if (body[index] === "'" && body[index + 1] === "'") { result += "'"; index++; }
    else if (body[index] === '\\' && !noBackslashEscapes && index + 1 < body.length) {
      const next = body[++index]; result += next === '%' || next === '_' ? '\\' + next : (escapes[next] ?? next);
    } else result += body[index];
  }
  return result;
}
/** 仅识别设计器支持的时间默认值表达式，不放行任意 SQL 函数。 */
export function temporalDefault(value: string | null): boolean { return value !== null && /^(?:CURRENT_TIMESTAMP(?:\([0-6]?\))?|CURRENT_DATE(?:\(\))?|CURRENT_TIME(?:\([0-6]?\))?)$/i.test(value); }

/** Buffer 通过显式包装跨进程传递；精确数值及日期由驱动直接返回字符串。 */
export function serializeCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return { type: 'binary', base64: value.toString('base64') };
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) throw new Error('驱动返回了 Date，必须开启 dateStrings 以避免时区和精度变化');
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return JSON.stringify(value);
}
/** 将跨进程二进制包装还原为驱动参数，其余精确字符串保持不变。 */
export function deserializeCell(value: CellValue): string | number | boolean | null | Buffer {
  if (value && typeof value === 'object' && value.type === 'binary') return Buffer.from(value.base64, 'base64');
  return value as string | number | boolean | null;
}

/** 范围采用原文 UTF-16 半开区间；客户端分隔符不属于真正发送的 SQL。 */
export interface SqlStatementRange { sql: string; start: number; end: number; delimiterStart: number; delimiterEnd: number; delimiter: string | null; }
export interface SqlLocatedStatement { sql: string; sourceRange?: { start: number; end: number }; }

/** 支持跨块、跨行字符串与 DELIMITER 指令，导入脚本时只保留当前语句。 */
export class SqlScriptScanner {
  private pending = '';
  private statement = '';
  private delimiter = ';';
  private state: 'normal' | 'single' | 'double' | 'identifier' | 'block' = 'normal';
  private hasCode = false;
  private atLineStart = true;
  private alternates: SqlScriptScanner[] = [];
  private pendingOffset = 0;
  private statementOffset = 0;
  /** 使用当前会话的反斜线模式初始化扫描器，避免字符串边界判断错误。 */
  constructor(private noBackslashEscapes = false, private ansiQuotes = false, ansiQuotesKnown = true, noBackslashEscapesKnown = true) {
    if (!ansiQuotesKnown || !noBackslashEscapesKnown) this.setMode(noBackslashEscapes, ansiQuotes, ansiQuotesKnown, noBackslashEscapesKnown);
  }

  /** 仅在语句边界更新模式；尚未消费的尾部保留到读取下一条语句时再解释。 */
  setMode(noBackslashEscapes: boolean, ansiQuotes = false, ansiQuotesKnown = true, noBackslashEscapesKnown = true): void {
    if (this.hasCode || this.state !== 'normal') throw new Error('不能在 SQL 语句中途改变词法模式');
    this.noBackslashEscapes = noBackslashEscapesKnown ? noBackslashEscapes : false; this.ansiQuotes = ansiQuotesKnown ? ansiQuotes : false;
    this.alternates = [];
    for (const escapes of noBackslashEscapesKnown ? [noBackslashEscapes] : [false, true]) {
      for (const quotes of ansiQuotesKnown ? [ansiQuotes] : [false, true]) {
        if (escapes === this.noBackslashEscapes && quotes === this.ansiQuotes) continue;
        const alternate = new SqlScriptScanner(escapes, quotes);
        alternate.pending = this.pending; alternate.statement = this.statement; alternate.delimiter = this.delimiter;
        alternate.state = this.state; alternate.hasCode = this.hasCode; alternate.atLineStart = this.atLineStart;
        alternate.pendingOffset = this.pendingOffset; alternate.statementOffset = this.statementOffset;
        this.alternates.push(alternate);
      }
    }
  }

  /** 消费一个文本块；仅在 final 时接收末尾无分隔符语句并检查未闭合状态。 */
  push(chunk: string, final = false, maxStatements = Infinity): string[] {
    return this.scan(chunk, final, maxStatements, false).map(statement => statement.sql);
  }

  /** 与原脚本扫描共用词法状态；未知模式时连原文偏移也必须完全一致。 */
  pushRanges(chunk: string, final = false, maxStatements = Infinity): SqlStatementRange[] {
    return this.scan(chunk, final, maxStatements, true);
  }

  /** 执行仍只要求原push的SQL文字一致；原文位置有歧义时省略范围，绝不强化成新的执行拒绝。 */
  pushLocated(chunk: string, final = false, maxStatements = Infinity): SqlLocatedStatement[] {
    const located = (range: SqlStatementRange): SqlLocatedStatement => ({ sql: range.sql, sourceRange: { start: range.start, end: range.end } });
    if (!this.alternates.length) return this.consume(chunk, final, maxStatements).map(located);
    try {
      const result = this.consume(chunk, final, maxStatements), output = result.map(located);
      const text = JSON.stringify(result.map(range => range.sql));
      for (const alternate of this.alternates) {
        const candidate = alternate.consume(chunk, final, maxStatements);
        if (text !== JSON.stringify(candidate.map(range => range.sql))) throw new Error('语句边界不同');
        for (let index = 0; index < result.length; index++) if (candidate[index].start !== result[index].start || candidate[index].end !== result[index].end) delete output[index].sourceRange;
      }
      return output;
    } catch { throw new Error('无法确定会话 SQL 引号模式，当前 SQL 的语句边界存在歧义；请关闭此标签并新建查询重新连接'); }
  }

  /** 原 push 仍比较实际 SQL；范围入口额外拒绝“文字相同但所在位置不同”的歧义。 */
  private scan(chunk: string, final: boolean, maxStatements: number, compareRanges: boolean): SqlStatementRange[] {
    if (!this.alternates.length) return this.consume(chunk, final, maxStatements);
    try {
      const result = this.consume(chunk, final, maxStatements);
      const comparable = (ranges: SqlStatementRange[]) => JSON.stringify(compareRanges ? ranges : ranges.map(range => range.sql));
      for (const alternate of this.alternates) if (comparable(result) !== comparable(alternate.consume(chunk, final, maxStatements))) throw new Error('语句边界不同');
      return result;
    } catch { throw new Error('无法确定会话 SQL 引号模式，当前 SQL 的语句边界存在歧义；请关闭此标签并新建查询重新连接'); }
  }

  /** 不确定模式时两个扫描状态分别保留跨块上下文，只有边界一致的完整语句才能交给服务器。 */
  private consume(chunk: string, final: boolean, maxStatements: number): SqlStatementRange[] {
    if (maxStatements < 1) throw new Error('每次至少允许取出一条 SQL');
    this.pending += chunk;
    const statements: SqlStatementRange[] = [];
    let lineEnd: number;
    while ((lineEnd = this.pending.indexOf('\n')) >= 0 || (final && this.pending.length)) {
      const length = lineEnd >= 0 ? lineEnd + 1 : this.pending.length;
      const consumed = this.line(this.pending.slice(0, length), statements, maxStatements);
      this.atLineStart = consumed === length && this.pending[consumed - 1] === '\n';
      this.pending = this.pending.slice(consumed);
      this.pendingOffset += consumed;
      if (statements.length >= maxStatements) return statements;
    }
    if (final) {
      if (this.state !== 'normal') throw new Error('SQL 脚本中存在未闭合的引号或注释');
      if (this.statement.length > 64 * 1024 * 1024) throw new Error('单条 SQL 不能超过 64 MiB');
      this.emitStatement(statements, this.pendingOffset, this.pendingOffset, null);
      this.statement = '';
      this.hasCode = false;
      this.statementOffset = this.pendingOffset;
    }
    if (this.statement.length + this.pending.length > 64 * 1024 * 1024) throw new Error('单条 SQL 不能超过 64 MiB');
    return statements;
  }

  /** 语句只做首尾 trim，正文始终是源文本的连续切片，不用 indexOf 猜重复 SQL 的位置。 */
  private emitStatement(output: SqlStatementRange[], delimiterStart: number, delimiterEnd: number, delimiter: string | null): void {
    if (!this.hasCode) return;
    const sql = this.statement.trim(), start = this.statementOffset + this.statement.length - this.statement.trimStart().length;
    output.push({ sql, start, end: start + sql.length, delimiterStart, delimiterEnd, delimiter });
  }

  /** 按行识别客户端 DELIMITER 指令，字符串和注释内的分隔符不结束语句。 */
  private line(line: string, output: SqlStatementRange[], maxStatements: number): number {
    const directive = this.atLineStart && this.state === 'normal' && !this.hasCode ? /^\s*DELIMITER\s+(\S+)\s*$/i.exec(line) : null;
    if (directive) {
      if (directive[1].length > 16 || /["'`\\]/.test(directive[1])) throw new Error('DELIMITER 必须是至多 16 个字符的非引号分隔符');
      this.delimiter = directive[1];
      this.statement = '';
      this.statementOffset = this.pendingOffset + line.length;
      return line.length;
    }
    for (let i = 0; i < line.length; i++) {
      const char = line[i], next = line[i + 1];
      if (this.state === 'block') {
        this.statement += char;
        if (char === '*' && next === '/') { this.statement += next; i++; this.state = 'normal'; }
        continue;
      }
      if (this.state !== 'normal') {
        this.statement += char;
        const quote = this.state === 'single' ? "'" : this.state === 'double' ? '"' : '`';
        if (char === '\\' && !this.noBackslashEscapes && this.state !== 'identifier' && !(this.state === 'double' && this.ansiQuotes)) { if (next !== undefined) { this.statement += next; i++; } }
        else if (char === quote) {
          if (next === quote) { this.statement += next; i++; }
          else this.state = 'normal';
        }
        continue;
      }
      if (line.startsWith(this.delimiter, i)) {
        if (this.statement.length > 64 * 1024 * 1024) throw new Error('单条 SQL 不能超过 64 MiB');
        this.emitStatement(output, this.pendingOffset + i, this.pendingOffset + i + this.delimiter.length, this.delimiter);
        this.statement = ''; this.hasCode = false; i += this.delimiter.length - 1;
        this.statementOffset = this.pendingOffset + i + 1;
        if (output.length >= maxStatements) return i + 1;
        continue;
      }
      if (char === '#' || (char === '-' && next === '-' && /[\x00-\x20\x7f]/.test(line[i + 2] ?? ' '))) { this.statement += line.slice(i); return line.length; }
      if (char === '/' && next === '*') {
        if (line[i + 2] === '!' || line.slice(i + 2, i + 4) === 'M!') this.hasCode = true;
        this.statement += '/*'; i++; this.state = 'block'; continue;
      }
      if (char === "'") this.state = 'single';
      else if (char === '"') this.state = 'double';
      else if (char === '`') this.state = 'identifier';
      if (!/\s/.test(char)) this.hasCode = true;
      this.statement += char;
      if (this.statement.length > 64 * 1024 * 1024) throw new Error('单条 SQL 不能超过 64 MiB');
    }
    return line.length;
  }
}
/** 对编辑器已有的完整文本执行同一套扫描规则，不另建简化版分号切分逻辑。 */
export function splitSql(sql: string, noBackslashEscapes = false, ansiQuotes = false, ansiQuotesKnown = true, noBackslashEscapesKnown = true): string[] { return new SqlScriptScanner(noBackslashEscapes, ansiQuotes, ansiQuotesKnown, noBackslashEscapesKnown).push(sql, true); }

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
export function buildTableFilterSql(info: TableInfo, filters: FilterRule[], filterMode: FilterMode = 'all', filterGroup?: FilterGroup): { where: string | undefined; params: CellValue[] } {
  const admitted=copyFilterRules(filters),group=validateFilterGroup(admitted,filterMode,filterGroup);
  const columns = new Map(info.columns.map(column => [column.name, column]));
  const params: CellValue[] = [];
  // 停用只排除谓词及参数；目录校验和总预算仍覆盖保留的所有条件。
  for (const filter of admitted) if (!columns.has(filter.column)) throw new Error(`未知筛选字段：${filter.column}`);
  /** 叶参数在实际遍历到该叶时才绑定，嵌套分组保持DFS顺序及原精确占位符。 */
  const clause = (filter:FilterRule):string => {
    const metadata = columns.get(filter.column);
    if (!metadata) throw new Error(`未知筛选字段：${filter.column}`);
    const column = identifier(filter.column);
    if (filter.operator === 'IS NULL' || filter.operator === 'IS NOT NULL') return `${column} ${filter.operator}`;
    /** 参数按条件原顺序加入，不拆分逗号、裁剪空白或转换为 JavaScript 数值。 */
    const parameter = (value: string) => { const sql = filterParameter(metadata, value, filter.operator === 'LIKE' || filter.operator === 'NOT LIKE'); params.push(value); return sql; };
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

/** 排序与筛选严格使用元数据白名单，值独立绑定；原表页SQL字节模板保持。 */
export function buildPageSql(info: TableInfo, page: number, pageSize: number, filters: FilterRule[], sort: SortRule[], filterMode: FilterMode = 'all', filterGroup?:FilterGroup): { sql: string; params: CellValue[] } {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000 || !Number.isSafeInteger((page - 1) * pageSize)) throw new Error('分页参数无效，页号范围为 1～10000000，页大小范围为 1～1000');
  if (!Array.isArray(sort) || sort.length > 20) throw new Error('排序规则不能超过 20 条');
  const { where, params } = buildTableFilterSql(info, filters, filterMode, filterGroup), columns = new Map(info.columns.map(column => [column.name, column]));
  // 非唯一排序补上可靠行键作为并列项顺序，避免跳页时相同排序值的行随机换位。
  const order = [...sort, ...info.editableKey.filter(column => !sort.some(rule => rule.column === column)).map(column => ({ column, direction: 'ASC' as const }))];
  const orderSql = order.map(rule => {
    if (!columns.has(rule.column) || !['ASC', 'DESC'].includes(rule.direction)) throw new Error('排序字段或方向无效');
    return `${identifier(rule.column)} ${rule.direction}`;
  }).join(', ');
  return { sql: `SELECT * FROM ${qualified(info.database, info.name)}${where?' WHERE '+where:''}${orderSql ? ' ORDER BY ' + orderSql : ''} LIMIT ${pageSize + 1} OFFSET ${(page - 1) * pageSize}`, params };
}

/** 全旧值比较避免丢失更新；唯一键是可靠定位的必要条件，不能仅凭 LIMIT 1 写入。 */
export function buildChanges(info: TableInfo, changes: RowChange[]): SqlPreview {
  if (info.engine.toUpperCase() !== 'INNODB') throw new Error('仅允许对 InnoDB 事务表集中提交修改');
  if (!info.editableKey.length) throw new Error('此表没有全部非空的主键或唯一键，数据仅可读取');
  const columns = new Map(info.columns.map(column => [column.name, column]));
  const table = qualified(info.database, info.name);
  const statements: SqlPreview['statements'] = [];
  for (const change of changes) {
    const params: CellValue[] = [];
    const values = change.kind === 'delete' ? [] : Object.entries(change.values);
    for (const [name] of values) {
      const column = columns.get(name);
      if (!column) throw new Error(`未知字段：${name}`);
      if (column.generated) throw new Error(`生成列不能手动赋值：${name}`);
    }
    if (change.kind === 'insert') {
      statements.push({ sql: values.length ? `INSERT INTO ${table} (${values.map(([name]) => identifier(name)).join(', ')}) VALUES (${values.map(([name, value]) => typedCellPlaceholder(columns.get(name)!, value)).join(', ')})` : `INSERT INTO ${table} () VALUES ()`, params: values.map(([, value]) => value) });
      continue;
    }
    if (change.kind === 'update' && !values.length) continue;
    for (const name of columns.keys()) if (!Object.hasOwn(change.before, name)) throw new Error(`缺少完整原始行：${name}，请刷新数据后重试`);
    for (const name of info.editableKey) if (change.before[name] === null || change.before[name] === undefined) throw new Error('原始行唯一键不得为空');
    // 键条件保持可用索引；全文本旧值另做精确比较，不受 CI/AI/PAD SPACE 排序规则影响。
    const keyClauses = info.editableKey.map(name => { params.push(change.before[name]); return `${identifier(name)} <=> ${typedCellPlaceholder(columns.get(name)!, change.before[name])}`; });
    // 非文本可靠键已由同一before值精确定位；实测部分版本重复大整数条件会异常不命中，去重避免该路径。
    // 文本键的索引比较受CI/AI/PAD SPACE影响，仍须保留下面独立的UTF-8字节旧值检查。
    const originalClauses = [...columns.values()].filter(column => !info.editableKey.includes(column.name) || /^(?:CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|ENUM|SET|JSON)\b/i.test(column.type)).map(column => {
      params.push(change.before[column.name]);
      // 先统一到连接字符集再取字节，否则 latin1 的 é 与 UTF-8 参数会产生假冲突。
      if (/^(?:CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|ENUM|SET|JSON)\b/i.test(column.type)) {
        return `BINARY CONVERT(${identifier(column.name)} USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4)`;
      }
      // BLOB/二进制列原生比较已按字节执行；数值和日期维持服务器自身的类型语义。
      return `${identifier(column.name)} <=> ${typedCellPlaceholder(column, change.before[column.name])}`;
    });
    const where = [...keyClauses, ...originalClauses].join(' AND ');
    if (change.kind === 'delete') statements.push({ sql: `DELETE FROM ${table} WHERE ${where}`, params });
    else statements.push({ sql: `UPDATE ${table} SET ${values.map(([name, value]) => `${identifier(name)} = ${typedCellPlaceholder(columns.get(name)!, value)}`).join(', ')} WHERE ${where}`, params: [...values.map(([, value]) => value), ...params] });
  }
  return { sql: statements.map(statement => statement.sql + ';\n-- 参数：' + JSON.stringify(statement.params)).join('\n\n'), statements, warnings: ['提交时在同一事务内校验完整原始行；并发冲突会回滚整批修改。'] };
}

/** BIT 的驱动 Buffer 是位字节而非整数文本；赋值、定位和乐观锁必须统一按无符号整数解码。 */
export function typedCellPlaceholder(column: ColumnInfo, value: CellValue): string {
  if (value === null || !/^BIT\b/i.test(column.type)) return '?';
  const width = Number(/^BIT\((\d+)\)/i.exec(column.type)?.[1] ?? 1);
  if (!Number.isInteger(width) || width < 1 || width > 64) throw new Error(`字段 ${column.name} 的 BIT 声明宽度无效`);
  const maximum = (1n << BigInt(width)) - 1n;
  if (typeof value === 'object') {
    validateReferenceValues([value]);
    const bytes = Buffer.from(value.base64, 'base64');
    if (!bytes.length || bytes.length > Math.ceil(width / 8) || BigInt('0x' + bytes.toString('hex')) > maximum) throw new Error(`字段 ${column.name} 的二进制值超过 BIT(${width}) 位范围或缺少位字节`);
    return 'CAST(CONV(HEX(?),16,10) AS UNSIGNED)';
  }
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error(`字段 ${column.name} 的 BIT 数值必须使用精确字符串或安全整数`);
  const text = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
  if (!/^\d+$/.test(text) || BigInt(text) > maximum) throw new Error(`字段 ${column.name} 的值必须在 BIT(${width}) 无符号整数范围内`);
  // MySQL 8.4 已复现预处理参数先按有符号整数推断，最大 BIT64 因而钳到 2^63-1。
  // 显式十进制定型必须在转无符号之前完成；仍传原始参数，不经过 JavaScript Number。
  return 'CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED)';
}

/** 类型只接收受支持的类型语法，不接收任意 SQL 片段。 */
export function columnType(value: string): string {
  const type = value.trim();
  if (/^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|BIT|BOOL|BOOLEAN)(?:\(\d{1,5}(?:\s*,\s*\d{1,5})?\))?(?:\s+UNSIGNED)?(?:\s+ZEROFILL)?$/i.test(type) || /^(?:CHAR|VARCHAR|BINARY|VARBINARY)\(\d{1,5}\)$/i.test(type) || /^(?:DATE|YEAR|TIME|DATETIME|TIMESTAMP)(?:\([0-6]\))?$/i.test(type) || /^(?:TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB|JSON|GEOMETRY|POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)$/i.test(type)) return type.toUpperCase();
  if (/^(?:ENUM|SET)\(\s*'(?:[^'\\]|'')*'(?:\s*,\s*'(?:[^'\\]|'')*')*\s*\)$/i.test(type)) return type;
  throw new Error(`字段类型不受支持或包含非法 SQL：${value}`);
}

/** 新旧设计共用同一列渲染规则，默认值及类型处理不能因索引入口分叉。 */
function renderDesignColumn(column: TableDesign['columns'][number] & TableCreateTimeColumn, noBackslashEscapes: boolean, provenEncoding?: { charset: string; collation: string }): string {
  if (Object.hasOwn(column, 'generated')) throw Error('生成列必须使用新表专属已编译计划，普通字段渲染不能丢弃生成表达式');
  if (Object.hasOwn(column, 'collation') && !provenEncoding) throw Error(tableCreateColumnEncodingMessages.legacy);
  let sql = `${identifier(column.name)} ${columnType(column.type)}${provenEncoding ? ` CHARACTER SET ${provenEncoding.charset} COLLATE ${provenEncoding.collation}` : ''} ${column.nullable ? 'NULL' : 'NOT NULL'}`;
  if (column.defaultValue !== undefined) {
    const value = column.defaultValue;
    sql += ' DEFAULT ' + (value === null ? 'NULL' : /^(?:DATE|DATETIME|TIMESTAMP|TIME)\b/i.test(column.type) && temporalDefault(value) ? value.toUpperCase() : stringLiteral(value, noBackslashEscapes));
  }
  if (column.autoIncrement) sql += ' AUTO_INCREMENT';
  sql += tableCreateOnUpdateSql(column);
  if (column.comment) sql += ' COMMENT ' + stringLiteral(column.comment, noBackslashEscapes);
  return sql;
}

/** 普通与生成新表共用同一键/外键渲染，名称、列映射与动作校验不能因入口分叉。 */
function renderDesignConstraints(design: Pick<TableDesign, 'indexes' | 'foreignKeys'>, names: ReadonlySet<string>) {
  const localColumns = (items: string[]) => {
    if (!items.length || new Set(items).size !== items.length || items.some(name => !names.has(name))) throw new Error('索引或外键包含空、重复或不存在的字段');
    return items.map(identifier).join(', ');
  };
  if (new Set(design.indexes.map(index => index.name)).size !== design.indexes.length) throw new Error('索引名称重复');
  if (new Set(design.foreignKeys.map(key => key.name)).size !== design.foreignKeys.length) throw new Error('外键名称重复');
  const indexes = design.indexes.map(index => index.name === 'PRIMARY' ? `PRIMARY KEY (${localColumns(index.columns)})` : `${index.unique ? 'UNIQUE ' : ''}KEY ${identifier(index.name)} (${localColumns(index.columns)})`);
  const foreignKeys = design.foreignKeys.map(key => {
    if (key.columns.length !== key.referencedColumns.length || !key.columns.length) throw new Error('外键与引用字段数量必须一致');
    if (![key.onDelete, key.onUpdate].every(action => ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'].includes(action.toUpperCase()))) throw new Error('外键动作无效');
    return `CONSTRAINT ${identifier(key.name)} FOREIGN KEY (${localColumns(key.columns)}) REFERENCES ${qualified(key.referencedDatabase, key.referencedTable)} (${key.referencedColumns.map(identifier).join(', ')}) ON DELETE ${key.onDelete.toUpperCase()} ON UPDATE ${key.onUpdate.toUpperCase()}`;
  });
  return { indexes, foreignKeys };
}

/** 以完整设计和现状生成结构差异；保留未变索引/外键，同名外键修改明确分步预览。 */
export function buildDesign(design: TableDesign, original?: TableInfo, noBackslashEscapes = false, newTableEncoding?: { charset: string; collation: string }): SqlPreview {
  if (design.columns.some(column => Object.hasOwn(column, 'collation'))) throw Error(tableCreateColumnEncodingMessages.legacy);
  if (design.columns.some(column => Object.hasOwn(column, 'generated'))) throw Error('生成列不能进入旧整表生成器；请使用新建表专属生成计划');
  // 新键只属于新表专属合同，旧整表ALTER不能借额外属性扩展写能力。
  if ((original || design.originalName !== undefined) && design.columns.some(column => Object.hasOwn(column, 'onUpdate'))) throw Error('新表自动更新时间不能用于旧整表ALTER入口');
  // 仅新建用途可传显式配对；已有表即便误传也拒绝，不转成ALTER或数据编码转换。
  if (newTableEncoding && (original || design.originalName !== undefined || newTableEncoding.charset !== design.charset || typeof newTableEncoding.collation !== 'string' || !/^[A-Za-z0-9_]{1,255}$/.test(newTableEncoding.collation))) throw new Error('显式新表编码选项无效或用于已有对象');
  if (!design.columns.length) throw new Error('表至少需要一个字段');
  const names = new Set(design.columns.map(column => column.name));
  if (names.size !== design.columns.length) throw new Error('字段名重复');
  if (!['INNODB', 'MYISAM', 'MEMORY', 'ARIA', 'ARCHIVE', 'CSV'].includes(design.engine.toUpperCase())) throw new Error('不支持的存储引擎');
  if (!/^[a-zA-Z0-9_]+$/.test(design.charset)) throw new Error('字符集名称无效');
  const literal = (value: string) => stringLiteral(value, noBackslashEscapes);
  /** 先验证类型，再生成列定义；文本字段的时间样式默认值仍按文字量处理。 */
  const columnSql = (column: TableDesign['columns'][number]) => renderDesignColumn(column, noBackslashEscapes);
  const { indexes, foreignKeys } = renderDesignConstraints(design, names);
  const preserveCollation = newTableEncoding?.collation ?? (original?.charset === design.charset ? original.collation : undefined);
  if (preserveCollation && !/^[a-zA-Z0-9_]+$/.test(preserveCollation)) throw new Error('原表排序规则名称无效');
  const options = `ENGINE=${design.engine.toUpperCase()} DEFAULT CHARACTER SET=${design.charset}${preserveCollation ? ' COLLATE=' + preserveCollation : ''} COMMENT=${literal(design.comment)}`;
  let sql: string;
  const preliminary: string[] = [];
  if (!original) sql = `CREATE TABLE ${qualified(design.database, design.name)} (\n  ${[...design.columns.map(columnSql), ...indexes, ...foreignKeys].join(',\n  ')}\n) ${options}`;
  else {
    if (original.columns.some(column => column.generated)) throw new Error('含生成列的表请通过 SQL 定义编辑，避免设计器丢失生成表达式');
    const oldNames = new Set(original.columns.map(column => column.name));
    const retained = new Set(design.columns.map(column => column.originalName ?? column.name));
    // 字段改名由服务器同步更新索引/FK的本表列引用，等价设计无需删除重建。
    const renamed = new Map(design.columns.map(column => [column.originalName ?? column.name, column.name]));
    const sameColumns = (left: string[], right: string[]) => left.length === right.length && left.every((name, index) => (renamed.get(name) ?? name) === right[index]);
    const unchangedIndexes = new Set(original.indexes.filter(old => design.indexes.some(next => next.name === old.name && next.unique === old.unique && sameColumns(old.columns, next.columns))).map(index => index.name));
    const unchangedForeignKeys = new Set(original.foreignKeys.filter(old => design.foreignKeys.some(next => next.name === old.name && sameColumns(old.columns, next.columns) && next.referencedDatabase === old.referencedDatabase && next.referencedTable === old.referencedTable && JSON.stringify(next.referencedColumns) === JSON.stringify(old.referencedColumns) && next.onUpdate.toUpperCase() === old.onUpdate.toUpperCase() && next.onDelete.toUpperCase() === old.onDelete.toUpperCase())).map(key => key.name));
    const removedForeignKeys = original.foreignKeys.filter(key => !unchangedForeignKeys.has(key.name));
    const reusedNames = removedForeignKeys.filter(key => design.foreignKeys.some(next => next.name === key.name));
    // MySQL 同一 ALTER 内 DROP/ADD 同名 FK 会报重复；先单独删除，并在预览中说明非原子边界。
    if (reusedNames.length) preliminary.push(`ALTER TABLE ${qualified(design.database, original.name)}\n  ${reusedNames.map(key => `DROP FOREIGN KEY ${identifier(key.name)}`).join(',\n  ')}`);
    const changes: string[] = [
      ...removedForeignKeys.filter(key => !reusedNames.includes(key)).map(key => `DROP FOREIGN KEY ${identifier(key.name)}`),
      ...original.indexes.filter(index => !unchangedIndexes.has(index.name)).map(index => index.name === 'PRIMARY' ? 'DROP PRIMARY KEY' : `DROP INDEX ${identifier(index.name)}`),
    ];
    for (const column of original.columns) if (!retained.has(column.name)) changes.push(`DROP COLUMN ${identifier(column.name)}`);
    design.columns.forEach((column, index) => {
      const oldName = column.originalName ?? column.name;
      const action = oldNames.has(oldName) ? `CHANGE COLUMN ${identifier(oldName)}` : 'ADD COLUMN';
      changes.push(`${action} ${columnSql(column)}${index ? ' AFTER ' + identifier(design.columns[index - 1].name) : ' FIRST'}`);
    });
    changes.push(...indexes.filter((_, index) => !unchangedIndexes.has(design.indexes[index].name)).map(index => 'ADD ' + index), ...foreignKeys.filter((_, index) => !unchangedForeignKeys.has(design.foreignKeys[index].name)).map(key => 'ADD ' + key), options);
    if (design.name !== original.name) changes.push(`RENAME TO ${qualified(design.database, design.name)}`);
    sql = `ALTER TABLE ${qualified(design.database, original.name)}\n  ${changes.join(',\n  ')}`;
  }
  const statements = [...preliminary, sql].map(statement => ({ sql: statement, params: [] }));
  const warnings = original ? ['MySQL/MariaDB 的 DDL 通常会隐式提交，执行后不能通过事务回滚。', '仅删除或重建已变更的索引和外键；请检查预览中的结构差异。'] : [];
  if (preliminary.length) warnings.push('同名外键的修改需要分两条 ALTER 执行：第一条删除旧外键，第二条修改表并添加新外键。若第二条失败或操作被取消，旧外键已删除，需按原定义恢复；执行期间应暂停相关写入。');
  return { sql: statements.map(statement => statement.sql + ';').join('\n\n'), statements, warnings };
}

/** 前缀只从结构化计划渲染；不接受rawSQL，不替换旧生成结果，公共buildDesign接口保持。 */
export function buildPrefixTableDesign(input: TableCreateDraft, facts: TableCreatePrefixFacts, noBackslashEscapes = false, encoding?: { charset: string; collation: string }, columnCatalog?: TableCreateEncodingCatalog): SqlPreview {
  const design = tableCreateDraftSchema.parse(input), plan = planTableCreateIndexes(design, facts);
  if (tableCreateHasColumnEncoding(design)) planTableCreateColumnEncodings(design, columnCatalog);
  if (design.columns.some(column => Object.hasOwn(column, 'generated'))) throw Error('带生成列的前缀新表必须使用专属生成计划');
  if (encoding && (encoding.charset !== design.charset || !/^[A-Za-z0-9_]{1,255}$/.test(encoding.collation))) throw Error('新表编码配对无效');
  const indexes = plan.indexes.map(index => {
    const parts = index.keyParts.map(part => identifier(part.columnName) + (part.prefixLength === undefined ? '' : `(${part.prefixLength})`)).join(', ');
    return index.name === 'PRIMARY' ? `PRIMARY KEY (${parts})` : `${index.unique ? 'UNIQUE ' : ''}KEY ${identifier(index.name)} (${parts})`;
  });
  const sql = `CREATE TABLE ${qualified(design.database, design.name)} (\n  ${[...design.columns.map(column => renderDesignColumn(column, noBackslashEscapes, column.collation)), ...indexes].join(',\n  ')}\n) ENGINE=INNODB DEFAULT CHARACTER SET=${design.charset}${encoding ? ' COLLATE=' + encoding.collation : ''} ROW_FORMAT=DYNAMIC COMMENT=${stringLiteral(design.comment, noBackslashEscapes)}`;
  return { sql: sql + ';', statements: [{ sql, params: [] }], warnings: [] };
}

/** 列配对从完整目录重新规划；独立生成整条CREATE，绝不替换旧SQL或丢弃新字段。 */
export function buildColumnEncodedTableDesign(input: TableCreateDraft, catalog: TableCreateEncodingCatalog, noBackslashEscapes = false, encoding?: { charset: string; collation: string }): SqlPreview {
  const design = tableCreateDraftSchema.parse(input); planTableCreateColumnEncodings(design, catalog);
  if (!tableCreateHasColumnEncoding(design) || tableCreateHasPrefix(design) || design.columns.some(column => Object.hasOwn(column, 'generated'))) throw Error(tableCreateColumnEncodingMessages.legacy);
  const names = new Set(design.columns.map(column => column.name));
  if (names.size !== design.columns.length || !['INNODB', 'MYISAM', 'MEMORY', 'ARIA', 'ARCHIVE', 'CSV'].includes(design.engine.toUpperCase()) || !/^[A-Za-z0-9_]{1,64}$/.test(design.charset) || encoding && (encoding.charset !== design.charset || !/^[A-Za-z0-9_]{1,255}$/.test(encoding.collation))) throw Error('新表字段编码设计或表选项无效');
  const { indexes, foreignKeys } = renderDesignConstraints({ indexes: design.indexes.map(index => ({ name: index.name, unique: index.unique, columns: tableCreateIndexParts(index).map(part => part.columnName) })), foreignKeys: design.foreignKeys }, names);
  const sql = `CREATE TABLE ${qualified(design.database, design.name)} (\n  ${[...design.columns.map(column => renderDesignColumn(column, noBackslashEscapes, column.collation)), ...indexes, ...foreignKeys].join(',\n  ')}\n) ENGINE=${design.engine.toUpperCase()} DEFAULT CHARACTER SET=${design.charset}${encoding ? ' COLLATE=' + encoding.collation : ''} COMMENT=${stringLiteral(design.comment, noBackslashEscapes)}`;
  if (Buffer.byteLength(sql) > 4 * 1024 * 1024 || splitSql(sql, noBackslashEscapes).length !== 1) throw Error('新表字段编码SQL超过预算或不是单条CREATE');
  return { sql: sql + ';', statements: [{ sql, params: [] }], warnings: [] };
}

/** 生成列只取受控AST编译结果；普通列和键仍走原渲染，不替换legacy SQL字符串或降级丢属性。 */
export function buildGeneratedTableDesign(input: TableCreateDraft, facts: TableCreateGeneratedFacts, noBackslashEscapes = false, encoding?: { charset: string; collation: string }, prefixFacts?: TableCreatePrefixFacts, columnCatalog?: TableCreateEncodingCatalog): SqlPreview {
  const design = tableCreateDraftSchema.parse(input), generated = planTableCreateGeneratedColumns(design, facts), names = new Set(design.columns.map(column => column.name));
  if (tableCreateHasColumnEncoding(design)) planTableCreateColumnEncodings(design, columnCatalog);
  if (!generated.columns.length || names.size !== design.columns.length || design.engine.toUpperCase() !== 'INNODB' || !/^[A-Za-z0-9_]+$/.test(design.charset)) throw Error('生成新表设计、引擎或字符集无效');
  if (encoding && (encoding.charset !== design.charset || !/^[A-Za-z0-9_]{1,255}$/.test(encoding.collation))) throw Error('生成新表编码配对无效');
  const prefix = tableCreateHasPrefix(design); if (prefix && !prefixFacts) throw Error('生成新表缺少实际前缀能力');
  const indexPlan = prefix ? planTableCreateIndexes(design, prefixFacts!) : undefined;
  const { indexes: ordinaryIndexes, foreignKeys } = renderDesignConstraints({ indexes: design.indexes.map(index => ({ name: index.name, unique: index.unique, columns: tableCreateIndexParts(index).map(part => part.columnName) })), foreignKeys: design.foreignKeys }, names);
  const indexes = indexPlan ? indexPlan.indexes.map(index => { const parts = index.keyParts.map(part => identifier(part.columnName) + (part.prefixLength === undefined ? '' : `(${part.prefixLength})`)).join(', '); return index.name === 'PRIMARY' ? `PRIMARY KEY (${parts})` : `${index.unique ? 'UNIQUE ' : ''}KEY ${identifier(index.name)} (${parts})`; }) : ordinaryIndexes;
  const columns = design.columns.map((column, ordinal) => {
    const value = generated.columns.find(value => value.ordinal === ordinal && value.name === column.name);
    if (!column.generated) { if (value) throw Error('普通新表列混入生成计划'); return renderDesignColumn(column, noBackslashEscapes, column.collation); }
    if (!value || value.storage !== column.generated.storage) throw Error('生成新表列与已编译计划不一致');
    return `${identifier(column.name)} ${columnType(column.type)} GENERATED ALWAYS AS (${value.sql}) ${value.storage}${column.comment ? ' COMMENT ' + stringLiteral(column.comment, noBackslashEscapes) : ''}`;
  });
  const sql = `CREATE TABLE ${qualified(design.database, design.name)} (\n  ${[...columns, ...indexes, ...foreignKeys].join(',\n  ')}\n) ENGINE=INNODB DEFAULT CHARACTER SET=${design.charset}${encoding ? ' COLLATE=' + encoding.collation : ''}${prefix ? ' ROW_FORMAT=DYNAMIC' : ''} COMMENT=${stringLiteral(design.comment, noBackslashEscapes)}`;
  if (Buffer.byteLength(sql) > 4 * 1024 * 1024 || splitSql(sql, noBackslashEscapes).length !== 1) throw Error('生成新表SQL超过预算或不是单条CREATE');
  return { sql: sql + ';', statements: [{ sql, params: [] }], warnings: [] };
}

/** SQL 导出使用十六进制文字量，避免字符集、反斜线模式和二进制数据改变原值。 */
export function exportLiteral(value: CellValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('不能导出非有限数字'); return String(value); }
  if (typeof value === 'object') return `X'${Buffer.from(value.base64, 'base64').toString('hex')}'`;
  return `_utf8mb4 X'${Buffer.from(value, 'utf8').toString('hex')}'`;
}

/** 把受控模板的值占位符变成模式无关的文字量，跳过引用名称内部的问号。 */
export function inlineParameters(sql: string, params: CellValue[]): string {
  let result = '', position = 0, quoted = false;
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index];
    if (char === '`') {
      result += char;
      if (quoted && sql[index + 1] === '`') { result += '`'; index++; }
      else quoted = !quoted;
    } else if (char === '?' && !quoted) {
      if (position >= params.length) throw new Error('SQL 模板缺少参数');
      result += exportLiteral(params[position++]);
    } else result += char;
  }
  if (position !== params.length || quoted) throw new Error('SQL 模板参数或引用标识符不完整');
  return result;
}
