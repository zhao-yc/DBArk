export const postgresCheckEditZh = {
  open: '编辑 CHECK', title: 'PostgreSQL CHECK 约束', operation: '操作', name: '约束名称', from: '原 CHECK 约束',
  actions: { create: '创建 CHECK', replace: '替换表达式', rename: '重命名 CHECK', validate: '验证 CHECK', drop: '删除 CHECK' },
  expression: 'CHECK 表达式', expressionHint: '只填写布尔表达式，例如 amount >= 0。自定义函数或类型请注明 schema。',
  noInherit: '不向继承表传播', notValid: '先创建，稍后验证已有记录',
  notEnforced: '仅记录定义，暂不强制检查',
  notValidHint: '新增或更新的记录仍受 CHECK 约束。修复历史记录后，可单独验证约束。',
  stage: '加入 CHECK 改动', undo: '撤回最后一项', preview: '预览 CHECK SQL', apply: '确认提交 CHECK 修改',
  close: '退出 CHECK 编辑', draft: '待提交 CHECK 改动', previewTitle: '实际提交 CHECK SQL',
  confirmDrop: '确认删除或替换预览中的约束。替换会在同一事务中删除原约束并创建新约束。',
  lockNote: '确认后将独占锁定本表。表达式及数据由 PostgreSQL 检查，任一步失败会回滚整批。',
  unknown: '提交结果待核对，请退出 CHECK 编辑后刷新实际结构。',
  rename: (from: string, name: string) => from + ' → ' + name,
} as const;
