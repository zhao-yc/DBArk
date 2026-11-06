export const postgresRecordJsonZh = {
  open: '编辑整行 JSON', input: 'PostgreSQL 整行编辑 JSON', back: '带回字段表单', discard: '放弃 JSON 输入',
  hint: '编辑每列的 assignment。text 使用字符串，binary 使用十六进制字符串，null 和 default 仅填写 mode。unchanged 保持原值或在新增时省略该列。original 及列信息供核对。',
  pending: '整行 JSON 正在编辑。带回字段表单或放弃后再切换记录。',
  limited: '整行编辑 JSON 超过 2 MiB 预算，请使用字段表单。',
  invalid: 'JSON 结构、字段顺序或原值不匹配，请保留原格式。',
  duplicate: '整行文档含重复成员，请修正后再继续。',
  locked: (name: string) => `数据库生成列不能赋值：${name}`,
  value: (name: string) => `字段赋值无效：${name}`,
};
