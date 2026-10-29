/** 整行输入格式使用独立文案，避免将只读投影误认作可恢复或导入格式。 */
export const recordDocumentZh = {
  invalid: '整行输入不是有效 JSON：{0}', limited: '整行输入超过 2 MiB 或结构预算',
  duplicateMember: '整行输入对象含重复成员：{0}', structure: '整行输入格式或字段结构不正确',
  duplicateField: '整行输入包含重复字段：{0}', unknownField: '整行输入包含未知字段：{0}',
  missingField: '整行输入必须包含当前记录的全部字段', locked: '只读或超限字段必须保留 locked: true：{0}',
  pending: '请先处理现有字段输入，再打开整行编辑', metadata: '字段元数据无效或超过整行输入预算',
  input: '整行编辑', label: '整行 JSON 输入',
  hint: '修改 mode 和 text 后暂存；写入仍需预览并确认。',
  formatHint: 'text 为精确文字，json 为 JSON 原文，binary 为 HEX，null 为 SQL NULL；default 仅用于新记录。locked 字段不可编辑。',
  scope: '单字段最多 262144 单元，整行最多 2 MiB UTF-8；无效输入须修正或放弃。此格式不用于导入或恢复。',
  unavailable: '当前没有可编辑的整行输入，请选择记录或核对只读原因。',
  changed: '本地行身份已变化，输入已保留；请核对当前记录后重新打开整行输入。',
} as const;
