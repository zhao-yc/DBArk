export const postgresReadonlyRecordZh = {
  modes: 'PostgreSQL 记录展示方式', form: '字段表单', tree: '原值记录树', json: '原值整行 JSON',
  readonly: '只读当前已加载记录的数据库原值。展开 JSON 结构会保留文本中的重复成员、顺序及数字原文。',
  jsonText: 'PostgreSQL 完整记录 JSON（只读）',
  jsonHint: '包含当前行的全部列及 PostgreSQL 类型，包括网格隐藏字段。数值、时间和 JSON 保留数据库返回的原文，BYTEA 用 Base64 表示。表单输入和草稿单独保留。',
  parse: (name: string) => `解析字段「${name}」的 JSON 原文`,
  limited: '整行 JSON 超过 2 MiB 预算，请用记录树查看原字段。',
  stale: '原表页、连接或记录已变化，请刷新后查看当前记录。',
  invalid: '记录值与原表页列目录不匹配，无法生成完整记录。',
  binary: (bytes: number) => `二进制 · Base64 · ${bytes} 字节`,
  generated: '数据库生成', invalidJson: '原文不是有效 JSON 或超出结构查看预算。',
  pending: '未暂存输入保留在字段表单。请返回表单暂存或放弃后再翻行。',
  staged: '本行的已暂存修改保留在草稿区。这里显示已加载的数据库原值。',
};
