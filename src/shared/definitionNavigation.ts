import { z } from 'zod';
import { definitionSearchKinds, searchIdentifier, type DefinitionSearchKind } from './databaseSearch';
import type { SavedQueryMatchSpan } from './savedQuerySearch';

export const definitionNavigationLimits = { matches: 200, sourceBytes: 2 * 1024 * 1024, payloadBytes: 12 * 1024 } as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/, '定义摘要必须是SHA-256');
const span = z.object({ offset: z.number().int().min(0).max(definitionNavigationLimits.sourceBytes), length: z.number().int().min(1).max(definitionNavigationLimits.sourceBytes) }).strict();
/** 返回值也严格校验；状态、摘要、位置及元数据共同占用预算，不允许未知字段夹带正文。 */
export const definitionNavigationResultSchema = z.discriminatedUnion('status', [
  z.object({ digest, status: z.literal('ready'), ranges: z.array(span).min(1).max(definitionNavigationLimits.matches), limitReached: z.boolean() }).strict(),
  z.object({ digest, status: z.literal('unavailable'), reason: z.enum(['server-regexp', 'case-mapping', 'positions-unavailable']) }).strict(),
]).superRefine((value, context) => {
  if (value.status === 'ready') {
    let end = -1;
    for (const [index, range] of value.ranges.entries()) { if (range.offset < end || range.offset + range.length > definitionNavigationLimits.sourceBytes) context.addIssue({ code: 'custom', path: ['ranges', index], message: '定义位置越界、无序或重叠' }); end = range.offset + range.length; }
    if (value.limitReached && value.ranges.length !== definitionNavigationLimits.matches) context.addIssue({ code: 'custom', path: ['limitReached'], message: '截断结果必须保留完整200处预算' });
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > definitionNavigationLimits.payloadBytes) context.addIssue({ code: 'custom', message: '定义位置及元数据超过12KiB' });
});
export type DefinitionNavigationResult = z.infer<typeof definitionNavigationResultSchema>;
/** 搜索时的连接修订与位置一起保存在窗口内存，不写工作台或保存查询。 */
export interface DefinitionNavigationTarget { connectionId: string; connectionVersion: number; database: string; name: string; kind: DefinitionSearchKind; }
export interface DefinitionSearchOpen extends DefinitionNavigationTarget { invalidated: boolean; result?: DefinitionNavigationResult; }
export interface DefinitionNavigationSource extends DefinitionNavigationTarget { uri: string; digest: string; sql: string; ranges: SavedQueryMatchSpan[]; limitReached: boolean; }
export const definitionSearchOpenSchema = z.object({ connectionId: z.string().min(1).max(200), connectionVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), database: searchIdentifier, name: searchIdentifier, kind: z.enum(definitionSearchKinds), invalidated: z.boolean(), result: definitionNavigationResultSchema.optional() }).strict();
/** 不先分配UTF8大缓冲；拒绝孤立代理项，避免摘要编码成另一个字串。 */
export function definitionTextWithinBudget(sql: string): boolean {
  if (sql.length > definitionNavigationLimits.sourceBytes) return false;
  let bytes = 0;
  for (let index = 0; index < sql.length; index++) {
    const unit = sql.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) { const next = sql.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; bytes += 4; }
    else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
    else bytes += unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3;
    if (bytes > definitionNavigationLimits.sourceBytes) return false;
  }
  return true;
}
/** 获得重新读取的原文后再核实际UTF16边界；不能仅用2MiB上限代替真实正文长度。 */
export function validateDefinitionNavigationResult(input: unknown, sql?: string): DefinitionNavigationResult {
  const value = definitionNavigationResultSchema.parse(input);
  if (sql !== undefined && !definitionTextWithinBudget(sql)) throw new Error('定义包含无效Unicode或超过2MiB定位预算');
  if (sql !== undefined && value.status === 'ready') for (const range of value.ranges) {
    const end = range.offset + range.length, boundary = (offset: number) => !(offset > 0 && offset < sql.length && /[\ud800-\udbff]/.test(sql[offset - 1]) && /[\udc00-\udfff]/.test(sql[offset]));
    if (end > sql.length || !boundary(range.offset) || !boundary(end)) throw new Error('定义位置超出当前原文或拆开Unicode代理对');
  }
  return value;
}
