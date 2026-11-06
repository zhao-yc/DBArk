export const postgresBatchDeleteZh = {
  action: '删除勾选记录', title: '确认 PostgreSQL 删除勾选记录',
  notice: '本窗口只暂存删除草稿。核对目标后，还需在表页预览并确认提交。',
  count: (count: number) => `将暂存 ${count} 条记录的删除`,
  updates: (count: number) => `其中 ${count} 条已有更新草稿，暂存删除会替换这些更新。撤销整批可恢复。`,
  row: '原行号', primary: '原主键', stage: '暂存整批删除', undo: '撤销整批删除',
  staged: (count: number) => `已暂存 ${count} 条记录的删除`,
  stale: '原表页、连接、勾选或草稿已变化，请重新打开删除确认。',
} as const;
