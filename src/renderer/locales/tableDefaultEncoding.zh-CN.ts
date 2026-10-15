/** 默认值与现有列转换分开表达；协议风险ID不直接暴露为用户文案。 */
export const tableDefaultEncodingZh = {
  title: '表默认字符集与排序规则', charset: '默认字符集', collation: '默认排序规则', choose: '请选择同字符集的排序规则',
  engine: '引擎', rowFormat: '行格式', serverVersion: '数据库版本', columnName: '字段', columnCharset: '字符集', columnCollation: '排序规则', notApplicable: '不适用',
  scope: '只影响后续新增且未显式指定编码的列。现有列、生成表达式、索引、外键和已有数据不转换；整表或现有列的编码转换需另行处理。',
  read: '重新读取实际默认编码', preview: '预览默认编码变更', apply: '确认修改表默认编码', back: '返回默认编码选择', cancel: '取消默认编码任务', close: '关闭',
  fixedSql: '默认编码SQL预览（只读）', before: '原默认编码', after: '新默认编码', readonly: '当前表默认编码只读', columns: '现有列编码（只读，保持原值）', moreColumns: '仅展示前100列，全部列仍参与执行前后结构核验。',
  ackImplicit: '我确认DDL可能隐式提交，取消和事务回滚不能撤销已完成的变更，服务器可能等待锁或内部重建。',
  ackWindow: '我确认在维护窗口执行并暂停并行结构修改；执行前重核仍存在外部DDL并发窗口。',
  ackDefaults: '我确认本次只改表默认字符集和排序规则，现有列与数据不转换，只影响后续未显式指定编码的新增列。',
  targetChanged: '目标或连接配置已变化，请关闭后重新打开。', expired: '快照或预览已过期，请重新读取。', mismatch: '响应目标或原定义与当前快照不一致，未接受该响应。',
  discard: '将放弃尚未提交的默认编码草稿，是否继续？', unknownClose: 'DDL可能已完成，请先核对服务器定义。确认放弃本窗口记录并继续？',
  notSent: '尚未发送DDL。', unknown: 'DDL结果未知，请核对实际定义；不会自动重试或重放。', succeeded: '表默认编码已修改，现有列编码与其余定义已核验。', verificationFailed: 'DDL已完成，但定义未完整核验；请核对实际定义，不要重试旧预览。',
  cancelling: '已请求取消，等待真实任务结束和资源释放。', consumed: '本次令牌已消费，不能再次执行，请重新读取。', unsupportedAck: '存在当前版本不认识的风险确认项，不能执行。',
  dirty: '同目标表页有未提交的数据草稿，请先处理后再选择默认编码。', busy: '同目标表页仍有活动操作，请等待实际完成。', workspaceBudget: '工作区标签超过检查预算，请先关闭部分标签。',
  connecting: '建立结构连接', reading: '读取实际默认编码与候选', rechecking: '复核定义、列编码与候选', executing: '修改表默认编码', verifying: '核验现有列与实际默认值', releasing: '释放结构资源',
};
