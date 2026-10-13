export const tableGridZh = {
  grid: '当前页数据网格',
  find: '当前页查找替换', preferences: '表列偏好', scope: '只查找当前已加载页的可见列，包含未提交草稿，排除待删除行；不会查询其他页。',
  kind: '查找值类型', text: '文字', null: 'SQL NULL', default: '未填写 DEFAULT', query: '查找文字', column: '查找列范围', all: '全部可见列', case: '区分大小写', whole: '整格匹配', previous: '上一处', next: '下一处', matches: '当前页匹配 {0} 格；位置 {1}',
  replacement: '替换为文字', preview: '预览当前页替换', replaceTitle: '当前页替换草稿预览', replaceHint: '仅替换可写 InnoDB 表的非生成 CHAR、VARCHAR、TEXT 列。JSON、数字、日期、NULL、DEFAULT 和二进制不替换。确认只形成草稿，仍需集中提交才写入数据库。',
  apply: '确认形成替换草稿', changed: '页面、记录或表结构已变化，整批替换未应用，请重新预览。', count: '将修改 {0} 格、{1} 行；下面只显示前 50 格，全部计划将一次应用。', before: '替换前', after: '替换后', row: '当前页行', noReplace: '没有可替换的文字单元格。',
  queryLimit: '查找词不能超过 512 个字符。', replacementLimit: '替换词不能超过 4096 个字符。', empty: '请先填写非空查找文字。', budget: '当前页扫描、匹配或替换超出安全预算，未截断或应用任何替换；请缩小列范围。',
  binaryHint: '文字查找使用完整原值；二进制不参与文字查找。文字 NULL 与 SQL NULL、空字符串与 DEFAULT 分开处理。数字只按当前精确值的文字表示查找，不做数值转换。', filter: '打开服务器筛选',
  layoutHint: '只改变当前表的列显示、顺序和宽度，不刷新数据或丢弃草稿。勾选行复制和矩阵粘贴使用当前可见列顺序；隐藏列排序仍保留。', visible: '显示列', width: '列宽', up: '前移', down: '后移', save: '保存表列偏好', reset: '恢复默认列布局', saving: '正在保存列偏好', saved: '列偏好已保存', unsaved: '当前列布局尚未保存', saveFailed: '列偏好保存失败，当前布局仅在此标签生效：{0}', oneVisible: '至少需要一列可见数据列。', widthInvalid: '列宽必须是 64 到 2000 的整数。',
};
