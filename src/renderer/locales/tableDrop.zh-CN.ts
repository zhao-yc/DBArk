/** 删除风险使用独立固定协议，不能借清空或未知确认项授权。 */
export const tableDropZh = {
  title: '删除表', read: '重新读取删除能力', preview: '预览删除SQL', apply: '永久删除此表', back: '取消本次预览', cancel: '取消删除任务', close: '关闭',
  connection: '连接编号', engine: '引擎', version: '数据库版本', fixedSql: '删除SQL预览（只读）', readonly: '当前表不能使用专用删除入口', confirmation: '输入准确的库名.表名', confirmationHint: '确认文字须完全一致，不忽略空格和大小写：',
  ackData: '我已核对备份，确认永久删除此表的数据和结构；撤销、取消或事务回滚都不能恢复。',
  ackCommit: '我确认DROP TABLE会隐式提交；操作使用独立结构会话，不会替其它查询标签提交事务，OK包不代表删除行数。',
  ackWindow: '我确认在维护窗口暂停并行DDL和数据写入；执行前重核仍存在外部变更窗口，不级联删除，不关闭外键检查。',
  targetChanged: '目标或连接配置已变化，请关闭后重新打开。', expired: '快照或预览已过期，请重新读取。', mismatch: '响应目标或原定义与当前快照不一致，未接受该响应。',
  discard: '将放弃本次删除预览和确认，是否继续？', unknownClose: '删除可能已完成，请先核对服务器。确认放弃本窗口记录并继续？',
  notSent: '尚未发送删除DDL。', unknown: '删除结果未知，请核对服务器；不会自动重试或重放。', succeeded: '删除DDL已完成，已核验表名和原物理表编号均从目录消失。', verificationFailed: '删除DDL已完成，但表名、原物理表编号或服务器身份未完整核验；不要重试旧预览。',
  cancelling: '已请求取消，等待真实任务结束和资源释放。', consumed: '本次令牌已消费，不能再次执行，请重新读取。', unsupportedAck: '存在当前版本不认识的风险确认项，不能执行。',
  dirty: '同目标表页有未提交的数据或布局草稿，请先处理后再删除。', busy: '同目标表页仍有活动操作，请等待实际完成。', editing: '表格仍有尚未结束的单元格输入，请先结束编辑。', workspaceBudget: '工作区标签超过检查预算，请先关闭部分标签。',
  connecting: '建立结构连接', reading: '读取删除能力与依赖', rechecking: '复核原定义与物理表身份', executing: '永久删除数据与结构', verifying: '核验原表确实消失', releasing: '释放结构资源',
};
