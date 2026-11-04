/** 查询结果只读投影保留协议事实，不从显示文字推断SQL类型。 */
export const queryReadonlyRecordZh = {
  modes: '查询记录展示方式', fields: '查询记录字段', tree: '查询记录树', json: '查询整行 JSON',
  readonly: '只读当前结果中的完整记录；查看、搜索和翻行不重新执行SQL，不提供编辑或提交。',
  jsonText: '查询完整记录 JSON（只读）',
  jsonHint: '完整包含当前行全部原结果列，同名列按唯一结果键和顺序区分，不受字段搜索或网格隐藏列影响。SQLite有存储类型事实时保持原类型；其它结果保留返回值和协议类型，不猜测数字字符串。这不是完整结果集或可导入格式。',
  parse: (name: string) => '查看查询字段“' + name + '”的 JSON 结构',
  limited: '完整查询记录JSON超过2MiB预算，未生成部分文档；请使用字段或记录树查看。',
  stale: '原查询结果、行、列、存储类型事实或连接来源已变化，请从当前结果重新选择记录。',
  invalid: '查询原值或类型事实不匹配，未猜测类型或生成部分记录。',
  binary: (bytes: number) => '二进制 · Base64 · ' + bytes + ' 字节',
  generated: '生成列（只读）', invalidJson: '字符串原文不是有效JSON或超过词法预算，未显示部分结构。',
};
