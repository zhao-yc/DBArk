export const tableApplyReceiptZh = {
  openCurrent: '查看本次提交记录', previewPrivacy: '提交记录仅保存目标和结果摘要，不保存此处SQL或字段值。',
  committedRecordFailed: '数据已确认提交，但本地记录保存失败；请核对服务器，不要重复执行。',
  committedCleanupWarning: '数据已确认提交，后续收尾异常；请查看提交记录。',
  title: '数据提交记录', tasks: '返回任务', privacy: '只保存目标和结果摘要，不保存SQL、参数、行值或原错误。记录仅说明目标InnoDB事务，不包含触发器或外部副作用。',
  empty: '暂无提交记录', missing: '未找到提交记录', running: '执行中',
  details: '提交记录详情',
  scope: '回执仅说明目标 InnoDB 事务，不包含触发器或外部副作用；不保存SQL或行值。',
  labels: { operationId: '操作编号', previewId: '预览编号', connectionRevision: '连接编号 / 修订', target: '目标库表', intent: '计划类别', time: '开始 / 结束', phase: '阶段', reason: '原因', transactionProtected: '目标连续事务保护', dmlAcknowledged: '提交前语句回应数', acknowledgements: 'COMMIT成功回应 / ROLLBACK成功回应' },
  intent: '新增 {0}，修改 {1}，删除 {2}；执行计划 {3} 条',
  unfinished: '尚未结束', pendingConfirmation: '未知 / 尚未确认', confirmed: '已确认', unconfirmed: '未确认', yes: '是', no: '否',
  // 标签末尾的空格保留原界面文字间距，动态句式使用formatText位置参数。
  filters: { outcome: '结果 ', outcomeAria: '提交结果筛选', all: '全部', connectionId: '连接编号 ', connectionAria: '提交连接筛选' },
  viewDetails: '查看提交详情', previousPage: '上一页', nextPage: '下一页', page: '第 {0} 页 / 共 {1} 条',
  cancellation: { finished: '任务正在收尾，暂不能取消', unverified: '尚未核验当前阶段，暂不能取消' },
  outcomes: { 'not-sent': '未发送数据写入', committed: '服务器已确认提交', 'rolled-back': '已确认目标事务回滚', unknown: '结果未知，请先核对服务器' },
  phases: { prepared: '已保存意图', dispatching: '已准备派发', executing: '正在执行', committing: '正在确认提交，暂不能取消', 'rolling-back': '正在确认回滚', terminal: '已结束' },
  unknown: '结果未知不等于失败或已回滚。请先核对服务器，不要重新执行原批次。此处不提供重放操作。',
  rows: '服务器报告的目标行数（UPDATE包含FOUND_ROWS匹配行，不保证内容实际改变）',
  pendingRows: '未确认提交，不能以已回应语句数计算已提交行数。',
  clock: '时间为本机记录时间，不是服务器提交时间。',
  reasons: { none: '无', 'statement-failed': '语句未正常完成', 'transaction-unconfirmed': '连续事务保护未确认', validation: '提交前校验未完成', conflict: '数据并发冲突', cancelled: '用户取消', 'connection-loss': '连接中断', 'rollback-unconfirmed': '回滚未确认', 'commit-unconfirmed': '提交未确认', interrupted: '应用或引擎中断', 'cleanup-failed': '提交已确认，后续收尾异常' }
} as const;
