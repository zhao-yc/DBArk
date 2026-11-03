import { analyzeCompletion } from './completionAnalysis';
import { completionLexicalContext, type CompletionLexicalMode } from './completionLexical';
import type { CompletionScopeCapabilities } from './completionCapabilities';
import { completionLimits } from './sqlCompletion';
import { analyzeLocalReferences } from './localReferencesAnalysis';
import { planLocalRename } from './localRename';

/** 仅修改AST确认的别名或CTE声明；物理表、字段和未绑定词均不得借重命名改变。 */
export function analyzeMysqlLocalRename(source: string, offset: number, mode: CompletionLexicalMode = {}, capabilities: CompletionScopeCapabilities = {}, newName?: string) {
  const lexical = completionLexicalContext(source, offset, mode, completionLimits.aliasUnits);
  if (lexical.status !== 'ready') return lexical;
  const target = lexical.tokens.find(token => token.start === lexical.target.start && token.end === lexical.target.end);
  if (!target) return { status: 'blocked' as const, reason: 'syntax' };
  const references = analyzeLocalReferences(source, offset, mode, capabilities);
  return planLocalRename({ status: 'ready', target, tokens: lexical.tokens.filter(token => ['word', 'identifier'].includes(token.kind)) }, references, 'mysql', reference => {
    let kind: 'alias' | 'cte' | 'physical' | undefined;
    const proof = analyzeCompletion(source, reference.end, mode, capabilities, 'definition', value => { kind = value; });
    return proof.status === 'ready' && references.status === 'ready' && proof.definition?.start === references.declaration.start ? kind : undefined;
  }, newName);
}
