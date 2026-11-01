import { z } from 'zod';
import { foldSqliteCompletionName as fold, sqliteCompletionLimits as limits } from './sqliteCompletion';

export type SqliteCompletionRelation = { kind: 'physical'; name: string; schema?: 'main' | 'temp'; alias?: string } | { kind: 'local'; source: 'cte' | 'derived'; name: string; alias?: string; columns: string[]; declaration?: true };
export type SqliteCompletionAnalysis = { status: 'ready'; target: { start: number; end: number; prefix: string; quoted: boolean }; syntax: ('relation' | 'column' | 'keyword')[]; qualifiers: string[]; relations: SqliteCompletionRelation[]; unqualifiedColumns?: true } | { status: 'blocked'; reason: string };
type Token = { kind: 'id' | 'string' | 'number' | 'parameter' | 'symbol'; value: string; start: number; end: number; depth: number; quoted?: boolean; closed?: boolean; pair?: number };
type Cte = { name: string; columns?: string[]; start: number; end: number };
type Binding = { relation: SqliteCompletionRelation; start: number; end: number; aliasIndex?: number; unknown?: boolean };
type Ready = Extract<SqliteCompletionAnalysis, { status: 'ready' }>;
const unicode = (value: string) => !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const idStart = (character: string) => !!character && (/[A-Za-z_]/.test(character) || character.codePointAt(0)! >= 128);
const idPart = (character: string) => !!character && (/[A-Za-z0-9_$]/.test(character) || character.codePointAt(0)! >= 128);
/** 显式never函数声明让目录边界失败后的分支可靠收窄，不能继续使用未确认值。 */
function fail(reason: string): never { throw new Error(reason); }
const boundary = (source: string, offset: number) => !(offset > 0 && offset < source.length && /[\uD800-\uDBFF]/.test(source[offset - 1]) && /[\uDC00-\uDFFF]/.test(source[offset]));
const keyword = (token: Token | undefined, word: string) => !!token && token.kind === 'id' && !token.quoted && fold(token.value) === word;
const structural = new Set('select from where group having order limit offset returning set values into update delete insert replace join on using as left right full outer inner cross natural union except intersect window indexed not by and or when then else end case'.split(' '));

