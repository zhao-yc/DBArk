export const postgresBatchEditZh = {
  action: '逐条编辑勾选记录', title: '逐条编辑 PostgreSQL 勾选记录',
  notice: '为各条记录分别填写字段。切换记录会保留窗口输入，整批暂存后仍需预览并确认提交。',
  rows: '勾选记录列表', record: (row: number) => `第 ${row} 行`, edited: '已编辑',
  stage: '暂存整批编辑', undo: '撤销整批编辑',
  staged: (count: number) => `已更新 ${count} 条记录的草稿`,
  unchanged: '没有新的记录草稿变化。',
  stale: '原表页、连接、勾选或草稿已变化，请重新打开逐条编辑。',
  invalid: '字段或填充值无效，整批未暂存。',
} as const;
