import { generatedColumnExpressionFingerprint, generatedColumnLimits, generatedColumnMessages as text, parseGeneratedColumnExpression, type GeneratedColumnExpression } from '../shared/tableGeneratedColumn';
import type { TableColumnDefinitionDocument } from '../shared/tableColumnPatches';
import { editableColumnType, tableDefinitionTokens } from './tableColumnDefinition';

export interface CompiledGeneratedColumnExpression { sql: string; fingerprint: string; referencedColumns: string[]; }
export interface GeneratedColumnDefinition { storage: 'VIRTUAL' | 'STORED'; expression: string; sql: string; fingerprint: string; referencedColumns: string[]; }
/** 此处只引用实际名字；不使用客户端原文片段、数学求值或字符串查找代替解析。 */
const quoted = (name: string): string => '`' + name.replace(/`/g, '``') + '`';

/** 引用列须完整可读且是原有普通精确数值列；自增/生成/隐藏和未知属性不能借type权限放行。 */
export function isGeneratedColumnReference(document: TableColumnDefinitionDocument, name: string, beforeOrdinal = document.columns.length): boolean {
  if (!Number.isSafeInteger(beforeOrdinal) || beforeOrdinal < 0 || beforeOrdinal > document.columns.length) return false;
  const matches = document.columns.filter(column => column.name.toLowerCase() === name.toLowerCase());
  if (matches.length !== 1 || matches[0].name !== name) return false;
  const column = matches[0], type = editableColumnType(column, document.context);
  return document.columns.indexOf(column) < beforeOrdinal && column.type.known && column.access.type.editable === true && (type?.kind === 'integer' || type?.kind === 'decimal') && column.nullable !== undefined && !['expression', 'opaque'].includes(column.default.kind) && column.attributes.every(attribute => ['nullable', 'default', 'comment'].includes(attribute.kind));
}
/** 别名供任务层与界面准入投影共用，保持唯一的候选规则。 */
export const eligibleGeneratedColumnReference = isGeneratedColumnReference;

/** 将AST每次引用重写为真实转义列名；运算树和十进制尺度保持，不交换运算或推断等价。 */
export function compileResolvedGeneratedColumnExpression(expression: string, resolveColumn: (name: string) => string | undefined): CompiledGeneratedColumnExpression {
  const parsed = parseGeneratedColumnExpression(expression);
  const names = new Map<string, string>();
  for (const name of parsed.referencedColumns) { const resolved = resolveColumn(name); if (resolved !== name) throw Error(text.reference); names.set(name, resolved); }
  const render = (node: GeneratedColumnExpression): string => {
    if (node.kind === 'number') return node.value;
    if (node.kind === 'column') return quoted(names.get(node.name)!);
    if (node.kind === 'unary') return '(' + node.operator + render(node.operand) + ')';
    return '(' + render(node.left) + ' ' + node.operator + ' ' + render(node.right) + ')';
  };
  const sql = render(parsed.ast);
  // 引号、转义及结构括号会增加长度、词法单元和解析深度；发送DDL前先证明实际输出也能按同一预算后核。
  if (sql.length > generatedColumnLimits.expression) throw Error(text.budget);
  const fingerprint = generatedColumnExpressionFingerprint(parsed.ast), rendered = parseGeneratedColumnExpression(sql);
  // 不能仅因输出语法可读就放行；原始运算次序、引用及十进制尺度必须保持同一比较键。
  if (generatedColumnExpressionFingerprint(rendered.ast) !== fingerprint) throw Error(text.expression);
  return { sql, fingerprint, referencedColumns: [...parsed.referencedColumns] };
}

/** 旧现表入口仍逐项验证真实目录，不能用待建声明或客户端候选替换原权限证明。 */
export function compileGeneratedColumnExpression(document: TableColumnDefinitionDocument, expression: string, beforeOrdinal = document.columns.length): CompiledGeneratedColumnExpression {
  return compileResolvedGeneratedColumnExpression(expression, name => isGeneratedColumnReference(document, name, beforeOrdinal) ? document.columnsByName.get(name)!.name : undefined);
}

/** SHOW/目录可用当前ANSI模式表示标识符；转为同一安全子集后只比较结构，不执行原表达式。 */
function serverExpression(document: TableColumnDefinitionDocument, source: string): string {
  // 服务器表达式仍受原始长度门；词法层不得将巨大空白或注释折叠后绕过预算。
  if (typeof source !== 'string' || source.length > 2048) throw Error(text.budget);
  const tokens = tableDefinitionTokens(source, document.context); let cursor = 0, result = '';
  for (const token of tokens) {
    // 共用词法器会略过普通注释；源偏移之间必须只有空白，不能用token重拼把注释悄悄洗掉。
    const gap = source.slice(cursor, token.start); if (!/^\s*$/u.test(gap)) throw Error(text.expression);
    result += gap;
    if (token.kind === 'identifier') result += quoted(token.value);
    else if (token.kind === 'word' || token.kind === 'number' || token.kind === 'symbol' && ['+', '-', '*', '(', ')'].includes(token.value)) result += source.slice(token.start, token.end);
    else throw Error(text.expression);
    cursor = token.end;
  }
  const tail = source.slice(cursor); if (!/^\s*$/u.test(tail)) throw Error(text.expression);
  return result + tail;
}

/** 仅语法外括号/空白/安全数字前导零及解析器丢弃的一元+可归一化；不推断代数等价。 */
export function sameGeneratedColumnExpression(document: TableColumnDefinitionDocument, left: string, right: string, beforeOrdinal = document.columns.length): boolean {
  try { return compileGeneratedColumnExpression(document, serverExpression(document, left), beforeOrdinal).fingerprint === compileGeneratedColumnExpression(document, serverExpression(document, right), beforeOrdinal).fingerprint; }
  catch { return false; }
}

/** 从保偏移SHOW片段提取明确生成方式和表达式；Maria的PERSISTENT只在后核投影为STORED。 */
export function readGeneratedColumnDefinition(document: TableColumnDefinitionDocument, columnName: string): GeneratedColumnDefinition | undefined {
  const column = document.columnsByName.get(columnName); if (!column) return;
  const attributes = column.attributes.filter(attribute => attribute.kind === 'generated'); if (attributes.length !== 1) return;
  try {
    const raw = attributes[0].raw, tokens = tableDefinitionTokens(raw, document.context); let cursor = 0;
    const word = (index: number, value: string): boolean => tokens[index]?.kind === 'word' && tokens[index].value.toUpperCase() === value;
    if (word(cursor, 'GENERATED')) { cursor++; if (word(cursor, 'ALWAYS')) cursor++; }
    if (!word(cursor++, 'AS') || tokens[cursor]?.value !== '(' || tokens.at(-2)?.value !== ')' || tokens.at(-1)?.kind !== 'word') return;
    const storage = tokens.at(-1)!.value.toUpperCase(); if (!['VIRTUAL', 'STORED', ...(document.context.dialect === 'mariadb' ? ['PERSISTENT'] : [])].includes(storage)) return;
    const expression = raw.slice(tokens[cursor].end, tokens.at(-2)!.start), compiled = compileGeneratedColumnExpression(document, serverExpression(document, expression), document.columns.indexOf(column));
    return { storage: storage === 'PERSISTENT' ? 'STORED' : storage as 'VIRTUAL' | 'STORED', expression, sql: compiled.sql, fingerprint: compiled.fingerprint, referencedColumns: compiled.referencedColumns };
  } catch { return; }
}