/** SQLite词法独立实现：--无需空白、块注释不嵌套、方括号在第一个]结束，不借用MySQL模式。 */
function lex(source: string, offset: number): Token[] {
  const tokens: Token[] = [], stack: number[] = []; let i = 0, depth = 0;
  const push = (token: Token) => { if (tokens.length >= limits.tokens) fail('budget'); tokens.push(token); };
  const inSpan = (start: number, end: number, open: boolean) => offset >= start && (offset < end || open && offset === end);
  while (i < source.length) {
    const start = i, character = source[i];
    if (/[\t\n\v\f\r ]/.test(character)) { i++; continue; }
    if (source.startsWith('--', i)) { i += 2; while (i < source.length && source[i] !== '\r' && source[i] !== '\n') i++; if (inSpan(start, i, i === source.length)) fail('comment'); continue; }
    if (source.startsWith('/*', i)) { const close = source.indexOf('*/', i + 2); i = close < 0 ? source.length : close + 2; if (inSpan(start, i, close < 0)) fail('comment'); continue; }
    if (character === "'" || character === '"' || character === '\u0060' || character === '[') {
      const closing = character === '[' ? ']' : character; let value = '', closed = false; i++;
      while (i < source.length) {
        if (source[i] === closing) { if (character !== '[' && source[i + 1] === closing) { value += closing; i += 2; continue; } i++; closed = true; break; }
        const point = source.codePointAt(i)!; value += String.fromCodePoint(point); i += point > 65535 ? 2 : 1;
      }
      const kind = character === "'" ? 'string' : 'id';
      if (kind === 'string' && inSpan(start, i, !closed)) fail('string');
      if (kind === 'id' && value.length > limits.nameUnits) fail('budget');
      push({ kind, value, start, end: i, depth, quoted: kind === 'id', closed }); continue;
    }
    if (character === ':' || character === '@' || character === '$' || character === '?') {
      i++; while (i < source.length && (idPart(String.fromCodePoint(source.codePointAt(i)!)) || character === '$' && source[i] === ':')) i += source.codePointAt(i)! > 65535 ? 2 : 1;
      if (character === '$' && source[i] === '(') { const close = source.indexOf(')', i + 1); i = close < 0 ? source.length : close + 1; }
      if (offset >= start && offset <= i) fail('parameter');
      push({ kind: 'parameter', value: source.slice(start, i), start, end: i, depth }); continue;
    }
    if (idStart(String.fromCodePoint(source.codePointAt(i)!))) {
      i += source.codePointAt(i)! > 65535 ? 2 : 1;
      while (i < source.length && idPart(String.fromCodePoint(source.codePointAt(i)!))) i += source.codePointAt(i)! > 65535 ? 2 : 1;
      const value = source.slice(start, i); if (value.length > limits.nameUnits) fail('budget'); push({ kind: 'id', value, start, end: i, depth }); continue;
    }
    if (/[0-9]/.test(character) || character === '.' && /[0-9]/.test(source[i + 1] ?? '')) {
      i++; while (i < source.length && /[A-Za-z0-9_.]/.test(source[i])) i++;
      if (offset >= start && offset <= i) fail('number'); push({ kind: 'number', value: source.slice(start, i), start, end: i, depth }); continue;
    }
    if (character === '(') { if (++depth > limits.depth) fail('budget'); const index = tokens.length; push({ kind: 'symbol', value: character, start, end: ++i, depth: depth - 1 }); stack.push(index); continue; }
    if (character === ')') { const open = stack.pop(); if (open !== undefined) depth--; const index = tokens.length; push({ kind: 'symbol', value: character, start, end: ++i, depth, ...(open === undefined ? {} : { pair: open }) }); if (open !== undefined) tokens[open].pair = index; continue; }
    push({ kind: 'symbol', value: character, start, end: ++i, depth });
  }
  return tokens;
}

/** 全引号范围替换；prefix只解码光标之前的原文，UTF16坐标不转换成码点下标。 */
function targetAt(source: string, tokens: Token[], offset: number): Ready['target'] {
  const token = tokens.find(item => item.kind === 'id' && item.start <= offset && offset <= item.end);
  if (!token) return { start: offset, end: offset, prefix: '', quoted: false };
  const quote = token.quoted ? source[token.start] : '', end = token.quoted && token.closed ? Math.min(offset, token.end - 1) : offset;
  let prefix = source.slice(token.start + (token.quoted ? 1 : 0), Math.max(token.start + (token.quoted ? 1 : 0), end));
  if (quote && quote !== '[') prefix = prefix.split(quote + quote).join(quote);
  if (prefix.length > limits.prefixUnits) fail('prefix');
  return { start: token.start, end: token.end, prefix, quoted: !!token.quoted };
}

/** 只分析原statement；CREATE TRIGGER的body分号不被误当独立SQL作用域。 */
function statementAt(tokens: Token[], offset: number): { start: number; end: number } {
  let start = 0, triggerStart = -1, body = false, cases = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (i === start && keyword(token, 'create')) { let next = i + 1; if (keyword(tokens[next], 'temp') || keyword(tokens[next], 'temporary')) next++; if (keyword(tokens[next], 'trigger')) triggerStart = i; }
    if (triggerStart >= 0) {
      if (keyword(token, 'case')) cases++;
      else if (keyword(token, 'end') && cases) cases--;
      else if (keyword(token, 'begin')) body = true;
      else if (body && keyword(token, 'end') && token.depth === 0) {
        const end = tokens[i + 1]?.value === ';' ? i + 2 : i + 1;
        if (offset >= tokens[triggerStart].start && offset <= (tokens[end - 1]?.end ?? token.end)) fail('trigger');
        i = end - 1; start = end; triggerStart = -1; body = false; continue;
      }
      continue;
    }
    if (token.value === ';' && token.depth === 0) { if (offset <= token.start) return { start, end: i }; start = i + 1; }
  }
  if (triggerStart >= 0 && offset >= tokens[triggerStart].start) fail('trigger');
  return { start, end: tokens.length };
}

