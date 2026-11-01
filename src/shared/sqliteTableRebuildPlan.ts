import { buildSqliteTableCreateDefault, sqliteTableCreateColumnSchema, type SqliteTableCreateDefault } from './sqliteTableCreate';

/** 重建编译只修改声明跨度；不推断数据转换、不签发执行能力，也不重新序列化既有约束。 */
export const sqliteTableRebuildPlanLimits = { sqlBytes: 2 * 1024 * 1024, tokens: 300000, columns: 1024, changes: 128, nesting: 256 } as const;
export interface SqliteRebuildSourceColumn { name: string; hidden: number; }
export interface SqliteRebuildColumnChange { column: string; declaredType?: string; default?: SqliteTableCreateDefault; }
export interface SqliteTableRebuildDefinitionInput {
  table: string; tableSql: string; columns: readonly SqliteRebuildSourceColumn[];
  candidateName: string; changes: readonly SqliteRebuildColumnChange[];
}
export interface SqliteTableRebuildDefinition {
  candidateSql: string;
  columnMapping: { name: string; copy: boolean }[];
}
interface Token { kind: 'word' | 'quoted' | 'string' | 'number' | 'symbol'; value: string; start: number; end: number; }
interface Span { start: number; end: number; }
interface ColumnDefinition { name: string; type?: Span; insertion: number; end: number; defaults: Span[]; hidden: number; }
const limits = sqliteTableRebuildPlanLimits, encoder = new TextEncoder();
const fold = (value: string) => value.replace(/[A-Z]/g, letter => letter.toLowerCase());
const word = (token: Token | undefined, value: string) => token?.kind === 'word' && fold(token.value) === value.toLowerCase();
const symbol = (token: Token | undefined, value: string) => token?.kind === 'symbol' && token.value === value;
const identifier = (token: Token | undefined) => token && ['word', 'quoted', 'string'].includes(token.kind) ? token.value : undefined;
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const invalid = () => Error('SQLite重建原定义、字段目录或修改跨度无法准确确认');
/** 未配对代理项和NUL不是可无损交付给native的SQL；检查在词法分配前完成。 */
function validText(value: string): boolean { return !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value); }

/** 带位置的有界词法器；注释不参与语法，原切片仍完整保留。 */
function tokenize(sql: string): Token[] {
  if (sql.length > limits.sqlBytes || !validText(sql) || encoder.encode(sql).length > limits.sqlBytes) throw invalid();
  const parts: Token[] = [], numberPattern = /(?:0[xX][0-9a-fA-F_]+|(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9][0-9_]*)(?:[eE][+-]?[0-9_]+)?)/y;
  for (let index = 0; index < sql.length;) {
    const start = index, character = sql[index];
    if (/[ \t\r\n\v\f]/.test(character)) { index++; continue; }
    if (sql.startsWith('--', index)) { const end = sql.indexOf('\n', index + 2); index = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith('/*', index)) { const end = sql.indexOf('*/', index + 2); if (end < 0) throw invalid(); index = end + 2; continue; }
    if (["'", '"', '`', '['].includes(character)) {
      const close = character === '[' ? ']' : character; let value = '', closed = false; index++;
      while (index < sql.length) {
        if (sql[index] !== close) value += sql[index++];
        else if (close !== ']' && sql[index + 1] === close) { value += close; index += 2; }
        else { index++; closed = true; break; }
      }
      if (!closed) throw invalid(); parts.push({ kind: character === "'" ? 'string' : 'quoted', value, start, end: index });
    } else if (/[A-Za-z_\u0080-\uFFFF]/.test(character)) {
      index++; while (index < sql.length && /[A-Za-z0-9_$\u0080-\uFFFF]/.test(sql[index])) index++;
      parts.push({ kind: 'word', value: sql.slice(start, index), start, end: index });
    } else if (/[0-9]/.test(character) || character === '.' && /[0-9]/.test(sql[index + 1] ?? '')) {
      numberPattern.lastIndex = index; const number = numberPattern.exec(sql);
      if (!number) throw invalid(); index += number[0].length; parts.push({ kind: 'number', value: number[0], start, end: index });
    } else { index++; parts.push({ kind: 'symbol', value: character, start, end: index }); }
    if (parts.length > limits.tokens) throw invalid();
  }
  return parts;
}

