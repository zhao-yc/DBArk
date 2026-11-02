import { copySqliteTableRebuildColumnOrder } from './sqliteTableRebuild';
import { buildSqliteTableCreateDefault, sqliteTableCreateColumnSchema, type SqliteTableCreateDefault } from './sqliteTableCreate';
import { buildSqliteTableForeignKey, sqliteTableForeignKeyEditsSchema, sqliteTableForeignKeyLimits, type SqliteTableForeignKeyDefinition, type SqliteTableForeignKeyEdit } from './sqliteTableForeignKeys';
import { buildSqliteTablePrimaryKey, sqliteTablePrimaryKeyEditSchema, type SqliteTablePrimaryKeyDefinition, type SqliteTablePrimaryKeyEdit } from './sqliteTablePrimaryKey';
import { buildSqliteTableUnique, sqliteTableUniqueEditsSchema, sqliteTableUniqueLimits, type SqliteTableUniqueDefinition, type SqliteTableUniqueEdit } from './sqliteTableUnique';

/** 重建编译只修改明确声明跨度；不推断数据转换、不签发执行能力，未修改约束原文保留。 */
export const sqliteTableRebuildPlanLimits = { sqlBytes: 2 * 1024 * 1024, tokens: 300000, columns: 1024, changes: 128, nesting: 256 } as const;
export interface SqliteRebuildSourceColumn { name: string; hidden: number; }
export interface SqliteRebuildColumnChange { column: string; declaredType?: string; default?: SqliteTableCreateDefault; }
export interface SqliteTableRebuildDefinitionInput {
  table: string; tableSql: string; columns: readonly SqliteRebuildSourceColumn[];
  candidateName: string; changes: readonly SqliteRebuildColumnChange[]; columnOrder?: readonly string[]; foreignKeyEdits?: readonly SqliteTableForeignKeyEdit[]; primaryKeyEdit?: SqliteTablePrimaryKeyEdit; uniqueEdits?: readonly SqliteTableUniqueEdit[];
}
export interface SqliteTableRebuildDefinition {
  candidateSql: string;
  columnMapping: { name: string; copy: boolean }[];
}
interface Token { kind: 'word' | 'quoted' | 'string' | 'number' | 'symbol'; value: string; start: number; end: number; }
interface Span { start: number; end: number; }
interface DefinitionSegment extends Span { column?: string; parts: Token[]; }
interface ColumnDefinition { name: string; type?: Span; insertion: number; end: number; defaults: Span[]; hidden: number; notNull: boolean; references: (Span & { parts: Token[] })[]; primaryKeys: (Span & { parts: Token[] })[]; uniques: (Span & { parts: Token[] })[]; names: { name: string; start: number }[]; }
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
  const result: ColumnDefinition = { name, type: index > 1 ? { start: parts[1].start, end: parts[index - 1].end } : undefined, insertion: parts[0].end, end: parts.at(-1)!.end, defaults: [], hidden: 0, notNull: false, references: [], primaryKeys: [], uniques: [], names: [] };
  while (index < parts.length) {
    const start = index;
    while (word(parts[index], 'CONSTRAINT')) { const marker = parts[index].start; if (identifier(parts[++index]) === undefined) throw invalid(); result.names.push({ name: identifier(parts[index])!, start: marker }); index++; }
    // SQLite接受独立/连续的命名标记；新默认值置于尾部孤立标记前，不暗中改变其归属。
    if (index === parts.length) { result.end = parts[start].start; break; }
    const token = parts[index++];
    if (word(token, 'DEFAULT')) { index = defaultEnd(parts, index); result.defaults.push({ start: parts[start].start, end: parts[index - 1].end }); }
    else if (word(token, 'CHECK')) index = groupEnd(parts, index);
    else if (word(token, 'COLLATE')) { if (identifier(parts[index++]) === undefined) throw invalid(); }
    else if (word(token, 'REFERENCES')) { index = foreignEnd(parts, index); result.references.push({ start: parts[start].start, end: parts[index - 1].end, parts: parts.slice(start, index) }); }
    else if (word(token, 'PRIMARY')) {
      if (!word(parts[index++], 'KEY')) throw invalid();
      if (word(parts[index], 'ASC') || word(parts[index], 'DESC')) index++;
      index = conflictEnd(parts, index); if (word(parts[index], 'AUTOINCREMENT')) index++;
      result.primaryKeys.push({ start: parts[start].start, end: parts[index - 1].end, parts: parts.slice(start, index) });
    } else if (word(token, 'NOT')) { if (!word(parts[index++], 'NULL')) throw invalid(); result.notNull = true; index = conflictEnd(parts, index); }
    else if (word(token, 'NULL')) index = conflictEnd(parts, index);
    else if (word(token, 'UNIQUE')) { index = conflictEnd(parts, index); result.uniques.push({ start: parts[start].start, end: parts[index - 1].end, parts: parts.slice(start, index) }); }
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
function definition(input: SqliteTableRebuildDefinitionInput): { table: Span; bodyStart: number; bodyOpen: number; bodyEnd: number; columns: ColumnDefinition[]; segments: DefinitionSegment[]; strict: boolean; withoutRowid: boolean } {
  const parts = tokenize(input.tableSql); let index = 0;
  if (!word(parts[index++], 'CREATE') || !word(parts[index++], 'TABLE')) throw invalid();
  let tableToken = parts[index++];
  if (symbol(parts[index], '.')) { if (fold(identifier(tableToken) ?? '') !== 'main') throw invalid(); index++; tableToken = parts[index++]; }
  if (fold(identifier(tableToken) ?? '') !== fold(input.table)) throw invalid();
  const open = index, end = groupEnd(parts, index), columns: ColumnDefinition[] = [], segments: DefinitionSegment[] = []; let begin = open + 1, rawStart = parts[open].end;
  for (index = begin; index < end - 1; index++) {
    if (symbol(parts[index], '(')) { index = groupEnd(parts, index) - 1; continue; }
    if (!symbol(parts[index], ',')) continue;
    consume(parts.slice(begin, index), rawStart, parts[index].start); begin = index + 1; rawStart = parts[index].end;
  }
  consume(parts.slice(begin, end - 1), rawStart, parts[end - 1].start); index = end; let strict = false, withoutRowid = false;
  while (index < parts.length && !symbol(parts[index], ';')) {
    // native接受重复表选项；原样保留，而不是为了输出美观重新序列化或去重。
    if (word(parts[index], 'STRICT')) { strict = true; index++; }
    else if (word(parts[index], 'WITHOUT') && word(parts[index + 1], 'ROWID')) { withoutRowid = true; index += 2; }
    else throw invalid();
    if (symbol(parts[index], ',')) { index++; if (index === parts.length || symbol(parts[index], ';')) throw invalid(); } else break;
  }
  if (symbol(parts[index], ';')) index++;
  if (index !== parts.length || columns.length !== input.columns.length || !columns.length) throw invalid();
  for (let ordinal = 0; ordinal < columns.length; ordinal++) if (columns[ordinal].name !== input.columns[ordinal].name || columns[ordinal].hidden !== input.columns[ordinal].hidden) throw invalid();
  // native DROP首列会移除其name至下一列name前的全部文字；原leading trivia须置于私有列之前。
  return { table: { start: tableToken.start, end: tableToken.end }, bodyStart: parts[open + 1].start, bodyOpen: parts[open].end, bodyEnd: parts[end - 1].start, columns, segments, strict, withoutRowid };

  /** 表级约束原样保留；它们不能被当成与原生列目录同名的可编辑字段。 */
  function consume(segment: Token[], start: number, end: number): void {
    if (!segment.length) throw invalid();
    if (['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN'].some(value => word(segment[0], value))) { segments.push({ start, end, parts: segment }); return; }
    const column = columnDefinition(segment); segments.push({ start, end, column: column.name, parts: segment }); columns.push(column); if (columns.length > limits.columns) throw invalid();
  }
}

/** 输出仅是候选CREATE。调用方仍须native验证结构、完整复制核对、外键及真实事务ACK才能提交。 */
export function compileSqliteTableRebuildDefinition(input: SqliteTableRebuildDefinitionInput): SqliteTableRebuildDefinition {
  return compileDefinition(input);
}

/** 后验仅归一准确CREATE表头名称，完整正文/注释/约束均原样比较；不借无意义字段补丁绕非空门。 */
export function normalizeSqliteTableRebuildDefinitionName(input: Pick<SqliteTableRebuildDefinitionInput, 'table' | 'tableSql' | 'columns'>, candidateName: string): string {
  if (!input.table || !validText(input.table) || /^sqlite_/i.test(input.table) || candidateName.length !== 48 || !/^__dbark_rebuild_[a-f0-9]{32}$/.test(candidateName) || !input.columns.length || input.columns.length > limits.columns || new Set(input.columns.map(column => fold(column.name))).size !== input.columns.length || input.columns.some(column => !column.name || !validText(column.name) || ![0, 2, 3].includes(column.hidden))) throw invalid();
  const source = definition({ ...input, candidateName, changes: [] });
  const sql = input.tableSql.slice(0, source.table.start) + quote(candidateName) + input.tableSql.slice(source.table.end); if (encoder.encode(sql).length > limits.sqlBytes) throw invalid(); return sql;
}

type ForeignKeyInput = Pick<SqliteTableRebuildDefinitionInput, 'table' | 'tableSql' | 'columns'>;
export interface SqliteTableForeignKeySource {
  readonly ordinal: number; readonly location: 'column' | 'table'; readonly column?: string;
  readonly sql: string; readonly names: readonly string[]; readonly columns: readonly string[];
  readonly referencedTable: string; readonly referencedColumns: readonly string[];
  readonly onDelete: SqliteTableForeignKeyDefinition['onDelete']; readonly onUpdate: SqliteTableForeignKeyDefinition['onUpdate'];
  readonly deferral: SqliteTableForeignKeyDefinition['deferral']; readonly matches: readonly string[]; readonly onInsert: readonly SqliteTableForeignKeyDefinition['onDelete'][];
}
interface ForeignSpan extends Span { segment: DefinitionSegment; value: Omit<SqliteTableForeignKeySource, 'ordinal'>; }

/** 新入口只读准确原文和原生列目录；未知对象访问器不进入共用词法器。 */
function foreignInput(raw: ForeignKeyInput): ForeignKeyInput {
  const own = (value: unknown, key: string): unknown => { const property = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key) : undefined; if (!property || !('value' in property)) throw invalid(); return property.value; };
  const table = own(raw, 'table'), tableSql = own(raw, 'tableSql'), columns = own(raw, 'columns');
  if (typeof table !== 'string' || typeof tableSql !== 'string' || !Array.isArray(columns) || Object.getPrototypeOf(columns) !== Array.prototype) throw invalid();
  const count = own(columns, 'length'); if (!Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > limits.columns) throw invalid();
  const copied: SqliteRebuildSourceColumn[] = [];
  for (let index = 0; index < (count as number); index++) { const column = own(columns, String(index)), name = own(column, 'name'), hidden = own(column, 'hidden'); if (typeof name !== 'string' || typeof hidden !== 'number') throw invalid(); copied.push({ name, hidden }); }
  const result = { table, tableSql, columns: copied };
  normalizeSqliteTableRebuildDefinitionName(result, '__dbark_rebuild_' + '0'.repeat(32)); return result;
}
/** FK字段列表只允许准确标识符，表达式、排序和COLLATE不能偷偷成为字段名。 */
function foreignColumns(parts: Token[], start: number): { names: string[]; end: number } {
  const end = groupEnd(parts, start), names: string[] = []; let index = start + 1;
  while (index < end - 1) { const name = identifier(parts[index++]); if (name === undefined) throw invalid(); names.push(name); if (index === end - 1) break; if (!symbol(parts[index++], ',') || index === end - 1) throw invalid(); }
  if (!names.length || names.length > sqliteTableForeignKeyLimits.parts) throw invalid(); return { names, end };
}
/** 读取旧约束的完整动作；MATCH和旧ON INSERT仅标明原文，不能暗示SQLite执行了这些规则。 */
function foreignValue(parts: Token[], columns?: string[]): Omit<SqliteTableForeignKeySource, 'ordinal' | 'location' | 'column' | 'sql'> {
  let index = 0; const names: string[] = [];
  while (word(parts[index], 'CONSTRAINT')) { const name = identifier(parts[++index]); if (name === undefined) throw invalid(); names.push(name); index++; }
  if (!columns) { if (!word(parts[index++], 'FOREIGN') || !word(parts[index++], 'KEY')) throw invalid(); const list = foreignColumns(parts, index); columns = list.names; index = list.end; }
  if (!word(parts[index++], 'REFERENCES')) throw invalid(); const referenceStart = index, referencedTable = identifier(parts[index++]); if (referencedTable === undefined) throw invalid();
  const parent = symbol(parts[index], '(') ? foreignColumns(parts, index) : { names: [], end: index }; index = parent.end;
  if (foreignEnd(parts, referenceStart) !== parts.length) throw invalid();
  let onDelete: SqliteTableForeignKeyDefinition['onDelete'] = 'NO ACTION', onUpdate: SqliteTableForeignKeyDefinition['onUpdate'] = 'NO ACTION', deferral: SqliteTableForeignKeyDefinition['deferral'] = 'not-deferrable';
  const matches: string[] = [], onInsert: SqliteTableForeignKeyDefinition['onDelete'][] = [];
  while (index < parts.length) {
    if (word(parts[index], 'ON')) {
      const operation = parts[++index].value.toUpperCase(); index++;
      let action = parts[index++].value.toUpperCase(); if (action === 'SET' || action === 'NO') action += ' ' + parts[index++].value.toUpperCase();
      const admitted = action as SqliteTableForeignKeyDefinition['onDelete'];
      if (operation === 'DELETE') onDelete = admitted; else if (operation === 'UPDATE') onUpdate = admitted; else onInsert.push(admitted);
    } else if (word(parts[index], 'MATCH')) { matches.push(identifier(parts[++index])!); index++; }
    else {
      const disabled = word(parts[index], 'NOT'); if (disabled) index++; if (!word(parts[index++], 'DEFERRABLE')) throw invalid();
      let deferred = false; if (word(parts[index], 'INITIALLY')) { index++; deferred = word(parts[index++], 'DEFERRED'); }
      deferral = disabled ? 'not-deferrable' : deferred ? 'deferred' : 'immediate';
    }
  }
  return { names: Object.freeze(names), columns: Object.freeze(columns), referencedTable, referencedColumns: Object.freeze(parent.names), onDelete, onUpdate, deferral, matches: Object.freeze(matches), onInsert: Object.freeze(onInsert) };
}
/** 按声明位置而非PRAGMA逆向编号定位，重复约束名和完全相同的重复定义仍各有独立目标。 */
function foreignSpans(input: ForeignKeyInput, source: ReturnType<typeof definition>): ForeignSpan[] {
  const output: ForeignSpan[] = [];
  for (const segment of source.segments) {
    if (segment.column !== undefined) {
      const column = source.columns.find(column => column.name === segment.column)!;
      for (const reference of column.references) output.push({ ...reference, segment, value: { ...foreignValue(reference.parts, [column.name]), location: 'column', column: column.name, sql: input.tableSql.slice(reference.start, reference.end) } });
    } else {
      let index = 0; while (word(segment.parts[index], 'CONSTRAINT')) index += 2;
      if (!word(segment.parts[index], 'FOREIGN')) continue;
      const start = segment.parts[0].start, end = segment.parts.at(-1)!.end;
      output.push({ start, end, segment, value: { ...foreignValue(segment.parts), location: 'table', sql: input.tableSql.slice(start, end) } });
    }
  }
  if (output.length > sqliteTableForeignKeyLimits.keys) throw invalid(); return output.sort((left, right) => left.start - right.start);
}
/** 仅提供原外键读取，不创建候选表、不访问数据库或文件，也不生成执行能力。 */
export function inspectSqliteTableForeignKeys(raw: ForeignKeyInput): readonly SqliteTableForeignKeySource[] {
  const input = foreignInput(raw), source = definition({ ...input, candidateName: '', changes: [] });
  return Object.freeze(foreignSpans(input, source).map((span, ordinal) => Object.freeze({ ordinal, ...span.value })));
}
/** 编译增改删的准确声明跨度；其他列、约束、表选项与注释保留，输出尚须原生预览和事务核验。 */
export function compileSqliteTableForeignKeys(raw: ForeignKeyInput, rawEdits: unknown): { tableSql: string; foreignKeys: readonly SqliteTableForeignKeySource[]; added: number; removed: number; replaced: number } {
  const input = foreignInput(raw), source = definition({ ...input, candidateName: '', changes: [] }), originals = foreignSpans(input, source), edits = sqliteTableForeignKeyEditsSchema.parse(rawEdits);
  const replaced = new Set<ForeignSpan>(), appended: string[] = [], newNames = new Set<string>(); let added = 0, removed = 0, changed = 0;
  for (const edit of edits) {
    if (edit.kind !== 'add') { const original = originals[edit.ordinal]; if (!original || original.value.sql !== edit.expectedSql) throw Error('SQLite原外键声明或位置已变化，请重新读取'); replaced.add(original); }
    if (edit.kind === 'remove') { removed++; continue; }
    appended.push(buildSqliteTableForeignKey(edit.definition, input.table, input.columns.map(column => column.name)));
    if (edit.definition.name !== null) { const key = fold(edit.definition.name); if (newNames.has(key)) throw Error('SQLite新外键约束名不能重复'); newNames.add(key); }
    if (edit.kind === 'add') added++; else changed++;
  }
  // 约束名归属从真实声明读取，不把CHECK/default中的字符串或表达式当命名标记。
  const markers = source.columns.flatMap(column => column.names);
  for (const segment of source.segments.filter(segment => segment.column === undefined)) { let index = 0; while (word(segment.parts[index], 'CONSTRAINT')) { const start = segment.parts[index].start, name = identifier(segment.parts[++index]); if (name === undefined) throw invalid(); markers.push({ name, start }); index++; } }
  for (const marker of markers) if (![...replaced].some(span => marker.start >= span.start && marker.start < span.end) && newNames.has(fold(marker.name))) throw Error('SQLite新外键名与保留的原约束名冲突');
  const chunks: string[] = []; let trivia = '';
  for (const segment of source.segments) {
    const spans = [...replaced].filter(span => span.segment === segment).sort((left, right) => left.start - right.start);
    if (segment.column === undefined && spans.length) { trivia += input.tableSql.slice(segment.start, spans[0].start) + input.tableSql.slice(spans[0].end, segment.end); continue; }
    let sql = '', boundary = segment.start;
    for (const span of spans) { sql += input.tableSql.slice(boundary, span.start) + ' '; boundary = span.end; }
    chunks.push(trivia + sql + input.tableSql.slice(boundary, segment.end)); trivia = '';
  }
  if (!chunks.length) throw invalid(); chunks[chunks.length - 1] += trivia;
  let body = chunks.join(','); if (appended.length) body += ',\n ' + appended.join(',\n ') + '\n';
  const tableSql = input.tableSql.slice(0, source.bodyOpen) + body + input.tableSql.slice(source.bodyEnd);
  if (encoder.encode(tableSql).length > limits.sqlBytes || tableSql === input.tableSql) throw Error('SQLite外键声明未变化或超过2MiB UTF8预算');
  return { tableSql, foreignKeys: inspectSqliteTableForeignKeys({ ...input, tableSql }), added, removed, replaced: changed };
}

