export const postgresBatchFillZh = {
  action: '批量填充字段', title: '批量填充 PostgreSQL 勾选记录', addField: '添加填充字段',
  selectField: '选择填充字段', remove: (name: string) => `移除填充字段 ${name}`,
  count: (count: number) => `本页勾选 ${count} 条记录`,
  notice: '统一填充所选记录的指定字段。整批暂存后，仍需在表页预览并提交。',
  stage: '暂存整批填充', undo: '撤销整批填充', staged: (count: number) => `已暂存 ${count} 条记录的批量填充`,
  unchanged: '勾选记录的值已一致，草稿保持。',
  stale: '原表页、连接、勾选或草稿已变化，请重新打开批量填充。',
  rows: '请选择当前页 1 至 100 条完整的已有记录，排除已标记删除的行。',
  fields: '请选择可编辑的普通字段。主键和生成列不可批量填充。',
  invalid: '填充值或字段无效，整批未暂存。',
} as const;
