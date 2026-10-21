import { analyzeCompletion, type CompletionAnalysis } from './completionAnalysis';
import { completionLexicalContext, type CompletionLexicalMode } from './completionLexical';
import type { CompletionScopeCapabilities } from './completionCapabilities';
import { completionLimits } from './sqlCompletion';

/** 悬停只定位完整且闭合的字段token，不把限定段、函数、字符串或别名声明当作字段。 */
export function analyzeCompletionHover(source: string, offset: number, mode: CompletionLexicalMode = {}, capabilities: CompletionScopeCapabilities = {}): CompletionAnalysis {
  const context = completionLexicalContext(source, offset, mode, completionLimits.aliasUnits);
  if (context.status !== 'ready') return context;
  const index = context.tokens.findIndex(token => token.start === context.target.start && token.end === context.target.end), token = context.tokens[index];
  if (!token || !['word','identifier'].includes(token.kind) || !token.closed || context.tokens[index + 1]?.value === '.' || context.tokens[index + 1]?.value === '(' || context.tokens[index - 1]?.kind === 'word' && context.tokens[index - 1].value.toUpperCase() === 'AS') return { status: 'blocked', reason: 'identifier' };
  const analysis = analyzeCompletion(source, token.end, mode, capabilities);
  if (analysis.status !== 'ready') return analysis;
  if (analysis.target.start !== token.start || analysis.target.end !== token.end) return { status: 'blocked', reason: 'identifier' };
  return { ...analysis, target: { ...analysis.target, prefix: token.value } };
}
