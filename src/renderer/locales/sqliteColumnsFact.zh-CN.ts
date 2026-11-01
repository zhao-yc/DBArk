/** 字段任务与回执只显示最小DDL事实，不保留列名、默认值、SQL或路径。 */
export const sqliteColumnsTaskTitles = { inspect: 'SQLite字段目录检查', preview: 'SQLite字段修改预览', apply: 'SQLite字段事务' } as const;
export const sqliteColumnsFactZh = {
  title: 'SQLite 字段事务回执', operation: '操作编号', target: '准确目标', requested: '请求的 DDL 语句数', completed: '已处理的 DDL 语句数（不是已提交数）',
  phases: { 'not-sent': 'DDL 尚未发送', writing: '事务内处理 DDL，尚未提交', 'commit-pending': '等待 COMMIT 确认', committed: 'COMMIT 已确认', 'rolled-back': 'ROLLBACK 已确认，整组回滚', unknown: '结果未知，禁止重复提交' },
} as const;