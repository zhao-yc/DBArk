/** 结果XLSX沿用既有表Excel的dbark-v1协议，不猜测返回列的SQL类型。 */
export const resultExcelZh = {
  format: 'Excel (XLSX)', sheet: '数据',
  encoding: 'XLSX 使用固定 Unicode，无需选择文本编码。',
  notice: '仅导出已经返回的有界结果快照，不重发 SQL，也不需要数据库连接。文件使用与表 Excel 一致的 DBArk 文本协议。',
  numbers: '数字和日期时间按文本保留，避免 Excel 的 15 位数值精度限制；布尔值保持原类型，公式样式的标题和值按普通文本保存。',
  nulls: 'NULL 写为文本 \\N，空字符串保留为空文本；原文本若以反斜线开头则再加一个反斜线。重新导入时选择 DBArk 协议可区分 NULL、空串和原始标记。',
  binary: '二进制写为文本 \\B: 加原 Base64，包括空二进制 \\B:；不解码为字节或猜测字符编码。',
  limits: '保留结果导出的 100000 行、1024 列、2000000 格和 32 MiB 原数据预算；DBArk 标记或转义计入 Excel 单格 32767 字符及单行 1 MiB 限制。超限或含 XML 无法表示的字符时整份拒绝，不截断。',
  utf8Only: 'XLSX 结果导出必须使用固定 utf8 标记，不接受 UTF-16 或 GB18030 文本编码。',
  length: '结果单元格及 DBArk 标记超过 Excel 的 32767 字符上限，请改用 JSON 导出。',
  characters: '结果包含 XLSX 无法无损表示的 XML 字符，请改用 JSON 导出。',
  rowBytes: 'Excel 标题或数据行的输出文本超过 1 MiB，请减少导出列或改用 JSON。',
  invalid: 'XLSX 结果导出数据或请求无效。',
} as const;
