import { postgresCompletionLimits as limits, type PostgresCompletionReference, type PostgresRoutineCompletionTarget } from '../shared/postgresCompletion';
import { scanPostgresEditorTokens, type PostgresEditorToken } from '../shared/postgresSql';

type Group = { kind: 'group'; start: number; end: number; closed: boolean; closing: ')' | ']'; parts: Part[] };
type Part = PostgresEditorToken | Group;
interface Projection { names: (string | null)[]; stars: PostgresCompletionReference[]; exact: boolean; }
export interface PostgresCompletionRelation extends PostgresCompletionReference { alias?: string; projection?: Projection; }
type Scope = ReadonlyMap<string, Projection>;
type Query = { kind: 'relations'; schema?: string; ctes?: string[] } |
  { kind: 'columns'; relations: PostgresCompletionRelation[]; qualified: boolean };
export interface PostgresCompletionAnalysis {
  start: number;
  end: number;
  prefix: string;
  quoted: boolean;
  query?: Query;
  routine?: PostgresRoutineCompletionTarget;
  existingCall?: boolean;
}
const entries = new Set(['FROM', 'JOIN', 'UPDATE', 'INTO']);
const endsFrom = new Set(['WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'FETCH', 'RETURNING',
  'SET', 'VALUES', 'WINDOW', 'FOR']);
const setOperators = new Set(['UNION', 'EXCEPT', 'INTERSECT']);
const stop = new Set([...entries, ...endsFrom, ...setOperators, 'ON', 'USING', 'CROSS', 'LEFT', 'RIGHT',
  'INNER', 'OUTER', 'FULL', 'NATURAL', 'AS', 'WITH', 'SELECT', 'TABLESAMPLE', 'OVERRIDING',
  'CONFLICT', 'DO', 'NULLS', 'DISTINCT', 'LATERAL', 'ONLY', 'END', 'COLLATE', 'TRUE', 'FALSE', 'NULL']);
const commands = new Set(['SELECT', 'UPDATE', 'INSERT', 'DELETE', 'VALUES', 'WITH', 'CALL']);
const expressionEntries = new Set(['SELECT', 'WHERE', 'HAVING', 'ON', 'RETURNING', 'VALUES', 'WHEN', 'THEN', 'ELSE',
  'AND', 'OR', 'NOT', 'BY', 'DISTINCT', 'ALL']);
const expressionOperators = new Set(['(', '[', ',', '=', '+', '-', '*', '/', '%', '<', '>', '|', '&', '^', '~']);
const unknown: Projection = { names: [], stars: [], exact: false };

/** PostgreSQL 未引用标识符折叠 ASCII 大写字母，引用名称保留原大小写。 */
const identifier = (part?: Part) => part?.kind === 'identifier' && !part.open ? part.text
  : part?.kind === 'word' ? part.text.replace(/[A-Z]/g, char => char.toLowerCase()) : undefined;
const keyword = (part?: Part) => part?.kind === 'word' ? part.text.toUpperCase() : '';
const punct = (part: Part | undefined, value: string) => part?.kind === 'punct' && part.text === value;
const contains = (part: Group, offset: number) => part.start < offset && (part.closed ? offset < part.end : offset <= part.end);

/** 只建当前语句的括号树，保留未闭合括号以处理编辑中的 SQL。 */
function groupStatement(tokens: PostgresEditorToken[], offset: number, length: number): Part[] | undefined {
  const root: Part[] = [];
  const stack: Group[] = [];
  for (const token of tokens) {
    if (token.kind === 'blocked' && token.text === 'comment') continue;
    if (!stack.length && punct(token, ';')) {
      if (token.start >= offset) break;
      root.length = 0;
      continue;
    }
    if (stack.length && punct(token, stack.at(-1)!.closing)) {
      const group = stack.pop()!;
      group.end = token.end;
      group.closed = true;
      continue;
    }
    const current = stack.at(-1)?.parts ?? root;
    if (punct(token, '(') || punct(token, '[')) {
      if (stack.length >= 24) return;
      const group: Group = { kind: 'group', start: token.start, end: length, closed: false,
        closing: punct(token, '(') ? ')' : ']', parts: [] };
      current.push(group);
      stack.push(group);
    } else current.push(token);
  }
  return root;
}

