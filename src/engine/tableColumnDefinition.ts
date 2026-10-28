import { SqlScriptScanner } from './sql';
import { columnTypePatchSchema, type ColumnTypePatch } from '../shared/tableColumnPatches';
import { tableColumnPatchLimits as limits, type ColumnDefinitionAttribute, type ColumnEditableAttribute, type DefinitionFragment, type DefinitionRange, type ReadColumnDefault, type TableColumnDefinition, type TableColumnDefinitionDocument, type TableConstraintDefinition, type TableDefinitionContext } from '../shared/tableColumnPatches';

export interface TableDefinitionToken extends DefinitionRange { kind: 'word' | 'number' | 'identifier' | 'string' | 'symbol' | 'executable'; value: string; }
type Token = TableDefinitionToken;
const knownTypes = new Set(['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'INTEGER', 'BIGINT', 'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'REAL', 'BIT', 'BOOL', 'BOOLEAN', 'CHAR', 'VARCHAR', 'BINARY', 'VARBINARY', 'DATE', 'YEAR', 'TIME', 'DATETIME', 'TIMESTAMP', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB', 'JSON', 'ENUM', 'SET', 'GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON', 'MULTIPOINT', 'MULTILINESTRING', 'MULTIPOLYGON', 'GEOMETRYCOLLECTION']);
const attributes = new Set(['NULL', 'NOT', 'DEFAULT', 'COMMENT', 'CHARACTER', 'CHARSET', 'COLLATE', 'AUTO_INCREMENT', 'ON', 'GENERATED', 'AS', 'VIRTUAL', 'STORED', 'PERSISTENT', 'INVISIBLE', 'VISIBLE', 'COLUMN_FORMAT', 'STORAGE', 'SRID', 'CHECK', 'CONSTRAINT', 'REFERENCES', 'UNIQUE', 'PRIMARY']);
const constraintStarts = new Set(['PRIMARY', 'UNIQUE', 'KEY', 'INDEX', 'FULLTEXT', 'SPATIAL', 'FOREIGN', 'CONSTRAINT', 'CHECK']);
const editableAttributes: ColumnEditableAttribute[] = ['name', 'type', 'nullable', 'default', 'comment', 'position', 'onUpdate'];

/** 字符串的解码仅用于显示；原片段始终保留，后续修改不能从解码值重建未修改属性。 */
function decodeQuoted(source: string, start: number, end: number, quote: string, identifier: boolean, context: TableDefinitionContext): string {
  let value = '';
  const escapes: Record<string, string> = { '0': '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a' };
  for (let index = start + 1; index < end - 1; index++) {
    const char = source[index];
    if (char === quote && source[index + 1] === quote) { value += quote; index++; }
    else if (char === '\\' && !identifier && !context.mode.noBackslashEscapes) { const next = source[++index]; value += next === '%' || next === '_' ? '\\' + next : Object.hasOwn(escapes, next) ? escapes[next] : next; }
    else value += char;
  }
  return value;
}

/** 这是定义属性的保偏移词法层；语句分隔和完整性首先使用既有 SqlScriptScanner 校验。 */
function tokenize(source: string, context: TableDefinitionContext, from = 0, until = source.length): Token[] {
  const tokens: Token[] = [];
  for (let index = from; index < until;) {
    const start = index, char = source[index], next = source[index + 1];
    if (/\s/.test(char)) { index++; continue; }
    if (char === '#' || (char === '-' && next === '-' && /[\x00-\x20\x7f]/.test(source[index + 2] ?? ' '))) { const end = source.indexOf('\n', index); index = end < 0 ? until : Math.min(until, end + 1); continue; }
    if (char === '/' && next === '*') {
      const close = source.indexOf('*/', index + 2);
      if (close < 0 || close + 2 > until) throw new Error('表定义存在未闭合注释');
      index = close + 2;
      if (source[start + 2] === '!' || source.slice(start + 2, start + 4) === 'M!') tokens.push({ kind: 'executable', start, end: index, value: source.slice(start, index) });
      if (tokens.length > limits.tokens) throw new Error('表定义词法单元超出预算');
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      const identifier = char === '`' || (char === '"' && context.mode.ansiQuotes); let closed = false; index++;
      while (index < until) {
        if (source[index] === '\\' && !identifier && !context.mode.noBackslashEscapes) { index += 2; continue; }
        if (source[index] === char) { if (source[index + 1] === char && index + 1 < until) { index += 2; continue; } index++; closed = true; break; }
        index++;
      }
      if (!closed || index > until) throw new Error('表定义存在未闭合引号');
      tokens.push({ kind: identifier ? 'identifier' : 'string', start, end: index, value: decodeQuoted(source, start, index, char, identifier, context) });
    } else if (/[A-Za-z_$\u0080-\uffff]/.test(char)) {
      index++; while (index < until && /[A-Za-z0-9_$\u0080-\uffff]/.test(source[index])) index++;
      tokens.push({ kind: 'word', start, end: index, value: source.slice(start, index) });
    } else if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(next ?? ''))) {
      const match = /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(source.slice(index, until))!;
      index += match[0].length; tokens.push({ kind: 'number', start, end: index, value: match[0] });
    } else { index++; tokens.push({ kind: 'symbol', start, end: index, value: char }); }
    if (tokens.length > limits.tokens) throw new Error('表定义词法单元超出预算');
  }
  return tokens;
}

