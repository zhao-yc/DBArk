export const workbenchZh = {
  title: '收藏与虚拟分组', shelf: '对象收藏', add: '添加收藏', remove: '移除收藏', rename: '重命名',
  newGroup: '新建虚拟分组', groupName: '虚拟分组名称', deleteGroup: '删除虚拟分组', ungrouped: '未分组收藏',
  label: '收藏名称', group: '所属虚拟分组', connection: '原连接', database: '数据库名称', kind: '对象类型', object: '对象名称',
  save: '保存', cancel: '取消', open: '打开对象', up: '上移', down: '下移', copy: '复制对象链接', copied: '对象链接已复制',
  paste: '粘贴对象链接', uri: 'DBArk 对象链接', openUri: '打开链接', invalidConnection: '原连接已失效',
  empty: '暂无收藏，可从对象树的星标添加，或在此填写完整身份。',
  hint: '虚拟分组和收藏只保存在本机配置，不更改数据库对象或连接分组。删除虚拟分组后收藏移至未分组。',
  uriHint: '仅支持应用内粘贴打开。链接含原连接标识，不含凭据；另一台电脑须存在相同连接标识。',
  focus: '进入专注模式', exitFocus: '退出专注模式', focusHint: '专注模式已隐藏侧栏，按 Ctrl / ⌘ Shift L 恢复',
  loading: '正在读取收藏', retry: '重新读取', saved: '收藏已保存', databaseKind: '数据库',
  kinds: { database: '数据库', table: '表', view: '视图', procedure: '存储过程', function: '函数', trigger: '触发器', event: '事件' },
  action: (action: string, name: string) => `${action}：${name}`
} as const;