export interface SqliteTableUniqueSource {
  readonly ordinal: number; readonly location: 'column' | 'table'; readonly column?: string;
  readonly sql: string; readonly names: readonly string[];
  readonly columns: readonly Readonly<SqliteTableUniqueDefinition['columns'][number]>[];
  readonly conflict: SqliteTableUniqueDefinition['conflict'];
}
interface UniqueSpan extends Span { segment: DefinitionSegment; value: Omit<SqliteTableUniqueSource, 'ordinal'>; }

/** 仅识别UNIQUE真实字段引用；括号及连续COLLATE保留原文，不将表达式当字段。 */
function uniqueValue(parts: Token[], column?: string): Omit<SqliteTableUniqueSource, 'ordinal' | 'location' | 'column' | 'sql'> {
  let index = 0; const names: string[] = [], columns: SqliteTableUniqueDefinition['columns'] = [];
  while (word(parts[index], 'CONSTRAINT')) { const name = identifier(parts[++index]); if (name === undefined) throw invalid(); names.push(name); index++; }
  if (!word(parts[index++], 'UNIQUE')) throw invalid();
  if (column === undefined) {
    if (!symbol(parts[index++], '(')) throw invalid();
    /** 已有字段可被多层括号包围；COLLATE只读取实际最后声明，不重写原表达形式。 */
    function field(depth = 0): { column: string; collation: string | null } {
      if (depth > limits.nesting) throw invalid(); let value: { column: string; collation: string | null };
      if (symbol(parts[index], '(')) { index++; value = field(depth + 1); if (!symbol(parts[index++], ')')) throw invalid(); }
      else { const name = identifier(parts[index++]); if (name === undefined) throw invalid(); value = { column: name, collation: null }; }
      while (word(parts[index], 'COLLATE')) { const collation = identifier(parts[++index]); if (collation === undefined) throw invalid(); value = { ...value, collation }; index++; }
      return value;
    }
    for (;;) {
      const value = field(); let order: 'ASC' | 'DESC' | null = null;
      if (word(parts[index], 'ASC') || word(parts[index], 'DESC')) order = parts[index++].value.toUpperCase() as 'ASC' | 'DESC';
      columns.push({ ...value, order }); if (columns.length > sqliteTableUniqueLimits.parts) throw invalid();
      if (symbol(parts[index], ',')) { index++; continue; }
      if (!symbol(parts[index++], ')')) throw invalid(); break;
    }
  } else columns.push({ column, collation: null, order: null });
  let conflict: SqliteTableUniqueDefinition['conflict'] = null;
  if (word(parts[index], 'ON')) { const end = conflictEnd(parts, index); if (end === index) throw invalid(); conflict = parts[index + 2].value.toUpperCase() as NonNullable<typeof conflict>; index = end; }
  if (index !== parts.length || !columns.length) throw invalid();
  return { names: Object.freeze(names), columns: Object.freeze(columns.map(value => Object.freeze(value))), conflict };
}
/** 声明位置而非自动索引编号决定原目标：SQLite可能合并多条相同UNIQUE的自动索引。 */
function uniqueSpans(input: ForeignKeyInput, source: ReturnType<typeof definition>): UniqueSpan[] {
  const output: UniqueSpan[] = [];
  for (const segment of source.segments) {
    if (segment.column !== undefined) {
      const column = source.columns.find(column => column.name === segment.column)!;
      for (const span of column.uniques) output.push({ ...span, segment, value: { ...uniqueValue(span.parts, column.name), location: 'column', column: column.name, sql: input.tableSql.slice(span.start, span.end) } });
    } else {
      let index = 0; while (word(segment.parts[index], 'CONSTRAINT')) index += 2; if (!word(segment.parts[index], 'UNIQUE')) continue;
      const start = segment.parts[0].start, end = segment.parts.at(-1)!.end;
      output.push({ start, end, segment, value: { ...uniqueValue(segment.parts), location: 'table', sql: input.tableSql.slice(start, end) } });
    }
  }
  if (output.length > sqliteTableUniqueLimits.keys || output.some(span => span.value.columns.some(term => !source.columns.some(column => fold(column.name) === fold(term.column))))) throw invalid();
  return output.sort((left, right) => left.start - right.start);
}
/** 只读准确原声明，返回冻结的序号、位置、字段和冲突策略，不读取数据库或生成执行令牌。 */
export function inspectSqliteTableUniques(raw: ForeignKeyInput): readonly SqliteTableUniqueSource[] {
  const input = foreignInput(raw), source = definition({ ...input, candidateName: '', changes: [] });
  return Object.freeze(uniqueSpans(input, source).map((span, ordinal) => Object.freeze({ ordinal, ...span.value })));
}
/** 仅编译声明增改删；完整复制、约束语义、父键、事务ACK及写授权仍由后续独立重建链证明。 */
export function compileSqliteTableUniques(raw: ForeignKeyInput, rawEdits: unknown): { tableSql: string; uniques: readonly SqliteTableUniqueSource[]; added: number; removed: number; replaced: number } {
  const input = foreignInput(raw), source = definition({ ...input, candidateName: '', changes: [] }), originals = uniqueSpans(input, source), edits = sqliteTableUniqueEditsSchema.parse(rawEdits);
  const replaced = new Set<UniqueSpan>(), additions: { definition: SqliteTableUniqueDefinition; sql: string }[] = [], newNames = new Set<string>(); let added = 0, removed = 0, changed = 0;
  for (const edit of edits) {
    if (edit.kind !== 'add') { const original = originals[edit.ordinal]; if (!original || original.value.sql !== edit.expectedSql) throw Error('SQLite原唯一约束声明或位置已变化，请重新读取'); replaced.add(original); }
    if (edit.kind === 'remove') { removed++; continue; }
    additions.push({ definition: edit.definition, sql: buildSqliteTableUnique(edit.definition, input.columns) });
    if (edit.definition.name !== null) { const key = fold(edit.definition.name); if (newNames.has(key)) throw Error('SQLite新唯一约束名不能重复'); newNames.add(key); }
    if (edit.kind === 'add') added++; else changed++;
  }
  // 所有约束共享命名空间；只排除本批明确删除的准确跨度，不能用名称批量误删。
  const markers = source.columns.flatMap(column => column.names);
  for (const segment of source.segments.filter(segment => segment.column === undefined)) { let index = 0; while (word(segment.parts[index], 'CONSTRAINT')) { const start = segment.parts[index].start, name = identifier(segment.parts[++index]); if (name === undefined) throw invalid(); markers.push({ name, start }); index++; } }
  for (const marker of markers) if (![...replaced].some(span => marker.start >= span.start && marker.start < span.end) && newNames.has(fold(marker.name))) throw Error('SQLite新唯一约束名与保留的原约束名冲突');
  const chunks: string[] = []; let trivia = '';
  for (const segment of source.segments) {
    const spans = [...replaced].filter(span => span.segment === segment).sort((left, right) => left.start - right.start);
    if (segment.column === undefined && spans.length) { trivia += input.tableSql.slice(segment.start, spans[0].start) + input.tableSql.slice(spans[0].end, segment.end); continue; }
    let sql = '', boundary = segment.start;
    for (const span of spans) { sql += input.tableSql.slice(boundary, span.start) + ' '; boundary = span.end; }
    chunks.push(trivia + sql + input.tableSql.slice(boundary, segment.end)); trivia = '';
  }
  if (!chunks.length) throw invalid(); chunks[chunks.length - 1] += trivia;
  let tableSql = input.tableSql.slice(0, source.bodyOpen) + chunks.join(',') + input.tableSql.slice(source.bodyEnd);
  // 重新划定当前列尾，避开原末尾孤立CONSTRAINT标记；同列多条声明保持本批明确顺序。
  for (const addition of additions) {
    const remaining = definition({ ...input, tableSql, candidateName: '', changes: [] });
    const position = addition.definition.location === 'column' ? remaining.columns.find(column => column.name === addition.definition.columns[0].column)!.end : remaining.bodyEnd;
    const sql = addition.definition.location === 'column' ? ' ' + addition.sql + ' ' : ',\n ' + addition.sql + '\n';
    if (encoder.encode(tableSql).length + encoder.encode(sql).length > limits.sqlBytes) throw Error('SQLite唯一约束SQL超过2MiB UTF8预算');
    tableSql = tableSql.slice(0, position) + sql + tableSql.slice(position);
  }
  if (encoder.encode(tableSql).length > limits.sqlBytes || tableSql === input.tableSql) throw Error('SQLite唯一约束声明未变化或超过2MiB UTF8预算');
  return { tableSql, uniques: inspectSqliteTableUniques({ ...input, tableSql }), added, removed, replaced: changed };
}

