import type { CellValue, ColumnInfo } from '../shared/contracts';
import { typedCellPlaceholder } from './sql';
import iconv from 'iconv-lite';

/** 依列字符集核对可表示性与存储字节；例如 latin1 的 é 不能按 UTF-8 两字节误判容量。 */
function textStorageBytes(value: string, charset = 'utf8mb4'): number {
  const normalized = charset.toLowerCase();
  if (['utf8mb4', 'utf8mb3', 'utf8'].includes(normalized)) {
    if (normalized !== 'utf8mb4' && /[\u{10000}-\u{10FFFF}]/u.test(value)) throw new Error('目标字符集不能表示补充平面字符');
    return Buffer.byteLength(value, 'utf8');
  }
  const encoding = ({ latin1: 'windows1252', latin2: 'iso88592', ucs2: 'utf16-be', utf16: 'utf16-be', utf32: 'utf32-be' } as Record<string, string>)[normalized] ?? normalized;
  if (!iconv.encodingExists(encoding)) throw new Error('暂不能确认目标字符集的无损表示');
  if (normalized === 'ucs2' && /[\u{10000}-\u{10FFFF}]/u.test(value)) throw new Error('UCS2 不能表示补充平面字符');
  const encoded = iconv.encode(value, encoding);
  if (iconv.decode(encoded, encoding, { stripBOM: false }) !== value) throw new Error('文字不能在目标字符集中往返');
  return encoded.length;
}

/** 用十进制字符串比较可往返文本，不能先把精确值转为 Number 再检查舍入后的结果。 */
function decimalKey(value: string): string {
  const parts = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!parts) return '';
  const fraction = parts[3] ?? parts[4] ?? '', exponent = Number(parts[5] ?? 0) - fraction.length;
  if (!Number.isSafeInteger(exponent)) return '';
  let digits = ((parts[2] ?? '') + fraction).replace(/^0+/, ''), power = exponent;
  if (!digits) return '0';
  while (digits.endsWith('0')) { digits = digits.slice(0, -1); power++; }
  return `${parts[1] === '-' ? '-' : ''}${digits}e${power}`;
}

