export const sqliteValueOptionsZh = {
  title: '从SQLite不同值筛选', entry: '从数据库不同值筛选', column: 'SQLite不同值字段', search: 'SQLite不同值搜索',
  hint: '读取符合已应用筛选的全部记录，不限当前页，不含未提交修改。按真实存储类型和原列排序规则分组，同组可包含大小写不同的值。',
  searchHint: '搜索在数据库中先筛记录再分组，计数为搜索后的记录数；文本区分大小写，数值使用SQLite文本表示，二进制使用十六进制。%和_是原文，非空搜索不含NULL。',
  limit: '最多返回500组，每页显示50组，可选择1至128组。只勾选本次返回的准确候选；无穷REAL可查看但不能用于有限数值筛选。',
  relation: (mode: 'and' | 'or') => `加入一条条件，使用表单当前${mode.toUpperCase()}关系。加入后仍需点击表页“应用”，不会自动读取或提交。`,
  read: '读取SQLite不同值', stop: '停止SQLite不同值读取', add: '加入SQLite筛选草稿', include: '保留勾选值', exclude: '排除勾选值',
  choice: (n: number) => `勾选SQLite候选 ${n}`, selected: (n: number) => `已勾选 ${n} 组`, count: (count: string) => `${count} 行`,
  previous: '上一页候选', next: '下一页候选', empty: '没有匹配候选。', truncated: '还有未返回的组，请缩小搜索范围。',
  close: '关闭SQLite不同值', discard: '更换字段、搜索或关闭将丢弃当前勾选，是否继续？',
  stale: '原表、条件或连接已变化，请关闭后重新打开。', unavailable: '候选尚未读取、来源已失效或正在等待原任务结束。',
  loading: '正在读取不同值…', stopping: '正在等待原读取和取消请求真正结束…', unsupported: '该REAL值不能用于有限数值筛选。',
  selection: '请选择1至128个不同值', rejected: '原表页未接纳条件，勾选与原筛选均已保留。',
};
