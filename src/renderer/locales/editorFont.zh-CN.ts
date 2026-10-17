export const editorFontZh = {
  entry: '编辑器字号', title: 'SQL 编辑器字号', field: '字号（px）', save: '保存字号', saving: '正在保存…', cancel: '取消', reset: '恢复默认 13',
  current: (value: number) => `当前字号：${value} px`, hint: '允许 8–32 的整数。保存后应用到所有 SQL 编辑器和只读 SQL 预览，不改变结果网格或窗口缩放。',
  draft: '恢复默认只修改本次草稿，点击“保存字号”后生效。', invalid: '请输入 8–32 之间的整数。', failed: '保存失败，当前窗口已应用该字号；请重试保存。',
} as const;
