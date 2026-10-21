export const queryResultSelectedFilterZh = {
  open: '勾选值加入筛选',
  hint: '使用当前列中已勾选行的完整原值，与已有条件整体按 AND 组合。NULL 使用独立分组，先审阅草稿再应用，不重发 SQL。',
  unavailable: '请先勾选行并指定当前列；勾选值必须有可靠的原行列身份和可比较原值。字节或未知类型只支持全部为 NULL 的勾选值。',
  budget: '勾选值超过 128 种（含 NULL）、100000 行、1024 列、单值 4096 字符或总原文 8 Mi 单元预算；没有截断或应用部分值。',
  stale: '勾选值所属行列、原值或选择已变化，请重新选择当前结果。',
  caption: (count: number, name: string) => `已从“${name}”的 ${count} 行勾选值生成筛选草稿`,
} as const;
