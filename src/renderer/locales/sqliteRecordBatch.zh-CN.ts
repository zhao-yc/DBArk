/** 多条记录分别保留输入，只有明确暂存整组才进入原Editor；不将窗口导航当数据库提交。 */
export const sqliteRecordBatchZh = {
  entry: '批量编辑 SQLite 勾选记录…', title: '批量编辑 SQLite 勾选记录',
  position: (position: number, count: number) => `第 ${position} / ${count} 条勾选记录`,
  hint: '只编辑当前页已勾选的记录，可逐条填写不同值。切换仅保留窗口内输入；“暂存全部”一次性生成可撤销草稿，取消则整组不变，最终仍须预览并明确提交。',
  previous: '上一条勾选记录', next: '下一条勾选记录',
  savePrevious: '保留输入并查看上一条勾选记录', saveNext: '保留输入并查看下一条勾选记录',
  save: '暂存全部 SQLite 勾选记录', cancel: '取消全部 SQLite 批量输入',
  changed: (count: number) => `已一次暂存 ${count} 个单元格的独立记录修改`,
  invalid: '批量记录输入、字段或范围无效，未暂存任何修改。',
  stale: '原勾选记录、页面或批量输入来源已变化，输入保留但不能暂存，请核对后重新打开。',
  budget: '批量记录修改超过原行数、字段或文本预算，未暂存部分修改。',
} as const;
