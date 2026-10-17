export const queryResultFindZh = {
  open: '查找结果', input: '在当前结果中查找', sensitive: '区分大小写', previous: '上一个匹配', next: '下一个匹配', close: '关闭结果查找',
  hint: '仅查找当前已返回行和可见列；文本包含完整原值，二进制仅查已显示的十六进制预览。按匹配单元格计数，不重新执行 SQL。',
  empty: '输入字面文字开始查找', noMatch: '无匹配单元格', stopped: '查找已失效，请重新打开', invalid: '查找文字最多 256 个字符',
  searching: (count: number, scanned: number, total: number) => `正在查找：${count} 个匹配单元格，已检查 ${scanned}/${total} 格`,
  count: (count: number, index: number) => `${count} 个匹配单元格${index >= 0 ? `，当前第 ${index + 1} 个` : ''}`,
  limited: '已达到 5000 个匹配单元格上限，仅在这些命中中跳转；其余未继续检索。',
  scope: (rows: number, columns: number) => `范围：已返回 ${rows} 行、${columns} 个可见列。`,
  location: (row: number, column: number) => `命中：第 ${row + 1} 行，第 ${column + 1} 个可见列`,
} as const;
