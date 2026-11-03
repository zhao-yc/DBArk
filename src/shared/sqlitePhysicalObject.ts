import { analyzeSqliteCompletion, sqlitePhysicalObjectContext } from './sqliteCompletionAnalysis';
import { validPhysicalObjectTokens, type PhysicalObjectAnalysis } from './physicalObjectValidation';

/** SQLite仅使用既有结构解析与可见binding；不借MySQL语法猜测或访问业务数据库。 */
export function analyzeSqlitePhysicalObject(source: string, offset: number): PhysicalObjectAnalysis {
  let captured: PhysicalObjectAnalysis | undefined;
  const result = analyzeSqliteCompletion(source, offset, 'object', undefined, value => { captured = value; });
  if (result.status === 'blocked') return result;
  return captured && validPhysicalObjectTokens(captured, source, offset, 'sqlite', sqlitePhysicalObjectContext(source, offset)) ? captured : { status: 'blocked', reason: 'object' };
}
