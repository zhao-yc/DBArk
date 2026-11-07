export const postgresTransactionSettingsZh = {
  open: '事务默认设置', title: 'PostgreSQL 本会话事务默认设置',
  hint: '仅设置原查询会话后续事务的默认值；当前事务可自行覆盖。不会保存为连接设置，也不会自动提交或回滚。',
  isolation: '默认隔离级别', readOnly: '默认只读事务', deferrable: '默认 DEFERRABLE',
  semantics: 'READ UNCOMMITTED 在 PostgreSQL 中按 READ COMMITTED 处理。DEFERRABLE 仅在 SERIALIZABLE 且 READ ONLY 时生效。',
  transaction: '原会话事务', active: '正在事务中，请先明确提交或回滚，再重新读取后修改。', idle: '当前没有活动事务',
  identity: '物理后端 PID', database: '原数据库',
  refresh: '重新读取原会话', apply: '应用本会话默认值', close: '关闭',
  ready: '已读取原会话默认值', applied: '默认值已设置并读回确认', loading: '正在读取原会话…', applying: '正在设置并核对…',
  changed: '原标签、连接、数据库或物理会话已变化，请关闭后重新打开。',
  uncertain: '当前显示值尚未重新确认，请显式重新读取后再修改。',
} as const;