/** 关键字只来自未引用 word，不能把同名列或字符串当成属性。 */
function word(token: Token | undefined): string { return token?.kind === 'word' ? token.value.toUpperCase() : ''; }
function fragment(source: string, start: number, end: number): DefinitionFragment { return { range: { start, end }, raw: source.slice(start, end) }; }
function isSymbol(token: Token | undefined, symbol: string): boolean { return token?.kind === 'symbol' && token.value === symbol; }
/** 只接受完整平衡的括号组；不让注释或字符串内的括号影响层级。 */
function groupEnd(tokens: Token[], start: number): number {
  if (!isSymbol(tokens[start], '(')) throw new Error('表定义缺少括号');
  let depth = 0;
  for (let index = start; index < tokens.length; index++) {
    if (isSymbol(tokens[index], '(')) { if (++depth > limits.nesting) throw new Error('表定义括号嵌套超出预算'); }
    if (isSymbol(tokens[index], ')') && --depth === 0) return index + 1;
  }
  throw new Error('表定义存在未闭合括号');
}

/** 可执行注释不假定失效；若它可能改变列分隔或括号结构，拒绝产生错误列映射。 */
function validateExecutableColumnFragment(source: string, token: Token, context: TableDefinitionContext): void {
  const prefix = /^\/\*(?:!|M!)(?:\d{5,6})?\s*/.exec(token.value)!;
  const body = tokenize(source, context, token.start + prefix[0].length, token.end - 2);
  let depth = 0;
  for (const item of body) {
    if (item.kind === 'executable') throw new Error('可执行定义注释不允许嵌套');
    if (isSymbol(item, '(')) { if (++depth > limits.nesting) throw new Error('表定义括号嵌套超出预算'); }
    if (isSymbol(item, ')') && --depth < 0) throw new Error('可执行注释可能改变字段边界');
    if ((!depth && isSymbol(item, ',')) || isSymbol(item, ';')) throw new Error('可执行注释可能改变字段边界');
  }
  if (depth) throw new Error('可执行注释可能改变字段边界');
}

