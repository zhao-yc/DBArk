import { completionLexicalContext, type CompletionLexicalMode } from './completionLexical';
import { completionLimits } from './sqlCompletion';
import { sqlitePhysicalObjectContext } from './sqliteCompletionAnalysis';
import { validPhysicalObjectTokens, type PhysicalObjectAnalysis } from './physicalObjectValidation';
export type { PhysicalObjectAnalysis, PhysicalObjectRange } from './physicalObjectValidation';

/** 渲染端按原方言取得完整token，再复核消息；SQLite线程仅引用不含MySQL词法的公共校验核。 */
export function validPhysicalObjectAnalysis(value: unknown, source: string, offset: number, dialect: 'mysql' | 'sqlite', mode: CompletionLexicalMode = {}): value is PhysicalObjectAnalysis {
  const context = dialect === 'sqlite' ? sqlitePhysicalObjectContext(source, offset) : completionLexicalContext(source, offset, mode, completionLimits.aliasUnits, true);
  return validPhysicalObjectTokens(value, source, offset, dialect, context);
}