/** 日历用整数验证，避免 Date 的时区、两位年份和非法日期自动归一化。 */
function validDate(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return false;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1000 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** 文件导入的共同无损前置检查；报错只指出列与边界，不把用户字段值复制进错误摘要。 */
export function validateLosslessImport(column: ColumnInfo, value: CellValue, dialect: 'mysql' | 'mariadb'): void {
  const type = column.type.trim().toUpperCase();
  const fail = (reason: string): never => { throw new Error(`字段 ${column.name} 不能无损导入：${reason}`); };
  if (value === null) { if (!column.nullable) fail('目标不允许 NULL'); return; }
  if (typeof value === 'string' && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail('包含无效 Unicode 字符');
  const unsigned = /\bUNSIGNED\b|\bZEROFILL\b/.test(type);
  const numberText = typeof value === 'boolean' ? (value ? '1' : '0') : typeof value === 'object' ? '' : String(value);
  const integer = /^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|BOOL|BOOLEAN)\b/.exec(type);
  if (integer) {
    if (!/^[+-]?\d+$/.test(numberText) || (typeof value === 'number' && !Number.isSafeInteger(value))) fail('整数要求精确十进制整数');
    const bits = { TINYINT: 8, SMALLINT: 16, MEDIUMINT: 24, INT: 32, INTEGER: 32, BIGINT: 64, BOOL: 8, BOOLEAN: 8 }[integer[1]]!;
    const size = 1n << BigInt(unsigned ? bits : bits - 1), parsed = BigInt(numberText);
    if (parsed < (unsigned ? 0n : -size) || parsed > size - 1n) fail('整数超出目标有符号或无符号范围');
    return;
  }
  const decimal = /^(?:DECIMAL|NUMERIC|FIXED)\b(?:\((\d+)(?:,\s*(\d+))?\))?/.exec(type);
  if (decimal) {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) fail('精确小数必须使用原始文本');
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(numberText)) fail('小数要求普通十进制文本，不接受指数或隐式转换');
    const [whole, fraction = ''] = numberText.replace(/^[+-]/, '').split('.');
    const precision = Number(decimal[1] ?? 10), scale = Number(decimal[2] ?? 0);
    if (whole.replace(/^0+/, '').length > precision - scale || fraction.replace(/0+$/, '').length > scale || (unsigned && numberText.startsWith('-') && decimalKey(numberText) !== '0')) fail('数值超出目标精度或小数尺度');
    return;
  }
  if (/^(?:FLOAT|DOUBLE|REAL)\b/.test(type)) {
    const numeric = Number(numberText), original = decimalKey(numberText);
    if (!original || !Number.isFinite(numeric) || original !== decimalKey(String(numeric))) fail('浮点文本不能往返或超出范围');
    if (/^FLOAT\b/.test(type) && !Object.is(Math.fround(numeric), numeric)) fail('数值不能按 FLOAT 精度往返');
    if (unsigned && numeric < 0) fail('目标为无符号浮点数');
    return;
  }
  if (/^BIT\b/.test(type)) { typedCellPlaceholder(column, value); return; }
  if (/^(?:DATE|DATETIME|TIMESTAMP|TIME|YEAR)\b/.test(type)) {
    if (typeof value !== 'string') fail('日期时间要求明确文本');
    const source = value as string;
    if (/^YEAR\b/.test(type)) { if (!/^\d{4}$/.test(source) || Number(source) < 1901 || Number(source) > 2155) fail('YEAR 要求 1901～2155 的四位年份'); return; }
    if (/^DATE\b/.test(type)) { if (!validDate(source)) fail('日期无效或包含零日期'); return; }
    const scale = Number(/\((\d+)\)/.exec(type)?.[1] ?? 0);
    const parts = /^TIME\b/.test(type) ? /^-?(\d{2,3}):([0-5]\d):([0-5]\d)(?:\.(\d{1,6}))?$/.exec(source) : /^(\d{4}-\d{2}-\d{2}) (\d{2}):([0-5]\d):([0-5]\d)(?:\.(\d{1,6}))?$/.exec(source);
    if (!parts) fail('日期时间格式无效');
    const fraction = /^TIME\b/.test(type) ? parts![4] ?? '' : parts![5] ?? '';
    if (fraction.replace(/0+$/, '').length > scale) fail('非零微秒超出目标时间精度');
    if (/^TIME\b/.test(type)) {
      if (Number(parts![1]) > 838 || (dialect === 'mysql' && parts![1] === '838' && parts![2] === '59' && parts![3] === '59' && /[1-9]/.test(fraction))) fail('TIME 超出当前服务器可表示范围');
    } else if (!validDate(parts![1]) || Number(parts![2]) > 23) fail('日期时间日历或小时无效');
    return;
  }
  const binary = /^(TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB|BINARY|VARBINARY)\b/.exec(type);
  if (binary) {
    if (typeof value !== 'object' || value.type !== 'binary' || Buffer.from(value.base64, 'base64').toString('base64') !== value.base64) fail('二进制要求规范 Base64 协议值');
    const bytes = Buffer.from((value as { base64: string }).base64, 'base64').length;
    const maximum = Number(/\((\d+)\)/.exec(type)?.[1] ?? ({ TINYBLOB: 255, BLOB: 65535, MEDIUMBLOB: 16777215, LONGBLOB: 4294967295 } as Record<string, number>)[binary[1]]);
    if (!Number.isSafeInteger(maximum) || bytes > maximum || (binary[1] === 'BINARY' && bytes !== maximum)) fail('二进制长度会发生截断或定长填充');
    return;
  }
  const text = /^(CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT)\b/.exec(type);
  if (text) {
    if (typeof value !== 'string') fail('文本列要求文字，拒绝隐式数值或布尔转换');
    const source = value as string, maximum = Number(/\((\d+)\)/.exec(type)?.[1] ?? (text[1] === 'CHAR' ? 1 : NaN));
    if (text[1] === 'CHAR' || text[1] === 'VARCHAR') {
      if (!Number.isSafeInteger(maximum) || maximum < 0) fail('无法确认目标字符长度');
      let characters = 0; for (const _character of source) if (++characters > maximum) fail('字符数超过目标长度');
    }
    if (text[1] === 'CHAR' && source.endsWith(' ')) fail('CHAR 尾随空格可能被服务器移除');
    const bytes = ({ TINYTEXT: 255, TEXT: 65535, MEDIUMTEXT: 16777215, LONGTEXT: 4294967295 } as Record<string, number>)[text[1]];
    let actualBytes: number;
    try { actualBytes = textStorageBytes(source, column.characterSet ?? 'utf8mb4'); } catch (reason) { fail(reason instanceof Error ? reason.message : '目标字符集校验失败'); }
    if (bytes !== undefined && actualBytes! > bytes) fail('字节数超过目标文本容量');
    return;
  }
  if (/^(?:ENUM|SET)\(/.test(type)) {
    // 枚举的数字索引和 SET 重排可能没有警告；只接受可明确证明的原始成员文字。
    if (typeof value !== 'string' || column.type.includes('\\')) fail('枚举要求明确成员文本，暂不接受含反斜线转义的定义');
    const members = [...column.type.matchAll(/'((?:[^']|'')*)'/g)].map(match => match[1].replaceAll("''", "'"));
    if (/^ENUM/.test(type) ? !members.includes(value as string) : members.filter(member => (value as string).split(',').includes(member)).join(',') !== value) fail('枚举值无效或 SET 成员顺序会改变');
  }
}
