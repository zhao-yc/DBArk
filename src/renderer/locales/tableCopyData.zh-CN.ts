/** 只表达本用途的分阶段事实，建表成功不能代表数据已经提交。 */
export const tableCopyDataZh = {
  title: '复制表结构及数据', newName: '准确新表名（同一数据库）', read: '重新读取来源', preview: '只读预览结构及数据复制', apply: '确认创建并复制数据', back: '返回名称编辑', cancel: '取消复制任务', close: '关闭',
  version: '数据库版本', unset: '未知', sourceDdl: '来源完整定义（只读）', fixedSql: '固定建表及数据语句（分阶段执行，只读）', after: '准确目标', confirmation: '请输入准确的数据库名.新表名', readonly: '当前来源仅可查看',
  ackImplicit: '我确认建表DDL与数据事务分开，整体不原子；数据失败或取消仍可能留下空表。',
  ackScope: '我确认复制同库普通InnoDB表的全部普通列数据，包含自增0、准确数值、NULL和字节；不复制生成列、外键、触发器、授权等依赖，不继承源下一自增计数。',
  ackWindow: '我确认维护窗口内暂停两端写入及并行DDL；身份重核不能消除建表后取得事务元数据锁之前的外部窗口。',
  ackSnapshot: '我确认预览不固定数据快照；READ COMMITTED复制数据语句执行时所见的已提交数据，目标行锁、空间、日志和IO可能影响服务器。',
  ackRetain: '我确认取消ACK不表示完成；断线或提交结果未知时保留目标，先人工核查，不自动重放、覆盖或补DROP。',
  targetChanged: '来源或连接配置已变化，请关闭后重新打开。', expired: '快照或预览已过期，请重新读取。', mismatch: '响应用途、目标、新名或原定义与固定快照不一致，未接受该响应。',
  discard: '将放弃尚未提交的新表名草稿，是否继续？', unknownClose: '目标可能已创建或已有数据，须先人工核对。确认放弃本窗口记录并继续？',
  notSent: '尚未发送建表DDL或数据语句。', unknown: '建表或数据提交结果未知，保留目标待人工核查；不会自动重试、重放或补DROP。', succeeded: '已核写入前完整结构，并收到数据事务提交成功响应；未逐行校验。', verificationFailed: '目标表已创建，数据尚未确认提交；保留目标待人工核对，不要重复执行旧预览。',
  cancelling: '已请求取消，等待原命令真实结束及专属会话严格释放。', consumed: '本次预览已消费，不能再次执行；未知时先人工核对目标。', unsupportedAck: '存在未知风险确认项，不能执行。',
  created: '建表已确认完成，尚未发送数据语句。', createInFlight: '建表已发送，等待真实结果。', dataInFlight: '建表已完成，数据语句已发送，尚未确认提交。', insertFinished: '数据语句已返回成功，事务尚未确认提交。', commitUnknown: 'COMMIT已发送，尚未收到提交成功确认；保留目标待核查。', dataCommitted: '数据事务已收到提交成功响应。',
  dirty: '源表或新名称的隐藏表页存在未提交数据或列布局草稿，请先处理。', busy: '源表或新名称的表页仍有活动任务，请等待实际完成。', workspaceBudget: '工作区标签超过检查预算，请先关闭部分标签。',
  connecting: '建立专属复制连接', reading: '只读来源身份、定义、依赖和数据能力', rechecking: '重核来源、能力与同名冲突', executing: '分阶段建表、数据语句与提交', verifying: '核验来源及新表', releasing: '严格释放专属复制资源',
};
