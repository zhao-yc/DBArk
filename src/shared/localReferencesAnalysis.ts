import { analyzeCompletionDefinition } from './completionDefinitionAnalysis';
import { completionLexicalContext, type CompletionLexicalMode } from './completionLexical';
import type { CompletionScopeCapabilities } from './completionCapabilities';
import { completionLimits } from './sqlCompletion';
import type { LocalReferences } from './localReferences';
import { indexLocalReferences } from './localReferenceIndex';

/** 反向索引复用同一个声明解析器；作用域、遮蔽、分支和CTE链均以已确认的声明范围为身份。 */
export function analyzeLocalReferences(source: string, offset: number, mode: CompletionLexicalMode = {}, capabilities: CompletionScopeCapabilities = {}): LocalReferences {
  const context = completionLexicalContext(source, offset, mode, completionLimits.aliasUnits);
  if (context.status !== 'ready') return context;
  const target = context.tokens.find(token => token.start === context.target.start && token.end === context.target.end);
  if (!target || !target.closed || !['word', 'identifier'].includes(target.kind)) return { status: 'blocked', reason: 'syntax' };
  const candidates = context.tokens.filter(token => token.closed && ['word', 'identifier'].includes(token.kind) && token.value === target.value);
  return indexLocalReferences(target, candidates, completionLimits.entries, token => analyzeCompletionDefinition(source, token.end, mode, capabilities));
}
