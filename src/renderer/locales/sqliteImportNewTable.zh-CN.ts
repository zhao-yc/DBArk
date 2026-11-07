/** SQLite导入为新表分阶段交接，DDL与数据提交分别陈述真实事实。 */
export const sqliteImportNewTableZh = {
  title: 'SQLite 导入为新表', format: '新表来源格式', encoding: '新表来源编码', delimiter: '新表 CSV 分隔符', header: '新表 CSV 首行为标题',
  choose: '选择新表来源文件', chooseAgain: '重新选择新表来源文件', inspect: '检查新表来源文件', file: '新表来源文件', noFile: '尚未选择文件',
  scope: '只检查明确选择的 CSV、JSON 或 XML 文件；完整扫描后人工选择字段，不从有限样本猜测数据库类型。初始字段使用 TEXT 保留数字、日期和 JSON 原文，NULL 保持 NULL。',
  transactions: '建表和数据导入是两次独立事务。表创建后不会自动导入；导入失败或原文件变化时保留已建表，不自动删除、重建或重试。',
  columns: '选择新表来源字段', sourceColumn: (index: number) => `新表来源字段 ${index}`, emptySource: '（空键）', selected: (count: number) => `已选择 ${count} 个来源字段（最多 128 个）`,
  table: '导入新表名称', sample: '新表来源有限样本', omitted: '样本受限，不能替代完整文件检查。', records: (count: number) => `完整来源记录数：${count}`,
  nameHint: '空键、控制字符或重复大小写名称会生成安全的初始字段名称；进入设计器后可修改字段、默认值、约束和索引，导入阶段必须重新人工映射。',
  design: '设计 SQLite 导入新表', created: 'SQLite 表已创建，导入尚未开始。', retained: '后续取消、导入失败或来源变化均保留此表；不会把两次事务描述为一次原子操作。',
  continue: '继续导入已建 SQLite 表', readonly: '当前连接为只读，可以检查来源和设计预览，不能创建表或导入。',
  invalid: '原连接、修订或向导来源已变化；草稿保留，不能继续建表或导入。', expired: '来源检查已过期，请明确重新检查文件；不会自动续租或执行。',
  invalidReceipt: '建表回执未确认提交或未核验结构，不能进入数据导入；请核对原数据库。',
  close: '关闭 SQLite 新表导入', discard: '关闭将放弃此向导草稿，但不会删除已创建的 SQLite 表。', discardClose: '放弃向导并关闭', keep: '继续此向导',
  stop: '停止新表来源检查', cancelling: '已请求停止，正在等待原任务和取消响应。', working: '正在完整检查新表来源', cleanup: 'SQLite 新表导入资源释放失败，请保留窗口并重试关闭。',
} as const;
