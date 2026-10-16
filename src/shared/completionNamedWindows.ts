import type { CompletionToken } from './completionLexical';
import { completionIdentifier } from './completionLexical';
import type { CompletionQueryBranch } from './completionQueryScope';
import { completionLimits } from './sqlCompletion';

const word = (token: CompletionToken | undefined, name: string) => token?.kind === 'word' && token.value.toUpperCase() === name;
const symbol = (token: CompletionToken | undefined, value: string) => token?.kind === 'symbol' && token.value === value;
const name = (token: CompletionToken | undefined) => !!token && ['word', 'identifier'].includes(token.kind);
interface Definition { name: string; key: string; partition: boolean; order: boolean; }
export type NamedWindowContext = { names: string[] } | { blocked: true; reason: 'syntax' | 'budget' };

/** 只在裸OVER名称位置补全；依托真实查询块及完整语法，不把窗口名称当表/列去读目录。 */
export function completionNamedWindows(branches: CompletionQueryBranch[], tokens: CompletionToken[], at: number, validate: (start: number, end: number) => boolean): NamedWindowContext | undefined {
  const caret = tokens.findIndex(token => token.start === at); if (caret < 0) return;
  let over = caret - 1;
  // 只跨过实际限定链；不能越过FROM/GROUP/HAVING的一串普通单词回头误认旧OVER。
  while (symbol(tokens[over], '.') && name(tokens[over - 1])) over -= 2;
  if (!word(tokens[over], 'OVER') || !symbol(tokens[over - 1], ')')) return;
  const blocked = { blocked: true, reason: 'syntax' } as const;
  if (over !== caret - 1) return blocked; // 窗口名不可使用db.name限定，不能回退目录。
  const branch = branches.filter(item => item.select.start <= at && at <= item.end).sort((a, b) => b.select.depth - a.select.depth || b.select.start - a.select.start)[0];
  if (!branch) return blocked;
  const end = tokens.find(token => token.start > branch.select.start && (symbol(token, ')') && token.depth < branch.select.depth || token.depth === branch.select.depth && ['UNION', 'INTERSECT', 'EXCEPT'].some(value => word(token, value))))?.start ?? Infinity;
  const current = tokens.filter(token => token.start >= branch.select.start && token.start < end);
  if (!current.length || !validate(branch.select.start, current.at(-1)!.end)) return blocked;
  // 窗口函数只属于SELECT或本块ORDER BY，不把WHERE/GROUP/HAVING中的非法窗口写法当可补全入口。
  let clause = 'SELECT';
  for (let index = 0; index < tokens.length && tokens[index].start < tokens[over].start; index++) {
    const token = tokens[index]; if (token.start < branch.select.start || token.depth !== branch.select.depth || symbol(tokens[index - 1], '.')) continue;
    for (const value of ['FROM', 'WHERE', 'HAVING', 'WINDOW', 'LIMIT', 'INTO', 'FOR']) if (word(token, value)) clause = value;
    if ((word(token, 'ORDER') || word(token, 'GROUP')) && word(tokens[index + 1], 'BY')) clause = token.value.toUpperCase();
  }
  if (!['SELECT', 'ORDER'].includes(clause)) return blocked;
  const starts = tokens.flatMap((token, index) => token.start > branch.select.start && token.start < end && token.depth === branch.select.depth && word(token, 'WINDOW') && !symbol(tokens[index - 1], '.') ? [index] : []);
  if (starts.length !== 1) return blocked;
  const close = new Map<number, number>(), stack: number[] = [];
  for (let i = 0; i < tokens.length; i++) { if (symbol(tokens[i], '(')) stack.push(i); else if (symbol(tokens[i], ')')) { const open = stack.pop(); if (open !== undefined) close.set(open, i); } }
  const definitions = new Map<string, Definition>();
  let index = starts[0] + 1;
  while (index < tokens.length) {
    const token = tokens[index], body = index + 2, finish = close.get(body);
    // 首片采用ASCII名称比较；不把客户端Unicode折叠当作服务器窗口名的比较规则。
    if (!name(token) || !completionIdentifier(token.value) || !/^[\x20-\x7e]+$/.test(token.value) || !word(tokens[index + 1], 'AS') || !symbol(tokens[body], '(') || finish === undefined || tokens[finish].start >= end) return blocked;
    const key = token.value.toLowerCase(); if (definitions.has(key)) return blocked;
    if (definitions.size >= completionLimits.entries) return { blocked: true, reason: 'budget' };
    const own = tokens.slice(body + 1, finish).filter((part, i, list) => part.depth === tokens[body].depth + 1 && !symbol(list[i - 1], '.'));
    // 帧、前向引用和覆盖属性不在本切片；已有窗口内部字段补全保持原有边界。
    if (own.some(part => ['ROWS', 'RANGE', 'GROUPS', 'EXCLUDE'].some(value => word(part, value)))) return blocked;
    const partition = own.some(part => word(part, 'PARTITION')), order = own.some(part => word(part, 'ORDER'));
    let inherited: Definition | undefined;
    if (own.length && !word(own[0], 'PARTITION') && !word(own[0], 'ORDER')) {
      if (!name(own[0])) return blocked;
      inherited = definitions.get(own[0].value.toLowerCase());
      if (!inherited || partition || inherited.order && order) return blocked;
    }
    definitions.set(key, { name: token.value, key, partition: partition || inherited?.partition === true, order: order || inherited?.order === true });
    index = finish + 1;
    if (!symbol(tokens[index], ',')) break;
    index++;
  }
  return { names: [...definitions.values()].map(item => item.name) };
}
