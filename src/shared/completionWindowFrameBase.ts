import type { CompletionToken } from './completionLexical';
import type { CompletionQueryBranch } from './completionQueryScope';
import { completionLimits } from './sqlCompletion';

const word = (token: CompletionToken | undefined, value: string) => token?.kind === 'word' && token.value.toUpperCase() === value;
const symbol = (token: CompletionToken | undefined, value: string) => token?.kind === 'symbol' && token.value === value;
const key = (token: CompletionToken | undefined) => token && ['word', 'identifier'].includes(token.kind) && /^[A-Za-z_][A-Za-z0-9_$]{0,63}$/.test(token.value) ? token.value.toLowerCase() : undefined;

/** 窗口帧只属于SELECT、ORDER或真正WINDOW定义，WHERE／GROUP／HAVING不能借完整语法恢复。 */
export function completionWindowFramePosition(branches: CompletionQueryBranch[], tokens: CompletionToken[], openStart: number): boolean {
  const branch = branches.filter(item => item.select.start < openStart && openStart < item.end)
    .sort((a, b) => b.select.depth - a.select.depth || b.select.start - a.select.start)[0];
  if (!branch) return false;
  const open = tokens.findIndex(token => token.start === openStart && symbol(token, '('));
  if (open < 0) return false;
  // 此处只识别语法位置，不解析继承名；原有Unicode／带空格引用名不能被ASCII继承限制误拦。
  const definition = (index: number) => tokens[index].depth === branch.select.depth && word(tokens[index - 1], 'AS')
    && ['word', 'identifier'].includes(tokens[index - 2]?.kind ?? '');
  const parents: number[] = [];
  for (let index = 0; index < open; index++) {
    if (tokens[index].start <= branch.select.start) continue;
    if (symbol(tokens[index], '(')) parents.push(index);
    else if (symbol(tokens[index], ')')) parents.pop();
  }
  // 同查询块不能把窗口嵌在另一个窗口定义里；独立子查询此前的父括号不参与本块判断。
  if (parents.some(index => word(tokens[index - 1], 'OVER') || definition(index))) return false;
  let clause = 'SELECT';
  for (let index = 0; index < tokens.length && tokens[index].start < openStart; index++) {
    const token = tokens[index];
    if (token.start < branch.select.start || token.depth !== branch.select.depth || symbol(tokens[index - 1], '.')) continue;
    if (['FROM', 'WHERE', 'HAVING', 'WINDOW', 'LIMIT', 'INTO', 'FOR'].some(value => word(token, value))) clause = token.value.toUpperCase();
    if ((word(token, 'ORDER') || word(token, 'GROUP')) && word(tokens[index + 1], 'BY')) clause = token.value.toUpperCase();
  }
  return clause === 'WINDOW' ? definition(open) : ['SELECT', 'ORDER'].includes(clause);
}

/** 只在完整候选语法成立后核当前查询块的帧继承；不生成目录目标或猜测服务器名称规则。 */
export function completionWindowFrameBase(branches: CompletionQueryBranch[], tokens: CompletionToken[], openStart: number): boolean {
  const open = tokens.findIndex(token => token.start === openStart && symbol(token, '('));
  if (open < 0) return false;
  const branch = branches.filter(item => item.select.start < openStart && openStart < item.end)
    .sort((a, b) => b.select.depth - a.select.depth || b.select.start - a.select.start)[0];
  if (!branch) return false;
  const boundary = tokens.find(token => token.start > branch.select.start && (symbol(token, ')') && token.depth < branch.select.depth
    || token.depth === branch.select.depth && ['UNION', 'INTERSECT', 'EXCEPT'].some(value => word(token, value))))?.start ?? Infinity;
  const starts = tokens.flatMap((token, index) => token.start > branch.select.start && token.start < boundary
    && token.depth === branch.select.depth && word(token, 'WINDOW') && !symbol(tokens[index - 1], '.') ? [index] : []);
  if (starts.length !== 1) return false;
  const close = new Map<number, number>(), stack: number[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (symbol(tokens[index], '(')) stack.push(index);
    else if (symbol(tokens[index], ')')) { const start = stack.pop(); if (start !== undefined) close.set(start, index); }
  }
  const definitions = new Map<string, number>();
  let index = starts[0] + 1;
  while (index < tokens.length) {
    const name = key(tokens[index]), body = index + 2, end = close.get(body);
    if (!name || definitions.has(name) || definitions.size >= completionLimits.entries || !word(tokens[index + 1], 'AS')
      || !symbol(tokens[body], '(') || end === undefined || tokens[end].start >= boundary) return false;
    definitions.set(name, body); index = end + 1;
    if (!symbol(tokens[index], ',')) break;
    index++;
  }
  // 内联OVER可引用本块完整列表；命名child仅向前面的定义继承，覆盖两种首批方言的共同范围。
  let dependent = [...definitions.values()].includes(open) ? open : Infinity;
  let current = open, inherited = true, ordered = false;
  const visited = new Set<string>();
  while (true) {
    const end = close.get(current); if (end === undefined) return false;
    const body = tokens.slice(current + 1, end);
    const own = body.filter((token, offset) => token.depth === tokens[current].depth + 1 && !symbol(body[offset - 1], '.'));
    const hasReference = own.length > 0 && !['PARTITION', 'ORDER', 'ROWS', 'RANGE'].some(value => word(own[0], value));
    const reference = hasReference ? key(own[0]) : undefined;
    if (hasReference && !reference) return false;
    const partition = own.filter(token => word(token, 'PARTITION')).length, order = own.filter(token => word(token, 'ORDER')).length;
    if (partition > 1 || order > 1 || reference && partition || ordered && order) return false;
    if (!inherited && own.some(token => ['ROWS', 'RANGE', 'GROUPS', 'EXCLUDE'].some(value => word(token, value)))) return false;
    ordered ||= order > 0;
    if (!reference) return !inherited;
    const next = definitions.get(reference);
    if (next === undefined || next >= dependent || visited.has(reference) || visited.size >= completionLimits.depth) return false;
    visited.add(reference); current = next; dependent = next; inherited = false;
  }
}
