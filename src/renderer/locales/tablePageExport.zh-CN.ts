/** 表页快照和全表文件任务明确区分，不能把本页勾选解释为跨页选择。 */
export const tablePageExportZh = {
  page: '导出当前页', selected: '导出本页勾选记录',
  hint: '只导出当前已载入页及可见列，打开时冻结快照，不重新查询；请先处理未提交数据和活动编辑器。',
  pageRows: (count: number) => `当前页已加载的 ${count} 行`,
  selectedRows: (count: number) => `本页勾选的 ${count} 行`,
  scope: '仅包含打开窗口时本页的可见列及所列记录，按当前显示顺序导出；不含其它页、隐藏列或未提交修改。全表导出请使用表页原“导出”入口。',
  stale: '表页、勾选、字段或原始数据已变化，未打开导出；请从当前页重新选择。',
} as const;
