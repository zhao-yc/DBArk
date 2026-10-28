export const queryDatabaseSwitchZh = {
  open: '切换默认数据库', title: '切换当前查询的默认数据库', database: '目标数据库',
  current: '切换前默认库', loading: '正在读取数据库目录…', applying: '正在切换并确认实际数据库…',
  choose: '请选择数据库', confirm: '确认切换', close: '关闭', dismiss: '关闭数据库切换窗口',
  changed: '原查询来源已变化，请关闭窗口后重新选择数据库', busy: '当前查询会话正忙，请稍后再试',
  empty: '没有可选择的数据库', completed: '已确认当前默认数据库：',
  notice: '只切换原查询会话的默认数据库。SQL正文、原结果、事务和临时表保留；仅影响后续执行。',
  diagnostics: '切换后的确认可能更新服务器诊断区；原结果中的警告计数仍属于原执行。',
  failed: '默认数据库切换未完成。', unconfirmed: '切换可能已发生，当前库待确认；未自动重试或重连。',
  saveFailed: (database: string) => `服务器已确认默认数据库为“${database}”，但本地恢复信息保存失败；未重新发送切库命令。`,
} as const;
