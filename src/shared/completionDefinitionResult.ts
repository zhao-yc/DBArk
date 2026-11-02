import { completionLexicalContext, type CompletionLexicalMode } from './completionLexical';
import { completionLimits } from './sqlCompletion';

/** Worker只能返回本地同名词范围；拒绝扩展字段、伪造来源及任意外部跳转目标。 */
export function validCompletionDefinition(value: unknown, source: string, offset: number, mode: CompletionLexicalMode): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.status === 'blocked') return Object.keys(result).every(key => ['status', 'reason'].includes(key)) && typeof result.reason === 'string' && result.reason.length <= 64;
  if (result.status !== 'ready' || Object.keys(result).some(key => !['status', 'target', 'syntax', 'keywords', 'relations', 'localRelations', 'columnMode', 'incomplete', 'definition'].includes(key))) return false;
  if (result.columnMode !== 'expression' || result.incomplete !== false || !['syntax', 'keywords', 'relations', 'localRelations'].every(key => Array.isArray(result[key]) && !(result[key] as unknown[]).length)) return false;
  const context = completionLexicalContext(source, offset, mode, completionLimits.aliasUnits);
  if (context.status !== 'ready') return false;
  const target = result.target as Record<string, unknown> | undefined, definition = result.definition as Record<string, unknown> | undefined;
  if (!target || !definition || Object.keys(definition).some(key => !['start', 'end'].includes(key)) || Object.keys(target).some(key => !['start', 'end', 'prefix', 'qualifiers', 'quoted'].includes(key))) return false;
  const origin = context.tokens.find(token => token.start === target.start && token.end === target.end), declaration = context.tokens.find(token => token.start === definition.start && token.end === definition.end);
  return !!origin && !!declaration && origin.closed && declaration.closed && ['word', 'identifier'].includes(origin.kind) && ['word', 'identifier'].includes(declaration.kind)
    && origin.start === context.target.start && origin.end === context.target.end && origin.value === target.prefix && origin.value === declaration.value && origin.start !== declaration.start
    && target.quoted === context.target.quoted && Array.isArray(target.qualifiers) && target.qualifiers.length === context.target.qualifiers.length && target.qualifiers.every((value, index) => value === context.target.qualifiers[index]);
}
