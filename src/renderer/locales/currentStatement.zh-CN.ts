export const currentStatementZh = {
  action: '执行当前语句',
  hint: '只执行光标所在完整语句，不执行前面的SET或其它语句。Ctrl / ⌘ + Shift + Enter',
  unavailable: '当前查询编辑器不可用，请重新选择查询标签。',
  changed: '当前语句的模型、光标、连接或标签已变化；未发送SQL，请重新执行。',
  selectionOnly: '仅执行选区',
  selectionHint: '只执行一个非空选区。没有有效选区时不执行脚本。',
  selectionRequired: '请选择一段非空 SQL 后再执行选区。',
  selectionChanged: '选区、正文、连接或标签已变化，未发送 SQL。请重新选择后执行。',
} as const;
