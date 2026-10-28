import { z } from 'zod';

/** 名称仅用于本地资料展示；错误和界面均不回显SQL正文或输入摘要。 */
export const savedQueryRenameZh = {
  rename: '重命名查询', newName: '新查询名称', confirm: '确认重命名', cancel: '取消重命名',
  hint: '仅修改本地保存名称，保留SQL、来源连接、默认库及分组。已打开编辑器保留当前内容，后续覆盖保存会重新核对原来源。',
  invalidName: '查询名称须为1至256个字符，不能全为空白、包含控制字符或孤立代理字符。',
  missing: '原保存查询已删除，请刷新列表。', stale: '原保存查询已变化，请刷新后重命名。',
  noChange: '查询名称未改变。', timestamp: '原查询更新时间无法安全推进，名称保持不变。',
  renamed: '查询已重命名。', refreshRequired: '重命名已保存，但列表未能完整刷新，请刷新后继续。',
} as const;

/** 保留名称原文及有效Unicode，不修剪空白或合并同名的不同记录。 */
export const savedQueryRenameNameSchema = z.string().min(1, savedQueryRenameZh.invalidName).max(256, savedQueryRenameZh.invalidName).refine(
  value => value.length >= 1 && value.length <= 256 && value.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
    && [...value].every(character => { const point = character.codePointAt(0)!; return point < 0xd800 || point > 0xdfff; }), savedQueryRenameZh.invalidName,
);
export const savedQueryRenameSchema = z.object({
  id: z.string().min(1).max(200), digest: z.string().regex(/^[a-f0-9]{64}$/), name: savedQueryRenameNameSchema,
}).strict();
export type SavedQueryRenameInput = z.infer<typeof savedQueryRenameSchema>;