/** 单个 DEFAULT 的边界按完整词法值/括号组读取，陌生表达式保持只读原片段。 */
function readDefault(source: string, tokens: Token[], start: number): { value: ReadColumnDefault; end: number } {
  const first = tokens[start]; if (!first || (word(first) !== 'NULL' && attributes.has(word(first)))) throw new Error('DEFAULT 缺少值');
  let end = start + 1, value: ReadColumnDefault;
  if (first.kind === 'string') value = { kind: 'literal', valueType: 'text', value: first.value };
  else if (word(first) === 'NULL') value = { kind: 'null' };
  else if (['TRUE', 'FALSE'].includes(word(first))) value = { kind: 'literal', valueType: 'boolean', value: word(first).toLowerCase() };
  else if (first.kind === 'number') {
    if (/^0x/i.test(first.value)) value = { kind: 'literal', valueType: 'binary', value: first.value.slice(2), introducer: '0x', encoding: 'hex' };
    else if (/^0b/i.test(first.value)) value = { kind: 'literal', valueType: 'binary', value: first.value.slice(2), introducer: '0b', encoding: 'bits' };
    else value = { kind: 'literal', valueType: 'number', value: first.value };
  } else if ((isSymbol(first, '+') || isSymbol(first, '-')) && tokens[start + 1]?.kind === 'number') { end++; value = { kind: 'literal', valueType: 'number', value: first.value + tokens[start + 1].value }; }
  else if (first.kind === 'word' && tokens[start + 1]?.kind === 'string' && (/^_[A-Za-z0-9]+$/.test(first.value) || ['X', 'B', 'N'].includes(word(first)))) {
    end++; value = { kind: 'literal', valueType: ['X', 'B'].includes(word(first)) ? 'binary' : 'text', value: tokens[start + 1].value, introducer: first.value, ...(['X', 'B'].includes(word(first)) ? { encoding: word(first) === 'X' ? 'hex' as const : 'bits' as const } : {}) };
  } else if (isSymbol(first, '(')) { end = groupEnd(tokens, start); value = { kind: 'expression', sql: source.slice(first.start, tokens[end - 1].end) }; }
  else if (['CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME', 'LOCALTIME', 'LOCALTIMESTAMP', 'NOW'].includes(word(first))) {
    if (isSymbol(tokens[end], '(')) end = groupEnd(tokens, end);
    value = { kind: 'expression', sql: source.slice(first.start, tokens[end - 1].end) };
  } else if (first.kind === 'word' && isSymbol(tokens[end], '(')) {
    end = groupEnd(tokens, end); value = { kind: 'expression', sql: source.slice(first.start, tokens[end - 1].end) };
  } else { value = { kind: 'opaque', sql: source.slice(first.start, first.end), reason: '默认值语法尚未识别' }; }
  // 相邻额外 token 不能误当作独立列属性，尤其是运算表达式或未知默认值语法。
  while (end < tokens.length && !attributes.has(word(tokens[end]))) { end = isSymbol(tokens[end], '(') ? groupEnd(tokens, end) : end + 1; value = { kind: 'opaque', sql: source.slice(first.start, tokens[end - 1].end), reason: '默认值边界含未识别片段' }; }
  // COLLATE 可属于文字量表达式，不能误拆成列排序规则后在 DEFAULT 修改中留下或移动它。
  if (word(tokens[end]) === 'COLLATE') {
    end++; if (isSymbol(tokens[end], '=')) end++;
    if (!tokens[end] || !['word', 'identifier'].includes(tokens[end].kind)) throw new Error('DEFAULT 后 COLLATE 缺少值');
    end++; value = { kind: 'opaque', sql: source.slice(first.start, tokens[end - 1].end), reason: '默认值后的 COLLATE 归属不确定，需保留整体定义' };
  }
  return { value, end };
}

