export const postgresSequenceZh = {
  title: 'PostgreSQL 序列详情', create: '新建 PostgreSQL 序列', open: '查看序列',
  schema: '目标 schema', name: '序列名称', dataType: '整数类型', start: '起始值',
  increment: '增量', minimum: '最小值', maximum: '最大值', cache: '缓存数量',
  cycle: '循环', lastValue: '目录记录值', ownedBy: '所属字段', identity: '标识列',
  comment: '注释', defaultValue: '采用默认值', noValue: '未分配或当前角色不可见',
  hint: '目录记录值可能包含预分配的缓存。查看详情不会推进序列。',
  createHint: '留空的数字使用 PostgreSQL 默认值。请先核对 SQL，再确认创建。',
  preview: '预览序列 SQL', back: '返回编辑', apply: '确认创建序列',
  loading: '正在读取 PostgreSQL 目录…', working: '正在处理序列…',
  none: '当前连接没有可新建序列的 schema。',
  unknown: '创建结果未确认，请在原数据库核对序列。',
  discard: '放弃当前序列草稿？', stale: '原 PostgreSQL 连接已变化。',
} as const;
