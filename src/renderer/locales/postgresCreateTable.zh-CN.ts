export const postgresCreateTableZh = {
  title: '新建 PostgreSQL 表', schema: '目标 schema', table: '表名', tableComment: '表注释',
  fields: '字段', field: (n: number) => '字段 ' + n, name: '字段名称', type: '字段类型', nullable: '允许 NULL',
  primary: '主键', unique: '唯一', identity: '标识列', identityNone: '普通字段', identityAlways: '始终生成', identityDefault: '默认生成',
  length: '长度', precision: '精度', scale: '小数位', default: '默认值', noDefault: '未设置', literal: '文字值',
  currentDate: '当前日期', currentTimestamp: '当前时间', value: '默认文字', comment: '字段注释',
  add: '添加字段', remove: '移除此字段', preview: '预览建表 SQL', back: '返回修改', apply: '确认创建表',
  close: '关闭', wait: '正在等待 PostgreSQL', empty: '当前账号在此数据库没有可建表的 schema',
  changed: '原连接或预览已经变化，请重新预览', review: '确认后将在显示的数据库和 schema 中创建新表。',
  unknown: '建表终态待核对。请关闭窗口后刷新原数据库目录，核对新表是否存在。',
  canceled: '放弃当前建表草稿？',
} as const;
