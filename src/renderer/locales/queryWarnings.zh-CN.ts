export const queryWarningsZh = {
  option: '采集警告详情', open: '本次执行警告报告', title: '本次执行警告报告', close: '关闭', notice: '警告采集影响说明',
  hint: '开启后会在原语句之间读取警告，并改变后续 ROW_COUNT()。依赖该值的脚本请保持关闭；关闭时不增加诊断 SQL。选项仅用于普通和类型参数查询，不保存到配置。',
  snapshot: '这是本次执行取得的离线快照，打开、切换语句和关闭均不发送 SQL。CALL 按整条语句展示，不将多个结果集的次数累计成警告。',
  statement: '报告语句', ordinal: (ordinal: number) => `第 ${ordinal} 条语句`, completed: '已完成', failed: '未完成',
  total: '服务器报告总数', unknown: '未知', collected: '已取得条数', level: 'Level', code: 'Code', message: 'Message',
  fields: '服务器原始 Level / Code / Message', empty: '本语句没有取得条件明细。',
  unavailable: '明细未取得', hidden: '参数查询消息已隐藏', messageUnavailable: '消息未提供',
  messageTruncated: '消息已截断', statementTruncated: '本语句仅保留部分明细。',
  truncated: '本次警告报告未完整取得，详见各语句说明。',
  omitted: (count: number) => `另有 ${count} 条语句的报告未保留。`,
  count: (count: number) => `${count} 条警告`, statements: (count: number) => `本次已保留 ${count} 条语句的报告。`,
} as const;
