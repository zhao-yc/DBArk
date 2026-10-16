import { completionIdentifier, type CompletionToken } from './completionLexical';

/** 只识别当前语句CALL的最终过程名；参数表达式继续沿原分析路径，不将其误当过程目录。 */
export function completionProcedureScope(tokens: CompletionToken[], at: number, validate: () => boolean): 'procedure' | 'invalid' | undefined {
  const first = tokens[0];
  if (first?.kind !== 'word' || first.value.toUpperCase() !== 'CALL' || first.depth !== 0) return;
  const caret = tokens.findIndex(token => token.start === at);
  if (caret < 0 || tokens[caret].depth !== 0) return;
  const open = tokens.findIndex(token => token.kind === 'symbol' && token.value === '(' && token.depth === 0);
  if (open >= 0 && caret > open) return;
  // 名称只允许procedure或database.procedure；原词法结果已处理引号、注释、模式和语句边界。
  if (caret !== 1 && !(caret === 3 && ['word', 'identifier'].includes(tokens[1].kind) && completionIdentifier(tokens[1].value) && tokens[2].kind === 'symbol' && tokens[2].value === '.')) return 'invalid';
  const next = tokens[caret + 1];
  if (next && !(next.kind === 'symbol' && next.value === '(' && next.depth === 0)) return 'invalid';
  // 不以局部CALL前缀掩盖未完成参数或其它非法后缀；名称替换后的整条调用须通过现有解析器。
  return validate() ? 'procedure' : 'invalid';
}