/** 提取列属性但不重新生成 SQL；未知片段让该列相关修改保持只读。 */
function readColumn(source: string, tokens: Token[], range: DefinitionRange, ordinal: number): TableColumnDefinition {
  const name = tokens[0], base = tokens[1];
  if (!name || !['identifier', 'word'].includes(name.kind) || !name.value || name.value.includes('\0') || base?.kind !== 'word') throw new Error('无法识别字段名称或类型');
  let cursor = 2;
  if (word(base) === 'DOUBLE' && word(tokens[cursor]) === 'PRECISION') cursor++;
  if (isSymbol(tokens[cursor], '(')) cursor = groupEnd(tokens, cursor);
  while (['UNSIGNED', 'SIGNED', 'ZEROFILL'].includes(word(tokens[cursor]))) cursor++;
  const type = { ...fragment(source, base.start, tokens[cursor - 1].end), known: knownTypes.has(word(base)) };
  const result: TableColumnDefinition = { kind: 'column', ...fragment(source, range.start, range.end), name: name.value, nameRange: { start: name.start, end: name.end }, ordinal, type, nullable: undefined, default: { kind: 'none' }, comment: undefined, attributes: [], access: Object.fromEntries(editableAttributes.map(key => [key, { editable: true }])) as TableColumnDefinition['access'] };
  const seen = new Set<string>();
  /** 普通属性重复必须拒绝；合法的多个列级CHECK分别保留，不以最后一项覆盖。 */
  const add = (kind: ColumnDefinitionAttribute['kind'], from: number, end: number): void => {
    if (kind !== 'opaque' && kind !== 'check' && seen.has(kind)) throw new Error('表定义含重复列属性'); seen.add(kind);
    result.attributes.push({ kind, ...fragment(source, tokens[from].start, tokens[end - 1].end) });
  };
  while (cursor < tokens.length) {
    const start = cursor, key = word(tokens[cursor]); let kind: ColumnDefinitionAttribute['kind'];
    if (key === 'NULL' || (key === 'NOT' && word(tokens[cursor + 1]) === 'NULL')) { kind = 'nullable'; result.nullable = key === 'NULL'; cursor += key === 'NULL' ? 1 : 2; }
    else if (key === 'DEFAULT') { const parsed = readDefault(source, tokens, cursor + 1); result.default = parsed.value; cursor = parsed.end; kind = 'default'; }
    else if (key === 'COMMENT') { if (tokens[cursor + 1]?.kind !== 'string') throw new Error('COMMENT 缺少文本值'); result.comment = tokens[cursor + 1].value; cursor += 2; kind = 'comment'; }
    else if (key === 'AUTO_INCREMENT') { cursor++; kind = 'auto-increment'; }
    else if (['INVISIBLE', 'VISIBLE'].includes(key)) { cursor++; kind = 'visibility'; }
    else if (['COLUMN_FORMAT', 'STORAGE', 'SRID', 'COLLATE', 'CHARSET'].includes(key) || (key === 'CHARACTER' && word(tokens[cursor + 1]) === 'SET')) {
      cursor += key === 'CHARACTER' ? 2 : 1; if (isSymbol(tokens[cursor], '=')) cursor++;
      if (!tokens[cursor] || !['word', 'identifier', 'number'].includes(tokens[cursor].kind)) throw new Error('列属性缺少值'); cursor++;
      kind = key === 'COLLATE' ? 'collation' : key === 'SRID' ? 'srid' : key === 'STORAGE' ? 'storage' : key === 'COLUMN_FORMAT' ? 'column-format' : 'charset';
    } else if (key === 'ON' && word(tokens[cursor + 1]) === 'UPDATE') {
      cursor += 2; if (!['CURRENT_TIMESTAMP', 'NOW', 'LOCALTIME', 'LOCALTIMESTAMP'].includes(word(tokens[cursor]))) throw new Error('无法识别 ON UPDATE 定义'); cursor++;
      if (isSymbol(tokens[cursor], '(')) cursor = groupEnd(tokens, cursor); kind = 'on-update';
    } else if (key === 'GENERATED' || key === 'AS') {
      if (key === 'GENERATED') { cursor++; if (word(tokens[cursor]) === 'ALWAYS') cursor++; if (word(tokens[cursor]) !== 'AS') throw new Error('生成列定义缺少 AS'); }
      cursor++; cursor = groupEnd(tokens, cursor); if (['VIRTUAL', 'STORED', 'PERSISTENT'].includes(word(tokens[cursor]))) cursor++; kind = 'generated';
    } else if (key === 'CHECK' || (key === 'CONSTRAINT' && ['identifier', 'word'].includes(tokens[cursor + 1]?.kind ?? '') && word(tokens[cursor + 2]) === 'CHECK')) {
      if (key === 'CONSTRAINT') cursor += 2; cursor++; cursor = groupEnd(tokens, cursor);
      if (word(tokens[cursor]) === 'NOT' && word(tokens[cursor + 1]) === 'ENFORCED') cursor += 2; else if (word(tokens[cursor]) === 'ENFORCED') cursor++;
      kind = 'check';
    } else {
      // 未识别的语法不猜测其内部关键字边界，剩余片段整体保留。
      cursor = tokens.length; kind = 'opaque';
      result.default = { kind: 'opaque', sql: source.slice(tokens[start].start, tokens[cursor - 1].end), reason: '未知后缀可能含默认值定义，不能显示为无默认值' };
    }
    add(kind, start, cursor);
  }
  const opaque = !type.known || result.attributes.some(attribute => attribute.kind === 'opaque') || result.default.kind === 'opaque' || tokens.some(token => token.kind === 'executable');
  if (opaque) for (const key of editableAttributes) result.access[key] = { editable: false, reason: '此列含未知或可执行定义片段，属性边界不能安全修改' };
  if (seen.has('generated')) for (const key of editableAttributes) result.access[key] = { editable: false, reason: '生成列首批只读，完整定义保留' };
  return result;
}

