/** 脚本首错提示只描述执行范围和风险，不拼接模板SQL或参数值。 */
export const queryPartialOutcomeZh = {
  title: '脚本执行在首个错误处停止',
  position: (ordinal: number, completed: number) => `第${ordinal}条语句失败；此前已完成${completed}条语句。本次执行范围内的后续语句未继续执行。`,
  retained: (count: number) => `已保留此前完整成功的${count}个结果；可读取的行结果仍可查看、固定、筛选、排序和导出。失败语句的未完成结果不作为成功结果保留。`,
  empty: '没有此前完整成功的结果可供查看或导出。',
  warning: '此前已提交的修改不能通过取消或回滚撤销。失败语句可能已部分执行，不能据此认定未执行；不会自动重试、重放或重连执行。',
};
