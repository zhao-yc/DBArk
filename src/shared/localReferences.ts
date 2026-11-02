import { completionLexicalContext, type CompletionLexicalMode } from './completionLexical';
import { completionLimits } from './sqlCompletion';

export interface LocalReferenceRange { start: number; end: number; }
export type LocalReferences = { status: 'blocked'; reason: string } | {
  status: 'ready'; target: LocalReferenceRange; declaration: LocalReferenceRange; references: LocalReferenceRange[];
};

/** 引用列表只接受当前语句中完整、同名的标识符范围，不接受URI、正文或任意附加字段。 */
export function validLocalReferences(value: unknown, source: string, offset: number, mode: CompletionLexicalMode): value is LocalReferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.status === 'blocked') return Object.keys(result).sort().join(',') === 'reason,status' && typeof result.reason === 'string' && result.reason.length <= 64;
  if (result.status !== 'ready' || Object.keys(result).sort().join(',') !== 'declaration,references,status,target' || !Array.isArray(result.references) || !result.references.length || result.references.length > completionLimits.entries) return false;
  const context = completionLexicalContext(source, offset, mode, completionLimits.aliasUnits);
  if (context.status !== 'ready') return false;
  const origin = context.tokens.find(token => token.start === context.target.start && token.end === context.target.end);
  if (!origin || !origin.closed || !['identifier', 'word'].includes(origin.kind)) return false;
  /** 每个范围必须准确落在同一已解码名称上；不可跨词、跨语句或通过额外字段携带内容。 */
  const range = (value: unknown): value is LocalReferenceRange => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'end,start') return false;
    const item = value as LocalReferenceRange;
    return Number.isSafeInteger(item.start) && Number.isSafeInteger(item.end) && context.tokens.some(token => token.closed && ['word', 'identifier'].includes(token.kind) && token.start === item.start && token.end === item.end && token.value === origin.value);
  };
  if (!range(result.target) || result.target.start !== origin.start || result.target.end !== origin.end || !range(result.declaration)) return false;
  let previous = -1;
  for (const item of result.references) {
    if (!range(item) || item.start <= previous || item.start === result.declaration.start) return false;
    previous = item.start;
  }
  const target = result.target;
  return target.start === result.declaration.start || result.references.some(item => item.start === target.start && item.end === target.end);
}
