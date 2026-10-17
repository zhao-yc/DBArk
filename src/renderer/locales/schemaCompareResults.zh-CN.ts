export const schemaCompareResultsZh = {
  filters: '筛选结构差异', category: '筛选类别', status: '筛选结果', name: '搜索名称',
  allCategories: '全部类别', allStatuses: '全部结果', differences: '全部差异（隐藏相同项）',
  searchHint: '名称包含指定文本，不区分大小写；不使用正则表达式。', reset: '重置筛选',
  count: (visible: number, total: number) => `当前显示 ${visible} / 共 ${total} 项`,
  noMatch: '没有匹配当前筛选的项目，可重置筛选查看其它结果。', noRows: '本次报告没有可展示的比较项，请核对范围与忽略项。',
  hidden: (count: number) => `有 ${count} 个已选项被筛选隐藏，仍会包含在 SQL 预览中。`,
  clearHidden: '清除隐藏的已选项', retained: '筛选只影响显示，不改变已选项。',
  expand: '展开两侧定义', collapse: '收起两侧定义', definitions: '两侧可用定义',
};
