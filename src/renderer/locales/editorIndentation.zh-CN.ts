export const editorIndentationZh = {
  entry: '编辑器缩进', title: 'SQL 编辑器缩进', width: '缩进宽度', style: '缩进方式', spaces: '空格', tabs: 'Tab',
  save: '保存缩进', saving: '正在保存…', cancel: '取消', reset: '恢复默认缩进',
  current: (width: number, spaces: boolean) => `当前缩进：${width} 列 · ${spaces ? '空格' : 'Tab'}`,
  hint: '宽度允许 1–8 的整数。保存后应用到所有已打开和之后新建的 SQL 编辑器，包括只读预览；已有文本、选区和撤销记录保持不变。',
  draft: '恢复默认只修改本次草稿，保存后使用 2 列、空格缩进。不会自动格式化；显式格式化 SQL 时使用该偏好。',
  invalid: '请输入 1–8 之间的整数，并选择空格或 Tab。', failed: '保存失败，当前窗口已应用该缩进；请重试保存。',
} as const;
