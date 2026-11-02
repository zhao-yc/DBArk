export const sqliteRelationshipsZh = {
  scope: '仅展示main中所选物理表的目录声明；一次明确读取共用独立只读结构快照，不读取业务行或使用查询标签事务。',
  referenceScope: '隐式引用仅在父表已选入时按其声明主键解析；不推测rowid，不验证父唯一性、排序规则或业务数据是否满足外键。',
  initial: '点击“读取所选表”获取结构；打开、勾选和搜索不读取结构。当前表必须保留选中。',
  parentUnread: '父表未读取，隐式主键映射未确认。', primaryMismatch: '父表声明主键列数与引用列数不符，映射未确认。', columnMissing: '父表中未找到声明的引用列，映射未确认。',
  undeclaredType: '未声明类型', notNull: '目录声明NOT NULL', noNotNull: '目录未标记NOT NULL，不代表实际可存NULL', implicit: '引用父表声明主键',
  implicitPart: (index: number) => `隐式主键第${index + 1}列（未确认）`, foreignKey: (ordinal: number) => `SQLite 外键 #${ordinal}`,
};
