export const postgresRecordViewZh = {
  title: '记录表单视图', grid: '网格视图', view: '记录表单',
  first: '本页第一条', previous: '上一条记录', next: '下一条记录', last: '本页最后一条',
  position: (row: number, offset: number, count: number) => `第 ${offset + row + 1} 条 · 本页 ${row + 1} / ${count}`,
  fields: '字段导航', search: '搜索字段', hidden: '显示网格隐藏字段', noFields: '没有匹配的字段。',
  stage: '暂存本行', discard: '放弃本行输入',
  pending: '请先暂存或放弃本行输入，再切换记录或视图。',
  staged: '本行已有草稿。预览并确认整批修改后写入数据库。',
  deleted: '本行已暂存删除。可从草稿区撤销。',
  expired: '原表页、记录或连接已变化，请放弃本行输入并刷新。',
  fullValue: '查看完整原值', closeValue: '收起完整原值',
  raw: (column: string) => `${column} 的完整原值`,
  null: 'SQL NULL', empty: '空字符串',
} as const;
