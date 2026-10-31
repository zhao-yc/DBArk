/** SQLite 优化器计划只呈现原生四列，不推测 MySQL 指标或实际执行效果。 */
export const sqliteExplainZh = {
  title: 'SQLite 执行计划', tree: '树形', table: '表格', raw: '原文',
  treeLabel: 'SQLite 计划树', tableLabel: 'SQLite 计划表格', rawLabel: 'SQLite 计划原文', rawContent: 'SQLite 计划原文内容',
  source: 'SQLite EXPLAIN QUERY PLAN', estimates: '这是优化器计划，不是实际执行或实测耗时。节点说明保留 SQLite 原文，不推测成本、耗时或索引结构；输出可能随 SQLite 版本变化。',
  expand: '展开 SQLite 全部计划节点', collapse: '折叠 SQLite 全部计划节点',
  keyboard: '方向键选择节点；向右方向键展开或选择子节点，向左方向键折叠或选择父节点；Home/End 到首尾，Enter/空格展开或折叠。',
  empty: '没有可确认的完整树关系，请查看原始表格或原文。', bounds: '计划节点或深度超出展示边界，未构造不完整树；请查看原始表格和警告。',
  noTable: '没有原始计划表格。', noRaw: '没有可用的计划原文。', truncated: '原文已达到展示预算，内容不完整；不能据此推断完整计划。',
  detail: 'SQLite 节点原文', id: '节点 id', parent: '父节点 parent', auxiliary: '辅助值 auxiliary', root: '无已确认父节点',
};
