export const queryContinueOnErrorZh = {
  option: '遇错继续', title: '遇错继续执行摘要',
  hint: '遇数据库语句错误将继续执行后续语句（包括写操作）；取消、断线、解析失败将停止。客户端不自动提交或回滚，服务器错误仍可能回滚事务。继续前读取当前模式和默认库，会改变 ROW_COUNT()、FOUND_ROWS() 及警告等诊断信息。此选项只在当前标签保留，关闭后恢复默认，不保存到配置。',
  counts: (attempted: number, completed: number, failed: number) => `已尝试处理 ${attempted} 条语句，完整成功 ${completed} 条，记录失败 ${failed} 条。`,
  reachedEnd: '已处理到本次脚本末尾。', stopped: '本次脚本已停止，尚未处理到末尾。',
  stopReason: '停止原因', server: '数据库语句错误', terminal: '执行已停止',
  error: (ordinal: number) => `第 ${ordinal} 条语句`, locate: (ordinal: number) => `定位第${ordinal}条语句`,
  unavailable: '原模型或语句范围未确认，当前无法定位。', truncated: '［消息显示已截断］',
  results: (count: number) => `保留 ${count} 个完整成功结果；未完成语句的部分结果不作为成功结果保留。`,
  warning: '写入可能已生效，失败语句也可能部分执行；不会自动重试、重放、重连、提交或回滚原事务。',
} as const;
