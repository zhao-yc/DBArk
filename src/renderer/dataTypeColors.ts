import type { CellValue, ColumnInfo } from '../shared/contracts';

export const dataTypeColorKinds = ['text', 'number', 'temporal', 'json', 'binary', 'null'] as const;
export type DataTypeColorKind = typeof dataTypeColorKinds[number];
export type DataTypeColorSource = 'catalog' | 'protocol';

/** 元数据必须唯一对应真实内部列键；缺失或重复的目录记录不按名称猜另一列。 */
export function catalogColorType(columns: readonly Pick<ColumnInfo, 'name' | 'type'>[] | undefined, key: string): string | undefined {
  const matches = columns?.filter(column => column.name === key);
  return matches?.length === 1 ? matches[0].type : undefined;
}

/** 只按正式NULL/字节标记与已知列类型分类，从不读取或解析字符串内容。 */
export function dataTypeColorKind(value: CellValue | undefined, type: string | undefined, source: DataTypeColorSource): DataTypeColorKind | undefined {
  if (value === undefined) return undefined;
  if (value === null) return 'null';
  if (typeof value === 'object' && value.type === 'binary' && typeof value.base64 === 'string') return 'binary';
  if (typeof type !== 'string' || type.length > 512) return undefined;
  const name = type.trim().toUpperCase();
  if (source === 'protocol') {
    // MySQL字段包BLOB家族同时承载TEXT，不能从协议名推断二进制或解析文本猜JSON。
    if (['TINY', 'SHORT', 'LONG', 'INT24', 'LONGLONG', 'DECIMAL', 'NEWDECIMAL', 'FLOAT', 'DOUBLE'].includes(name)) return 'number';
    if (['DATE', 'NEWDATE', 'TIME', 'TIME2', 'DATETIME', 'DATETIME2', 'TIMESTAMP', 'TIMESTAMP2', 'YEAR'].includes(name)) return 'temporal';
    if (['STRING', 'VAR_STRING', 'VARCHAR', 'ENUM', 'SET'].includes(name)) return 'text';
    if (name === 'JSON') return 'json';
    if (name === 'BIT') return 'binary';
    return undefined;
  }
  if (source !== 'catalog') return undefined;
  if (/^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)(?:\(\d{1,5}\))?(?: UNSIGNED)?(?: ZEROFILL)?$/.test(name)
    || /^(?:DECIMAL|NUMERIC|FIXED|FLOAT|DOUBLE|REAL)(?:\(\d{1,3}(?:,\s*\d{1,3})?\))?(?: UNSIGNED)?(?: ZEROFILL)?$/.test(name)
    || /^(?:BOOL|BOOLEAN)$/.test(name)) return 'number';
  if (/^(?:DATE|YEAR(?:\([24]\))?|(?:TIME|DATETIME|TIMESTAMP)(?:\([0-6]\))?)$/.test(name)) return 'temporal';
  if (/^(?:(?:CHAR|VARCHAR)(?:\(\d{1,5}\))?|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|ENUM|SET)$/.test(name)) return 'text';
  if (name === 'JSON') return 'json';
  if (/^(?:(?:BINARY|VARBINARY|BIT)(?:\(\d{1,5}\))?|TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB)$/.test(name)) return 'binary';
  return undefined;
}
