export const postgresRecordDuplicateZh = {
  action: '复制当前记录', title: '复制 PostgreSQL 记录为新增草稿',
  source: (row: number) => `复制第 ${row} 行的原值及已暂存的字段。请核对手动主键和唯一字段。`,
  omitted: (names: string) => `初始省略的生成列、标识列及序列默认列为 ${names}。`,
  notice: '可编辑表单或让字段使用默认值。加入草稿后，仍需预览并确认提交。',
  staged: '已将当前记录的副本暂存为新增草稿。',
  stale: '原表页、记录、连接或草稿已变化，请重新打开复制表单。',
  missing: (name: string) => `字段 ${name} 的原值不完整，无法复制记录。`,
  invalid: (name: string) => `字段 ${name} 超出暂存范围或值无法复制。`,
  budget: '记录字段或数据大小超出新增草稿预算。',
} as const;
