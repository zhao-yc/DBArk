export const editorFontZh = {
  entry: '编辑器字号', title: 'SQL 编辑器字号', field: '字号（px）', save: '保存字号', saving: '正在保存…', cancel: '取消', reset: '恢复默认 13',
  current: (value: number) => `当前字号：${value} px`, hint: '字号为 8–32 的整数，应用于所有 SQL 编辑器和只读预览。',
  draft: '恢复默认后需保存才生效。', invalid: '请输入 8–32 之间的整数。', failed: '保存失败，当前窗口已应用该字号；请重试保存。',
} as const;
