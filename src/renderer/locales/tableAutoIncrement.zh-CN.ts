/** 目录观测与DDL事实分开表述，不把一次OK或较大数值当成“下一次插入一定使用”。 */
export const tableAutoIncrementZh = {
  title: '下一自增值', value: '请求的下一自增值（仅上调）', read: '重新读取计数与定义', preview: '预览自增计数调整', apply: '确认调整自增计数', back: '返回计数编辑', cancel: '取消计数任务', close: '关闭',
  engine: '引擎', charset: '默认字符集', collation: '默认排序规则', rowFormat: '行格式', autoIncrement: '当前目录观测值（只读）', unset: '未设置或未能读取', version: '数据库版本', column: '实际自增列', maximum: '整数类型上限', observed: '执行后目录观测值',
  fixedSql: '单一AUTO_INCREMENT语句（只读）', before: '原目录观测值', after: '请求值', readonly: '当前下一自增值仅可查看',
  ackImplicit: '我确认DDL可能隐式提交并等待元数据锁，取消或事务回滚不能撤销已完成的计数调整。',
  ackWindow: '我确认在维护时段暂停外部结构变更；物理身份和完整定义重核仍存在外部DDL窗口。',
  ackDml: '我已暂停外部写入并检查自增容量；DML、回滚或服务器调整都可能推进计数，目录观测不保证下一次插入值，未吻合或未知结果不重放。',
  ackRestart: '我确认MySQL 5.7的计数仅保存在内存，重启会使本次仅由ALTER上调的设置失效；我不依赖该值跨重启保留。',
  targetChanged: '目标或连接配置已变化；旧目标DDL可能已完成，请核对原服务器后重新打开。', expired: '快照或预览已过期，请重新读取。', mismatch: '响应目标、计数或原定义与固定快照不一致，未接受该响应。',
  discard: '将放弃尚未提交的计数草稿，是否继续？', unknownClose: 'DDL可能已完成，请先核对实际目录计数与定义。确认放弃本窗口记录并继续？',
  notSent: '尚未发送DDL。', unknown: 'DDL结果未知，请暂停写入并核对实际定义与计数；不会自动重试或重放。', succeeded: 'DDL已完成，定义及目录在核验时与请求一致；不保证下一次插入分配值。', verificationFailed: 'DDL已完成，但定义或目录计数未与请求完整吻合；请核对实际状态，不要重放。',
  completedUnsettled: 'DDL已完成且目录曾核验吻合，但请求或资源收尾异常；请核对资源状态，不要重放。',
  cancelling: '已请求取消，等待真实任务结束和资源释放。', consumed: '本次令牌已消费，不能再次执行，请重新读取。', unsupportedAck: '存在当前版本不认识的风险确认项，不能执行。',
  dirty: '同目标隐藏表页存在未提交数据或列布局草稿，请先处理。', busy: '同目标表页仍有活动任务，请等待实际完成。', workspaceBudget: '工作区标签超过检查预算，请先关闭部分标签。',
  connecting: '建立独立结构连接', reading: '读取计数、列类型与物理身份', rechecking: '重核完整定义和目录计数', executing: '调整表级自增计数', verifying: '核验实际目录与定义', releasing: '释放结构资源',
};
