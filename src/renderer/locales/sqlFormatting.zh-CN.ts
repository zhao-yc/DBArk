export const sqlFormattingZh = {
  action: '格式化 SQL',
  button: '格式化',
  hint: 'Alt+Shift+F（macOS：Option+Shift+F）；有选区时只格式化选区，否则格式化全文；可一次撤销，不执行 SQL',
  unavailable: '当前查询编辑器不可格式化，请关闭弹窗并回到可编辑的查询标签。',
  selection: '请只选择一个完整文本范围，不要截断名称、字符串或注释。',
  limited: 'SQL 超出安全格式化范围，请缩小脚本后重试；原文未改动。',
  unsafe: '无法确认此 SQL 的引号、分隔符或语法可安全排版，请手动调整；原文未改动。',
  failed: 'SQL 格式化失败，原文未改动。',
};
