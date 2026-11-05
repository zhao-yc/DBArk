import { postgresCompletionLimits, type PostgresCompletionReference } from '../shared/postgresCompletion';
import { scanPostgresEditorTokens, type PostgresEditorToken } from '../shared/postgresSql';

type Token = PostgresEditorToken;
export interface PostgresCompletionRelation extends PostgresCompletionReference { alias?: string; }
export interface PostgresCompletionAnalysis {
  start: number;
  end: number;
  prefix: string;
  quoted: boolean;
  query?: { kind: 'relations'; schema?: string } | { kind: 'columns'; relations: PostgresCompletionRelation[]; qualified: boolean };
}
const entries = new Set(['FROM', 'JOIN', 'UPDATE', 'INTO']);
const stop = new Set(['FROM', 'JOIN', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'FETCH',
  'UNION', 'EXCEPT', 'INTERSECT', 'RETURNING', 'SET', 'VALUES', 'FOR', 'ON', 'USING', 'CROSS', 'LEFT', 'RIGHT',
  'INNER', 'OUTER', 'FULL', 'NATURAL', 'WINDOW', 'AS', 'WITH', 'SELECT', 'TABLESAMPLE', 'OVERRIDING', 'CONFLICT', 'DO', 'NULLS', 'DISTINCT']);

/** PostgreSQL 未引用标识符仅折叠 ASCII 大写字母，引用名称保留原大小写。 */
const identifier = (token?: Token) => token?.kind === 'identifier' && !token.open ? token.text
  : token?.kind === 'word' ? token.text.replace(/[A-Z]/g, char => char.toLowerCase()) : undefined;
const keyword = (token?: Token) => token?.kind === 'word' ? token.text.toUpperCase() : '';
const punct = (token: Token | undefined, value: string) => token?.kind === 'punct' && token.text === value;

/** 读取 FROM、JOIN、UPDATE 或 INTO 的直接关系与别名，不把函数调用当成物理表。 */
function reference(tokens: Token[], start: number, allowColumnList: boolean): PostgresCompletionRelation | undefined {
  let index = keyword(tokens[start]) === 'ONLY' ? start + 1 : start;
  const first = identifier(tokens[index++]);
  if (!first || stop.has(keyword(tokens[index - 1]))) return;
  let schema: string | undefined, name = first;
  if (punct(tokens[index], '.')) {
    const next = identifier(tokens[index + 1]);
    if (!next) return;
    schema = first;
    name = next;
    index += 2;
  }
  if (punct(tokens[index], '.') || !allowColumnList && punct(tokens[index], '(')) return;
  const as = keyword(tokens[index]) === 'AS';
  const candidate = tokens[index + (as ? 1 : 0)];
  const alias = candidate && !stop.has(keyword(candidate)) ? identifier(candidate) : undefined;
  if ([schema, name, alias].some(value => value && value.length > postgresCompletionLimits.name)) return;
  return { name, ...(schema ? { schema } : {}), ...(alias ? { alias } : {}) };
}

/** 收集当前顶层查询的关系，逗号仅在 FROM 清单中引入额外表。 */
function collect(tokens: Token[]): { refs: PostgresCompletionRelation[]; from: boolean } {
  const refs: PostgresCompletionRelation[] = [];
  let from = false;
  for (let i = 0; i < tokens.length; i++) {
    const word = keyword(tokens[i]);
    if (['WHERE','GROUP','ORDER','HAVING','LIMIT','OFFSET','FETCH','RETURNING','UNION','EXCEPT','INTERSECT','SET','VALUES'].includes(word)) from = false;
    if (word === 'FROM' && keyword(tokens[i - 1]) === 'DISTINCT' || word === 'UPDATE' && i !== 0 ||
        word === 'INTO' && keyword(tokens[0]) !== 'INSERT') continue;
    if (word === 'FROM' || word === 'JOIN') from = true;
    if (!entries.has(word) && !(from && punct(tokens[i], ','))) continue;
    const item = reference(tokens, i + 1, word === 'INTO');
    if (item && !refs.some(ref => ref.name === item.name && ref.schema === item.schema && ref.alias === item.alias)) refs.push(item);
  }
  return { refs, from };
}

