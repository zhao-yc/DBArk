/** SQLite 只读表浏览的集中中文文案与稳定控件名称。 */
export const sqliteTableBrowseZh = {
  title: 'SQLite 只读表浏览', browse: '浏览 SQLite 表数据', readonly: '只读浏览：筛选和排序在 SQLite 中执行，不修改表数据，也不占用查询标签的事务。',
  refresh: '刷新 SQLite 表数据', stop: '停止 SQLite 表读取', stopping: '正在停止原读取，等待真实结束', loading: '正在读取 SQLite 表数据',
  export: '导出 SQLite 当前页', conditions: '筛选与排序', filters: 'SQLite 服务端筛选', mode: 'SQLite 筛选关系', addFilter: '添加 SQLite 筛选条件',
  sorts: 'SQLite 服务端排序', addSort: '添加 SQLite 排序', apply: '应用 SQLite 筛选排序', limit: 'SQLite 每页条数',
  first: 'SQLite 首页', previous: 'SQLite 上一页', next: 'SQLite 下一页', empty: '当前页没有记录', noPage: '尚无可用的当前页',
  noCount: '不读取总行数；下一页是否可用由本次多读一行确认。未指定排序或存在同值排序时，行顺序可能变化。',
  typesHint: '条件值按明确类型绑定：文本保留原文，整数使用有符号 64 位范围，实数必须有限，二进制填写十六进制字节。NULL 条件不填写值。',
  unsupported: 'SQLite 表浏览仅支持原文件连接的 main 数据库。', invalidPage: 'SQLite 表浏览返回目标或分页数据不匹配，未显示该响应。',
  unavailable: '原表标签或连接已变化，请重新打开后读取。', cancelled: '本次读取已停止，未显示取消后的结果。',
  filterColumn: (n: number) => 'SQLite 筛选 ' + n + ' 字段', filterOperator: (n: number) => 'SQLite 筛选 ' + n + ' 运算符', filterKind: (n: number) => 'SQLite 筛选 ' + n + ' 值类型', filterValue: (n: number) => 'SQLite 筛选 ' + n + ' 条件值', removeFilter: (n: number) => '删除 SQLite 筛选 ' + n,
  sortColumn: (n: number) => 'SQLite 排序 ' + n + ' 字段', sortDirection: (n: number) => 'SQLite 排序 ' + n + ' 方向', removeSort: (n: number) => '删除 SQLite 排序 ' + n, up: (n: number) => '上移 SQLite 排序 ' + n, down: (n: number) => '下移 SQLite 排序 ' + n,
  page: (offset: number, rows: number, more: boolean) => '行偏移 ' + offset + ' · 本页 ' + rows + ' 行 · ' + (more ? '还有下一页' : '已到末页'),
  operators: { eq: '等于', ne: '不等于', gt: '大于', gte: '大于等于', lt: '小于', lte: '小于等于', contains: '包含文本', isNull: '为空', notNull: '非空' },
  kinds: { text: '文本', integer: '整数', real: '实数', blob: '二进制（十六进制）' }, ascending: '升序', descending: '降序', dynamic: '动态类型',
};
