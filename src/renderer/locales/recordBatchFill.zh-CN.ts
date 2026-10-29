export const recordBatchFillZh = {
  action: '批量填充字段', title: '批量填充选中记录', field: '填充字段', stage: '暂存整批草稿',
  notice: '仅修改当前页已勾选的完整已有记录。可添加多个字段分别填写统一值，整组暂存后可一步撤销；仍需原表页预览并提交。',
  add: '添加填充字段', remove: (column: string) => `移除填充字段 ${column}`,
  assignment: (order: number) => `填充项 ${order}`, fieldAt: (order: number) => `填充字段 ${order}`,
  assignments: '请至少选择一个不同的可编辑字段；重复、缺失或超出可编辑字段数时整组未暂存。',
  count: '本次记录数：{0}', staged: '已将 {0} 条记录暂存为一步批量填充草稿。',
  unchanged: '所选记录已是全部指定值，未新增草稿或撤销步骤。',
  changed: '表页、连接、元数据、选择或草稿已变化；本次批量填充已失效，请关闭后重新打开。',
  selection: '请勾选当前页完整的已有记录；新增、删除、缺失或重复记录不能批量填充。',
  column: '仅可填充普通可编辑列；主键、定位键、自增和生成列不可选择。',
  source: '当前页来源不一致或记录不完整，整批未暂存；请显式刷新后重试。',
  budget: '记录或值无效，或超过原批量／历史预算；整批未暂存。',
} as const;