/** 仅推导SQLite可证明的简单投影名/显式alias；星号和无alias复杂表达式绝不借永久同名表补列。 */
function projectionColumns(tokens: Token[], start: number, end: number): string[] | undefined {
  const depth = tokens[start]?.depth ?? 0; let select = -1;
  for (let i = start; i < end; i++) if (tokens[i].depth === depth && keyword(tokens[i], 'select')) { select = i; break; }
  if (select < 0) return; let finish = end;
  for (let i = select + 1; i < end; i++) if (tokens[i].depth === depth && ['from', 'union', 'intersect', 'except', 'order', 'limit'].some(word => keyword(tokens[i], word))) { finish = i; break; }
  let begin = select + 1; if (keyword(tokens[begin], 'distinct') || keyword(tokens[begin], 'all')) begin++;
  const parts: Token[][] = []; for (let i = begin, last = begin; i <= finish; i++) if (i === finish || tokens[i].depth === depth && tokens[i].value === ',') { parts.push(tokens.slice(last, i)); last = i + 1; }
  const columns: string[] = [];
  for (const part of parts) {
    if (!part.length || part.some(token => token.value === '*' && token.depth === depth)) return;
    let name: string | undefined, as = -1;
    for (let i = 0; i < part.length; i++) if (part[i].depth === depth && keyword(part[i], 'as')) as = i;
    if (as >= 0) { if (as !== part.length - 2 || part[as + 1]?.kind !== 'id') return; name = part[as + 1].value; }
    else if (part.length % 2 === 1 && part.every((token, i) => i % 2 ? token.value === '.' : token.kind === 'id')) name = part.at(-1)!.value;
    else if (part.at(-1)?.kind === 'id' && part.length > 1 && (part.at(-2)?.value === ')' || ['id', 'number', 'string'].includes(part.at(-2)!.kind) && !['collate', 'escape', 'is', 'like', 'glob', 'regexp', 'match', 'over', 'filter'].some(word => keyword(part.at(-2), word))) && !structural.has(fold(part.at(-1)!.value))) name = part.at(-1)!.value;
    if (!name || !unicode(name) || columns.some(column => fold(column) === fold(name!))) return;
    columns.push(name); if (columns.length > limits.entries) fail('budget');
  }
  return columns.length ? columns : undefined;
}

