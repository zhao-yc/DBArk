export const editorIndentationZh = {
  entry: '编辑器缩进', title: 'SQL 编辑器缩进', width: '缩进宽度', style: '缩进方式', spaces: '空格', tabs: 'Tab',
  save: '保存缩进', saving: '正在保存…', cancel: '取消', reset: '恢复默认缩进',
  current: (width: number, spaces: boolean) => `当前缩进：${width} 列 · ${spaces ? '空格' : 'Tab'}`,
  hint: '缩进宽度为 1–8 的整数，应用于所有 SQL 编辑器；不改写现有文本。',
  draft: '默认使用 2 列空格缩进，保存后生效；不会自动格式化。',
  invalid: '请输入 1–8 之间的整数，并选择空格或 Tab。', failed: '保存失败，当前窗口已应用该缩进；请重试保存。',
} as const;
