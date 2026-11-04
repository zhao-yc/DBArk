export const sqliteReferenceZh = {
  choiceEntry: '选择 SQLite 外键值', choiceTitle: 'SQLite 外键值选择', candidates: '读取父键候选', stage: '使用所选键值',
  choiceHint: '选择只暂存本地草稿，复合键整组替换并可一步撤销；最终写入须经原 SQL 预览及提交。确认前重新读取父键，不验证声明唯一性；约束由最终数据库提交判断。',
  searchColumn: '父候选搜索列', search: '父候选包含文本', searchHint: '字面子串搜索，ASCII不区分大小写；BLOB按HEX搜索。修改后点击读取父键候选，分页沿用已应用搜索。',
  selectRow: '请在当前父候选页选择一行；NULL父键不能建立关联。', selectedRow: (row: number) => '已选择当前页第 ' + row + ' 行，确认时将重新核对。',
  clear: '清空关联至草稿', clearConfirm: '确认将这组可空外键全部暂存为 NULL',
  entry: '浏览 SQLite 父记录', title: 'SQLite 外键父记录', catalog: '读取当前表外键', read: '读取父记录', refresh: '刷新父记录',
  constraint: '外键声明', previous: '上一页父记录', next: '下一页父记录', stop: '停止读取父记录', close: '关闭外键浏览',
  choose: '先在当前物理表选择一行；表单输入须先暂存或取消。', emptyKeys: '当前物理表没有声明外键。', empty: '没有匹配父记录；NULL／部分NULL不建立关联，父记录也可能不存在。',
  hint: '独立只读浏览，值来自打开时当前行，包含已暂存本地草稿；不暂存、提交或占用查询标签事务。按声明匹配，不验证约束是否有效或父记录唯一性。',
  scope: '只读 main 物理表；页码不保证数据库快照，父表结构变化后请重新打开。', implicit: '按父表声明主键顺序', stale: '原行、页、连接、标签或结构已变化，请关闭后重新选择。',
  unloaded: '打开窗口和选择外键不读取父记录；请明确点击读取。', loading: '正在读取外键目录或父记录，等待原任务结束。',
  key: (ordinal: number) => '外键 #' + ordinal,
};