/** 表达式/类型尺寸内部逗号与关键字不会被解释为列或DEFAULT边界。 */
function groupEnd(parts: Token[], start: number): number {
  if (!symbol(parts[start], '(')) throw invalid(); let depth = 0;
  for (let index = start; index < parts.length; index++) {
    if (symbol(parts[index], '(') && ++depth > limits.nesting) throw invalid();
    if (symbol(parts[index], ')') && --depth === 0) return index + 1;
    if (symbol(parts[index], ';')) throw invalid();
  }
  throw invalid();
}
/** GENERATED可回退为合法类型名；只有实际组成生成列语法时才结束声明类型。 */
function constraintStart(parts: Token[], index: number): boolean {
  const token = parts[index];
  if (word(token, 'GENERATED')) return word(parts[index + 1], 'ALWAYS') && word(parts[index + 2], 'AS') && symbol(parts[index + 3], '(');
  return token?.kind === 'word' && ['constraint', 'primary', 'not', 'null', 'unique', 'check', 'default', 'collate', 'references', 'as'].includes(fold(token.value));
}

/** REFERENCES的SET DEFAULT不是列默认值；按约束结构跳过，不按裸DEFAULT搜改原文。 */
function foreignEnd(parts: Token[], start: number): number {
  let index = start; if (identifier(parts[index++]) === undefined) throw invalid();
  if (symbol(parts[index], '(')) index = groupEnd(parts, index);
  while (index < parts.length) {
    if (word(parts[index], 'ON')) {
      // ON INSERT是SQLite保留的旧兼容语法，只保留原文，不宣称其有执行语义。
      if (!word(parts[++index], 'DELETE') && !word(parts[index], 'UPDATE') && !word(parts[index], 'INSERT')) throw invalid(); index++;
      if (word(parts[index], 'SET')) { index++; if (!word(parts[index], 'NULL') && !word(parts[index], 'DEFAULT')) throw invalid(); index++; }
      else if (word(parts[index], 'NO')) { if (!word(parts[++index], 'ACTION')) throw invalid(); index++; }
      else if (word(parts[index], 'CASCADE') || word(parts[index], 'RESTRICT')) index++; else throw invalid();
    } else if (word(parts[index], 'MATCH')) { if (identifier(parts[++index]) === undefined) throw invalid(); index++; }
    else if (word(parts[index], 'DEFERRABLE') || word(parts[index], 'NOT') && word(parts[index + 1], 'DEFERRABLE')) {
      if (word(parts[index], 'NOT')) index++; index++;
      if (word(parts[index], 'INITIALLY')) { index++; if (!word(parts[index], 'DEFERRED') && !word(parts[index], 'IMMEDIATE')) throw invalid(); index++; }
    } else break;
  }
  return index;
}
/** 默认表达式只划定原文边界；不执行、不求值，也不把自定义表达式转换成typed默认值。 */
function defaultEnd(parts: Token[], start: number): number {
  if (symbol(parts[start], '(')) return groupEnd(parts, start);
  let index = start;
  if (symbol(parts[index], '+') || symbol(parts[index], '-')) { if (parts[++index]?.kind !== 'number') throw invalid(); return index + 1; }
  if (word(parts[index], 'X') && parts[index + 1]?.kind === 'string' && parts[index].end === parts[index + 1].start) return index + 2;
  if (!parts[index] || parts[index].kind === 'symbol') throw invalid(); return index + 1;
}
function conflictEnd(parts: Token[], start: number): number {
  if (!word(parts[start], 'ON')) return start;
  if (!word(parts[start + 1], 'CONFLICT') || !['rollback', 'abort', 'fail', 'ignore', 'replace'].some(value => word(parts[start + 2], value))) throw invalid(); return start + 3;
}

