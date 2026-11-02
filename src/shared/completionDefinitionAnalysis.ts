import { analyzeCompletion, type CompletionAnalysis } from './completionAnalysis';
import { completionLexicalContext, type CompletionLexicalMode } from './completionLexical';
import type { CompletionScopeCapabilities } from './completionCapabilities';
import { completionLimits } from './sqlCompletion';

/** 使用完整闭合词定位声明；光标在词中间时不把前缀误认为另一来源。 */
export function analyzeCompletionDefinition(source: string, offset: number, mode: CompletionLexicalMode = {}, capabilities: CompletionScopeCapabilities = {}): CompletionAnalysis {
  const context = completionLexicalContext(source, offset, mode, completionLimits.aliasUnits);
  if (context.status !== 'ready') return context;
  const token = context.tokens.find(item => item.start === context.target.start && item.end === context.target.end);
  if (!token || !token.closed || !['word', 'identifier'].includes(token.kind)) return { status: 'blocked', reason: 'syntax' };
  const result = analyzeCompletion(source, token.end, mode, capabilities, 'definition');
  return result.status === 'ready' && !result.definition ? { status: 'blocked', reason: 'syntax' } : result;
}
