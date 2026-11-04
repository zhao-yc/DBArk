export const sqliteRelationZh = {
  entry: '浏览 SQLite 关联记录', title: 'SQLite 关联浏览器', parents: '查看当前记录的父记录', children: '查看当前记录的子记录',
  back: '返回上个浏览位置', forward: '前进到下个浏览位置', nextParents: '继续查看选中记录的父记录', nextChildren: '继续查看选中记录的子记录',
  close: '关闭关联浏览器', stop: '停止关联读取', constraint: '当前关联声明', path: '关联浏览路径',
  hint: '使用已保存原值逐层只读浏览，本地草稿保留。方向、声明和历史位置切换不自动查询，请明确读取。',
  history: '返回和前进恢复上次已读结果；缓存不是当前数据库快照。最多保留20个位置、32MiB，换分支会替换当前位置之后的历史。',
  stale: '最初源行、页、连接、标签或草稿代次已变化，请关闭后重新选择。', empty: '没有匹配记录；NULL、父行或数据变化可能使关联为空。',
  selectRow: '选中当前结果的一行后，可继续浏览它的父记录或子记录。', emptyKeys: '当前方向没有可读取的外键声明。',
  selected: (row: number) => '已选中结果第 ' + row + ' 条记录；返回历史时保留此选择。',
  unloaded: '当前位置尚未读取此方向的目录。', current: (table: string, position: number, history: number) => table + ' · 浏览位置 ' + position + ' / ' + history,
};
