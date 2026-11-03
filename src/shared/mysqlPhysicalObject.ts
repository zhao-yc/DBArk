import { analyzeCompletion } from './completionAnalysis';
import { completionLexicalContext, type CompletionLexicalMode } from './completionLexical';
import type { CompletionScopeCapabilities } from './completionCapabilities';
import { completionLimits } from './sqlCompletion';
import { validPhysicalObjectAnalysis, type PhysicalObjectAnalysis } from './physicalObjectAnalysis';

/** 完整AST保留原表名；只将已确认的物理对象身份和原文范围交付线程边界。 */
export function analyzeMysqlPhysicalObject(source: string, offset: number, mode: CompletionLexicalMode = {}, capabilities: CompletionScopeCapabilities = {}): PhysicalObjectAnalysis {
  const context = completionLexicalContext(source, offset, mode, completionLimits.aliasUnits, true);
  if (context.status !== 'ready') return context;
  const token = context.tokens.find(item => item.start === context.target.start && item.end === context.target.end);
  if (!token || !token.closed || !['word', 'identifier'].includes(token.kind)) return { status: 'blocked', reason: 'target' };
  let captured: PhysicalObjectAnalysis | undefined;
  const result = analyzeCompletion(source, token.end, mode, capabilities, 'object', undefined, value => { captured = value; });
  if (result.status === 'blocked') return result;
  return captured && validPhysicalObjectAnalysis(captured, source, offset, 'mysql', mode) ? captured : { status: 'blocked', reason: 'object' };
}
