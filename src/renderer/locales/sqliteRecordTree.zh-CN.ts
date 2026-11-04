/** 记录树只处理当前窗口的完整typed输入，不自动解释SQLite声明类型。 */
export const sqliteRecordTreeZh = {
  mode: 'SQLite 记录树', fields: 'SQLite 有序字段树',
  hint: '显示当前窗口的全部字段输入。只有明确选择TEXT字段后才按JSON解析；重复成员按原文序号区分，数字不转换为JavaScript数值。节点修改先应用到当前输入，保存整行后仍须预览并明确提交。',
  parse: (name: string) => '查看 SQLite 字段“' + name + '”的 JSON 树',
  edit: '应用节点修改到当前输入', pending: '请先应用或取消当前 JSON 节点／结构输入，再切换字段、输入方式、导航或保存整行。',
  stale: '原 SQLite 字段、文档或输入票据已变化，未应用旧节点修改。',
  readonly: '生成列或超过65536字符完整字段预算的原文只能查看，不能通过节点修改。',
  textOnly: '请明确选择有完整TEXT值的字段；NULL、默认值和其他存储类型不自动当作JSON。',
  invalid: '原文不是有效JSON或超过词法预算，未显示部分结构。',
  limited: '修改后的完整SQLite字段超过原编辑预算或包含非法Unicode，未应用节点修改。',
  default: '默认值（省略）', null: 'SQL NULL', generated: '生成列（只读）',
};
