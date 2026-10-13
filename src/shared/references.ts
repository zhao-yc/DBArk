import type { CellValue, ColumnInfo, ForeignKeyInfo, TableInfo } from './contracts';

export const REFERENCE_LIMITS = { columns: 64, valueBytes: 256 * 1024, totalBytes: 1024 * 1024 } as const;

/** 跨进程关联值只接收完整单元格，禁止把缺失值悄悄转换成 NULL。 */
export function validateReferenceValues(values: unknown): asserts values is CellValue[] {
  if (!Array.isArray(values) || !values.length || values.length > REFERENCE_LIMITS.columns) throw new Error('关联值必须为 1～64 个完整单元格');
  let total = 0;
  for (const value of values) {
    let bytes = 16;
    if (typeof value === 'string') bytes = new TextEncoder().encode(value).length;
    else if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('关联数值必须为有限数字'); }
    else if (value !== null && typeof value !== 'boolean') {
      if (!value || typeof value !== 'object' || Object.keys(value).length !== 2 || value.type !== 'binary' || typeof value.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)) throw new Error('关联二进制值必须为有效的 base64 单元格');
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      if ((value.base64.endsWith('==') && (alphabet.indexOf(value.base64.at(-3)!) & 15)) || (value.base64.endsWith('=') && !value.base64.endsWith('==') && (alphabet.indexOf(value.base64.at(-2)!) & 3))) throw new Error('关联二进制值必须为规范的 base64');
      bytes = value.base64.length;
    }
    if (bytes > REFERENCE_LIMITS.valueBytes) throw new Error('单个关联值不能超过 256 KiB');
    total += bytes;
  }
  if (total > REFERENCE_LIMITS.totalBytes) throw new Error('关联值合计不能超过 1 MiB');
}

/** 元数据中的大小写映射必须唯一，合法的原型同名字段按普通名称处理。 */
export function referenceColumn(info: TableInfo, name: string): ColumnInfo {
  const matches = info.columns.filter(column => column.name.toLowerCase() === name.toLowerCase());
  if (matches.length !== 1) throw new Error(`关联字段 ${name} 已不存在或名称不明确，请刷新表结构`);
  return matches[0];
}

/** 返回服务器元数据规范化后的复合外键，顺序与匹配值严格对应。 */
export function canonicalReference(source: TableInfo, foreignKey: ForeignKeyInfo, target: TableInfo): ForeignKeyInfo {
  if (!foreignKey.columns.length || foreignKey.columns.length !== foreignKey.referencedColumns.length) throw new Error('外键字段映射不完整，请刷新表结构');
  return { ...foreignKey, columns: foreignKey.columns.map(name => referenceColumn(source, name).name), referencedColumns: foreignKey.referencedColumns.map(name => referenceColumn(target, name).name) };
}
