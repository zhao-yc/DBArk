import { analyzeSqliteCompletion, sqliteReferenceContext } from './sqliteCompletionAnalysis';
import { foldSqliteCompletionName as fold, sqliteCompletionLimits } from './sqliteCompletion';
import { indexLocalReferences } from './localReferenceIndex';
import type { LocalReferenceRange, LocalReferences } from './localReferences';

/** SQLite只折叠ASCII；各引用位置通过已有作用域解析器确认，不读取数据库或推断字段引用。 */
export function analyzeSqliteLocalReferences(source: string, offset: number): LocalReferences {
  const context = sqliteReferenceContext(source, offset);
  if (context.status !== 'ready') return context;
  const candidates = context.tokens.filter(token => fold(token.value) === fold(context.target.value));
  return indexLocalReferences(context.target, candidates, sqliteCompletionLimits.entries, token => analyzeSqliteCompletion(source, token.end, 'definition'));
}

/** 回包只允许原语句同名完整标识符与严格字段；保留SQLite引号、非BMP和ASCII大小写身份。 */
export function validSqliteLocalReferences(value: unknown, source: string, offset: number): value is LocalReferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.status === 'blocked') return Object.keys(result).sort().join(',') === 'reason,status' && typeof result.reason === 'string' && /^[a-z-]{1,64}$/.test(result.reason);
  if (result.status !== 'ready' || Object.keys(result).sort().join(',') !== 'declaration,references,status,target' || !Array.isArray(result.references) || !result.references.length || result.references.length > sqliteCompletionLimits.entries) return false;
  const context = sqliteReferenceContext(source, offset);
  if (context.status !== 'ready') return false;
  /** 原词范围不允许跨token、跨语句或从另一个同显示名称上取子串。 */
  const range = (value: unknown): value is LocalReferenceRange => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'end,start') return false;
    const item = value as LocalReferenceRange;
    return Number.isSafeInteger(item.start) && Number.isSafeInteger(item.end) && context.tokens.some(token => token.start === item.start && token.end === item.end && fold(token.value) === fold(context.target.value));
  };
  if (!range(result.target) || result.target.start !== context.target.start || result.target.end !== context.target.end || !range(result.declaration)) return false;
  let previous = -1;
  for (const item of result.references) {
    if (!range(item) || item.start <= previous || item.start === result.declaration.start) return false;
    previous = item.start;
  }
  const target = result.target;
  return target.start === result.declaration.start || result.references.some(item => item.start === target.start && item.end === target.end);
}
