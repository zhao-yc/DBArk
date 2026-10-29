/** 数据库默认值不等于现有表列转换；所有风险确认使用明确中文。 */
export const databaseDefaultEncodingZh = {
  entry: '数据库默认编码', title: '数据库默认字符集与排序规则', charset: '数据库默认字符集', collation: '数据库默认排序规则', choose: '请选择同字符集的排序规则', serverVersion: '数据库版本',
  scope: '仅影响后续未指定编码的新表，不转换已有表、字段或数据，不提交其他查询标签的事务。',
  read: '重新读取数据库默认编码', preview: '预览数据库默认编码变更', apply: '确认修改数据库默认编码', back: '返回数据库默认编码选择', cancel: '取消数据库默认编码任务', close: '关闭',
  fixedSql: '数据库默认编码SQL预览（只读）', before: '原数据库默认编码', after: '新数据库默认编码', actual: '实际读回默认编码', readonly: '当前数据库默认编码只读', confirmation: '输入完整数据库名确认修改',
  ackImplicit: '我确认DDL使用独立短会话，可能在该会话隐式提交；取消与事务回滚不能撤销已经完成的变更。',
  ackWindow: '我确认在维护窗口执行并暂停并行结构修改；执行前复核仍存在外部DDL并发窗口。',
  ackDefaults: '我确认只改数据库默认值，已有表、字段与数据不转换，只影响后续未显式指定编码的新表。',
  targetChanged: '目标或连接配置已变化，请关闭后重新打开。', expired: '快照或预览已过期，请重新读取。', mismatch: '响应目标、原定义或候选摘要与当前快照不一致，未接受该响应。',
  discard: '将放弃尚未提交的数据库默认编码草稿，是否继续？', unknownClose: 'DDL可能已完成，请先核对服务器数据库默认值。确认放弃本窗口记录并继续？',
  notSent: '尚未发送DDL。', unknown: 'DDL结果未知，请重新读取实际数据库默认值；不会自动重试或重放。', succeeded: '数据库默认编码已修改并完成定义核验；已有表、字段和数据保持原编码。', verificationFailed: 'DDL已完成，但定义未完整核验；请重新读取实际数据库默认值，不要重试旧预览。',
  cancelling: '已请求取消，等待原任务结束和资源释放。', consumed: '本次预览已消费，不能再次执行，请重新读取。', unsupportedAck: '存在当前版本不认识的风险确认项，不能执行。',
  busy: '同数据库表页仍有活动操作，请等待实际完成。', workspaceBudget: '工作区标签超过检查预算，请先关闭部分标签。',
  connecting: '建立数据库属性连接', reading: '读取数据库默认编码与候选', rechecking: '复核数据库定义与候选', executing: '修改数据库默认编码', verifying: '核验实际数据库默认值', releasing: '释放数据库属性资源',
};
