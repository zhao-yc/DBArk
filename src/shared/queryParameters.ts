/** 参数只代表 SQL 值，不能代替数据库、表、字段等标识符。 */
export const queryParameterTypes = ['text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'time', 'binary', 'null'] as const;
export type QueryParameterType = typeof queryParameterTypes[number];
export interface QueryParameter { name: string; type: QueryParameterType; value?: string; }
export interface SqlLexicalMode { noBackslashEscapes: boolean; ansiQuotes: boolean; ansiQuotesKnown?: boolean; noBackslashEscapesKnown?: boolean; }
export interface QueryParameterNames extends SqlLexicalMode { names: string[]; warnings: string[]; maxDecimalScale: 30 | 38; allowTimeEndpointFraction: boolean; }
export const queryParameterLimits = { names: 200, occurrences: 100000, valueBytes: 64 * 1024, totalBytes: 1024 * 1024, sqlBytes: 20 * 1024 * 1024 } as const;
const encoder = new TextEncoder();

/** 文本以 UTF-8 十六进制编码，值中的引号、NUL 和 SQL 分隔符均无法影响 SQL 结构。 */
function textLiteral(value: string): string { return `CONVERT(X'${Array.from(encoder.encode(value), byte => byte.toString(16).padStart(2, '0')).join('')}' USING utf8mb4)`; }

/** 时间只检查明确格式和日历边界；拒绝零日期，避免 sql_mode 导致悄然转成 NULL 或零值。 */
function validDate(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return false;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1000 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** 严格验证后生成模式无关的类型表达式，精确数字从不经过 JavaScript Number。 */
export function queryParameterLiteral(parameter: QueryParameter, maxDecimalScale: 30 | 38 = 30, allowTimeEndpointFraction = false): string {
  const { type, value } = parameter;
  if (type === 'null') { if (value !== undefined && value !== '') throw new Error('NULL 参数不能填写值'); return 'NULL'; }
  if (typeof value !== 'string') throw new Error('非 NULL 参数必须填写字符串值');
  // TextEncoder 会把孤立代理项替换为 U+FFFD，必须拒绝，不能悄然改变输入。
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Error('参数包含无效 Unicode 字符');
  if (encoder.encode(value).length > queryParameterLimits.valueBytes) throw new Error('单个参数不能超过 64 KiB');
  switch (type) {
    case 'text': return textLiteral(value);
    case 'integer':
    case 'decimal': {
      if (!(type === 'integer' ? /^[+-]?\d+$/ : /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/).test(value)) throw new Error('数值参数必须为普通十进制，不接受指数或 SQL 表达式');
      const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
      const digits = whole.replace(/^0+/, '').length;
      if (fraction.length > maxDecimalScale || digits + fraction.length > 65) throw new Error(`数值参数最多 65 位有效数字及 ${maxDecimalScale} 位小数`);
      // 整数字面量由服务器精确解析，同时可用于 LIMIT 等不接受 CAST 表达式的位置。
      if (type === 'integer') { const magnitude = whole.replace(/^0+/, '') || '0'; return value.startsWith('-') && magnitude !== '0' ? '-' + magnitude : magnitude; }
      // DECIMAL(65,s) 可精确保留 UNSIGNED BIGINT 上界及超出 JS 安全整数的值。
      return `CAST('${value}' AS DECIMAL(65,${fraction.length}))`;
    }
    case 'boolean': if (!['true', 'false'].includes(value)) throw new Error('布尔参数只能为 true 或 false'); return value === 'true' ? 'TRUE' : 'FALSE';
    case 'binary': if (!/^(?:[0-9a-fA-F]{2})*$/.test(value)) throw new Error('二进制参数必须为偶数位十六进制，不带 0x 前缀'); return `X'${value}'`;
    case 'date': if (!validDate(value)) throw new Error('日期参数要求有效的 YYYY-MM-DD，年份 1000～9999，不接受零日期'); return `CAST('${value}' AS DATE)`;
    case 'datetime': {
      if (!/^\d{4}-\d{2}-\d{2} [0-2]\d:[0-5]\d:[0-5]\d(?:\.\d{1,6})?$/.test(value) || !validDate(value.slice(0, 10)) || Number(value.slice(11, 13)) > 23) throw new Error('日期时间要求 YYYY-MM-DD HH:mm:ss[.微秒]，不接受时区或零日期');
      return `CAST('${value}' AS DATETIME(6))`;
    }
    case 'time': {
      const parts = /^-?(\d{2,3}):([0-5]\d):([0-5]\d)(?:\.(\d{1,6}))?$/.exec(value);
      if (!parts || Number(parts[1]) > 838) throw new Error('时间要求 [-]HH:mm:ss[.微秒]，小时范围 00～838');
      if (!allowTimeEndpointFraction && Number(parts[1]) === 838 && parts[2] === '59' && parts[3] === '59' && /[1-9]/.test(parts[4] ?? '')) throw new Error('当前服务器 TIME 上界为 838:59:59.000000，端点不能带非零微秒');
      return `CAST('${value}' AS TIME(6))`;
    }
    default: throw new Error('不支持的查询参数类型');
  }
}

/** 首条 SQL 发送前校验整组值、重名及内存预算；错误不回显用户输入值。 */
export function validateQueryParameters(parameters: QueryParameter[], maxDecimalScale: 30 | 38 = 30, allowTimeEndpointFraction = false): Map<string, string> {
  if (!Array.isArray(parameters) || parameters.length > queryParameterLimits.names) throw new Error('查询参数不能超过 200 个');
  const values = new Map<string, string>(); let bytes = 0;
  for (const parameter of parameters) {
    if (!parameter || typeof parameter.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(parameter.name)) throw new Error('参数名须为 1～64 位 ASCII 字母、数字或下划线，且不能以数字开头');
    if (values.has(parameter.name)) throw new Error('查询参数名称重复');
    values.set(parameter.name, queryParameterLiteral(parameter, maxDecimalScale, allowTimeEndpointFraction));
    bytes += encoder.encode(parameter.value ?? '').length;
    if (bytes > queryParameterLimits.totalBytes) throw new Error('参数值合计不能超过 1 MiB');
  }
  return values;
}

export interface NamedParameterToken { name: string; start: number; end: number; }
/** 参数词法扫描保留偏移：普通注释/引号内不绑定，可执行版本注释内部必须扫描。 */
export function namedParameterTokens(sql: string, mode: SqlLexicalMode, onWord?: (word: string) => void): NamedParameterToken[] {
  if (mode.ansiQuotesKnown === false || mode.noBackslashEscapesKnown === false) {
    try {
      let tokens: NamedParameterToken[] | undefined;
      for (const noBackslashEscapes of mode.noBackslashEscapesKnown === false ? [false, true] : [mode.noBackslashEscapes]) {
        for (const ansiQuotes of mode.ansiQuotesKnown === false ? [false, true] : [mode.ansiQuotes]) {
          const candidate = namedParameterTokens(sql, { noBackslashEscapes, ansiQuotes, ansiQuotesKnown: true, noBackslashEscapesKnown: true }, onWord);
          if (tokens && JSON.stringify(tokens) !== JSON.stringify(candidate)) throw new Error('参数边界不同');
          tokens = candidate;
        }
      }
      return tokens!;
    } catch { throw new Error('无法确定会话 SQL 引号模式，当前 SQL 的引号或参数边界存在歧义；请关闭此标签并新建查询重新连接'); }
  }
  const tokens: NamedParameterToken[] = [];
  const scan = (start: number, end: number, executable = false): void => {
    for (let i = start; i < end; i++) {
      const char = sql[i], next = sql[i + 1];
      if (char === '#' || (char === '-' && next === '-' && /[\x00-\x20\x7f]/.test(sql[i + 2] ?? ' '))) { const line = sql.indexOf('\n', i); i = line < 0 ? end : line; continue; }
      if (char === '/' && next === '*') {
        if (executable) throw new Error('可执行版本注释不接受嵌套注释');
        const close = sql.indexOf('*/', i + 2);
        if (close < 0 || close >= end) throw new Error('SQL 存在未闭合的注释');
        const prefix = /^\/\*(?:!|M!)(?:\d{5,6})?\s*/.exec(sql.slice(i, close));
        if (prefix) scan(i + prefix[0].length, close, true);
        i = close + 1; continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        const identifier = char === '`' || (char === '"' && mode.ansiQuotes); const quotedStart = i; let closed = false;
        for (i++; i < end; i++) {
          if (sql[i] === '\\' && !identifier && !mode.noBackslashEscapes) { i++; continue; }
          if (sql[i] === char) { if (sql[i + 1] === char && i + 1 < end) i++; else { closed = true; break; } }
        }
        if (!closed) throw new Error('SQL 存在未闭合的引号');
        if (identifier) onWord?.(sql.slice(quotedStart + 1, i).replaceAll(char + char, char));
        continue;
      }
      if (char === ':' && next !== '=' && sql[i - 1] !== ':') {
        // 存储程序的 label: LOOP/BEGIN 等属于控制流标签，不是值占位符。
        if (/[A-Za-z0-9_`]/.test(sql[i - 1] ?? '') && /^\s*(?:BEGIN|LOOP|REPEAT|WHILE)\b/i.test(sql.slice(i + 1, end))) continue;
        const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i + 1, end))?.[0];
        if (!name || /[A-Za-z0-9_$\u0080-\uFFFF:]/.test(sql[i - 1] ?? '') || /[$\u0080-\uFFFF]/.test(sql[i + 1 + name.length] ?? '') || name.length > 64) throw new Error('非法命名参数；请使用独立的 :name 值占位符');
        if (tokens.length >= queryParameterLimits.occurrences) throw new Error('单条 SQL 参数占位符不能超过 100000 处');
        tokens.push({ name, start: i, end: i + name.length + 1 }); i += name.length;
      } else if (/[A-Za-z_]/.test(char)) {
        const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(i, end))![0];
        onWord?.(word); i += word.length - 1;
      }
    }
  };
  scan(0, sql.length);
  return tokens;
}

/** 协议缓存只检查可执行单词，不把字符串/普通注释中的 SET、CALL 当作控制命令。 */
export function sqlExecutableWords(sql: string, mode: SqlLexicalMode): string[] {
  const words: string[] = [];
  namedParameterTokens(sql, mode, word => words.push(word.toUpperCase()));
  return words;
}

/** 只替换已验证词法位置，重复名称共享同一个安全值表达式。 */
export function bindQueryParameters(sql: string, values: ReadonlyMap<string, string>, mode: SqlLexicalMode): string {
  const tokens = namedParameterTokens(sql, mode); let output = '', from = 0, bytes = 0;
  for (const token of tokens) {
    const literal = values.get(token.name);
    if (literal === undefined) throw new Error('SQL 缺少命名参数值，请重新识别参数');
    const segment = sql.slice(from, token.start) + literal;
    bytes += encoder.encode(segment).length;
    if (bytes > queryParameterLimits.sqlBytes) throw new Error('展开后的 SQL 不能超过 20 MiB');
    output += segment; from = token.end;
  }
  output += sql.slice(from);
  if (encoder.encode(output).length > queryParameterLimits.sqlBytes) throw new Error('展开后的 SQL 不能超过 20 MiB');
  return output;
}
