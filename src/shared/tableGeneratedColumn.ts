import { z } from 'zod';

export const generatedColumnLimits = { expression: 2048, tokens: 256, depth: 16, references: 32, digits: 65 } as const;
export const generatedColumnAcknowledgement = 'generated-column-computation';
/** 集中说明只表达能力和输入错误，不把原表达式或数据值写入错误文本。 */
export const generatedColumnMessages = {
  expression: '生成表达式只接受已有普通整数/DECIMAL列、十进制文字量、括号和加减乘；不接受函数、字符串、注释或其它SQL',
  budget: '生成表达式超过2048字符、256词法单元、16层或32次引用的限制',
  attributes: '新增生成列仅支持整数/DECIMAL、允许NULL、无默认值、无自动更新时间并置于末尾',
  isolated: '生成列必须单独新增一列，不能与其它字段修改混合提交',
  version: '当前服务器版本尚未开放新增数值生成列',
  reference: '生成表达式引用必须精确匹配已有普通整数/DECIMAL列，不能引用自增、生成或未知属性列',
  computation: '生成列由服务器计算，STORED可能重建表；请核对精度、溢出、NULL传播及已有数据，不会自动重试或转换其它列。',
} as const;
const text = generatedColumnMessages;
export const generatedColumnSchema = z.object({ storage: z.enum(['VIRTUAL', 'STORED']), expression: z.string().min(1).max(generatedColumnLimits.expression) }).strict();
export type GeneratedColumn = z.infer<typeof generatedColumnSchema>;
export type GeneratedColumnExpression =
  | { kind: 'number'; value: string }
  | { kind: 'column'; name: string }
  | { kind: 'unary'; operator: '+' | '-'; operand: GeneratedColumnExpression }
  | { kind: 'binary'; operator: '+' | '-' | '*'; left: GeneratedColumnExpression; right: GeneratedColumnExpression };
export interface ParsedGeneratedColumnExpression { ast: GeneratedColumnExpression; referencedColumns: string[]; tokenCount: number; }
type Token = { kind: 'number' | 'column'; value: string } | { kind: 'symbol'; value: '+' | '-' | '*' | '(' | ')' };

/** 数字只做字符串正规化，保留小数位数，避免把1.00的十进制运算尺度改成整数1。 */
function decimal(source: string): string {
  const [integer, fraction] = source.split('.');
  if (source.replace('.', '').length > generatedColumnLimits.digits) throw Error(text.expression);
  const whole = (integer || '0').replace(/^0+(?=\d)/, '');
  return whole + (fraction ? '.' + fraction : '');
}
/** 标识符内允许成对代理字符，孤立代理和控制字符不属于受控名字。 */
function validIdentifier(value: string): boolean {
  if (!value.length || value.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return false;
  for (const character of value) { const code = character.codePointAt(0)!; if (code >= 0xd800 && code <= 0xdfff) return false; }
  return true;
}

/** 输入语法是模式无关的严格子集：仅反引号及安全裸名字；从不把引号文本当SQL再执行。 */
export function parseGeneratedColumnExpression(source: string): ParsedGeneratedColumnExpression {
  if (typeof source !== 'string' || !source.length || source.length > generatedColumnLimits.expression) throw Error(text.budget);
  const tokens: Token[] = [];
  for (let index = 0; index < source.length;) {
    const char = source[index], next = source[index + 1];
    if (/\s/u.test(char)) { index++; continue; }
    if (char === '`') {
      let value = '', closed = false; index++;
      while (index < source.length) {
        if (source[index] === '`') { if (source[index + 1] === '`') { value += '`'; index += 2; continue; } index++; closed = true; break; }
        value += source[index++];
      }
      if (!closed || !validIdentifier(value)) throw Error(text.expression);
      tokens.push({ kind: 'column', value });
    } else if (/[0-9]/.test(char) || char === '.' && /[0-9]/.test(next ?? '')) {
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(source.slice(index))!;
      index += match[0].length; tokens.push({ kind: 'number', value: decimal(match[0]) });
    } else if (/[A-Za-z_$\u0080-\uffff]/.test(char)) {
      const start = index++;
      while (index < source.length && /[A-Za-z0-9_$\u0080-\uffff]/.test(source[index])) index++;
      const value = source.slice(start, index); if (!validIdentifier(value)) throw Error(text.expression);
      tokens.push({ kind: 'column', value });
    } else if (['+', '-', '*', '(', ')'].includes(char) && !(char === '-' && next === '-')) { tokens.push({ kind: 'symbol', value: char as Extract<Token, { kind: 'symbol' }>['value'] }); index++; }
    else throw Error(text.expression);
    if (tokens.length > generatedColumnLimits.tokens) throw Error(text.budget);
  }
  const references: string[] = []; let cursor = 0;
  interface Node { ast: GeneratedColumnExpression; height: number; }
  const bounded = (ast: GeneratedColumnExpression, height: number): Node => { if (height > generatedColumnLimits.depth) throw Error(text.budget); return { ast, height }; };
  const value = (depth: number): Node => {
    if (depth > generatedColumnLimits.depth) throw Error(text.budget);
    const token = tokens[cursor++]; if (!token) throw Error(text.expression);
    if (token.kind === 'symbol' && (token.value === '+' || token.value === '-')) { const child = value(depth + 1); return bounded({ kind: 'unary', operator: token.value, operand: child.ast }, child.height + 1); }
    if (token.kind === 'symbol' && token.value === '(') { const nested = sum(depth + 1); if (tokens[cursor]?.kind !== 'symbol' || tokens[cursor++].value !== ')') throw Error(text.expression); return nested; }
    if (token.kind === 'number') return { ast: { kind: 'number', value: token.value }, height: 1 };
    if (token.kind !== 'column') throw Error(text.expression);
    if (references.length >= generatedColumnLimits.references) throw Error(text.budget);
    references.push(token.value); return { ast: { kind: 'column', name: token.value }, height: 1 };
  };
  const product = (depth: number): Node => {
    let node = value(depth);
    while (tokens[cursor]?.kind === 'symbol' && tokens[cursor].value === '*') { cursor++; const right = value(depth); node = bounded({ kind: 'binary', operator: '*', left: node.ast, right: right.ast }, Math.max(node.height, right.height) + 1); }
    return node;
  };
  const sum = (depth: number): Node => {
    let node = product(depth);
    while (tokens[cursor]?.kind === 'symbol' && (tokens[cursor].value === '+' || tokens[cursor].value === '-')) { const operator = tokens[cursor++].value as '+' | '-'; const right = product(depth); node = bounded({ kind: 'binary', operator, left: node.ast, right: right.ast }, Math.max(node.height, right.height) + 1); }
    return node;
  };
  const ast = sum(0).ast; if (cursor !== tokens.length) throw Error(text.expression);
  return { ast, referencedColumns: references, tokenCount: tokens.length };
}

/** 纯属性限制不替代服务器目录/版本准入；onUpdate即使显式null也不属于生成列合同。 */
export function assertAddedGeneratedColumn(column: { type: { kind: string }; nullable: boolean; default: { kind: string }; generated?: GeneratedColumn; onUpdate?: unknown; position?: { kind: string } }): void {
  if (!Object.hasOwn(column, 'generated')) return;
  if (!column.generated || !['integer', 'decimal'].includes(column.type.kind) || column.nullable !== true || column.default.kind !== 'none' || Object.hasOwn(column, 'onUpdate') || column.position !== undefined && column.position.kind !== 'last') throw Error(text.attributes);
  const generated = generatedColumnSchema.parse(column.generated); parseGeneratedColumnExpression(generated.expression);
}