/** 纯分析入口不读取文件、会话、IPC或数据库；预算与未知语法均以固定原因阻断。 */
export function analyzeSqliteCompletion(source: string, offset: number): SqliteCompletionAnalysis {
  try {
    if (typeof source !== 'string' || source.length > limits.sourceUnits) fail('budget');
    if (!unicode(source) || !Number.isSafeInteger(offset) || offset < 0 || offset > source.length || !boundary(source, offset)) fail('input');
    const tokens = lex(source, offset), target = targetAt(source, tokens, offset), statement = statementAt(tokens, offset), beforeTarget = tokens.filter(token => token.end <= target.start), qualifiers: string[] = [];
    let q = beforeTarget.length - 1;
    while (q >= 1 && beforeTarget[q].value === '.' && beforeTarget[q - 1].kind === 'id') { qualifiers.unshift(beforeTarget[q - 1].value); q -= 2; }
    if (qualifiers.length > 2) fail('qualifier');
    const active = tokens.slice(statement.start, statement.end);
    if (active.some(token => token.value === '#' || token.value === ']' || token.value === ')' && token.pair === undefined)) fail('syntax');
    let relationBudget = 0;
    /** 收集本层CTE头后再推导输出，前向引用与递归名先遮蔽永久对象。 */
    function withClause(start: number, end: number, inherited: Map<string, Cte>): { head: number; ctes: Map<string, Cte>; declared: Cte[] } {
      const ctes = new Map(inherited), declared: Cte[] = []; let i = start;
      if (!keyword(tokens[i], 'with')) return { head: i, ctes, declared };
      i++; if (keyword(tokens[i], 'recursive')) i++;
      while (i < end) {
        const name = tokens[i++]; if (name?.kind !== 'id' || !name.value) fail('cte');
        let columns: string[] | undefined;
        if (tokens[i]?.value === '(') {
          const close = tokens[i].pair; if (close === undefined || close >= end) fail('cte');
          columns = []; for (let at = i + 1; at < close; at++) { if ((at - i) % 2 ? tokens[at].kind !== 'id' || !tokens[at].value : tokens[at].value !== ',') fail('cte'); if ((at - i) % 2) columns.push(tokens[at].value); }
          if (!columns.length || columns.length > limits.entries || new Set(columns.map(fold)).size !== columns.length) fail('cte'); i = close + 1;
        }
        if (!keyword(tokens[i++], 'as')) fail('cte');
        if (keyword(tokens[i], 'not')) { i++; if (!keyword(tokens[i++], 'materialized')) fail('cte'); } else if (keyword(tokens[i], 'materialized')) i++;
        if (tokens[i]?.value !== '(') fail('cte'); const open = i++, close = tokens[open].pair ?? end;
        const cte: Cte = { name: name.value, columns: columns ?? projectionColumns(tokens, i, close), start: i, end: close };
        if (declared.some(value => fold(value.name) === fold(cte.name))) fail('cte');
        if (++relationBudget > limits.relations) fail('budget'); declared.push(cte); ctes.set(fold(cte.name), cte); i = close < end ? close + 1 : end;
        if (tokens[i]?.value !== ',') break; i++;
      }
      return { head: i, ctes, declared };
    }
    function scope(start: number, end: number, inherited: Map<string, Cte>, outer: Binding[], level: number): { bindings: Binding[]; ctes: Map<string, Cte>; syntax: Ready['syntax']; unqualified?: true } {
      if (level > limits.depth) fail('budget');
      const parsed = withClause(start, end, inherited), ctes = parsed.ctes, head = parsed.head, base = tokens[head]?.depth ?? tokens[start]?.depth ?? 0;
      for (const cte of parsed.declared) if (offset >= (tokens[cte.start]?.start ?? source.length) && offset <= (tokens[cte.end]?.start ?? source.length)) return scope(cte.start, cte.end, ctes, [], level + 1);
      if (head >= end) return { bindings: [], ctes, syntax: ['keyword'] };
      const command = fold(tokens[head].value);
      if (!['select', 'update', 'insert', 'replace', 'delete'].includes(command) || tokens[head].quoted) {
        if (head === start && tokens.length === 1 && tokens[0].kind === 'id') return { bindings: [], ctes, syntax: ['keyword'] };
        fail('statement');
      }
      if (tokens.slice(head, end).some(token => token.depth === base && ['union', 'intersect', 'except'].some(word => keyword(token, word)))) fail('compound');
      const own: Binding[] = [], derived: { start: number; end: number }[] = []; let relationContext = false, aliasContext = false, targetBinding: Binding | undefined, insertList: { start: number; end: number } | undefined;
      const relevant = (begin: number, finish: number) => offset >= (tokens[begin]?.start ?? source.length) && target.start <= (tokens[finish - 1]?.end ?? source.length);
      function relation(at: number, target = false): number {
        const begin = at; let binding: Binding;
        if (tokens[at]?.value === '(') {
          const open = at++, close = tokens[open].pair ?? end;
          if (!keyword(tokens[at], 'select') && !keyword(tokens[at], 'with')) fail('relation-group');
          derived.push({ start: at, end: close }); const columns = projectionColumns(tokens, at, close); at = close < end ? close + 1 : end;
          if (keyword(tokens[at], 'as')) at++;
          const alias = tokens[at]; if (alias?.kind !== 'id' || !alias.value || !alias.quoted && structural.has(fold(alias.value))) { if (offset >= tokens[open].start && offset <= (tokens[close]?.start ?? source.length)) return at; fail('derived-alias'); }
          binding = { relation: { kind: 'local', source: 'derived', name: alias.value, alias: alias.value, columns: columns ?? [] }, start: begin, end: at + 1, aliasIndex: at, unknown: !columns }; at++;
        } else {
          const first = tokens[at]; if (!first || first.kind !== 'id') { if (!first || first.start >= offset) { relationContext = true; return at; } fail('relation'); }
          if (!first.value) { relationContext = true; return at + 1; }
          let name = first.value, schema: 'main' | 'temp' | undefined; at++;
          if (tokens[at]?.value === '.') {
            const folded = fold(name); if (folded !== 'main' && folded !== 'temp') fail('schema'); schema = folded; at++;
            if (tokens[at]?.kind !== 'id' || !tokens[at].value) { relationContext = true; return at; } name = tokens[at++].value;
          }
          const nameEnd = at;
          if (tokens[at]?.value === '(' && command === 'select') fail('table-function');
          const local = schema === undefined ? ctes.get(fold(name)) : undefined; if (target && local) fail('dml-target');
          binding = { relation: local ? { kind: 'local', source: 'cte', name: local.name, columns: local.columns ?? [] } : { kind: 'physical', name, ...(schema ? { schema } : {}) }, start: begin, end: at, unknown: !!local && !local.columns };
          relationContext ||= relevant(begin, nameEnd);
          if (keyword(tokens[at], 'as')) { at++; const alias = tokens[at]; if (!alias || alias.kind !== 'id' || !alias.value) { aliasContext = true; return at; } binding.relation.alias = alias.value; binding.aliasIndex = at; at++; }
          else if (tokens[at]?.kind === 'id' && (tokens[at].quoted || !structural.has(fold(tokens[at].value)))) { binding.relation.alias = tokens[at].value; binding.aliasIndex = at; at++; }
          binding.end = at;
        }
        if (binding.aliasIndex !== undefined && relevant(binding.aliasIndex, binding.aliasIndex + 1)) aliasContext = true;
        if (++relationBudget > limits.relations) fail('budget'); own.push(binding); return at;
      }
      let index = head + 1;
      if (command === 'update' || command === 'insert' || command === 'replace') {
        if (keyword(tokens[index], 'or')) index += 2;
        if (keyword(tokens[index], 'into')) index++;
        index = relation(index, true); targetBinding = own[0];
        if ((command === 'insert' || command === 'replace') && tokens[index]?.value === '(') insertList = { start: index, end: tokens[index].pair ?? end };
      }
      let inFrom = false;
      for (let at = command === 'select' || command === 'delete' ? head + 1 : index; at < end; at++) {
        const token = tokens[at]; if (token.depth !== base) continue;
        if (keyword(token, 'from') || keyword(token, 'join') || token.value === ',' && inFrom) { const next = relation(at + 1, command === 'delete' && !targetBinding); if (command === 'delete' && !targetBinding) targetBinding = own[0]; inFrom = true; if (next > at + 1) at = next - 1; continue; }
        if (['where', 'group', 'having', 'order', 'limit', 'returning', 'set', 'values', 'window'].some(word => keyword(token, word))) inFrom = false;
      }
      // 子查询只继承真正可相关的外层binding；FROM派生表与CTE体不得看到外层行别名。
      for (let at = head; at < end; at++) if (tokens[at].value === '(' && (keyword(tokens[at + 1], 'select') || keyword(tokens[at + 1], 'with'))) {
        const finish = tokens[at].pair ?? end;
        if (offset >= (tokens[at + 1]?.start ?? source.length) && offset <= (tokens[finish]?.start ?? source.length)) return scope(at + 1, finish, ctes, derived.some(item => item.start === at + 1) ? [] : [...own, ...outer], level + 1);
        at = finish;
      }
      const aliases = new Set<string>(); for (const binding of own) { const name = fold(binding.relation.alias ?? binding.relation.name), previous = own.find(item => item !== binding && aliases.has(name) && fold(item.relation.alias ?? item.relation.name) === name); if (previous && !(qualifiers.length === 2 && binding.relation.kind === 'physical' && previous.relation.kind === 'physical' && !binding.relation.alias && !previous.relation.alias && !!binding.relation.schema && !!previous.relation.schema && binding.relation.schema !== previous.relation.schema)) fail('ambiguous'); aliases.add(name); }
      const bindings = [...own, ...outer.filter(binding => !aliases.has(fold(binding.relation.alias ?? binding.relation.name)))];
      if (aliasContext) fail('alias');
      let unqualified = false;
      if (insertList && offset >= tokens[insertList.start].end && offset <= (tokens[insertList.end]?.start ?? source.length)) unqualified = true;
      const returning = tokens.findIndex((token, at) => at >= head && at < end && token.depth === base && keyword(token, 'returning'));
      if (returning >= 0 && offset >= tokens[returning].end && targetBinding) unqualified = true;
      if (command === 'update') {
        const set = tokens.findIndex((token, at) => at >= head && at < end && token.depth === base && keyword(token, 'set'));
        if (set >= 0 && offset >= tokens[set].end) {
          let last = set + 1, stop = end;
          for (let at = set + 1; at < end; at++) if (tokens[at].depth === base && ['where', 'from', 'returning', 'order', 'limit'].some(word => keyword(tokens[at], word))) { stop = at; break; }
          if (offset <= (tokens[stop]?.start ?? source.length)) {
            for (let at = set + 1; at < stop; at++) if (tokens[at].depth === base && tokens[at].value === ',' && tokens[at].end <= target.start) last = at + 1;
            const equals = tokens.findIndex((token, at) => at >= last && at < stop && token.depth === base && token.value === '=');
            if (equals < 0 || target.start <= tokens[equals].start) unqualified = true;
          }
        }
      }
      if (unqualified) { if (qualifiers.length) fail('qualified-target'); return { bindings: targetBinding ? [targetBinding] : [], ctes, syntax: ['column'], unqualified: true }; }
      if (command === 'insert' || command === 'replace') {
        const select = tokens.findIndex((token, at) => at >= index && at < end && token.depth === base && keyword(token, 'select'));
        if (select >= 0 && offset >= tokens[select].start && (returning < 0 || offset < tokens[returning].start)) return scope(select, returning < 0 ? end : returning, ctes, [], level + 1);
        const values = tokens.findIndex((token, at) => at >= index && at < end && token.depth === base && keyword(token, 'values'));
        if (values >= 0 && offset >= tokens[values].end) fail('values');
      }
      for (let at = head; at < end; at++) if (keyword(tokens[at], 'using') && tokens[at + 1]?.value === '(' && offset >= tokens[at + 1].end && offset <= (tokens[tokens[at + 1].pair ?? end]?.start ?? source.length)) fail('using');
      const priorTokens = tokens.filter((token, at) => at >= head && at < end && token.end <= target.start);
      if (keyword(priorTokens.at(-1), 'by') && keyword(priorTokens.at(-2), 'indexed')) fail('index');
      if (!relationContext) {
        const prior = tokens.filter((token, at) => at >= head && at < end && token.end <= target.start).at(-1);
        relationContext = !!prior && ['from', 'join', 'update', 'into'].some(word => keyword(prior, word)) || !!prior && prior.value === ',' && inFrom;
      }
      if (!relationContext && bindings.some(binding => binding.unknown && (!qualifiers.length || fold(binding.relation.alias ?? binding.relation.name) === fold(qualifiers[0])))) fail('local-output');
      return { bindings, ctes, syntax: relationContext ? ['relation', 'keyword'] : ['column', 'keyword'] };
    }
    const parsed = scope(statement.start, statement.end, new Map(), [], 0);
    const declarations: SqliteCompletionRelation[] = [...parsed.ctes.values()].map(cte => ({ kind: 'local', source: 'cte', name: cte.name, columns: cte.columns ?? [], declaration: true }));
    const relations = [...parsed.bindings.map(binding => binding.relation), ...declarations];
    if (relations.length > limits.relations) fail('budget');
    if (parsed.syntax.includes('relation') && qualifiers.some(name => !['main', 'temp'].includes(fold(name))) || qualifiers.length === 2 && !['main', 'temp'].includes(fold(qualifiers[0]))) fail('schema');
    return { status: 'ready', target, syntax: parsed.syntax, qualifiers, relations, ...(parsed.unqualified ? { unqualifiedColumns: true } : {}) };
  } catch (reason) { return { status: 'blocked', reason: reason instanceof Error && /^[a-z-]{1,64}$/.test(reason.message) ? reason.message : 'analysis' }; }
}

