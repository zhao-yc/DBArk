export const sqliteRecordTransferZh = {
  entry: '从 PostgreSQL 查询结果复制记录', title: '复制 PostgreSQL 记录到 SQLite',
  scope: (count: number) => `已勾选 ${count} 行。核对映射后只生成 SQLite 新增草稿。`,
  precision: '整数和字节保留原存储类型。精确小数及其他文本原文应映射到能保留 TEXT 的列。',
  source: 'PostgreSQL 来源', target: 'SQLite 目标', sourceColumn: '来源字段', targetColumn: '目标字段',
  skip: '跳过此字段', unavailable: '没有暂存的 PostgreSQL 查询结果。',
  incompatible: (name: string) => `SQLite 目标列「${name}」不能原样保留此批字段的存储类型，请重新映射。`,
};
