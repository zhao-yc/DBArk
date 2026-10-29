export const navigationZh = {
  toolbar: '常用模块', connection: '连接', table: '表', view: '视图', routine: '函数', other: '其他',
  query: '查询', tools: '工具', more: '更多', objects: '对象浏览', objectActions: '对象操作',
  name: '名称', type: '类型', search: '搜索对象名称', refresh: '刷新', newTable: '新建表',
  categories: { table: '表', view: '视图', routine: '存储过程与函数', trigger: '触发器', event: '事件' },
  pickTitle: '选择对象浏览数据库', pickConnection: '选择连接', pickDatabase: '选择数据库',
  readDatabases: '读取数据库', open: '打开', cancel: '取消', selectConnection: '请选择连接',
  selectDatabase: '请选择数据库', noObjects: '此分类下没有匹配的对象',
  stale: '连接或浏览目标已变化，请重新打开。', context: '对象浏览目标', pageContext: '当前页面',
  helpTitle: 'DBArk 使用说明', shortcutsTitle: '快捷键', queryHistory: '执行历史', savedQueries: '已保存查询',
  records: (count: number, total: number) => `${count} 个对象，共 ${total} 个`,
  help: [
    '文件、编辑、查看、收藏夹、工具、窗口和帮助菜单提供完整功能；下方模块栏保留常用入口。',
    '表、视图、函数和其他对象使用左侧选中的数据库，在中央对象列表中双击打开；右键只选中并显示操作。',
    '执行、保存、筛选与事务始终作用于当前标签，左侧选择其他库不会改变已打开查询的会话。',
    '页面操作按用途收在“更多”中；宽度不足时按钮也会移入“更多”，操作及原有确认流程保持。',
    '表格修改先暂存，检查底部修改数量，再预览和提交；任意查询结果保持只读。'
  ],
  shortcuts: [ ['新建连接', 'Ctrl / ⌘ + Shift + N'], ['新建查询', 'Ctrl / ⌘ + N'],
    ['打开 SQL 文件', 'Ctrl / ⌘ + O'], ['保存当前查询', 'Ctrl / ⌘ + S'], ['执行查询', 'Ctrl / ⌘ + Enter'],
    ['全库搜索', 'Ctrl / ⌘ + Shift + F'], ['查找已打开标签', 'Ctrl / ⌘ + Shift + A'],
    ['关闭当前标签', 'Ctrl / ⌘ + W'], ['打开右键菜单', 'Shift + F10'], ['关闭菜单', 'Escape'] ]
} as const;
