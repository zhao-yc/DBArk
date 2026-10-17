/** 表行 INSERT 复制的跨进程提示统一维护，不能把生成成功说成数据库执行成功。 */
export const copyInsertSqlZh = {
  current: '复制当前行为 INSERT SQL', selected: '复制选中行为 INSERT SQL',
  policy: '仅复制当前页未修改的已加载原始行；不含草稿，不补取数据，不执行 SQL。',
  copied: 'INSERT SQL 已复制；未执行数据库操作。',
  invalid: 'INSERT 复制参数无效，未写入剪贴板。',
  limit: 'INSERT 复制超出行数、单元格或字节上限；整次拒绝，未截断或写入剪贴板。',
  type: '存在未知类型、生成列、不可见列或不保真的值；未生成 INSERT。',
  incomplete: '当前行缺少字段或含未知字段，不能生成完整 INSERT。',
  draft: '所选行含未保存草稿或已删除行；请先提交或撤销后重试。',
  target: '当前表页目标、连接版本或目录身份不明确；请刷新后重试。',
  busy: '当前表页正在变化、存在活动字段输入或不是活动标签；未复制。',
  selection: '请在当前已加载页选择有效行。'
} as const;
