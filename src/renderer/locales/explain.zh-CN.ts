/** 执行计划文案集中管理；优化器字段名保留原文便于核对来源。 */
export const explainZh = {
  title: '可视化执行计划', tree: '树形计划', raw: '原始输出', table: '计划结果表格', text: '获取文本计划',
  estimates: '以下均为优化器估计值，成本不是毫秒；节点连接表示 JSON 包含关系，数组顺序沿用服务器输出。',
  unavailable: '不可用', missing: '当前节点未提供此指标', empty: '当前计划无法生成树，请查看原始输出或获取文本计划。',
  source: '计划来源', node: '计划节点', access: '访问方式', rows: '估计扫描行数', produced: '估计连接输出行数', filtered: '过滤后比例', cost: '成本', index: '使用索引',
  details: '节点详情', path: 'JSON 路径', detailHint: '详情中的数值以文本保留精度，完整字节以原始输出为准。',
  unknown: '未知节点', keyboard: '方向键移动和展开收起，Home / End 跳转首尾，Enter / 空格选择节点。',
  expand: '全部展开', collapse: '全部收起', rawMissing: '当前没有可用的 JSON 原文，请查看计划结果表格。', rawLimited: '原始输出展示已截断。',
  longPath: '节点路径超过展示上限，请查看原始输出。',
  find: '查找计划节点', findPlaceholder: '查找类型、表名、索引、指标或属性', findCount: '计划查找计数', findIdle: '输入关键字后查找', previous: '上一处', next: '下一处', clear: '清空查找', matches: (current: number, total: number) => `${current} / ${total} 个匹配节点`,
  findHint: '关键字最多 200 字符；仅查找当前已生成的节点（含已收起节点）及属性展示文本，已截断内容以原始输出为准。', findTooLong: '关键字超过 200 字符，本次输入未应用，仍使用上次关键字。',
  properties: '节点属性', propertyTruncated: '此属性展示已截断，请核对原始输出。',
  // 项号只描述 JSON 数组中的位置，不表示优化器执行顺序。
  arrayItem: (container: string, index: number) => `${container === 'query_specifications' ? '查询分支' : '子查询项'} · 第 ${index + 1} 项`,
  propertyLabels: { attached_condition: '附加条件', index_condition: '索引条件', pushed_index_condition: '下推索引条件', having_condition: 'HAVING 条件', possible_keys: '候选索引', used_key_parts: '使用的索引字段', used_columns: '使用的字段', ref: '索引引用', partitions: '分区', key_length: '索引长度', sort_key: '排序键', sort_mode: '排序方式', using_filesort: '使用文件排序', using_temporary_table: '使用临时表', using_index: '使用覆盖索引', using_index_condition: '使用索引条件', using_join_buffer: '连接缓冲', buffer_type: '缓冲类型', buffer_size: '缓冲大小', join_type: '连接方式', message: '优化器说明', dependent: '依赖外层查询', cacheable: '可缓存' } as Record<string, string>,
  kinds: { plan: '执行计划', query_block: '查询块', table: '表访问', nested_loop: '嵌套连接序列', subqueries: '子查询', query_specifications: '查询分支列表', union_result: '联合结果', materialized: '物化', expression_cache: '表达式缓存', filesort: '文件排序', read_sorted_file: '读取排序结果', temporary_table: '临时表', buffer_result: '结果缓冲', 'block-nl-join': '块嵌套连接', ordering_operation: '排序操作', grouping_operation: '分组操作', duplicates_removal: '去重操作', materialized_from_subquery: '物化子查询', attached_subqueries: '附属子查询', optimized_away_subqueries: '优化移除的子查询', having_subqueries: 'HAVING 子查询', select_list_subqueries: '选择列表子查询', windowing: '窗口操作', windows: '窗口', window: '窗口定义' } as Record<string, string>,
};