/** 明确识别完整列约束；不认识的语法拒绝编译，不能猜测后续约束属于声明类型。 */
function columnDefinition(parts: Token[]): ColumnDefinition {
  const name = identifier(parts[0]); if (name === undefined || !name.length) throw invalid();
  let index = 1;
  while (index < parts.length && !constraintStart(parts, index)) {
    if (symbol(parts[index], '(')) index = groupEnd(parts, index);
    else { if (parts[index].kind === 'symbol' || parts[index].kind === 'number') throw invalid(); index++; }
  }
  const result: ColumnDefinition = { name, type: index > 1 ? { start: parts[1].start, end: parts[index - 1].end } : undefined, insertion: parts[0].end, end: parts.at(-1)!.end, defaults: [], hidden: 0 };
  while (index < parts.length) {
    const start = index;
    while (word(parts[index], 'CONSTRAINT')) { if (identifier(parts[++index]) === undefined) throw invalid(); index++; }
    // SQLite接受独立/连续的命名标记；新默认值置于尾部孤立标记前，不暗中改变其归属。
    if (index === parts.length) { result.end = parts[start].start; break; }
    const token = parts[index++];
    if (word(token, 'DEFAULT')) { index = defaultEnd(parts, index); result.defaults.push({ start: parts[start].start, end: parts[index - 1].end }); }
    else if (word(token, 'CHECK')) index = groupEnd(parts, index);
    else if (word(token, 'COLLATE')) { if (identifier(parts[index++]) === undefined) throw invalid(); }
    else if (word(token, 'REFERENCES')) index = foreignEnd(parts, index);
    else if (word(token, 'PRIMARY')) {
      if (!word(parts[index++], 'KEY')) throw invalid();
      if (word(parts[index], 'ASC') || word(parts[index], 'DESC')) index++;
      index = conflictEnd(parts, index); if (word(parts[index], 'AUTOINCREMENT')) index++;
    } else if (word(token, 'NOT')) { if (!word(parts[index++], 'NULL')) throw invalid(); index = conflictEnd(parts, index); }
    else if (word(token, 'NULL') || word(token, 'UNIQUE')) index = conflictEnd(parts, index);
    else if (word(token, 'GENERATED') || word(token, 'AS')) {
      if (result.hidden !== 0) throw invalid();
      if (word(token, 'GENERATED')) { if (!word(parts[index++], 'ALWAYS') || !word(parts[index++], 'AS')) throw invalid(); }
      index = groupEnd(parts, index); result.hidden = word(parts[index], 'STORED') ? 3 : 2;
      if (word(parts[index], 'STORED') || word(parts[index], 'VIRTUAL')) index++;
    } else throw invalid();
  }
  return result;
}

/** 校验CREATE归属与原生列顺序；仅接受普通main表，不接收CTAS、虚拟表和多语句。 */
function definition(input: SqliteTableRebuildDefinitionInput): { table: Span; columns: ColumnDefinition[] } {
  const parts = tokenize(input.tableSql); let index = 0;
  if (!word(parts[index++], 'CREATE') || !word(parts[index++], 'TABLE')) throw invalid();
  let tableToken = parts[index++];
  if (symbol(parts[index], '.')) { if (fold(identifier(tableToken) ?? '') !== 'main') throw invalid(); index++; tableToken = parts[index++]; }
  if (fold(identifier(tableToken) ?? '') !== fold(input.table)) throw invalid();
  const open = index, end = groupEnd(parts, index), columns: ColumnDefinition[] = []; let begin = open + 1;
  for (index = begin; index < end - 1; index++) {
    if (symbol(parts[index], '(')) { index = groupEnd(parts, index) - 1; continue; }
    if (!symbol(parts[index], ',')) continue;
    consume(parts.slice(begin, index)); begin = index + 1;
  }
  consume(parts.slice(begin, end - 1)); index = end;
  while (index < parts.length && !symbol(parts[index], ';')) {
    // native接受重复表选项；原样保留，而不是为了输出美观重新序列化或去重。
    if (word(parts[index], 'STRICT')) index++;
    else if (word(parts[index], 'WITHOUT') && word(parts[index + 1], 'ROWID')) index += 2;
    else throw invalid();
    if (symbol(parts[index], ',')) { index++; if (index === parts.length || symbol(parts[index], ';')) throw invalid(); } else break;
  }
  if (symbol(parts[index], ';')) index++;
  if (index !== parts.length || columns.length !== input.columns.length || !columns.length) throw invalid();
  for (let ordinal = 0; ordinal < columns.length; ordinal++) if (columns[ordinal].name !== input.columns[ordinal].name || columns[ordinal].hidden !== input.columns[ordinal].hidden) throw invalid();
  return { table: { start: tableToken.start, end: tableToken.end }, columns };

  /** 表级约束原样保留；它们不能被当成与原生列目录同名的可编辑字段。 */
  function consume(segment: Token[]): void {
    if (!segment.length) throw invalid();
    if (['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN'].some(value => word(segment[0], value))) return;
    columns.push(columnDefinition(segment)); if (columns.length > limits.columns) throw invalid();
  }
}

