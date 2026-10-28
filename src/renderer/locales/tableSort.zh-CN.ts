export const tableSortZh = {
  entry: '多列排序', title: '表数据多列排序',
  hint: '按列表优先级在服务器上排序全部匹配记录，应用后从第一页读取，保留当前筛选。草稿编辑不查询；应用时会确认是否放弃未提交数据。',
  ties: '并列项沿用可靠行键补充排序。每列可独立指定NULL置前或置后，与升降序无关；缺省沿用数据库顺序。空文本不是NULL，文本和时间的比较仍由数据库决定。',
  empty: '尚未指定排序字段。', add: '添加排序字段', clear: '清空排序草稿',
  apply: '应用排序', cancel: '取消排序编辑', asc: '升序', desc: '降序',
  field: (order: number) => `排序字段 ${order}`, direction: (order: number) => `排序方向 ${order}`,
  nulls: (order: number) => `NULL位置 ${order}`, nullsDefault: '数据库默认', nullsFirst: 'NULL置前', nullsLast: 'NULL置后',
  earlier: (order: number) => `提高第${order}排序优先级`, later: (order: number) => `降低第${order}排序优先级`,
  remove: (order: number) => `移除第${order}排序字段`,
  invalid: '排序字段必须来自当前表、不能重复，且最多20项；方向只能为升序或降序，NULL位置只能为数据库默认、置前或置后。',
  stale: '表、筛选、排序或连接已变化，请关闭后从当前表重新打开排序编辑。',
  declined: '尚未应用排序，原数据草稿和排序保持。',
} as const;