/** 位置别名覆盖已知输出；通配展开缺少位置时只保留显式声明。 */
function rename(projection: Projection, names: string[]): Projection {
  if (!names.length) return projection;
  return {
    names: [...names, ...(projection.exact ? projection.names.slice(names.length) : [])].slice(0, limits.items),
    stars: [],
    exact: projection.exact,
  };
}

/** 列名列表必须由完整标识符和逗号组成。 */
function nameList(group?: Part): string[] {
  if (group?.kind !== 'group' || group.closing !== ')' || !group.closed || group.parts.length % 2 !== 1) return [];
  const names: string[] = [];
  for (let i = 0; i < group.parts.length; i += 2) {
    const name = identifier(group.parts[i]);
    if (!name || name.length > limits.name || i && !punct(group.parts[i - 1], ',')) return [];
    names.push(name);
  }
  return names;
}

/** 关系入口与 FROM 清单边界沿同一规则识别。 */
function relationEntry(parts: Part[], index: number): boolean {
  const word = keyword(parts[index]);
  return entries.has(word) &&
    !(word === 'FROM' && keyword(parts[index - 1]) === 'DISTINCT') &&
    !(word === 'UPDATE' && index !== 0) &&
    !(word === 'INTO' && keyword(parts[0]) !== 'INSERT');
}

/** 写入目标只能是实际表，WITH 同名定义只参与读取位置。 */
function writeTarget(parts: Part[], index: number): boolean {
  const word = keyword(parts[index]);
  return word === 'UPDATE' || word === 'INTO' || word === 'FROM' && index === 1 && keyword(parts[0]) === 'DELETE';
}

interface QueryContext {
  offset: number;
  start: number;
  left: PostgresEditorToken[];
}
interface Parsed { projection: Projection; query?: Query; routine?: PostgresRoutineCompletionTarget; }

/** 只接受一个 schema 限定符，关系别名和赋值左侧继续由字段补全处理。 */
function expressionRoutine(main: Part[], left: PostgresEditorToken[], cursorGroup: Part | undefined,
  refs: PostgresCompletionRelation[][]): PostgresRoutineCompletionTarget | undefined {
  const dotted = punct(left.at(-1), '.');
  const schema = dotted ? identifier(left.at(-2)) : undefined;
  if (dotted && (!schema || refs.some(level => level.some(ref => (ref.alias ?? ref.name) === schema)))) return;
  const before = left.at(dotted ? -3 : -1);
  if (!before || !(expressionEntries.has(keyword(before)) || (before.kind === 'punct' && expressionOperators.has(before.text)))) return;
  const command = keyword(main[0]);
  if (cursorGroup) {
    const index = main.indexOf(cursorGroup);
    if (keyword(main[index - 1]) === 'USING' || (command === 'INSERT' &&
        !main.slice(0, index).some(part => ['VALUES', 'SELECT', 'RETURNING'].includes(keyword(part))))) return;
  } else if (command === 'UPDATE') {
    const preceding = main.filter(part => part.end <= before.end);
    const set = preceding.findIndex(part => keyword(part) === 'SET');
    if (set >= 0 && !preceding.slice(set + 1).some(part => ['WHERE', 'RETURNING', 'FROM'].includes(keyword(part)))) {
      const reversed = preceding.slice(set + 1).reverse();
      const separator = reversed.findIndex(part => punct(part, ','));
      if (!reversed.slice(0, separator < 0 ? undefined : separator).some(part => punct(part, '='))) return;
    }
  }
  return { context: 'expression', ...(schema ? { schema } : {}) };
}

