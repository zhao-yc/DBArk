/** 整行JSON只编辑有类型的字段值，不把数据库整数交给JavaScript Number。 */
export const sqliteRecordJsonZh = {
  modes: 'SQLite 记录输入方式', form: 'SQLite 字段表单', json: 'SQLite 整行 JSON', input: 'SQLite 整行 JSON 输入',
  hint: '整行 JSON 与字段表单共享当前输入。只修改 value，保留字段名称、顺序、类型声明和生成列标记；integer、real、blob 的 value 必须是字符串，blob 使用完整十六进制。新行的 default 表示省略字段，不等于 NULL。保存仅暂存，最终仍须预览并明确提交。',
  limited: 'SQLite 整行 JSON 超过 2 MiB 输入预算，未截断；请使用字段表单。',
  invalid: 'SQLite 整行 JSON 格式无效，请保留完整格式、字段名称与顺序、类型声明和生成列标记。',
  value: (name: string) => 'SQLite字段“' + name + '”的JSON值无效：非NULL值须填写字符串，整数须在有符号64位内，实数须有限，BLOB须为完整十六进制且不超原编辑预算。',
  duplicate: 'SQLite 整行 JSON 含重复成员，未采用后值覆盖前值。',
  locked: '生成列或超出完整编辑预算的原 BLOB 不能通过整行 JSON 修改。',
  defaultExisting: '已有 SQLite 记录不能省略字段或改为 default。',
};