/** 解析当前语句及可替换的完整标识符；复杂作用域不降级到同名物理表。 */
export function analyzePostgresCompletion(source: string, offset: number): PostgresCompletionAnalysis | undefined {
  if (source.length > postgresCompletionLimits.source || offset < 0 || offset > source.length || source.includes('\0')) return;
  const all = scanPostgresEditorTokens(source, postgresCompletionLimits.tokens);
  if (!all) return;
  if (all.some(token => token.kind === 'blocked' && offset > token.start && (offset < token.end || token.open && offset === token.end))) return;
  const target = all.find(token => (token.kind === 'word' || token.kind === 'identifier') && offset >= token.start && offset <= token.end);
  const start = target?.start ?? offset, end = target?.end ?? offset, quoted = target?.kind === 'identifier';
  const raw = source.slice(start, offset);
  const prefix = quoted ? raw.slice(1, !target?.open && offset === end ? -1 : undefined).replaceAll('""', '"') : raw;
  if (prefix.length > postgresCompletionLimits.name) return;
  const base: PostgresCompletionAnalysis = { start, end, prefix, quoted };
  const tokens: Token[] = [], statement: Token[] = [];
  let depth = 0, cursorDepth = 0, nestedQuery = false;
  for (const token of all) {
    if (punct(token, ';') && depth === 0) {
      if (token.start >= offset) break;
      tokens.length = 0; statement.length = 0; nestedQuery = false; cursorDepth = 0;
      continue;
    }
    if (punct(token, ')')) depth = Math.max(0, depth - 1);
    if (token.kind === 'blocked' && token.text === 'comment') continue;
    statement.push(token);
    if (depth === 0) tokens.push(token);
    if (depth > 0 && ['SELECT','WITH'].includes(keyword(token))) nestedQuery = true;
    if (punct(token, '(')) depth++;
    if (token.end <= offset) cursorDepth = depth;
  }
  if (tokens.some(token => ['WITH','UNION','EXCEPT','INTERSECT'].includes(keyword(token))) || nestedQuery) return base;
  if (tokens[0] && !['SELECT','UPDATE','INSERT','DELETE'].includes(keyword(tokens[0]))) return base;
  const left = statement.filter(token => token.end <= start && token !== target);
  const previous = left.at(-1), dotted = punct(previous, '.');
  const qualifier = dotted ? identifier(left.at(-2)) : undefined;
  const beforeQualifier = dotted ? left.at(-3) : undefined;
  const referenceEntry = (position: number) => {
    const index = keyword(left.at(position)) === 'ONLY' ? position - 1 : position;
    const word = keyword(left.at(index));
    return entries.has(word) && !(word === 'FROM' && keyword(left.at(index - 1)) === 'DISTINCT') &&
      !(word === 'INTO' && keyword(tokens[0]) !== 'INSERT') && !(word === 'UPDATE' && left.at(index) !== tokens[0]);
  };
  if (!cursorDepth && (referenceEntry(-1) || dotted && qualifier && referenceEntry(-3) ||
      (dotted ? punct(beforeQualifier, ',') && !!qualifier : punct(previous, ',')) &&
        collect(tokens.filter(token => token.end <= (dotted ? beforeQualifier : previous)!.start)).from)) {
    return { ...base, query: { kind: 'relations', ...(dotted && qualifier ? { schema: qualifier } : {}) } };
  }
  if (keyword(previous) === 'AS') return base;
  const refs = collect(tokens).refs;
  if (dotted) {
    if (!qualifier) return base;
    const schema = punct(beforeQualifier, '.') ? identifier(left.at(-4)) : undefined;
    const matches = refs.filter(ref => schema ? !ref.alias && ref.schema === schema && ref.name === qualifier : (ref.alias ?? ref.name) === qualifier);
    return matches.length === 1 ? { ...base, query: { kind: 'columns', relations: matches, qualified: true } } : base;
  }
  return refs.length > 0 && refs.length <= postgresCompletionLimits.relations
    ? { ...base, query: { kind: 'columns', relations: refs, qualified: false } } : base;
}