export interface SqliteTablePrimaryKeySource {
  readonly location: 'column' | 'table'; readonly column?: string; readonly sql: string; readonly names: readonly string[];
  readonly columns: readonly Readonly<SqliteTablePrimaryKeyDefinition['columns'][number]>[];
  readonly conflict: SqliteTablePrimaryKeyDefinition['conflict']; readonly autoIncrement: boolean;
}
interface PrimarySpan extends Span { segment: DefinitionSegment; value: SqliteTablePrimaryKeySource; }

/** 列级DESC与表级DESC严格区分；排序规则只读原声明，不推断native行身份。 */
function primaryValue(parts: Token[], column?: string): Omit<SqliteTablePrimaryKeySource, 'location' | 'column' | 'sql'> {
  let index = 0; const names: string[] = [], columns: SqliteTablePrimaryKeyDefinition['columns'] = []; let autoIncrement = false;
  while (word(parts[index], 'CONSTRAINT')) { const name = identifier(parts[++index]); if (name === undefined) throw invalid(); names.push(name); index++; }
  if (!word(parts[index++], 'PRIMARY') || !word(parts[index++], 'KEY')) throw invalid();
  if (column === undefined) {
    if (!symbol(parts[index++], '(')) throw invalid();
    /** native接受括号包围的字段及连续COLLATE；只承认字段表达式，不开放运算或函数。 */
    function field(depth = 0): { column: string; collation: string | null } {
      if (depth > limits.nesting) throw invalid(); let value: { column: string; collation: string | null };
      if (symbol(parts[index], '(')) { index++; value = field(depth + 1); if (!symbol(parts[index++], ')')) throw invalid(); }
      else { const name = identifier(parts[index++]); if (name === undefined) throw invalid(); value = { column: name, collation: null }; }
      while (word(parts[index], 'COLLATE')) { const collation = identifier(parts[++index]); if (collation === undefined) throw invalid(); value = { ...value, collation }; index++; }
      return value;
    }
    for (;;) {
      const value = field(); let order: 'ASC' | 'DESC' | null = null;
      if (word(parts[index], 'ASC') || word(parts[index], 'DESC')) order = parts[index++].value.toUpperCase() as 'ASC' | 'DESC';
      columns.push({ ...value, order });
      if (symbol(parts[index], ',')) { index++; continue; }
      if (word(parts[index], 'AUTOINCREMENT')) { autoIncrement = true; index++; }
      if (!symbol(parts[index++], ')')) throw invalid(); break;
    }
  } else {
    let order: 'ASC' | 'DESC' | null = null; if (word(parts[index], 'ASC') || word(parts[index], 'DESC')) order = parts[index++].value.toUpperCase() as 'ASC' | 'DESC';
    columns.push({ column, collation: null, order });
  }
  let conflict: SqliteTablePrimaryKeyDefinition['conflict'] = null;
  if (word(parts[index], 'ON')) { const end = conflictEnd(parts, index); if (end === index) throw invalid(); conflict = parts[index + 2].value.toUpperCase() as NonNullable<typeof conflict>; index = end; }
  if (column !== undefined && word(parts[index], 'AUTOINCREMENT')) { autoIncrement = true; index++; }
  if (index !== parts.length || !columns.length || columns.length > limits.columns) throw invalid();
  return { names: Object.freeze(names), columns: Object.freeze(columns.map(value => Object.freeze(value))), conflict, autoIncrement };
}
/** 从同一有界词法结果提取唯一主键跨度，不用正则搜PRIMARY或按名称替换。 */
function primarySpan(input: ForeignKeyInput, source: ReturnType<typeof definition>, intermediate = false): PrimarySpan | undefined {
  const keys: PrimarySpan[] = [];
  for (const segment of source.segments) {
    if (segment.column !== undefined) {
      const column = source.columns.find(column => column.name === segment.column)!;
      for (const span of column.primaryKeys) keys.push({ ...span, segment, value: { ...primaryValue(span.parts, column.name), location: 'column', column: column.name, sql: input.tableSql.slice(span.start, span.end) } });
    } else {
      let index = 0; while (word(segment.parts[index], 'CONSTRAINT')) index += 2; if (!word(segment.parts[index], 'PRIMARY')) continue;
      const start = segment.parts[0].start, end = segment.parts.at(-1)!.end;
      keys.push({ start, end, segment, value: { ...primaryValue(segment.parts), location: 'table', sql: input.tableSql.slice(start, end) } });
    }
  }
  if (keys.length > 1 || !keys.length && source.withoutRowid && !intermediate) throw invalid(); const key = keys[0];
  if (key?.value.columns.some(term => !source.columns.some(column => fold(column.name) === fold(term.column) && column.hidden === 0))) throw invalid();
  if (key?.value.autoIncrement) {
    const term = key.value.columns[0], column = source.columns.find(column => fold(column.name) === fold(term.column)), type = column?.type && tokenize(input.tableSql.slice(column.type.start, column.type.end));
    if (source.withoutRowid || key.value.columns.length !== 1 || !type || type.length !== 1 || fold(identifier(type[0]) ?? '') !== 'integer' || key.value.location === 'column' && term.order === 'DESC') throw invalid();
  }
  return key;
}
/** 原PK目录仅读取精确声明及表选项；ROWID身份、自增水位和完整数据仍须独立native证明。 */
export function inspectSqliteTablePrimaryKey(raw: ForeignKeyInput): { primaryKey: Readonly<SqliteTablePrimaryKeySource> | null; withoutRowid: boolean; strict: boolean } {
  const input = foreignInput(raw), source = definition({ ...input, candidateName: '', changes: [] }), key = primarySpan(input, source);
  return { primaryKey: key ? Object.freeze(key.value) : null, withoutRowid: source.withoutRowid, strict: source.strict };
}
/** 最终声明推导计划内PK和隐含可空性；实际候选仍逐项对照native目录，不能用计划自证。 */
export function inspectSqliteTableRebuildKeyLayout(raw: ForeignKeyInput): {
  columns: { name: string; primaryKey: number; notNull: boolean }[];
  rowIdentity: { kind: 'rowid'; source: string } | { kind: 'primary-key'; columns: string[] };
  autoIncrement: boolean;
} {
  const input = foreignInput(raw), source = definition({ ...input, candidateName: '', changes: [] }), primary = primarySpan(input, source)?.value;
  const names = primary?.columns.map(term => source.columns.find(column => fold(column.name) === fold(term.column))!.name) ?? [];
  const alias = primary && names.length === 1 && !source.withoutRowid && !(primary.location === 'column' && primary.columns[0].order === 'DESC') && (() => { const column = source.columns.find(column => column.name === names[0])!, tokens = column.type ? tokenize(input.tableSql.slice(column.type.start, column.type.end)) : []; return tokens.length === 1 && fold(identifier(tokens[0]) ?? '') === 'integer'; })() ? names[0] : undefined;
  const rowid = alias ?? ['_rowid_', 'rowid', 'oid'].find(name => !source.columns.some(column => fold(column.name) === name));
  if (!source.withoutRowid && rowid === undefined) throw Error('SQLite新主键使真实ROWID不可访问，无法证明完整行身份');
  return {
    columns: source.columns.map(column => { const index = names.indexOf(column.name); return { name: column.name, primaryKey: index < 0 ? 0 : index + 1, notNull: column.notNull || index >= 0 && (source.withoutRowid || source.strict && alias !== column.name) }; }),
    rowIdentity: source.withoutRowid ? { kind: 'primary-key', columns: names } : { kind: 'rowid', source: rowid! }, autoIncrement: primary?.autoIncrement ?? false,
  };
}
/** 只修改明确主键跨度；非主键约束、列原文、注释和表选项继续保留。本API不连入执行合同。 */
export function compileSqliteTablePrimaryKey(raw: ForeignKeyInput, rawEdit: unknown): { tableSql: string; primaryKey: Readonly<SqliteTablePrimaryKeySource> | null; withoutRowid: boolean; strict: boolean } {
  const output = transformPrimaryKey(raw, rawEdit);
  return { tableSql: output, ...inspectSqliteTablePrimaryKey({ ...raw, tableSql: output }) };
}
/** 组合变更仅允许内部短暂缺少WR主键；该中间SQL从不进入候选或公开执行能力。 */
function transformPrimaryKey(raw: ForeignKeyInput, rawEdit: unknown, intermediate = false): string {
  const input = foreignInput(raw), source = definition({ ...input, candidateName: '', changes: [] }), original = primarySpan(input, source, intermediate), edit = sqliteTablePrimaryKeyEditSchema.parse(rawEdit);
  if (edit.kind === 'add' ? !!original : !original || edit.expectedSql !== original.value.sql) throw Error('SQLite原主键声明或存在性已变化，请重新读取');
  if (edit.kind === 'remove' && source.withoutRowid && !intermediate) throw Error('WITHOUT ROWID表必须保留主键，请用替换设计完整新主键');
  const value = edit.kind === 'remove' ? undefined : edit.definition;
  if (value?.autoIncrement) {
    const column = source.columns.find(column => column.name === value.columns[0].column), type = column?.type && tokenize(input.tableSql.slice(column.type.start, column.type.end));
    if (source.withoutRowid || !type || type.length !== 1 || fold(identifier(type[0]) ?? '') !== 'integer') throw Error('SQLite自增主键须为ROWID表的准确单列INTEGER声明');
  }
  if (value?.name !== null && value?.name !== undefined) {
    const markers = source.columns.flatMap(column => column.names);
    for (const segment of source.segments.filter(segment => segment.column === undefined)) { let index = 0; while (word(segment.parts[index], 'CONSTRAINT')) { markers.push({ name: identifier(segment.parts[index + 1])!, start: segment.parts[index].start }); index += 2; } }
    if (markers.some(marker => (!original || marker.start < original.start || marker.start >= original.end) && fold(marker.name) === fold(value.name!))) throw Error('SQLite新主键名与保留的原约束名冲突');
  }
  // 删除表级声明时将注释移交下一片段；行内只删除原命名标记和PK约束，不碰NOT NULL等邻接约束。
  let tableSql = input.tableSql;
  if (original) {
    if (original.value.location === 'column') tableSql = tableSql.slice(0, original.start) + ' ' + tableSql.slice(original.end);
    else {
      const chunks: string[] = []; let trivia = '';
      for (const segment of source.segments) { if (segment === original.segment) { trivia += input.tableSql.slice(segment.start, original.start) + input.tableSql.slice(original.end, segment.end); continue; } chunks.push(trivia + input.tableSql.slice(segment.start, segment.end)); trivia = ''; }
      if (!chunks.length) throw invalid(); chunks[chunks.length - 1] += trivia;
      tableSql = input.tableSql.slice(0, source.bodyOpen) + chunks.join(',') + input.tableSql.slice(source.bodyEnd);
    }
  }
  if (value) {
    const fragment = buildSqliteTablePrimaryKey(value, input.columns), remaining = definition({ ...input, tableSql, candidateName: '', changes: [] });
    if (value.location === 'column') { const column = remaining.columns.find(column => column.name === value.columns[0].column)!; tableSql = tableSql.slice(0, column.end) + ' ' + fragment + ' ' + tableSql.slice(column.end); }
    else tableSql = tableSql.slice(0, remaining.bodyEnd) + ',\n ' + fragment + '\n' + tableSql.slice(remaining.bodyEnd);
  }
  if (encoder.encode(tableSql).length > limits.sqlBytes || tableSql === input.tableSql) throw Error('SQLite主键声明未变化或超过2MiB UTF8预算');
  return tableSql;
}

