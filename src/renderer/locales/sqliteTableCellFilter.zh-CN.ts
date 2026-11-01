/** SQLite原格筛选文案；只填条件草稿，沿原Apply入口读取。 */
export const sqliteTableCellFilterZh = {
  group: '按当前单元格筛选', equal: '等于当前单元格', exclude: '不等于当前单元格',
  unavailable: '请在当前页选择一个未修改的原单元格；旧页、待新增或删除的行不能用于筛选。',
  unsupported: '此原值无法用于筛选：值过长、格式无效或为非有限实数。请手动调整条件。',
  added: '已加入筛选条件草稿，请检查类型、条件关系和排序后点击“应用”。',
  target: (column: string) => '字段：' + column + '。仅加入筛选草稿，点击“应用”后读取。',
  limit: '筛选条件数量或值总量已达上限，请先整理条件。',
};
