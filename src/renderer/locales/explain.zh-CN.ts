/** 执行计划文案集中管理；优化器字段名保留原文便于核对来源。 */
export const explainZh = {
  title: '可视化执行计划', tree: '树形计划', raw: '原始输出', table: '计划结果表格', text: '获取文本计划',
  estimates: '以下均为优化器估计值，成本不是毫秒；节点连接表示 JSON 包含关系，数组顺序沿用服务器输出。',
  unavailable: '不可用', missing: '当前节点未提供此指标', empty: '当前计划无法生成树，请查看原始输出或获取文本计划。',
  source: '计划来源', node: '计划节点', access: '访问方式', rows: '估计扫描行数', produced: '估计连接输出行数', filtered: '过滤后比例', cost: '成本', index: '使用索引',
  details: '节点详情', path: 'JSON 路径', detailHint: '详情中的数值以文本保留精度，完整字节以原始输出为准。',
  unknown: '未知节点', keyboard: '方向键移动和展开收起，Home / End 跳转首尾，Enter / 空格选择节点。',
  expand: '全部展开', collapse: '全部收起', rawMissing: '当前没有可用的 JSON 原文，请查看计划结果表格。', rawLimited: '原始输出展示已截断。',
  kinds: { plan: '执行计划', query_block: '查询块', table: '表访问', nested_loop: '嵌套连接序列', subqueries: '子查询', query_specifications: '查询分支', union_result: '联合结果', materialized: '物化', expression_cache: '表达式缓存', filesort: '文件排序', read_sorted_file: '读取排序结果', temporary_table: '临时表', buffer_result: '结果缓冲', 'block-nl-join': '块嵌套连接', ordering_operation: '排序操作', grouping_operation: '分组操作', duplicates_removal: '去重操作', materialized_from_subquery: '物化子查询', attached_subqueries: '附属子查询', optimized_away_subqueries: '优化移除的子查询', having_subqueries: 'HAVING 子查询', select_list_subqueries: '选择列表子查询', windowing: '窗口操作', windows: '窗口' } as Record<string, string>,
};
