import type { CompletionToken } from './completionLexical';

const candidates = ['ROWS', 'RANGE', 'BETWEEN', 'AND', 'CURRENT', 'ROW', 'UNBOUNDED', 'PRECEDING', 'FOLLOWING',
  'CURRENT ROW', 'UNBOUNDED PRECEDING', 'UNBOUNDED FOLLOWING', 'ROWS CURRENT ROW', 'RANGE CURRENT ROW',
  'BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW', 'ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW', 'RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW'];
const word = (token: CompletionToken | undefined, value: string) => token?.kind === 'word' && token.value.toUpperCase() === value;
type Decimal = { whole: string; fraction: string };
type Bound = { side: -2 | -1 | 0 | 1 | 2; value?: Decimal; parameter?: true };

/** 帧偏移仅解析有界非负数字文本；Number只读取四位指数，不转换数值本身。 */
function decimal(raw: string): Decimal | undefined {
  if (raw.length > 128 || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,4})?$/.test(raw)) return;
  const [coefficient, power = '0'] = raw.toLowerCase().split('e'), exponent = Number(power);
  if (Math.abs(exponent) > 1024) return;
  const [whole, fraction = ''] = coefficient.split('.'), digits = whole + fraction, point = whole.length + exponent;
  const left = point <= 0 ? '0' : point >= digits.length ? digits + '0'.repeat(point - digits.length) : digits.slice(0, point);
  const right = point <= 0 ? '0'.repeat(-point) + digits : point >= digits.length ? '' : digits.slice(point);
  return { whole: left.replace(/^0+(?=\d)/, ''), fraction: right.replace(/0+$/, '') };
}

/** 用原十进制位比较已知边界；参数标记的运行值不猜测。 */
function ordered(start: Bound, end: Bound): boolean {
  if (start.side === 2 || end.side === -2) return false;
  if (start.parameter || end.parameter) return true;
  if (start.side !== end.side) return start.side < end.side;
  if (!start.value || !end.value) return true;
  const a = start.value, b = end.value, size = Math.max(a.fraction.length, b.fraction.length);
  const order = a.whole.length !== b.whole.length ? a.whole.length - b.whole.length : a.whole !== b.whole ? (a.whole < b.whole ? -1 : 1)
    : a.fraction.padEnd(size, '0') === b.fraction.padEnd(size, '0') ? 0 : a.fraction.padEnd(size, '0') < b.fraction.padEnd(size, '0') ? -1 : 1;
  return start.side < 0 ? order >= 0 : order <= 0;
}

/** 完整帧形状先过滤候选，字段、函数、嵌套表达式和非帧词不进入语法验证器。 */
function frame(tokens: CompletionToken[], depth: number): boolean {
  if (!tokens.length || tokens.some(token => token.depth !== depth || !token.closed) || !['ROWS', 'RANGE'].some(value => word(tokens[0], value))) return false;
  let index = 1;
  const between = word(tokens[index], 'BETWEEN'); if (between) index++;
  /** 只消费一个完整边界；偏移原文保持，拒绝负数及ROWS的非整数。 */
  function bound(): Bound | undefined {
    if (word(tokens[index], 'CURRENT') && word(tokens[index + 1], 'ROW')) { index += 2; return { side: 0 }; }
    if (word(tokens[index], 'UNBOUNDED')) {
      const direction = tokens[++index]; index++;
      return word(direction, 'PRECEDING') ? { side: -2 } : word(direction, 'FOLLOWING') ? { side: 2 } : undefined;
    }
    const values: CompletionToken[] = [];
    while (index < tokens.length && !['PRECEDING', 'FOLLOWING', 'AND'].some(value => word(tokens[index], value))) values.push(tokens[index++]);
    const direction = tokens[index++], side = word(direction, 'PRECEDING') ? -1 : word(direction, 'FOLLOWING') ? 1 : undefined;
    if (!side || !values.length) return;
    if (values.length === 1 && values[0].kind === 'symbol' && values[0].value === '?') return { side, parameter: true };
    const parsed = decimal(values.map(token => token.value).join(''));
    if (!parsed || word(tokens[0], 'ROWS') && parsed.fraction) return;
    return { side: parsed.whole === '0' && !parsed.fraction ? 0 : side, value: parsed };
  }
  const start = bound(); if (!start) return false;
  let end: Bound = { side: 0 };
  if (between) { if (!word(tokens[index++], 'AND')) return false; const last = bound(); if (!last) return false; end = last; }
  return index === tokens.length && ordered(start, end);
}

/** 已确认的OVER／WINDOW括号内生成固定帧关键字，整条替换语句仍须通过原解析器。 */
export function completionWindowFrameKeywords(tokens: CompletionToken[], at: number, prefix: string, open: number, close: number | undefined, validate: (value: string) => boolean): string[] | undefined {
  if (close === undefined || !['SELECT', 'WITH'].some(value => word(tokens[0], value))) return;
  const current = tokens.findIndex(token => token.start === at), depth = tokens[open].depth + 1;
  if (current <= open || current >= close || tokens[current].depth !== depth || tokens[current].kind !== 'word') return;
  const body = tokens.slice(open + 1, close), position = current - open - 1, result: string[] = [];
  // 带基窗口引用的继承继续使用原保守边界，不借关键字路径绕过其完整性检查。
  if (position !== 0 && !['PARTITION', 'ORDER', 'ROWS', 'RANGE'].some(value => word(body[0], value))) return;
  for (const candidate of candidates) {
    if (!candidate.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const replacement = candidate.split(' ').map(value => ({ ...tokens[current], value }));
    const next = [...body.slice(0, position), ...replacement, ...body.slice(position + 1)];
    const starts = next.flatMap((token, index) => token.depth === depth && !((next[index - 1]?.kind === 'symbol') && next[index - 1].value === '.') && ['ROWS', 'RANGE'].some(value => word(token, value)) ? [index] : []);
    if (starts.length !== 1 || position < starts[0] || !frame(next.slice(starts[0]), depth)) continue;
    if (validate(candidate)) result.push(candidate);
  }
  return result.length ? result : undefined;
}
