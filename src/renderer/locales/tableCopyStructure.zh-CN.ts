/** 复制空表的实际范围独立展示，不能把CREATE LIKE宣传为复制所有依赖。 */
export const tableCopyStructureZh = {
  title: '复制表结构', newName: '准确新表名（同一数据库）', read: '重新读取来源', preview: '预览创建空表', apply: '确认创建空表', back: '返回名称编辑', cancel: '取消复制任务', close: '关闭',
  version: '数据库版本', unset: '未知', sourceDdl: '来源完整定义（只读）', fixedSql: '固定CREATE TABLE LIKE语句（只读）', after: '准确目标', confirmation: '请输入准确的数据库名.新表名', readonly: '当前来源仅可查看',
  ackImplicit: '我确认DDL会隐式提交；取消、关闭窗口和事务回滚不能撤销已经创建的新表。',
  sourceCounter: '来源当前自增计数（准确观测）', newCounter: '新空表预期下一自增值', actualCounter: '新表实际下一自增值', counterUnverified: '未核验，不能从空表或省略选项推断', counterMatched: '准确一致', counterDifferent: '与预期不符',
  ackAutoIncrement: '我确认暂停来源与目标写入，保留列级AUTO_INCREMENT属性但不继承源当前计数；本支持范围中新空表下一值应为1，并须完成后按准确目录核验。',
  ackWindow: '我确认在维护窗口执行并暂停并行DDL；重核不能消除外部并发窗口，同名冲突由服务器拒绝，不覆盖或自动改名。',
  ackScope: '我确认只创建空表的已核列、普通BTREE索引和表选项；不复制数据、外键、触发器、授权及其它对象。首片含生成/隐藏字段、CHECK、特殊索引或已知依赖均只读。',
  targetChanged: '来源或连接配置已变化，请关闭后重新打开。', expired: '快照或预览已过期，请重新读取。', mismatch: '响应目标、新名或原定义与固定快照不一致，未接受该响应。',
  discard: '将放弃尚未提交的新表名草稿，是否继续？', unknownClose: 'DDL可能已完成，请人工核对源表和新表。确认放弃本窗口记录并继续？',
  notSent: '尚未发送DDL。', unknown: '复制结果未知，请核对源表和新表；不会自动重试或重放。', succeeded: '空表已创建，来源、新表完整定义与空表状态已核验。', verificationFailed: '创建已完成，但未完整核验；请核对源表和新表，不要重复执行旧预览。',
  cancelling: '已请求取消，等待真实任务结束和资源释放。', consumed: '本次预览已消费，不能再次执行；未知时先人工核对新表。', unsupportedAck: '存在未知风险确认项，不能执行。',
  dirty: '源表或新名称的隐藏表页存在未提交数据或列布局草稿，请先处理。', busy: '源表或新名称的表页仍有活动任务，请等待实际完成。', workspaceBudget: '工作区标签超过检查预算，请先关闭部分标签。',
  connecting: '建立结构连接', reading: '只读来源身份、定义和依赖', rechecking: '重核来源、能力与同名冲突', executing: '单次创建空表', verifying: '核验来源、新表定义及空表状态', releasing: '释放结构资源',
};