/** 读取单条 SHOW CREATE TABLE；精确分片可原样回放，但不承担任意 SQL 的服务端语义验证。 */
export function parseTableColumnDefinition(source: string, context: TableDefinitionContext): TableColumnDefinitionDocument {
  if (typeof source !== 'string' || source.length > limits.definitionBytes || new TextEncoder().encode(source).length > limits.definitionBytes) throw new Error('表定义超过 2 MiB 预算');
  if (!context || !['mysql', 'mariadb'].includes(context.dialect) || typeof context.mode?.ansiQuotes !== 'boolean' || typeof context.mode?.noBackslashEscapes !== 'boolean' || context.mode.ansiQuotesKnown === false || context.mode.noBackslashEscapesKnown === false) throw new Error('读取表定义需要明确方言和 SQL 引号模式');
  if (new SqlScriptScanner(context.mode.noBackslashEscapes, context.mode.ansiQuotes).push(source, true).length !== 1) throw new Error('只接受单条 SHOW CREATE TABLE 定义');
  const tokens = tokenize(source, context); let cursor = 0;
  if (word(tokens[cursor++]) !== 'CREATE') throw new Error('表定义必须以 CREATE TABLE 开始');
  if (word(tokens[cursor]) === 'TEMPORARY') throw new Error('首批字段设计不接受临时表');
  if (word(tokens[cursor++]) !== 'TABLE') throw new Error('只接受普通表定义');
  if (word(tokens[cursor]) === 'IF' && word(tokens[cursor + 1]) === 'NOT' && word(tokens[cursor + 2]) === 'EXISTS') cursor += 3;
  /** 名称来自词法 token，不把引用名称中的点号解释成跨库目标。 */
  const readName = (): string => { const token = tokens[cursor++]; if (!token || !['word', 'identifier'].includes(token.kind) || !token.value || token.value.includes('\0')) throw new Error('无法识别表名称'); return token.value; };
  let table = readName(), database: string | undefined;
  if (isSymbol(tokens[cursor], '.')) { cursor++; database = table; table = readName(); }
  const open = tokens[cursor]; if (!isSymbol(open, '(')) throw new Error('表定义缺少字段列表');
  const closeIndex = groupEnd(tokens, cursor) - 1, close = tokens[closeIndex];
  const items: (TableColumnDefinition | TableConstraintDefinition)[] = [], columns: TableColumnDefinition[] = [], columnsByName = new Map<string, TableColumnDefinition>(), folded = new Set<string>(), separators: DefinitionRange[] = [];
  let segment = cursor + 1, segmentStart = open.end, depth = 0;
  /** 只在真实顶层逗号处分片，普通注释和字符串由 token 层屏蔽。 */
  const consume = (until: number, end: number): void => {
    const part = tokens.slice(segment, until); if (!part.length) throw new Error('字段列表包含空定义');
    for (const token of part) if (token.kind === 'executable') validateExecutableColumnFragment(source, token, context);
    const range = { start: segmentStart, end };
    if (constraintStarts.has(word(part[0]))) items.push({ kind: 'constraint', constraintKind: word(part[0]), ...fragment(source, range.start, range.end) });
    else {
      const column = readColumn(source, part, range, columns.length);
      if (folded.has(column.name.toLowerCase())) throw new Error('表定义包含重复或大小写不明确的字段名称');
      if (columns.length >= limits.columns) throw new Error('表定义字段数量超过 4096');
      columns.push(column); columnsByName.set(column.name, column); folded.add(column.name.toLowerCase()); items.push(column);
    }
  };
  for (let index = cursor + 1; index < closeIndex; index++) {
    const token = tokens[index];
    if (isSymbol(token, '(')) depth++;
    else if (isSymbol(token, ')')) depth--;
    else if (depth === 0 && isSymbol(token, ',')) { consume(index, token.start); separators.push({ start: token.start, end: token.end }); segment = index + 1; segmentStart = token.end; }
  }
  consume(closeIndex, close.start); if (!columns.length) throw new Error('表定义至少需要一个可识别字段');
  // SHOW CREATE 不含客户端 DELIMITER；拒绝尾部多余括号或非末尾分隔符。
  for (let index = closeIndex + 1; index < tokens.length; index++) {
    if (isSymbol(tokens[index], '(')) { index = groupEnd(tokens, index) - 1; continue; }
    if (isSymbol(tokens[index], ')') || (isSymbol(tokens[index], ';') && index !== tokens.length - 1)) throw new Error('表定义尾部边界无效');
  }
  return { source, context: structuredClone(context), database, table, head: fragment(source, 0, open.end), body: { start: open.end, end: close.start }, tail: fragment(source, close.start, source.length), items, separators, columns, columnsByName };
}

