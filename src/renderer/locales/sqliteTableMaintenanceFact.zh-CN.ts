/** 仅显示最小事务事实；写锁后的原表行数不代表实际删除量或触发器影响量。 */
export const sqliteTableMaintenanceTaskTitles = { inspect: 'SQLite表维护目录检查', preview: 'SQLite表维护预览', apply: 'SQLite表维护事务' } as const;
export const sqliteTableMaintenanceFactZh = {
  title: 'SQLite 表维护事务回执', operation: '操作编号', target: '准确原目标', action: '操作', actions: { clear: '清空表数据', drop: '删除表结构与数据' }, requested: '请求的语句数', completed: '已处理的语句数（不是已提交数）', actualBeforeRows: '写锁后原表行数（不是删除行数）', unknownRows: '尚未取得写锁后行数事实',
  phases: { 'not-sent': '语句尚未发送', writing: '事务内处理，尚未提交', 'commit-pending': '等待 COMMIT 确认', committed: 'COMMIT 已确认', 'rolled-back': 'ROLLBACK 已确认，整组回滚', unknown: '结果未知，禁止重复提交' },
} as const;
