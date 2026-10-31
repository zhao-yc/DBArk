import type { SqliteValue } from '../engine/sqlite/protocol';
import { queryParameterLimits, type QueryParameter } from './queryParameters';

const encoder = new TextEncoder(), base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** 只读取普通自有数据字段，拒绝访问器、symbol 和隐藏扩展，不触发用户输入中的 getter。 */
function parameterData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('SQLite参数形状无效');
  const output: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !['name', 'type', 'value'].includes(key)) throw Error('SQLite参数形状无效');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw Error('SQLite参数形状无效');
    output[key] = descriptor.value;
  }
  return output;
}
/** 浏览器和Main使用同一编码，不依赖Buffer、btoa或Node模块；原Hex已严格验证。 */
function hexBase64(hex: string): string {
  const output: string[] = [];
  for (let i = 0; i < hex.length; i += 6) {
    const a = parseInt(hex.slice(i, i + 2), 16), hasB = i + 2 < hex.length, hasC = i + 4 < hex.length;
    const b = hasB ? parseInt(hex.slice(i + 2, i + 4), 16) : 0, c = hasC ? parseInt(hex.slice(i + 4, i + 6), 16) : 0;
    output.push(base64Alphabet[a >> 2], base64Alphabet[(a & 3) << 4 | b >> 4], hasB ? base64Alphabet[(b & 15) << 2 | c >> 6] : '=', hasC ? base64Alphabet[c & 63] : '=');
  }
  return output.join('');
}
/** 仅检查明确公历文本；不经Date、时区、CAST或本地时间格式化。 */
function validDate(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!parts) return false;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]), leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
/** SQLite九类型转真实绑定值；decimal及日历/时长保留TEXT原文，整数只接受签名64位。 */
function nativeValue(type: unknown, value: unknown): SqliteValue {
  if (type === 'null') { if (value !== undefined && value !== '') throw Error('SQLite NULL参数不能填写值'); return null; }
  if (typeof value !== 'string') throw Error('SQLite非NULL参数必须填写字符串值');
  switch (type) {
    case 'text': return value;
    case 'integer': {
      if (!/^[+-]?\d+$/.test(value)) throw Error('SQLite整数必须为有符号64位普通十进制');
      const magnitude = value.replace(/^[+-]/, '').replace(/^0+/, '') || '0'; if (magnitude.length > 19) throw Error('SQLite整数超出有符号64位范围');
      const number = BigInt((value.startsWith('-') ? '-' : '') + magnitude);
      if (number < -9223372036854775808n || number > 9223372036854775807n) throw Error('SQLite整数超出有符号64位范围');
      return { type: 'integer', value: number.toString() };
    }
    case 'decimal': {
      if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) throw Error('SQLite小数必须为普通十进制文本，不接受指数或SQL表达式');
      const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
      if (fraction.length > 38 || whole.replace(/^0+/, '').length + fraction.length > 65) throw Error('SQLite小数TEXT最多65位有效数字及38位小数');
      return value;
    }
    case 'boolean': if (value !== 'true' && value !== 'false') throw Error('SQLite布尔参数只能为true或false'); return { type: 'integer', value: value === 'true' ? '1' : '0' };
    case 'binary': if (!/^(?:[0-9a-fA-F]{2})*$/.test(value)) throw Error('SQLite二进制参数必须为偶数位Hex，不带前缀'); return { type: 'binary', base64: hexBase64(value) };
    case 'date': if (!validDate(value)) throw Error('SQLite日期要求有效YYYY-MM-DD，年份0001～9999'); return value;
    case 'datetime': if (!/^\d{4}-\d{2}-\d{2} [0-2]\d:[0-5]\d:[0-5]\d(?:\.\d{1,6})?$/.test(value) || !validDate(value.slice(0, 10)) || Number(value.slice(11, 13)) > 23) throw Error('SQLite日期时间要求有效YYYY-MM-DD HH:mm:ss及最多6位微秒，不接受时区'); return value;
    case 'time': { const parts = /^-?(\d{2,3}):([0-5]\d):([0-5]\d)(?:\.(\d{1,6}))?$/.exec(value); if (!parts || Number(parts[1]) > 838) throw Error('SQLite时长要求[-]HH:mm:ss，小时00～838及最多6位微秒'); return value; }
    default: throw Error('SQLite不支持该参数类型');
  }
}
/** 整组严格准入后返回bare-name绑定；不生成SQL字面量，错误不回显名称或参数原值。 */
export function validateSqliteQueryParameters(parameters: readonly QueryParameter[]): Map<string, SqliteValue> {
  if (!Array.isArray(parameters)) throw Error('SQLite查询参数必须为数组');
  const length = Object.getOwnPropertyDescriptor(parameters, 'length');
  if (!length || !('value' in length) || !Number.isSafeInteger(length.value) || length.value < 0 || length.value > queryParameterLimits.names) throw Error('SQLite查询参数不能超过200个');
  if (Reflect.ownKeys(parameters).length !== length.value + 1) throw Error('SQLite查询参数数组形状无效');
  const values = new Map<string, SqliteValue>(); let bytes = 0;
  for (let index = 0; index < length.value; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(parameters, String(index)); if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw Error('SQLite查询参数数组形状无效');
    const parameter = parameterData(descriptor.value), name = parameter.name, value = parameter.value;
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) throw Error('SQLite参数名须为1～64位ASCII字母数字或下划线，不能以数字开头');
    if (values.has(name)) throw Error('SQLite查询参数名称重复');
    if (typeof value === 'string') {
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw Error('SQLite参数包含无效Unicode');
      const size = encoder.encode(value).length; if (size > queryParameterLimits.valueBytes) throw Error('SQLite单个参数不能超过64 KiB'); bytes += size; if (bytes > queryParameterLimits.totalBytes) throw Error('SQLite参数值合计不能超过1 MiB');
    }
    values.set(name, nativeValue(parameter.type, value));
  }
  return values;
}
