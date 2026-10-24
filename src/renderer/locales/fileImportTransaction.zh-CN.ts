export const fileImportTransactionZh = {
  label: '导入提交方式',
  batch: '每500行提交（默认）',
  atomic: '整文件一次提交',
  batchHint: '每500行提交；后续失败或取消时，此前批次可能已提交，不能整文件回滚。',
  atomicHint: '流式读取文件，整文件成功后一次提交，可能长时间占用数据库锁，并需要目标表SELECT权限。失败或取消会尝试整文件回滚；事务保证仅限目标InnoDB表，不承诺回滚触发器对非事务表或外部系统的副作用。',
  unknown: '提交结果未知时，请人工核对目标数据；不会自动重试。',
  presetHint: '导入模板只恢复文件字节解释和字段映射，不改变本次提交方式。',
} as const;
