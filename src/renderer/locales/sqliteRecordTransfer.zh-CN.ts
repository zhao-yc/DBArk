export const sqliteRecordTransferZh = {
  entry: (engine: string) => `从 ${engine} 查询结果复制记录`, title: (engine: string) => `复制 ${engine} 记录到 SQLite`,
  emptyEntry: '从暂存的查询结果复制记录',
  scope: (count: number) => `已勾选 ${count} 行。核对映射后只生成 SQLite 新增草稿。`,
  precision: '精确小数按 TEXT 保存。整数可按原文写入 TEXT，本批超出有符号 64 位范围的整数列须保留文本。字节按 BLOB 保存。',
  source: (engine: string) => `${engine} 来源`, target: 'SQLite 目标', sourceColumn: '来源字段', targetColumn: '目标字段',
  skip: '跳过此字段', unavailable: '没有可复制到 SQLite 的暂存查询结果。',
  unsafeInteger: (name: string) => `来源字段「${name}」缺少可验证的精确整数原值。`,
  incompatible: (name: string) => `SQLite 目标列「${name}」不能原样保留此批字段的存储类型，请重新映射。`,
};
