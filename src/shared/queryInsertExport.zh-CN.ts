/** 完整INSERT流式导出的合同、错误和界面文案集中维护。 */
export const queryInsertZh = {
  format: 'INSERT SQL：一个完整行结果集',
  mapping: '请填写明确目标库、表及按结果列位置排列的全部唯一字段；不会推断SQL来源或读取目标结构。',
  database: '完整INSERT目标数据库', table: '完整INSERT目标表', columns: '完整INSERT目标字段（每行一个，按结果列位置）',
  scope: '首片只接受一个行结果集，不接受状态结果、第二个行结果集或列数不符；不匹配即停止且保留原文件。此前SQL可能已经执行，不会自动重放。',
  mismatch: '完整INSERT仅支持一个行结果集，实际结果结构与明确目标不匹配；原文件保持不变，SQL可能已执行。',
  type: '完整INSERT遇到不能可靠表示的类型或值；不转换、截断或重放SQL，原文件保持不变。',
  field: '完整INSERT单字段超过8MiB或生成的单行超过16MiB；原文件保持不变。',
  incomplete: '完整INSERT没有收到唯一行结果集的完整结束；原文件保持不变。',
  header: '-- 本次新执行的完整行结果；仅生成INSERT文件，不向目标表执行INSERT。\n',
} as const;
