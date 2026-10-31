/** SQLite 文件连接与首版工作区能力的集中中文文案。 */
export const sqliteZh = {
  file: 'SQLite 数据库文件', choose: '选择数据库文件', noFile: '请选择现有 SQLite 数据库文件',
  readOnly: '以只读方式打开', busyTimeout: '锁等待超时（毫秒）',
  hint: '文件选择仅授权当前连接。导入或复制的连接需要重新选择本机文件。',
  selectQuery: '生成 SELECT 查询', definition: '查看定义',
  wrongFileKind: '网络连接不能授权 SQLite 数据库文件',
  unsupported: 'SQLite 当前入口尚未实现，请在查询标签中执行明确的 SQL。',
  formatCaseUnavailable: 'SQLite 格式化暂仅支持保留关键字大小写，请在偏好中选择保留。',
  mainOnly: 'SQLite 当前仅支持 main 数据库；原查询指定了其他数据库，正文和来源保持不变，请显式新建 main 查询。',
  recoveryHint: 'SQLite 文件查询仅支持 main。确认后恢复到 main，原 SQL 正文保持不变，仍需显式执行。',
  brokenTransaction: 'SQLite 原会话已失效，事务结果未知。请先核对数据库结果，再显式断开连接并新建查询；不会自动重连或重放。',
  required: '请重新选择现有 SQLite 数据库文件。',
};
