/** 清空确认使用固定协议项目，不能把未知项目显示为已授权。 */
export const tableTruncateZh = {
  title: '清空表数据', read: '重新读取清空能力', preview: '预览清空SQL', apply: '确认清空全部数据', back: '取消本次预览', cancel: '取消清空任务', close: '关闭',
  connection: '连接编号', engine: '引擎', autoIncrement: '当前自增计数（只读）', unset: '无自增列', version: '数据库版本',
  fixedSql: '清空SQL预览（只读）', readonly: '当前表不能使用专用清空入口', confirmation: '输入准确的库名.表名', confirmationHint: '确认文字须完全一致，不忽略空格和大小写：',
  ackData: '我确认已核对备份，将清空此表全部数据；DDL隐式提交且不可事务回滚，撤销和取消不能恢复数据。',
  ackCounter: '我确认自增计数将重置；OK包的0行不表示删除0条，本窗口不报告删除行数。',
  ackWindow: '我确认在维护窗口执行并暂停并行DDL和数据写入；执行前重核仍存在外部变更窗口。',
  targetChanged: '目标或连接配置已变化，请关闭后重新打开。', expired: '快照或预览已过期，请重新读取。', mismatch: '响应目标或原定义与当前快照不一致，未接受该响应。',
  discard: '将放弃本次清空预览和确认，是否继续？', unknownClose: '清空可能已完成，请先核对服务器数据。确认放弃本窗口记录并继续？',
  notSent: '尚未发送清空DDL。', unknown: '清空结果未知，请核对服务器；不会自动重试或重放。', succeeded: '清空DDL已完成，已观察空表并核验计数及定义。', verificationFailed: '清空DDL已完成，但空表、计数或定义未完整核验；不要重试旧预览。',
  cancelling: '已请求取消，等待真实任务结束和资源释放。', consumed: '本次令牌已消费，不能再次执行，请重新读取。', unsupportedAck: '存在当前版本不认识的风险确认项，不能执行。',
  dirty: '同目标表页有未提交的数据或布局草稿，请先处理后再清空。', busy: '同目标表页仍有活动操作，请等待实际完成。', editing: '表格仍有尚未结束的单元格输入，请先结束编辑。', workspaceBudget: '工作区标签超过检查预算，请先关闭部分标签。',
  connecting: '建立结构连接', reading: '读取清空能力与依赖', rechecking: '复核原定义与物理表身份', executing: '清空全部数据', verifying: '核验空表、计数及定义', releasing: '释放结构资源',
};
