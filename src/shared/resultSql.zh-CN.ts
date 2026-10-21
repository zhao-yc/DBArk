/** 结果INSERT导出的合同、界面及任务文案集中维护。 */
export const resultSqlZh = {
  database: 'INSERT目标数据库', table: 'INSERT目标表', column: (position: number) => `第${position}列INSERT目标字段`,
  targetColumn: 'INSERT目标字段', previewRequired: 'SQL结果导出必须先预览并确认目标映射', nonSql: '非SQL格式不能夹带INSERT目标或预览', confirmationMismatch: 'INSERT准确目标确认不匹配', filePurpose: 'INSERT预览只能绑定SQL结果保存用途', shuttingDown: '客户端正在退出，不能准备结果SQL', formats: '结果仅支持CSV、JSON、XLSX或INSERT SQL导出',
  mapping: '请明确填写每个结果列对应的目标字段；不从查询文本推断库、表或字段。',
  preview: '生成INSERT SQL预览', confirmation: '确认INSERT目标库.表名', acknowledge: '已核对目标与全部列映射；预览仅显示部分行，文件仅保存已返回快照，不执行SQL',
  protocol: 'SQL：文本使用UTF-8十六进制，二进制使用X十六进制；NULL、空串和精确数值字符串分别保留。不读取目标结构，不保证目标字段类型转换或约束可接受。',
  previewScope: (shown: number, total: number) => `实际SQL预览 ${shown}/${total} 行（最多20行、4MiB）；文件包含快照全部${total}行。`,
  invalid: 'INSERT目标或列映射无效：请填写明确库、表及全部唯一目标字段，源列必须与快照逐项一致。',
  identifier: 'INSERT名称须为1至64个基本多语言平面字符，不接受控制符、反斜线、尾部空白或无效Unicode。',
  type: 'SQL无法无损表示此单元格：拒绝孤立代理项、负零及非规范二进制编码。',
  stale: 'INSERT预览或文件选择已失效，请重新预览、选择文件并确认。',
  capacity: 'INSERT预览已达数量上限，请关闭旧导出窗口后重试。',
  changed: '结果已变化，请关闭此窗口后重新打开导出。',
  header: '-- 已返回结果快照；仅生成INSERT，不执行SQL。\n',
} as const;
