export interface PostgresStatement {
  sql: string;
  start: number;
  end: number;
  parameters: number[];
  keyword: string;
}

const maxScriptLength = 4 * 1024 * 1024;
const whitespace = /[ \t\n\r\f\v]/;
const identifierStart = /[A-Za-z_\u0080-\uFFFF]/;
const identifierPart = /[A-Za-z_0-9$\u0080-\uFFFF]/;
const tagPart = /[A-Za-z_0-9\u0080-\uFFFF]/;

/** 扫描普通引号、标识符引号及转义字符串，返回紧随闭引号的位置。 */
function quotedEnd(source: string, opening: number, backslash: boolean): number {
  const quote = source[opening];
  for (let i = opening + 1; i < source.length; i++) {
    if (backslash && source[i] === '\\') { i++; continue; }
    if (source[i] !== quote) continue;
    if (source[i + 1] === quote) { i++; continue; }
    return i + 1;
  }
  throw Error('PostgreSQL引用未闭合');
}

/** PostgreSQL的块注释可嵌套，内部引号和分号均属于注释。 */
function blockCommentEnd(source: string, opening: number): number {
  let depth = 1, index = opening + 2;
  while (index < source.length && depth) {
    const pair = source.slice(index, index + 2);
    if (pair === '/*') { depth++; index += 2; }
    else if (pair === '*/') { depth--; index += 2; }
    else index++;
  }
  if (depth) throw Error('PostgreSQL块注释未闭合');
  return index;
}

/** 识别完整dollar标签；标签本身允许非ASCII标识符字符。 */
function dollarTag(source: string, opening: number): string | undefined {
  let index = opening + 1;
  if (source[index] === '$') return '$$';
  if (!identifierStart.test(source[index] ?? '')) return;
  while (index < source.length && tagPart.test(source[index])) index++;
  if (source[index] === '$') return source.slice(opening, index + 1);
}

/** 保留原文偏移，注释、引号及dollar正文中的分号和参数均不参与拆句。 */
export function splitPostgresSql(source: string, standardStrings = true, firstOnly = false): PostgresStatement[] {
  if (source.length > maxScriptLength || source.includes('\0')) throw Error('PostgreSQL脚本超过4MiB或包含NUL');
  const statements: PostgresStatement[] = [];
  let start = 0, index = 0, meaningful = false, keyword = '';
  let parameters = new Set<number>();
  const finish = (end: number) => {
    if (meaningful) {
      if (statements.length >= 1000) throw Error('PostgreSQL脚本最多1000条语句');
      statements.push({ sql: source.slice(start, end), start, end, parameters: [...parameters].sort((a, b) => a - b), keyword });
    }
    start = end + 1;
    meaningful = false;
    parameters = new Set();
    keyword = '';
  };
  while (index < source.length) {
    const c = source[index], next = source[index + 1];
    if (whitespace.test(c)) { index++; continue; }
    if (c === '-' && next === '-') {
      index += 2;
      while (index < source.length && source[index] !== '\r' && source[index] !== '\n') index++;
      continue;
    }
    if (c === '/' && next === '*') { index = blockCommentEnd(source, index); continue; }
    if (c === ';') {
      finish(index++);
      if (firstOnly && statements.length) return statements;
      continue;
    }
    if (!meaningful && identifierStart.test(c)) {
      let end = index + 1;
      while (end < source.length && identifierPart.test(source[end])) end++;
      keyword = source.slice(index, end).toUpperCase();
    }
    meaningful = true;
    if (c === "'" || c === '"') {
      const explicitEscape = /[eE]/.test(source[index - 1] ?? '') && !identifierPart.test(source[index - 2] ?? '');
      index = quotedEnd(source, index, c === "'" && (!standardStrings || explicitEscape));
      continue;
    }
    if (c === '$' && !identifierPart.test(source[index - 1] ?? '')) {
      const tag = dollarTag(source, index);
      if (tag) {
        const end = source.indexOf(tag, index + tag.length);
        if (end < 0) throw Error('PostgreSQL dollar-quote未闭合');
        index = end + tag.length;
        continue;
      }
      if (/[0-9]/.test(next ?? '')) {
        let end = index + 2;
        while (end < source.length && /[0-9]/.test(source[end])) end++;
        const n = Number(source.slice(index + 1, end));
        if (!Number.isSafeInteger(n) || n < 1 || n > 200) throw Error('PostgreSQL位置参数仅支持$1至$200');
        parameters.add(n);
        index = end;
        continue;
      }
    }
    index++;
  }
  finish(source.length);
  return statements;
}

/** 光标只选择原文内的准确语句，使用编辑器的UTF-16偏移。 */
export function currentPostgresStatement(source: string, offset: number, standardStrings = true): PostgresStatement {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length) throw Error('PostgreSQL光标位置无效');
  const statements = splitPostgresSql(source, standardStrings);
  const selected = statements.find(statement => offset >= statement.start && offset <= statement.end) ??
    (offset === source.length ? statements.at(-1) : undefined);
  if (!selected) throw Error('当前位置没有可执行PostgreSQL语句');
  return selected;
}

/** 目录标识符只按PostgreSQL双引号规则生成。 */
export function postgresIdentifier(value: string): string {
  if (!value || value.includes('\0')) throw Error('PostgreSQL标识符无效');
  return '"' + value.replaceAll('"', '""') + '"';
}

/** 脚本逐句按实际ParameterStatus识别下一条，前句改变字符串模式时重新取边界。 */
export function firstPostgresStatement(source: string, standardStrings = true): PostgresStatement | undefined {
  return splitPostgresSql(source, standardStrings, true)[0];
}

/** 目录双引号复合名逐段重建，其他来源作为单一标识符。 */
export function postgresRelationSelect(name: string): string {
  const parts = /^"((?:""|[^"])*)"\."((?:""|[^"])*)"$/.exec(name);
  const target = parts
    ? postgresIdentifier(parts[1].replaceAll('""', '"')) + '.' + postgresIdentifier(parts[2].replaceAll('""', '"'))
    : postgresIdentifier(name);
  return 'SELECT * FROM ' + target + ' LIMIT 1000;';
}
