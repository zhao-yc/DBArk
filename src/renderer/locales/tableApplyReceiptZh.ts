export const tableApplyReceiptZh = {
  title: '数据提交记录', tasks: '返回任务', privacy: '只保存目标和结果摘要，不保存SQL、参数、行值或原错误。记录仅说明目标InnoDB事务，不包含触发器或外部副作用。',
  empty: '暂无提交记录', missing: '未找到提交记录', running: '执行中',
  outcomes: { 'not-sent': '未发送数据写入', committed: '服务器已确认提交', 'rolled-back': '已确认目标事务回滚', unknown: '结果未知，请先核对服务器' },
  phases: { prepared: '已保存意图', dispatching: '已准备派发', executing: '正在执行', committing: '正在确认提交，暂不能取消', 'rolling-back': '正在确认回滚', terminal: '已结束' },
  unknown: '结果未知不等于失败或已回滚。请先核对服务器，不要重新执行原批次。此处不提供重放操作。',
  rows: '服务器报告的目标行数（UPDATE包含FOUND_ROWS匹配行，不保证内容实际改变）',
  pendingRows: '未确认提交，不能以已回应语句数计算已提交行数。',
  clock: '时间为本机记录时间，不是服务器提交时间。',
  reasons: { none: '无', 'statement-failed': '语句未正常完成', 'transaction-unconfirmed': '连续事务保护未确认', validation: '提交前校验未完成', conflict: '数据并发冲突', cancelled: '用户取消', 'connection-loss': '连接中断', 'rollback-unconfirmed': '回滚未确认', 'commit-unconfirmed': '提交未确认', interrupted: '应用或引擎中断', 'cleanup-failed': '提交已确认，后续收尾异常' }
} as const;
