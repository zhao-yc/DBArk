/** 只读记录只展示原页数据，不提供编辑、暂存或数据库提交入口。 */
export const sqliteReadonlyRecordZh = {
  modes: 'SQLite 只读记录展示方式', fields: 'SQLite 只读字段', tree: 'SQLite 只读记录树', json: 'SQLite 只读整行 JSON',
  readonly: '只读原页记录；展开、查看和切换方式不重新查询，不提供节点编辑、暂存或提交。',
  jsonText: 'SQLite 完整记录 JSON（只读）',
  jsonHint: '完整包含当前记录全部字段，不受字段搜索或网格隐藏列影响。整数和实数保留原文字串，BLOB使用原Base64及字节数；这不是可写入或恢复格式。',
  parse: (name: string) => '查看只读字段“' + name + '”的 JSON 结构',
  limited: '完整只读记录JSON超过2MiB预算，未生成部分文档；请使用字段或记录树查看。',
  stale: 'SQLite原页、行、类型事实或连接来源已变化，请从当前页重新选择记录。',
  invalid: 'SQLite原值与完整存储类型事实不匹配，未猜测类型或生成部分记录。',
  binary: (bytes: number) => 'BLOB · Base64 · ' + bytes + ' 字节',
  generated: '生成列（只读）',
  invalidJson: 'TEXT原文不是有效JSON或超过词法预算，未显示部分结构。',
};