/** 后续计划器修改前必须查询属性能力，不能把 opaque 列误当完整可编辑模型。 */
export function assertColumnAttributeReadable(column: TableColumnDefinition, attribute: ColumnEditableAttribute): void {
  if (!column.access[attribute].editable) throw new Error(column.access[attribute].reason ?? '字段属性无法安全修改');
}

/** 纯计划器复用同一保偏移词法层识别依赖，不在原文上正则搜索列名或注释关键字。 */
export function tableDefinitionTokens(source: string, context: TableDefinitionContext): TableDefinitionToken[] {
  if (source.length > limits.definitionBytes || new TextEncoder().encode(source).length > limits.definitionBytes) throw new Error('表定义超过 2 MiB 预算');
  return tokenize(source, context);
}

/** MariaDB的JSON别名须完整保有二进制排序规则和本列JSON_VALID校验；不从LONGTEXT或备注猜类型。 */
function mariaJsonAlias(column: TableColumnDefinition, context: TableDefinitionContext, encoding?: { charset: string | null; collation: string | null }): boolean {
  if (context.dialect !== 'mariadb' || column.type.raw.trim().toUpperCase() !== 'LONGTEXT') return false;
  const charset = column.attributes.find(attribute => attribute.kind === 'charset'), collation = column.attributes.find(attribute => attribute.kind === 'collation'), check = column.attributes.find(attribute => attribute.kind === 'check');
  if (!check) return false;
  if (encoding && (encoding.charset !== 'utf8mb4' || encoding.collation !== 'utf8mb4_bin')) return false;
  if ((!charset || !collation) && !encoding) return false;
  const chars = tableDefinitionTokens(charset?.raw ?? 'CHARACTER SET utf8mb4', context).map(token => token.value.toUpperCase()).filter(value => value !== '='), coll = tableDefinitionTokens(collation?.raw ?? 'COLLATE utf8mb4_bin', context).map(token => token.value.toUpperCase()).filter(value => value !== '=');
  if (chars.join(' ') !== 'CHARACTER SET UTF8MB4' && chars.join(' ') !== 'CHARSET UTF8MB4' || coll.join(' ') !== 'COLLATE UTF8MB4_BIN') return false;
  const tokens = tableDefinitionTokens(check.raw, context);
  return tokens.length === 7 && tokens[0].kind === 'word' && tokens[0].value.toUpperCase() === 'CHECK' && tokens[1].value === '(' && tokens[2].kind === 'word' && tokens[2].value.toUpperCase() === 'JSON_VALID' && tokens[3].value === '(' && ['word', 'identifier'].includes(tokens[4].kind) && tokens[4].value === column.name && tokens[5].value === ')' && tokens[6].value === ')';
}

