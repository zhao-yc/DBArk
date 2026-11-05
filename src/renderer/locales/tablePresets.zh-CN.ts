export const tablePresetsZh={
  title:'命名筛选/排序方案',notice:'仅显式保存当前已应用的筛选条件、组合方式和排序。筛选值会保存本机；连接导出和复制不包含这些值。未添加的条件输入不会保存。',
  name:'方案名称',choose:'选择命名方案',none:'请选择方案',save:'保存为新方案',replace:'覆盖同名方案',apply:'应用方案',remove:'删除方案',reload:'刷新方案',
  replaceConfirm:'确认用当前筛选和排序覆盖此同名方案？',deleteConfirm:'确认删除所选本机方案？此操作不修改数据库。',cancel:'取消方案读取',
  confirmReplace:'确认覆盖方案',confirmRemove:'确认删除方案',cancelChange:'取消方案修改',
  postgresNotice:'可保存当前已应用的筛选、排序及当前列布局。方案保存在本机，未应用的筛选输入不会保存。',
  includeLayout:'包含当前列布局', hasLayout:'所选方案包含列布局',
  applyLayoutPrompt:'应用方案将替换本标签尚未保存的列布局，确认继续？', confirmApplyLayout:'确认应用方案布局',
  appliedWithLayout:'已应用方案的筛选、排序和列布局。',
  saved:'方案已保存本机，当前输入保持不变。',deleted:'所选本机方案已删除。',applied:'方案已应用，仅重新读取表数据。',changed:'表页、连接、字段或筛选已变化，本次未应用；请刷新方案后重试。',
} as const;
