/** 协议确认项与用户文案分离，未知确认项不能显示为已授权。 */
export const tableCommentZh = {
  title: '表注释', comment: '普通表说明', read: '重新读取表属性', preview: '预览表注释变更', apply: '确认修改表注释', back: '返回注释编辑', cancel: '取消注释任务', close: '关闭',
  engine: '引擎', charset: '默认字符集', collation: '默认排序规则', rowFormat: '行格式', autoIncrement: '自增计数（只读）', unset: '未设置', version: '数据库版本',
  fixedSql: '表注释SQL预览（只读）', before: '原注释', after: '新注释', readonly: '当前表注释只读', budget: '本版保守预算：{0}字符、{1}个UTF-8字节；超限拒绝，不截断。', bmp: '当前注释目录仅证明基本多文种平面文字，暂不接受emoji等补充字符。',
  ackImplicit: '我确认DDL可能隐式提交，取消和事务回滚不能撤销已完成的注释修改，服务器可能等待锁或内部重建。',
  ackWindow: '我确认在维护窗口执行并暂停并行结构修改；执行前重核仍存在外部DDL并发窗口。',
  targetChanged: '目标或连接配置已变化，请关闭后重新打开。', expired: '快照或预览已过期，请重新读取。', mismatch: '响应目标或原定义与当前快照不一致，未接受该响应。',
  discard: '将放弃尚未提交的注释草稿，是否继续？', unknownClose: 'DDL可能已完成，请先核对服务器定义。确认放弃本窗口记录并继续？',
  notSent: '尚未发送DDL。', unknown: 'DDL结果未知，请核对实际定义；不会自动重试或重放。', succeeded: '表注释已修改并完整核验。', verificationFailed: 'DDL已完成，但定义未完整核验；请核对实际定义，不要重试旧预览。',
  cancelling: '已请求取消，等待真实任务结束和资源释放。', consumed: '本次令牌已消费，不能再次执行，请重新读取。', unsupportedAck: '存在当前版本不认识的风险确认项，不能执行。',
  dirty: '同目标表页有未提交的数据草稿，请先处理后再编辑注释。', busy: '同目标表页仍有活动操作，请等待实际完成。', workspaceBudget: '工作区标签超过检查预算，请先关闭部分标签。',
  connecting: '建立结构连接', reading: '读取实际定义', rechecking: '复核原定义与表身份', executing: '修改表注释', verifying: '核验完整定义', releasing: '释放结构资源',
};
