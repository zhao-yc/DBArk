import { z } from 'zod';
import { savedQueryRenameNameSchema } from './savedQueryRename';

/** 复制仅接收本地资料引用和名称，不借用活动查询或连接凭据。 */
export const savedQueryDuplicateSchema = z.object({
  id: z.string().min(1).max(200), digest: z.string().regex(/^[a-f0-9]{64}$/),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/), name: savedQueryRenameNameSchema,
}).strict();
export type SavedQueryDuplicateInput = z.infer<typeof savedQueryDuplicateSchema>;

export const savedQueryDuplicateZh = {
  rename: '复制查询', newName: '副本名称', confirm: '创建副本', cancel: '取消复制',
  hint: '创建独立的本地保存查询，保留完整SQL、来源连接、默认库及原分组。不会打开或执行副本；原记录及已打开草稿保持不变。',
  invalidName: '查询名称须为1至256个字符，不能全为空白、包含控制字符或孤立代理字符。',
  missing: '原保存查询已删除，请刷新列表。', stale: '保存查询或分组已变化，请刷新后复制。',
  renamed: '查询副本已保存。', refreshRequired: '复制已保存，但列表未能完整刷新，请刷新后继续。',
} as const;

/** 有效Unicode按码点截短，附加后缀后仍满足原256个UTF16单元预算。 */
export function savedQueryDuplicateName(name: string): string {
  const suffix = '（副本）'; let prefix = '';
  for (const character of name) { if (prefix.length + character.length + suffix.length > 256) break; prefix += character; }
  return prefix + suffix;
}
