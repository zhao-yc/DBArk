/** 任务概要不携带字段或默认值；计数不替代真实事务确认。 */
export const sqliteTableRebuildTaskTitles = { inspect: 'SQLite 表重建目录检查', preview: 'SQLite 表重建预览', apply: 'SQLite 表重建事务' } as const;
export const sqliteTableRebuildFactZh = {
  title: 'SQLite 表重建事务回执', operation: '操作编号', target: '准确原目标', requested: '请求的语句数', completed: '已处理的语句数（不是已提交数）',
  sourceRows: '写锁后原表行数', copiedRows: '已复制行数（不是已提交数）', verifiedRows: '全量逐值核验行数（不是已提交数）',
  phases: { 'not-sent': '语句尚未发送', writing: '事务内重建，尚未提交', 'commit-pending': '等待 COMMIT 确认', committed: 'COMMIT 已确认', 'rolled-back': 'ROLLBACK 已确认，整组回滚', unknown: '结果未知，禁止重复提交' },
} as const;