/** 只投影能由受控编辑模型完整表示的常用类型，不把未知修饰符或枚举值大小写抹掉。 */
export function editableColumnType(column: TableColumnDefinition, context: TableDefinitionContext, encoding?: { charset: string | null; collation: string | null }): ColumnTypePatch | undefined {
  const tokens = tableDefinitionTokens(column.type.raw, context), type = tokens[0]?.value.toUpperCase();
  const text = tokens.map(token => token.kind === 'word' ? token.value.toUpperCase() : token.value).join('');
  let value: unknown;
  let match: RegExpExecArray | null;
  if (context.dialect === 'mysql' && text === 'JSON' || mariaJsonAlias(column, context, encoding)) value = { kind: 'json' };
  else if ((match = /^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)(?:\(\d+\))?(UNSIGNED)?$/.exec(text))) value = { kind: 'integer', type: match[1] === 'INTEGER' ? 'INT' : match[1], unsigned: Boolean(match[2]) };
  else if ((match = /^(?:DECIMAL|NUMERIC)\((\d+),(\d+)\)(UNSIGNED)?$/.exec(text))) value = { kind: 'decimal', precision: Number(match[1]), scale: Number(match[2]), unsigned: Boolean(match[3]) };
  else if ((match = /^(FLOAT|DOUBLE)(UNSIGNED)?$/.exec(text))) value = { kind: 'float', type: match[1], unsigned: Boolean(match[2]) };
  else if ((match = /^BIT(?:\((\d+)\))?$/.exec(text))) value = { kind: 'bit', length: Number(match[1] ?? 1) };
  else if ((match = /^(CHAR|VARCHAR|BINARY|VARBINARY)\((\d+)\)$/.exec(text))) value = { kind: 'string', type: match[1], length: Number(match[2]) };
  else if (/^(?:TINY|MEDIUM|LONG)?(?:TEXT|BLOB)$/.test(text)) value = { kind: 'large', type };
  else if (/^(?:DATE|YEAR(?:\(4\))?)$/.test(text)) value = { kind: 'temporal', type };
  else if ((match = /^(TIME|DATETIME|TIMESTAMP)(?:\(([0-6])\))?$/.exec(text))) value = { kind: 'temporal', type: match[1], ...(match[2] !== undefined ? { precision: Number(match[2]) } : {}) };
  else if (['ENUM', 'SET'].includes(type) && tokens[1]?.value === '(' && tokens.at(-1)?.value === ')') {
    const values: string[] = []; let valid = true;
    for (let index = 2; index < tokens.length - 1; index++) {
      const token = tokens[index];
      if (index % 2 === 0 ? token.kind !== 'string' : token.kind !== 'symbol' || token.value !== ',') { valid = false; break; }
      if (index % 2 === 0) values.push(token.value);
    }
    if (valid && tokens.length % 2 === 0) value = { kind: 'enumeration', type, values };
  }
  const result = columnTypePatchSchema.safeParse(value); return result.success ? result.data : undefined;
}