export interface SqliteTableRebuildCopyDefinition extends SqliteTableRebuildDefinition { ordinalColumn: string; ordinalIndex: string; createOrdinalIndexSql: string; removeOrdinalSql: string[]; }
/** 私有复制阶段额外加入逐行编号；不进入公开字段设计，提交前须移除并核对准确最终结构。 */
export function compileSqliteTableRebuildCopyDefinition(input: SqliteTableRebuildDefinitionInput, ordinalColumn: string): SqliteTableRebuildCopyDefinition {
  if (ordinalColumn.length !== 54 || !/^__dbark_rebuild_order_[a-f0-9]{32}$/.test(ordinalColumn) || input.columns.some(column => fold(column.name) === ordinalColumn)) throw invalid();
  const ordinalIndex = '__dbark_rebuild_order_index_' + ordinalColumn.slice(-32), compiled = compileDefinition(input, ordinalColumn);
  return { ...compiled, ordinalColumn, ordinalIndex,
    createOrdinalIndexSql: 'CREATE UNIQUE INDEX "main".' + quote(ordinalIndex) + ' ON ' + quote(input.candidateName) + '(' + quote(ordinalColumn) + ')',
    removeOrdinalSql: ['DROP INDEX "main".' + quote(ordinalIndex), 'ALTER TABLE "main".' + quote(input.candidateName) + ' DROP COLUMN ' + quote(ordinalColumn)],
  };
}

