import type { CompletionToken } from './completionLexical';
import type { CompletionQueryBranch } from './completionQueryScope';
import { completionLimits } from './sqlCompletion';

const word = (token: CompletionToken | undefined, value: string) => token?.kind === 'word' && token.value.toUpperCase() === value;
const symbol = (token: CompletionToken | undefined, value: string) => token?.kind === 'symbol' && token.value === value;
// 本切片只证明ASCII窗口名称，避免把客户端Unicode折叠当作服务器名称比较规则。
const windowName = (token: CompletionToken | undefined) => token && (token.kind === 'word' || token.kind === 'identifier') && /^[A-Za-z_][A-Za-z0-9_$]{0,63}$/.test(token.value) ? token.value.toLowerCase() : undefined;

/** 只放开本SELECT内“已知空窗口/分区窗口 + ORDER BY”，不推断新关系、帧或版本能力。 */
export function completionWindowInheritance(branch: CompletionQueryBranch, tokens: CompletionToken[], close: ReadonlyMap<number, number>, open: number, validate?: (start: number, end: number) => boolean): boolean {
  const reference = windowName(tokens[open + 1]);
  if (!reference || !word(tokens[open + 2], 'ORDER') || !word(tokens[open + 3], 'BY')) return false;
  const end = close.get(open);
  if (end === undefined) return false;
  // 只观察当前括号层的属性词；u.rows/u.order不能变成帧或排序属性。
  const properties = (start: number, finish: number) => tokens.slice(start, finish).filter((token, index, source) => token.depth === tokens[start - 1].depth + 1 && !symbol(source[index - 1], '.'));
  const current = properties(open + 1, end);
  if (current.filter(token => word(token, 'ORDER')).length !== 1 || current.some(token => ['PARTITION', 'ROWS', 'RANGE', 'GROUPS', 'EXCLUDE'].some(value => word(token, value)))) return false;

  // 解析恢复可能在第一个WINDOW后提前结束；重复子句仍须看至真实括号/集合边界，不能被AST截断藏掉。
  const lexicalEnd = tokens.find(token => token.start > branch.select.start && (symbol(token, ')') && token.depth < branch.select.depth || token.depth === branch.select.depth && ['UNION', 'INTERSECT', 'EXCEPT'].some(value => word(token, value))))?.start ?? Infinity;
  const branchEnd = tokens.filter(token => token.start >= branch.select.start && token.start < lexicalEnd).at(-1)?.end;
  // 有界继承只在当前SELECT分支完整通过语法校验时开放；AST恢复不能证明列表后继或分区表达式完整。
  if (!validate || branchEnd === undefined || !validate(branch.select.start, branchEnd)) return false;
  const starts = tokens.flatMap((token, index) => token.start > branch.query.position.endIndex && token.start < lexicalEnd && token.depth === branch.select.depth && word(token, 'WINDOW') && !symbol(tokens[index - 1], '.') ? [index] : []);
  if (starts.length !== 1) return false;
  if (tokens.some((token, index) => token.start > branch.select.start && index < starts[0] && token.depth === branch.select.depth && word(token, 'ORDER') && word(tokens[index + 1], 'BY'))) return false;
  const definitions = new Map<string, number>();
  let index = starts[0] + 1;
  // 必须按完整WINDOW列表定位；同层重复名称不任取一个定义，预算沿用既有上限。
  while (index < tokens.length) {
    const key = windowName(tokens[index]), body = index + 2, finish = close.get(body);
    if (!key || definitions.has(key) || !word(tokens[index + 1], 'AS') || !symbol(tokens[body], '(') || finish === undefined || tokens[finish].start >= branch.end || definitions.size >= completionLimits.entries) return false;
    definitions.set(key, body);
    index = finish + 1;
    if (!symbol(tokens[index], ',')) break;
    index++;
  }

  const visited = new Set<string>();
  let key: string | undefined = reference;
  let dependent = [...definitions.values()].includes(open) ? open : Infinity;
  // MariaDB只从先前命名定义查找，MySQL另允许前向引用；缺少方言能力时仅支持共同的向后链。
  // 只在同一列表解析，不向祖先、兄弟或物理目录回退；OVER内联规范仍可引用完整WINDOW列表。
  while (key) {
    if (visited.has(key) || visited.size >= completionLimits.depth) return false;
    visited.add(key);
    const body = definitions.get(key);
    if (body === undefined || body >= dependent) return false;
    dependent = body;
    const finish = close.get(body)!;
    if (finish === body + 1) return true;
    const first = tokens[body + 1], own = properties(body + 1, finish);
    if (word(first, 'PARTITION') && word(tokens[body + 2], 'BY')) {
      return own.filter(token => word(token, 'PARTITION')).length === 1 && own.length > 2 && !own.some(token => ['ORDER', 'ROWS', 'RANGE', 'GROUPS', 'EXCLUDE'].some(value => word(token, value)));
    }
    // 引用链只接受“base AS(other)”；叠加分区、排序、帧和未知恢复语法均暂不放开。
    key = windowName(first);
    if (!key || finish !== body + 2) return false;
  }
  return false;
}
