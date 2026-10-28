export const importNewTableZh = {
  title: '从文件导入新表', source: '源文件', format: '文件格式', encoding: '文件编码', delimiter: 'CSV 分隔符', header: '首行是字段名', choose: '选择并完整扫描文件', scanning: '正在完整扫描源文件', cancel: '取消扫描', cancelling: '正在等待原扫描和取消请求结束', close: '退出向导', closing: '正在收尾',
  table: '新表名称', reviewed: '我已核对新表名称', design: '进入正式表设计器', continue: '继续配置导入', created: '表已创建，继续导入',
  scope: '先完整扫描文件，再编辑并确认新表结构，最后单独确认导入。不会自动创建、自动导入或删除表。',
  ddl: '这是两个独立阶段：建表 DDL 不能随导入事务回滚。导入失败或退出向导时，已创建的表仍会保留。',
  types: '全部字段建议为可空 LONGTEXT；样本不代表全文件类型保证。请在正式设计器中核对字段类型、索引、NULL 和默认值。',
  sample: '有限样本（最多 20 行）', columns: '全文件字段', records: (value: number) => `完整扫描 ${value} 条记录`, omitted: '其余记录未在样本中展示，已参与完整扫描。', fingerprint: '原始文件 SHA-256', bytes: '原始文件字节数',
  retained: '退出后保留已创建的表；不会重建或自动删除。', unverified: '已收到建表完成回应，但完整定义或资源收尾未确认，不能继续导入。请核对实际表，不要重复创建。',
  invalid: '源文件、完整扫描结果或表名称无效', stale: '向导原目标或连接修订已变化，请退出后重新打开；旧响应不会继续执行。', reviewRequired: '请填写并确认准确的新表名称', changed: '原建表回应与目标或连接修订不一致，不能继续导入。', waitingSchema: '建表已回应；请等待设计器完成资源释放后关闭，再继续导入。',
  createdStale: '原目标已失效，但已收到原建表完成回应。请核对已创建的表，不要重复创建；不能继续导入。',
  separators: { ',': '逗号', ';': '分号', '\t': '制表符', '|': '竖线' },
} as const;
