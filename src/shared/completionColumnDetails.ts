import type { CompletionColumnDetails } from './sqlCompletion';

export const completionDetailLimits = { type: 4096, defaultValue: 4096, extra: 1024, comment: 2048 } as const;
/** 只接收完整且有界的字段属性，不把截断片段或未知布尔值当作真实定义。 */
export function copyCompletionColumnDetails(value: unknown): CompletionColumnDetails {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('字段属性格式无效');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'comment,defaultValue,extra,nullable,type' || typeof row.nullable !== 'boolean' || typeof row.type !== 'string' || !row.type) throw Error('字段属性不完整');
  for (const key of ['type', 'defaultValue', 'extra', 'comment'] as const) {
    const text = row[key]; if (key === 'defaultValue' && text === null) continue;
    if (typeof text !== 'string' || text.length > completionDetailLimits[key] || text.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) throw Error('字段属性超过预算或编码无效');
  }
  return { type: row.type, nullable: row.nullable, defaultValue: row.defaultValue as string | null, extra: row.extra as string, comment: row.comment as string };
}