/** 收集确定的投影名称，并将单源通配符的目录读取留给现有只读接口。 */
function project(parts: Part[], refs: PostgresCompletionRelation[]): Projection {
  const row = parts[1];
  if (keyword(parts[0]) === 'VALUES' && row?.kind === 'group' && row.closed && row.parts.length) {
    const count = 1 + row.parts.filter(part => punct(part, ',')).length;
    return { names: Array.from({ length: Math.min(count, limits.items) }, (_, i) => 'column' + (i + 1)),
      stars: [], exact: count <= limits.items };
  }
  const select = keyword(parts[0]) === 'SELECT';
  const returning = parts.findIndex(part => keyword(part) === 'RETURNING');
  if (!select && returning < 0) return unknown;
  let start = select ? 1 : returning + 1;
  if (select && ['ALL', 'DISTINCT'].includes(keyword(parts[start]))) start++;
  if (select && keyword(parts[start]) === 'ON' && parts[start + 1]?.kind === 'group') start += 2;
  const names: (string | null)[] = [];
  const stars: PostgresCompletionReference[] = [];
  const mergedJoinColumns = parts.some(part => ['NATURAL', 'USING'].includes(keyword(part)));
  let exact = true;
  let end = start;
  while (end <= parts.length) {
    const word = keyword(parts[end]);
    const done = end === parts.length || word === 'FROM' && keyword(parts[end - 1]) !== 'DISTINCT' || endsFrom.has(word);
    if (!done && !punct(parts[end], ',')) { end++; continue; }
    const column = parts.slice(start, end);
    const last = column.at(-1);
    const tail = identifier(last);
    const explicit = keyword(column.at(-2)) === 'AS';
    const path = column.length % 2 === 1 && column.every((part, i) =>
      i % 2 ? punct(part, '.') : !!identifier(part) && !stop.has(keyword(part)));
    const prior = column.at(-2);
    const implicit = column.length === 2 && (prior?.kind === 'group' || prior?.kind === 'blocked' ||
      (!!identifier(prior) && !stop.has(keyword(prior))) || (prior?.kind === 'punct' && /^[0-9]$/.test(prior.text))) ||
      column.length === 3 && prior?.kind === 'group' && !!identifier(column[0]);
    if (punct(last, '*')) {
      const owner = identifier(column.at(-3));
      const schema = column.length === 5 ? identifier(column[0]) : undefined;
      const match = column.length === 1 && !select ? refs.slice(0, 1)
        : column.length === 1 && !mergedJoinColumns ? refs : punct(column.at(-2), '.') && owner &&
        (column.length === 3 || schema && punct(column[1], '.')) ? refs.filter(ref => schema
          ? !ref.alias && ref.name === owner && ref.schema === schema : (ref.alias ?? ref.name) === owner) : [];
      if (match.length && (column.length === 1 || match.length === 1)) {
        for (const ref of match) {
          if (ref.projection) {
            names.push(...ref.projection.names);
            stars.push(...ref.projection.stars);
            exact &&= ref.projection.exact;
          } else {
            stars.push({ name: ref.name, ...(ref.schema ? { schema: ref.schema } : {}) });
            exact = false;
          }
        }
      } else exact = false;
    } else if (tail && tail.length <= limits.name && (explicit || (path || implicit) && !stop.has(keyword(last)))) {
      names.push(tail);
    } else if (column.length) names.push(null);
    if (done) break;
    start = ++end;
  }
  return { names: names.slice(0, limits.items), stars: stars.length <= limits.relations ? stars : [],
    exact: exact && names.length <= limits.items };
}

/** 在当前查询层或可关联的外层查找限定名，当前层同名别名遮蔽外层。 */
function columns(refs: PostgresCompletionRelation[], outer: PostgresCompletionRelation[][], left: PostgresEditorToken[]): Query | undefined {
  if (punct(left.at(-1), '.')) {
    const qualifier = identifier(left.at(-2));
    if (!qualifier) return;
    const schema = punct(left.at(-3), '.') ? identifier(left.at(-4)) : undefined;
    for (const level of [refs, ...outer]) {
      const matches = level.filter(ref => schema ? !ref.alias && ref.schema === schema && ref.name === qualifier : (ref.alias ?? ref.name) === qualifier);
      if (matches.length) return matches.length === 1 ? { kind: 'columns', relations: matches, qualified: true } : undefined;
    }
    return;
  }
  const level = refs.length ? refs : outer.find(group => group.length) ?? [];
  const names = level.map(ref => ref.alias ?? (ref.schema ? JSON.stringify([ref.schema, ref.name]) : ref.name));
  if (level.length && level.length <= limits.relations && (level.length === 1 || names.every(Boolean) && new Set(names).size === level.length)) {
    return { kind: 'columns', relations: level, qualified: false };
  }
}

