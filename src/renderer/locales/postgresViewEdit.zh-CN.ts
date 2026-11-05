export const postgresViewEditZh = {
  title: '编辑视图定义',
  definition: '视图查询',
  hint: '保留现有列的名称、顺序和类型，可以在末尾添加列。请使用带 schema 的对象名。',
  preview: '预览视图修改',
  sql: '视图修改 SQL',
  review: '确认时会先锁定并核对原视图，再以当前选项替换查询定义。',
  back: '返回编辑',
  apply: '确认更新视图',
  close: '关闭编辑',
  discard: '放弃视图定义草稿？',
  unknown: '更新结果未确认，请关闭编辑并重新读取原视图定义。',
} as const;
