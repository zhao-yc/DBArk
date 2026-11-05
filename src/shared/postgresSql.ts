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

/** 目录复合名逐段还原；每段的成对双引号仅解码一次。 */
function parseQualifiedRelation(value: string): { schema: string; name: string } | undefined {
  const parts = /^"((?:""|[^"])*)"\."((?:""|[^"])*)"$/.exec(value);
  if (parts) return { schema: parts[1].replaceAll('""', '"'), name: parts[2].replaceAll('""', '"') };
}

/** 表工作台将旧式未限定关系名明确解释为 public 下的单个标识符。 */
export function postgresRelationName(value: string): { schema: string; name: string } {
  return parseQualifiedRelation(value) ?? { schema: 'public', name: value };
}

/** 草稿保留现有单标识符行为，目录复合名逐段重建。 */
export function postgresRelationSelect(name: string): string {
  const relation = parseQualifiedRelation(name);
  const target = relation
    ? postgresIdentifier(relation.schema) + '.' + postgresIdentifier(relation.name)
    : postgresIdentifier(name);
  return 'SELECT * FROM ' + target + ' LIMIT 1000;';
}

export interface PostgresEditorToken {
  kind: 'word' | 'identifier' | 'punct' | 'blocked';
  start: number;
  end: number;
  text: string;
  open?: boolean;
}

/** 编辑器允许未闭合的标识符，字符串和注释沿原词法边界一律禁止目录请求。 */
export function scanPostgresEditorTokens(source: string, budget: number): PostgresEditorToken[] | undefined {
  const result: PostgresEditorToken[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i], next = source[i + 1];
    if (whitespace.test(c)) { i++; continue; }
    if (result.length >= budget) return;
    const start = i;
    if (c === '-' && next === '-') {
      i += 2;
      while (i < source.length && source[i] !== '\r' && source[i] !== '\n') i++;
      result.push({ kind: 'blocked', start, end: i, text: 'comment', open: true });
    } else if (c === '/' && next === '*') {
      let open = false;
      try { i = blockCommentEnd(source, i); } catch { i = source.length; open = true; }
      result.push({ kind: 'blocked', start, end: i, text: 'comment', open });
    } else if (c === '"' || c === "'") {
      let open = false;
      // 兼容未掌握的会话字符串设置，反斜杠后一律不恢复字符串内的补全。
      try { i = quotedEnd(source, i, c === "'"); } catch { i = source.length; open = true; }
      result.push({ kind: c === '"' ? 'identifier' : 'blocked', start, end: i,
        text: c === '"' ? source.slice(start + 1, open ? i : i - 1).replaceAll('""', '"') : '', open });
    } else if (c === '$' && dollarTag(source, i)) {
      const tag = dollarTag(source, i)!;
      const end = source.indexOf(tag, i + tag.length);
      i = end < 0 ? source.length : end + tag.length;
      result.push({ kind: 'blocked', start, end: i, text: '', open: end < 0 });
    } else if (c === '$') {
      i++;
      while (i < source.length && /[0-9]/.test(source[i])) i++;
      result.push({ kind: 'blocked', start, end: i, text: '', open: true });
    } else if (identifierStart.test(c)) {
      i++;
      while (i < source.length && identifierPart.test(source[i])) i++;
      result.push({ kind: 'word', start, end: i, text: source.slice(start, i) });
    } else {
      i++;
      result.push({ kind: 'punct', start, end: i, text: c });
    }
  }
  return result;
}