/** 推导当前查询的输出，并且只为包含光标的查询层返回补全目标。 */
function parseQuery(parts: Part[], inherited: Scope, outer: PostgresCompletionRelation[][], context?: QueryContext): Parsed {
  if (parts.length === 1 && parts[0].kind === 'group') {
    return parseQuery(parts[0].parts, inherited, outer, context && contains(parts[0], context.offset) ? context : undefined);
  }
  if (parts.length && parts[0].kind !== 'group' && !commands.has(keyword(parts[0]))) return { projection: unknown };
  let start = 0;
  let scope = inherited;
  if (keyword(parts[0]) === 'WITH') {
    const ctes = new Map(inherited);
    scope = ctes;
    const recursive = keyword(parts[1]) === 'RECURSIVE';
    const definitions: { name: string; names: string[]; body: Group }[] = [];
    start = recursive ? 2 : 1;
    do {
      const name = identifier(parts[start++]);
      if (!name || name.length > limits.name) return { projection: unknown };
      const names = nameList(parts[start]);
      if (parts[start]?.kind === 'group') start++;
      if (keyword(parts[start++]) !== 'AS') return { projection: unknown };
      if (keyword(parts[start]) === 'NOT') start++;
      if (keyword(parts[start]) === 'MATERIALIZED') start++;
      const body = parts[start++];
      if (body?.kind !== 'group') return { projection: unknown };
      definitions.push({ name, names, body });
    } while (punct(parts[start], ',') && ++start);
    // 递归 WITH 中先占住所有声明名，避免自引用或后置定义落到同名物理表。
    if (recursive) for (const { name, names } of definitions) ctes.set(name, rename(unknown, names));
    for (const { name, names, body } of definitions) {
      const active = context && contains(body, context.offset) ? context : undefined;
      const anchorEnd = recursive ? body.parts.findIndex(part => keyword(part) === 'UNION') : -1;
      if (active && anchorEnd > 0 && body.parts[anchorEnd].end <= active.offset) {
        const anchor = parseQuery(body.parts.slice(0, anchorEnd), ctes, outer);
        ctes.set(name, rename(anchor.projection, names));
      }
      const parsed = parseQuery(body.parts, ctes, outer, active);
      if (active) return parsed;
      ctes.set(name, rename(parsed.projection, names));
    }
  }
  const main = parts.slice(start);
  const firstSet = main.findIndex(part => setOperators.has(keyword(part)));
  if (firstSet >= 0) {
    let output = unknown, branchStart = 0, query: Query | undefined, routine: PostgresRoutineCompletionTarget | undefined;
    for (let i = 0; i <= main.length; i++) {
      if (i < main.length && !setOperators.has(keyword(main[i]))) continue;
      const branch = main.slice(branchStart, i);
      const active = context && (main[branchStart - 1]?.end ?? 0) <= context.offset &&
        (main[i]?.start ?? Infinity) >= context.offset ? context : undefined;
      // 最后一个分支后的 ORDER BY 归组合结果，不能看到该分支的表。
      const order = branchStart > 0 && i === main.length ? branch.findIndex(part => keyword(part) === 'ORDER') : -1;
      const inOrder = active && order >= 0 && active.offset >= branch[order].start;
      const parsed = parseQuery(order >= 0 ? branch.slice(0, order) : branch, scope, outer, inOrder ? undefined : active);
      if (branchStart === 0) output = parsed.projection;
      if (inOrder) query = columns([{ name: '', projection: output }], [], active.left);
      else if (active) { query = parsed.query; routine = parsed.routine; }
      if (['ALL', 'DISTINCT'].includes(keyword(main[i + 1]))) i++;
      branchStart = i + 1;
    }
    return { projection: output, query, routine };
  }

  const refs: PostgresCompletionRelation[] = [];
  const commas = new Set<number>();
  let from = false;
  for (let i = 0; i < main.length; i++) {
    const word = keyword(main[i]);
    if (endsFrom.has(word)) from = false;
    if (from && punct(main[i], ',')) commas.add(i);
    if (!relationEntry(main, i) && !commas.has(i)) continue;
    if (word === 'FROM' || word === 'JOIN') from = true;
    let next = i + 1;
    const modifier = keyword(main[next]);
    if (modifier === 'ONLY' || modifier === 'LATERAL') next++;
    let part = main[next];
    let name = '', schema: string | undefined, projection: Projection | undefined;
    if (part?.kind === 'group') {
      const active = context && contains(part, context.offset) ? context : undefined;
      const parsed = parseQuery(part.parts, scope, modifier === 'LATERAL' ? [refs, ...outer] : outer, active);
      if (active) return parsed;
      projection = parsed.projection;
      next++;
    } else {
      const first = identifier(part);
      if (!first || stop.has(keyword(part))) continue;
      name = first;
      if (punct(main[++next], '.')) {
        name = identifier(main[next + 1]) ?? '';
        schema = first;
        next += 2;
      }
      if (!name || punct(main[next], '.')) continue;
      if (main[next]?.kind === 'group' && word !== 'INTO') {
        // 表函数的别名仍会遮蔽外层关系，未声明字段时不查询同名物理表。
        projection = unknown;
        next++;
      } else if (!schema && !writeTarget(main, i)) projection = scope.get(name);
    }
    if (keyword(main[next]) === 'AS') next++;
    part = main[next];
    const alias = !stop.has(keyword(part)) ? identifier(part) : undefined;
    if (alias) {
      const renamed = nameList(main[next + 1]);
      if (renamed.length) projection = rename(projection ?? unknown, renamed);
    }
    if ([name, schema, alias].some(value => value && value.length > limits.name)) continue;
    refs.push({ name, ...(schema ? { schema } : {}), ...(alias ? { alias } : {}), ...(projection ? { projection } : {}) });
  }
  const projection = project(main, refs);
  if (!context || start > 0 && (main[0]?.start ?? context.start) > context.start) return { projection };

  const { left, offset } = context;
  const cursorGroup = main.find(part => part.kind === 'group' && contains(part, offset));
  if (cursorGroup?.kind === 'group') {
    let group = cursorGroup;
    // 只深入包含光标的表达式括号，普通函数参数仍沿用本层字段。
    while (true) {
      if (commands.has(keyword(group.parts[0]))) return parseQuery(group.parts, scope, [refs, ...outer], context);
      const nested = group.parts.find(part => part.kind === 'group' && contains(part, offset));
      if (nested?.kind !== 'group') break;
      group = nested;
    }
  } else {
    const dotted = punct(left.at(-1), '.');
    const qualifier = dotted ? identifier(left.at(-2)) : undefined;
    let before = left.at(dotted ? -3 : -1);
    const modifier = keyword(before);
    if (modifier === 'ONLY' || modifier === 'LATERAL') before = left.at(dotted ? -4 : -2);
    const position = main.findIndex(part => part === before);
    if (position === 0 && keyword(before) === 'CALL' && (!dotted || qualifier))
      return { projection, routine: { context: 'call', ...(qualifier ? { schema: qualifier } : {}) } };
    if (position >= 0 && (!dotted || qualifier) && (relationEntry(main, position) || commas.has(position))) {
      const ctes = qualifier || writeTarget(main, position) ? [] : [...scope.keys()].slice(0, limits.items);
      const routine: PostgresRoutineCompletionTarget | undefined = modifier !== 'ONLY' && !writeTarget(main, position)
        ? { context: 'from', ...(qualifier ? { schema: qualifier } : {}) } : undefined;
      return { projection, query: modifier === 'LATERAL' ? undefined :
        { kind: 'relations', ...(qualifier ? { schema: qualifier } : {}), ...(ctes.length ? { ctes } : {}) }, routine };
    }
  }
  return { projection, query: keyword(left.at(-1)) === 'AS' ? undefined : columns(refs, outer, left),
    routine: expressionRoutine(main, left, cursorGroup, [refs, ...outer]) };
}

