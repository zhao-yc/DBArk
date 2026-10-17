export const tableCreateZh = {
  title: '确认新建表', target: '准确创建目标', preview: '生成新表预览', apply: '确认创建新表', back: '返回结构草稿', close: '关闭新建表确认', cancel: '请求取消',
  confirmation: '输入准确库.表名', ackDdl: '我已知DDL可能隐式提交，取消或断线不能证明创建未发生', ackCreate: '只创建此新表；同名拒绝，不覆盖、不改名、不自动重放',
  preparing: '正在读取实际服务器、数据库并生成只读预览…', sql: '本次固定CREATE语句',
  mismatch: '连接、目标或草稿已变化，此窗口预览永久失效，请返回重新准备。', expired: '新表预览已过期，请返回重新准备。',
  invalidDesign: '新表草稿无效；请检查字段和索引内容，不接受已有对象来源或任意SQL。',
  response: '新建表响应与本次准确目标不一致，请核对实际对象；不要重放。',
  succeeded: 'CREATE已收到成功响应，实际定义与本次设计已核验。', unverified: 'CREATE已收到成功响应，但完整定义尚未核验；请核对新表，不要重复创建。',
  cleanup: 'CREATE已收到成功响应，但资源收尾未确认；不要重复创建。', unknown: '创建结果未知；请只读核对实际目标，不要重复执行或自动删除同名表。', notSent: '尚未确认发送CREATE；旧预览已消费，不会自动重试。',
  discard: '放弃此新表确认并释放预览？', unknownClose: '创建或资源结果未确认。关闭仅释放本地预览，不回滚、不删除表；是否保留现场并关闭？',
  sqlWorkspace: '在SQL工作区独立编辑', sqlWorkspaceNotice: '已打开独立SQL草稿；它不携带本窗口的新建表确认能力。',
} as const;
