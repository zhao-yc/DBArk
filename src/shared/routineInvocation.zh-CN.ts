export const routineInvocationZh = {
  invalid: '例程目标、参数或调用草稿格式无效。',
  metadataChanged: '例程结构已变化或目录参数与定义不一致，请重新读取后生成草稿。',
  definitionUnavailable: '无法完整确认例程定义和参数签名，请检查 SHOW CREATE 权限及保存的 SQL 模式；不会把缺失信息当作零参数。',
  budget: '例程定义、参数、名称或调用草稿超过预算，未生成部分 SQL。',
  warning: '过程和函数都可能修改数据、隐式提交或产生其它副作用。这里只生成草稿，不会自动执行或重试。',
  multiStatement: '含 OUT/INOUT 时必须完整执行所有语句。临时变量属于该查询会话，失败或取消后可能保留；最后的 SET 仅清空值，不会删除变量。',
  parameters: 'IN 和 INOUT 使用按序号生成的命名参数；请在执行时使用现有参数窗口填写精确值，草稿不包含参数值。',
  cancelled: '本次例程读取已取消。',
  reading: '正在读取并复核例程签名…',
  stale: '连接配置或客户端状态已变化，请重新读取例程参数。',
  shuttingDown: '客户端正在退出，不能读取例程参数。',
} as const;
