import { z } from 'zod';

export const savedQueryDeleteSelectedLimits = Object.freeze({ selected: 100, rawBytes: 128 * 1024 * 1024 });
/** 批量删除只处理本地查询原记录；文案不包含SQL、摘要或认证信息。 */
export const savedQueryDeleteSelectedZh = {
  open: '删除所选查询', title: '删除所选保存查询', confirm: (count: number) => `确认删除${count}条保存查询`, cancel: '取消批量删除',
  hint: '将永久删除下面全部本地保存查询，包括不在当前页的选择。已打开的草稿保留；再次保存原来源会要求另存。不会删除磁盘SQL文件或执行SQL。',
  invalid: '请选择1至100条不同的保存查询，并重新核对原记录摘要。',
  missing: '所选保存查询已删除，请刷新后重新选择；本次未删除。',
  stale: '所选保存查询已变化，请刷新后重新选择；本次未删除。',
  failed: '批量删除未完整确认，请刷新核对；不会自动重试。',
  budget: '所选查询原文合计超过128MiB，请减少所选条数；本次未删除。',
  deleted: (count: number) => `已删除${count}条本地保存查询。`,
  refreshRequired: '批量删除已保存，但列表未能完整刷新，请刷新后继续。',
} as const;
const text = savedQueryDeleteSelectedZh;
const reference = z.object({ id: z.string().min(1).max(200), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

/** 在Zod访问前只复制准确自有数据字段；拒绝getter、符号、稀疏数组及额外字段，不执行调用者代码。 */
function copyInput(input: unknown): unknown {
  const plain = (value: unknown): value is object => !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const own = (value: object, key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw Error(text.invalid);
    return descriptor.value;
  };
  if (!plain(input) || Reflect.ownKeys(input).length !== 1) throw Error(text.invalid);
  const values = own(input, 'queries');
  if (!Array.isArray(values) || Object.getPrototypeOf(values) !== Array.prototype || values.length < 1 || values.length > savedQueryDeleteSelectedLimits.selected || Reflect.ownKeys(values).length !== values.length + 1) throw Error(text.invalid);
  const queries = Array.from({ length: values.length }, (_, index) => {
    const value = own(values, String(index));
    if (!plain(value) || Reflect.ownKeys(value).length !== 2) throw Error(text.invalid);
    return { id: own(value, 'id'), digest: own(value, 'digest') };
  });
  return { queries };
}
export const savedQueryDeleteSelectedSchema = z.preprocess((value, context) => {
  try { return copyInput(value); } catch { context.addIssue({ code: 'custom', message: text.invalid }); return z.NEVER; }
}, z.object({ queries: z.array(reference).min(1).max(savedQueryDeleteSelectedLimits.selected).refine(values => new Set(values.map(value => value.id)).size === values.length, text.invalid) }).strict());
export type SavedQueryDeleteSelectedInput = z.infer<typeof savedQueryDeleteSelectedSchema>;
export interface SavedQueryDeleteSelectedResult { deleted: number; }

/** 回执仅包含确切删除数量；晚返或错误形状不能被当成任意成功记录数。 */
export function readSavedQueryDeleteSelectedResult(raw: unknown, expected: number): SavedQueryDeleteSelectedResult {
  if (!raw || typeof raw !== 'object' || Reflect.ownKeys(raw).length !== 1) throw Error(text.failed);
  const deleted = Object.getOwnPropertyDescriptor(raw, 'deleted');
  if (!deleted || !Object.hasOwn(deleted, 'value') || deleted.value !== expected || !Number.isSafeInteger(expected) || expected < 1 || expected > savedQueryDeleteSelectedLimits.selected) throw Error(text.failed);
  return { deleted: expected };
}