const nameSchema = z.string().min(1).max(limits.nameUnits).refine(unicode), relationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('physical'), name: nameSchema, schema: z.enum(['main', 'temp']).optional(), alias: nameSchema.optional() }).strict(),
  z.object({ kind: z.literal('local'), source: z.enum(['cte', 'derived']), name: nameSchema, alias: nameSchema.optional(), columns: z.array(nameSchema).max(limits.entries).refine(columns => new Set(columns.map(fold)).size === columns.length), declaration: z.literal(true).optional() }).strict(),
]);
const resultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('blocked'), reason: z.string().regex(/^[a-z-]{1,64}$/) }).strict(),
  z.object({ status: z.literal('ready'), target: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), prefix: z.string().max(limits.prefixUnits).refine(unicode), quoted: z.boolean() }).strict(), syntax: z.array(z.enum(['relation', 'column', 'keyword'])).min(1).max(3).refine(value => new Set(value).size === value.length), qualifiers: z.array(nameSchema).max(2), relations: z.array(relationSchema).max(limits.relations), unqualifiedColumns: z.literal(true).optional() }).strict(),
]);
/** Client只核有界回包形状与原范围，不在渲染线程重新解析整份用户SQL。 */
export function validateSqliteCompletionAnalysis(raw: unknown, source: string, offset: number): SqliteCompletionAnalysis {
  const value = resultSchema.parse(raw) as SqliteCompletionAnalysis;
  if (new TextEncoder().encode(JSON.stringify(value)).length > limits.outputBytes) fail('budget');
  if (value.status === 'blocked') return value;
  if (value.relations.some(relation => relation.kind === 'local' && relation.declaration && relation.source !== 'cte')) fail('response');
  const target = value.target;
  if (target.start > offset || target.end < offset || target.end > source.length || !boundary(source, target.start) || !boundary(source, target.end) || !boundary(source, offset)) fail('response');
  const rawName = source.slice(target.start, target.end), quote = rawName[0], quoted = ['"', '\u0060', '['].includes(quote ?? '');
  if (target.quoted !== quoted || rawName.length > limits.nameUnits * 2 + 2) fail('response');
  let prefix = source.slice(target.start + (quoted ? 1 : 0), offset);
  if (quoted) { const close = quote === '[' ? ']' : quote; if (rawName.endsWith(close) && offset === target.end) prefix = prefix.slice(0, -1); if (quote !== '[') prefix = prefix.split(quote + quote).join(quote); }
  else if (rawName && (!idStart(String.fromCodePoint(rawName.codePointAt(0)!)) || !Array.from(rawName).every(idPart)) || !quoted && (idPart(source[target.end] ?? '') || target.start > 0 && idPart(source[target.start - 1]))) fail('response');
  if (prefix !== target.prefix || value.unqualifiedColumns && (!value.syntax.includes('column') || value.qualifiers.length)) fail('response');
  return value;
}
