/** 列布局仅影响显示，不修改结构、数据或已应用查询。 */
export const sqliteTableLayoutZh = {
  entry: 'SQLite 列布局', title: 'SQLite 表格列布局', reload: '重新读取 SQLite 已保存布局',
  hint: '调整显示顺序、宽度和冻结边界，不修改表结构或数据。保存仅写入本机配置，按原连接和对象恢复；复制与矩形粘贴沿当前可见列顺序。',
  stale: '原SQLite表页或连接已变化，列布局操作未交付，请重新打开。', changed: '本机SQLite列布局或连接已变化，请重新读取后再保存。',
  source: '连接文件或读写配置已改变，未自动应用旧布局；请检查并明确保存新布局。', saved: 'SQLite列布局已保存到本机。',
  discard: '放弃尚未保存的SQLite列布局，恢复打开窗口时的显示？不会丢弃记录修改。',
  reset: '重置本机SQLite列布局为全部字段、原顺序和默认宽度？不会修改表或记录。',
};
