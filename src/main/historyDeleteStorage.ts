import { historyDeleteLimits, historyDeleteReferenceSchema, historyDeleteText, type HistoryDeleteReference } from '../shared/historyDelete';

/** 把授权目标复制为纯数据，拒绝访问器、隐藏字段、重复项和事后替换引用。 */
export function historyDeleteReferences(input: readonly HistoryDeleteReference[]): HistoryDeleteReference[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || !input.length || input.length > historyDeleteLimits.retained) throw Error(historyDeleteText.invalidRecord);
  if (Reflect.ownKeys(input).length !== input.length + 1) throw Error(historyDeleteText.invalidRecord);
  const references: HistoryDeleteReference[] = [], ids = new Set<string>();
  for (let index = 0; index < input.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error(historyDeleteText.invalidRecord);
    const value: unknown = descriptor.value;
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== 2) throw Error(historyDeleteText.invalidRecord);
    const id = Object.getOwnPropertyDescriptor(value, 'id'), digest = Object.getOwnPropertyDescriptor(value, 'digest');
    if (!id || !digest || !('value' in id) || !('value' in digest) || !id.enumerable || !digest.enumerable) throw Error(historyDeleteText.invalidRecord);
    const parsed = historyDeleteReferenceSchema.safeParse({ id: id.value, digest: digest.value });
    if (!parsed.success || ids.has(parsed.data.id)) throw Error(historyDeleteText.invalidRecord);
    ids.add(parsed.data.id); references.push(parsed.data);
  }
  return references;
}

/** 单条与整批共用真实UTF8字节预算；先减后比较，避免加法溢出绕过上限。 */
export function historyDeleteByteTotal(total: number, bytes: number): number {
  const limit = historyDeleteLimits.rawBytes;
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(bytes) || total < 0 || bytes < 0 || total > limit || bytes > limit - total) throw Error(historyDeleteText.budget);
  return total + bytes;
}
