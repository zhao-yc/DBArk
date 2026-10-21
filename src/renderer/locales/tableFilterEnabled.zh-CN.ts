export const tableFilterEnabledZh = {
  enabled: (index: number) => `启用筛选条件 ${index}`,
  enabledLabel: '已启用', disabledLabel: '已停用',
  enableAll: '启用全部筛选条件', disableAll: '停用全部筛选条件',
  enableAllLabel: '全部启用', disableAllLabel: '全部停用',
  hint: '切换会保留原条件及精确值，从第一页重新读取服务器；未提交数据仍需确认。全部停用时不限制记录，排序保持。',
  status: (enabled: number, total: number) => `生效条件 ${enabled} / 保留条件 ${total}`,
  invalid: '筛选启用状态或条件编号无效，原筛选保持。',
  declined: '筛选尚未切换，原条件及数据草稿保持。',
} as const;
