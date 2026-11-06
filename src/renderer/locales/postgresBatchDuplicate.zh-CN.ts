export const postgresBatchDuplicateZh = {
  action: '复制勾选记录', title: '复制 PostgreSQL 勾选记录为新增草稿',
  notice: '每条勾选记录生成一个副本，带入原值及已暂存值。请逐条核对手动主键和唯一字段。暂存后仍须预览并确认提交。',
  omitted: (names: string) => `初始省略的生成列、标识列及序列默认列为 ${names}。`,
  stage: '暂存整批副本', undo: '撤销整批副本',
  staged: (count: number) => `已暂存 ${count} 条新增副本。`,
  stale: '原表页、勾选或草稿已变化，请重新打开复制窗口。',
} as const;
