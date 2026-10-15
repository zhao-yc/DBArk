/** 默认库恢复文案集中管理；选择只修改下次建连目标，不执行或重放SQL。 */
export const queryContextZh={
  unknown:'默认库待确认',none:'未选择数据库',choose:'选择重连数据库',title:'确认重连数据库',
  database:'数据库名称',hint:'此前执行的最终默认库无法确认。请选择下次新会话使用的数据库；留空表示不选择默认库。确认后请自行执行所需语句，之前的事务和临时表不会恢复。',
  saveHint:'保存当前正文及当前会话的默认库；未知状态在重新打开时需要确认数据库。',
  confirm:'使用此数据库',busy:'当前标签仍有操作正在进行，请稍后保存查询',legacy:'旧记录的初始库',
  snapshotFailed:'默认库恢复信息保存失败，未发送本次 SQL：',cancelledBeforeSend:'任务在准备阶段已取消，未发送本次 SQL',
} as const;
