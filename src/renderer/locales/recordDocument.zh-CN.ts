/** 整行输入格式使用独立文案，避免将只读投影误认作可恢复或导入格式。 */
export const recordDocumentZh = {
  invalid: '整行输入不是有效 JSON：{0}', limited: '整行输入超过 2 MiB 或结构预算',
  duplicateMember: '整行输入对象含重复成员：{0}', structure: '整行输入格式或字段结构不正确',
  duplicateField: '整行输入包含重复字段：{0}', unknownField: '整行输入包含未知字段：{0}',
  missingField: '整行输入必须包含当前记录的全部字段', locked: '只读或超限字段必须保留 locked: true：{0}',
  pending: '请先处理现有字段输入，再打开整行编辑', metadata: '字段元数据无效或超过整行输入预算',
  input: '整行编辑', label: '整行 JSON 输入',
  hint: '修改字段条目的 mode 和 text，再暂存到本页草稿；实际写入仍须预览并确认。',
  formatHint: 'text 保留精确文字，json 的 text 保留 JSON 原文，binary 使用 HEX，null 表示 SQL NULL；default 仅用于新增记录。生成列或超限字段保留 locked: true。',
  scope: '这是本行输入格式，不是只读整行 JSON、数据库导入或恢复文件。单字段输入长度最多 262144，整行最多 2 MiB UTF-8；无效输入保留并阻止直接离开。',
  unavailable: '当前没有可编辑的整行输入，请选择记录或核对只读原因。',
  changed: '本地行身份已变化，输入已保留；请核对当前记录后重新打开整行输入。',
} as const;
