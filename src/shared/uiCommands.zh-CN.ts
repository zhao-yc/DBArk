import type { UiCommandId } from './uiCommands';

/** 菜单文案集中维护，分类不重复散落在主进程与页面中。 */
export const uiCommandLabels: Record<UiCommandId, string> = {
  'new-connection': '新建连接', 'new-query': '新建查询', 'open-sql-file': '打开 SQL 文件',
  'recent-sql-file': '最近 SQL 文件', 'save-query': '保存查询', 'save-sql-file': '另存 SQL 文件',
  'connections-transfer': '连接导入导出', 'connections-organize': '整理连接', 'find': '查找', 'replace': '替换',
  'toggle-theme': '切换明暗主题', 'focus-mode': '专注模式', 'editor-font': '编辑器字体',
  'editor-word-wrap': '自动换行', 'editor-indent': '编辑器缩进', 'favorite-toggle': '添加／取消当前对象收藏',
  'favorites-manage': '管理收藏与分组', 'object-link': '粘贴对象链接', 'execute': '执行查询',
  'execute-current': '执行当前语句', 'execute-all': '执行整个脚本', 'stop': '停止', 'format': '格式化 SQL',
  'parameters': '参数执行', 'explain': '执行计划', 'analyze': '实际执行分析', 'transaction-settings': '事务设置',
  'import': '导入数据', 'export': '导出数据', 'schema-compare': '结构比较', 'structure-search': '全库搜索',
  'server-monitor': '服务器监控', 'explain-snapshot': '打开计划快照', 'result-snapshot': '打开结果快照',
  'task-center': '任务中心', 'tab-search': '查找已打开标签', 'close-tab': '关闭当前标签',
  'close-other-queries': '关闭其他查询', 'close-left-queries': '关闭左侧查询', 'close-right-queries': '关闭右侧查询',
  'next-tab': '下一个标签', 'previous-tab': '上一个标签', 'help': '使用说明', 'shortcuts': '快捷键', 'about': '关于 DBArk'
};
export const uiMenuLabels = {
  file: '文件', edit: '编辑', view: '查看', favorites: '收藏夹', tools: '工具', window: '窗口', help: '帮助',
  query: '查询执行与分析', transfer: '数据导入导出', snapshots: '快照', editor: '编辑器',
  undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选',
  zoomIn: '放大', zoomOut: '缩小', resetZoom: '重置缩放', fullscreen: '全屏', quit: '退出',
  addFavorite: '添加当前对象收藏', removeFavorite: '取消当前对象收藏',
  hide: '隐藏 DBArk', hideOthers: '隐藏其他应用', showAll: '显示全部'
} as const;