/** 普通候选与带私有编号候选共享同一跨度编译，不复制或重新实现默认值/约束解析。 */
function compileDefinition(input: SqliteTableRebuildDefinitionInput, ordinalColumn?: string, reorderedBase = false): SqliteTableRebuildDefinition {
  // UNIQUE整批分支会复制其余选项，必须先拒绝访问器，不能让spread先调用旧主外键或顺序getter。
  for (const key of ['primaryKeyEdit', 'foreignKeyEdits', 'columnOrder']) { const descriptor = Object.getOwnPropertyDescriptor(input, key); if (descriptor && (!descriptor.enumerable || !('value' in descriptor))) throw invalid(); }
  const uniqueDescriptor = Object.getOwnPropertyDescriptor(input, 'uniqueEdits'); if (uniqueDescriptor && (!uniqueDescriptor.enumerable || !('value' in uniqueDescriptor))) throw invalid();
  if (uniqueDescriptor?.value !== undefined) {
    const edits = sqliteTableUniqueEditsSchema.parse(uniqueDescriptor.value);
    // 先按原序号/SQL移除本批所有旧UNIQUE；PK/FK编译再移除各自原跨度，名称互换只核最终集合。
    const removals = edits.filter(edit => edit.kind !== 'add').map(edit => ({ kind: 'remove' as const, ordinal: edit.ordinal, expectedSql: edit.expectedSql }));
    const tableSql = removals.length ? compileSqliteTableUniques(input, removals).tableSql : input.tableSql;
    const base = compileDefinition({ ...input, tableSql, uniqueEdits: undefined, columnOrder: undefined }, undefined, true);
    const changedSource = { table: input.candidateName, tableSql: base.candidateSql, columns: input.columns };
    const additions = edits.filter(edit => edit.kind !== 'remove').map(edit => ({ kind: 'add' as const, definition: edit.definition }));
    const finalSql = additions.length ? compileSqliteTableUniques(changedSource, additions).tableSql : base.candidateSql;
    return compileDefinition({ ...input, table: input.candidateName, tableSql: finalSql, changes: [], foreignKeyEdits: undefined, primaryKeyEdit: undefined, uniqueEdits: undefined }, ordinalColumn, true);
  }
  const primaryDescriptor = Object.getOwnPropertyDescriptor(input, 'primaryKeyEdit'); if (primaryDescriptor && (!primaryDescriptor.enumerable || !('value' in primaryDescriptor))) throw invalid();
  if (primaryDescriptor?.value !== undefined) {
    const edit = sqliteTablePrimaryKeyEditSchema.parse(primaryDescriptor.value), original = inspectSqliteTablePrimaryKey(input).primaryKey;
    if (edit.kind === 'add' ? !!original : !original || original.sql !== edit.expectedSql) throw Error('SQLite原主键声明或存在性已变化，请重新读取');
    const flags = definition(input); if (edit.kind === 'remove' && flags.withoutRowid) throw Error('WITHOUT ROWID表必须保留主键，请用替换设计完整新主键');
    // 先释放准确原PK跨度，再应用FK和字段补丁，最后添加新PK；互换约束名只核最终保留集合。
    let tableSql = original ? transformPrimaryKey(input, { kind: 'remove', expectedSql: original.sql }, true) : input.tableSql;
    const base = compileDefinition({ ...input, tableSql, primaryKeyEdit: undefined, columnOrder: undefined }, undefined, true);
    const changedSource = { table: input.candidateName, tableSql: base.candidateSql, columns: input.columns };
    tableSql = edit.kind === 'remove' ? base.candidateSql : transformPrimaryKey(changedSource, { kind: 'add', definition: edit.definition }, true);
    // 最终公开候选必须已有完整合法PK，不能让中间缺失状态逃出。
    inspectSqliteTablePrimaryKey({ ...changedSource, tableSql });
    return compileDefinition({ ...input, table: input.candidateName, tableSql, changes: [], foreignKeyEdits: undefined, primaryKeyEdit: undefined }, ordinalColumn, true);
  }
  const foreignDescriptor = Object.getOwnPropertyDescriptor(input, 'foreignKeyEdits'); if (foreignDescriptor && (!foreignDescriptor.enumerable || !('value' in foreignDescriptor))) throw invalid();
  if (foreignDescriptor?.value !== undefined) {
    // 先完成准确原外键跨度变更，再沿原类型/default及实际重排路径编译，不靠伪造字段补丁开门。
    const foreign = compileSqliteTableForeignKeys(input, foreignDescriptor.value);
    return compileDefinition({ ...input, tableSql: foreign.tableSql, foreignKeyEdits: undefined }, ordinalColumn, true);
  }
  const orderDescriptor = Object.getOwnPropertyDescriptor(input, 'columnOrder'); if (orderDescriptor && (!orderDescriptor.enumerable || !('value' in orderDescriptor))) throw invalid();
  const rawOrder = orderDescriptor?.value;

  if (!input.table || !validText(input.table) || /^sqlite_/i.test(input.table) || input.candidateName.length !== 48 || !/^__dbark_rebuild_[a-f0-9]{32}$/.test(input.candidateName) || fold(input.table) === input.candidateName && !reorderedBase || !input.columns.length || input.columns.length > limits.columns || !input.changes.length && !reorderedBase && rawOrder === undefined || input.changes.length > limits.changes) throw invalid();
  if (new Set(input.columns.map(column => fold(column.name))).size !== input.columns.length || input.columns.some(column => !column.name || !validText(column.name) || ![0, 2, 3].includes(column.hidden))) throw invalid();
  if (rawOrder !== undefined) {
    const order = copySqliteTableRebuildColumnOrder(rawOrder, input.columns.map(column => column.name));
    // 先在原顺序应用类型/default跨度，再移动完整声明切片；两类编辑不会重叠或覆盖别列。
    const base = compileDefinition({ ...input, columnOrder: undefined }, undefined, true), parsed = definition({ ...input, table: input.candidateName, tableSql: base.candidateSql, columnOrder: undefined });
    const slices = new Map(parsed.segments.filter(segment => segment.column !== undefined).map(segment => [segment.column!, base.candidateSql.slice(segment.start, segment.end)]));
    const chunks: string[] = []; let position = 0, next = 0;
    for (const segment of parsed.segments) { chunks.push(base.candidateSql.slice(position, segment.start), segment.column === undefined ? base.candidateSql.slice(segment.start, segment.end) : slices.get(order[next++])!); position = segment.end; }
    chunks.push(base.candidateSql.slice(position)); let candidateSql = chunks.join('');
    const exactColumns = new Map(input.columns.map(column => [column.name, column])), targetColumns = order.map(name => exactColumns.get(name)!);
    if (ordinalColumn) { const target = definition({ ...input, table: input.candidateName, tableSql: candidateSql, columns: targetColumns, columnOrder: undefined }); candidateSql = candidateSql.slice(0, target.bodyStart) + quote(ordinalColumn) + ' INTEGER NOT NULL, ' + candidateSql.slice(target.bodyStart); }
    if (encoder.encode(candidateSql).length > limits.sqlBytes) throw invalid();
    return { candidateSql, columnMapping: targetColumns.map(column => ({ name: column.name, copy: column.hidden === 0 })) };
  }
  const source = definition(input), columns = new Map(source.columns.map((column, index) => [fold(column.name), { definition: column, hidden: input.columns[index].hidden }]));
  const edits: (Span & { sql: string; order?: number })[] = [{ ...source.table, sql: quote(input.candidateName) }], changed = new Set<string>();
  let addedBytes = encoder.encode(edits[0].sql).length;
  /** 所有新增片段都会进入最终输出，提前预算避免先构造超大中间SQL才拒绝。 */
  function add(edit: Span & { sql: string; order?: number }): void {
    addedBytes += encoder.encode(edit.sql).length; if (addedBytes > limits.sqlBytes) throw invalid(); edits.push(edit);
  }
  if (ordinalColumn) add({ start: source.bodyStart, end: source.bodyStart, sql: quote(ordinalColumn) + ' INTEGER NOT NULL, ' });
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