/** 定位当前标识符，屏蔽注释、字符串和参数，再解析当前语句的查询作用域。 */
export function analyzePostgresCompletion(source: string, offset: number): PostgresCompletionAnalysis | undefined {
  if (source.length > limits.source || offset < 0 || offset > source.length || source.includes('\0')) return;
  const all = scanPostgresEditorTokens(source, limits.tokens);
  if (!all || all.some(token => token.kind === 'blocked' && offset > token.start &&
      (offset < token.end || token.open && offset === token.end))) return;
  const target = all.find(token => (token.kind === 'word' || token.kind === 'identifier') && offset >= token.start && offset <= token.end);
  const start = target?.start ?? offset, end = target?.end ?? offset, quoted = target?.kind === 'identifier';
  const raw = source.slice(start, offset);
  const prefix = quoted ? raw.slice(1, !target?.open && offset === end ? -1 : undefined).replaceAll('""', '"') : raw;
  if (prefix.length > limits.name) return;
  const parts = groupStatement(all, offset, source.length);
  const left = all.filter(token => token !== target && token.end <= start && !(token.kind === 'blocked' && token.text === 'comment'));
  const parsed = parts && parseQuery(parts, new Map(), [], { offset, start, left });
  const routine = parsed?.routine && (prefix || parsed.routine.schema) ? parsed.routine : undefined;
  const next = routine && all.find(token => token !== target && token.start >= end && !(token.kind === 'blocked' && token.text === 'comment'));
  return { start, end, prefix, quoted, ...(parsed?.query ? { query: parsed.query } : {}),
    ...(routine ? { routine, existingCall: punct(next || undefined, '(') } : {}) };
}