/** 输出仅是候选CREATE。调用方仍须native验证结构、完整复制核对、外键及真实事务ACK才能提交。 */
export function compileSqliteTableRebuildDefinition(input: SqliteTableRebuildDefinitionInput): SqliteTableRebuildDefinition {
  if (!input.table || !validText(input.table) || /^sqlite_/i.test(input.table) || input.candidateName.length !== 48 || !/^__dbark_rebuild_[a-f0-9]{32}$/.test(input.candidateName) || fold(input.table) === input.candidateName || !input.columns.length || input.columns.length > limits.columns || !input.changes.length || input.changes.length > limits.changes) throw invalid();
  if (new Set(input.columns.map(column => fold(column.name))).size !== input.columns.length || input.columns.some(column => !column.name || !validText(column.name) || ![0, 2, 3].includes(column.hidden))) throw invalid();
  const source = definition(input), columns = new Map(source.columns.map((column, index) => [fold(column.name), { definition: column, hidden: input.columns[index].hidden }]));
  const edits: (Span & { sql: string; order?: number })[] = [{ ...source.table, sql: quote(input.candidateName) }], changed = new Set<string>();
  let addedBytes = encoder.encode(edits[0].sql).length;
  /** 所有新增片段都会进入最终输出，提前预算避免先构造超大中间SQL才拒绝。 */
  function add(edit: Span & { sql: string; order?: number }): void {
    addedBytes += encoder.encode(edit.sql).length; if (addedBytes > limits.sqlBytes) throw invalid(); edits.push(edit);
  }
  for (const change of input.changes) {
    const key = fold(change.column), column = columns.get(key);
    if (!column || changed.has(key) || change.declaredType === undefined && change.default === undefined) throw invalid(); changed.add(key);
    if (change.declaredType !== undefined) {
      let sql = '';
      if (change.declaredType !== '') { const value = sqliteTableCreateColumnSchema.shape.declaredType.parse(change.declaredType); sql = quote(value); }
      const span = column.definition.type ?? { start: column.definition.insertion, end: column.definition.insertion }; add({ ...span, sql: ' ' + sql + ' ' });
    }
    if (change.default !== undefined) {
      if (column.hidden !== 0) throw Error('SQLite生成列不能设置默认值');
      const value = buildSqliteTableCreateDefault(change.default);
      // 所有原DEFAULT均移除，避免原本被末项覆盖的默认值在本次修改后重新生效。
      for (const span of column.definition.defaults) add({ ...span, sql: ' ' });
      if (value !== undefined) add({ start: column.definition.end, end: column.definition.end, sql: ' DEFAULT ' + value + ' ', order: 1 });
    }
  }
  // 同位置插入置于原跨度替换之后，倒序拼接时先插入，随后替换不会吞掉新增声明。
  edits.sort((left, right) => right.start - left.start || right.end - left.end || (right.order ?? 0) - (left.order ?? 0));
  // 一次拼接原切片，避免大量重复DEFAULT导致按每个跨度反复复制完整2MiB原文。
  const chunks: string[] = []; let boundary = input.tableSql.length, bytes = addedBytes;
  for (const edit of edits) {
    if (edit.end > boundary) throw invalid(); const original = input.tableSql.slice(edit.end, boundary);
    bytes += encoder.encode(original).length; if (bytes > limits.sqlBytes) throw invalid(); chunks.push(original, edit.sql); boundary = edit.start;
  }
  const prefix = input.tableSql.slice(0, boundary); bytes += encoder.encode(prefix).length; if (bytes > limits.sqlBytes) throw invalid(); chunks.push(prefix);
  return { candidateSql: chunks.reverse().join(''), columnMapping: input.columns.map(column => ({ name: column.name, copy: column.hidden === 0 })) };
}