/** 在最近的调用层定位当前实参，字面量、数组、子查询和嵌套调用内的逗号不计入外层。 */
export function analyzePostgresSignature(source: string, offset: number) {
  if (source.length > limits.source || offset < 0 || offset > source.length || source.includes('\0')) return;
  const scanned = scanPostgresEditorTokens(source, limits.tokens);
  const tokens = scanned?.filter(token => !(token.kind === 'blocked' && token.text === 'comment'));
  if (!tokens) return;
  const frames: { index: number; close: ')' | ']'; start: number; argument: number; previousNames: string[] }[] = [];
  const namedAt = (start: number) => {
    const operator = tokens[start + 1], last = tokens[start + 2];
    return operator && last && operator.end === last.start && last.end <= offset &&
      (punct(operator, '=') && punct(last, '>') || punct(operator, ':') && punct(last, '=')) ? identifier(tokens[start]) : undefined;
  };
  for (let i = 0; i < tokens.length && tokens[i].end <= offset; i++) {
    const token = tokens[i], frame = frames.at(-1);
    if (punct(token, '(') || punct(token, '[')) {
      if (frames.length >= 24) return;
      frames.push({ index: i, close: punct(token, '(') ? ')' : ']', start: i + 1, argument: 0, previousNames: [] });
    } else if (punct(token, ')') || punct(token, ']')) {
      if (frame && !punct(token, frame.close)) return;
      frames.pop();
    } else if (punct(token, ';')) frames.length = 0;
    else if (frame?.close === ')' && punct(token, ',')) {
      const name = namedAt(frame.start);
      if (name) frame.previousNames.push(name);
      frame.argument++;
      frame.start = i + 1;
    }
  }
  for (const frame of frames.reverse()) {
    if (frame.close !== ')') continue;
    const token = tokens[frame.index - 1], name = identifier(token);
    if (!name || name.length > limits.name || stop.has(keyword(token))) continue;
    const analysis = analyzePostgresCompletion(source, token.end);
    if (!analysis?.routine || !analysis.existingCall) continue;
    return { name, routine: analysis.routine, argument: frame.argument, named: namedAt(frame.start), previousNames: frame.previousNames };
  }
}
