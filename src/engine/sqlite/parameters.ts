import { queryParameterLimits, type QueryParameterNames } from '../../shared/queryParameters';
import { sqliteStatementRanges } from './currentStatement';

const identifierStart = (value: string) => /[A-Za-z_\u0080-\uFFFF]/.test(value);
const identifierPart = (value: string) => /[A-Za-z0-9_$\u0080-\uFFFF]/.test(value);

/** 完整SQLite词法先验证全文，再识别值参数；不会prepare模板或执行前序语句取得所谓模式。 */
export function sqliteNamedParameterNames(sql: string): string[] {
  if (!sqliteStatementRanges(sql).length) throw Error('SQLite参数模板中没有可执行语句');
  const names = new Set<string>(); let occurrences = 0;
  for (let index = 0; index < sql.length;) {
    const character = sql[index];
    if (sql.startsWith('--', index)) { const end = sql.indexOf('\n', index + 2); index = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith('/*', index)) { const end = sql.indexOf('*/', index + 2); index = end + 2; continue; }
    if (["'", '"', '`', '['].includes(character)) {
      const quote = character === '[' ? ']' : character; index++;
      while (index < sql.length) { if (sql[index] === quote) { if (quote !== ']' && sql[index + 1] === quote) index += 2; else { index++; break; } } else index++; }
      continue;
    }
    if (character === '?' || character === '@' || character === '$') throw Error('SQLite类型参数查询只接受 :name，不接受问号、@ 或 $ 参数');
    if (character === ':') {
      const start = ++index;
      while (index < sql.length && identifierPart(sql[index])) index++;
      const name = sql.slice(start, index);
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) || sql[index] === ':') throw Error('SQLite值参数名须为1～64位ASCII字母、数字或下划线，不能以数字开头或使用其他参数格式');
      if (++occurrences > queryParameterLimits.occurrences) throw Error('SQLite值参数引用超过100000次预算');
      names.add(name); if (names.size > queryParameterLimits.names) throw Error('SQLite值参数不能超过200个');
      continue;
    }
    // 普通标识符内部的美元符号是名称的一部分，不能把column$part误判为参数。
    if (identifierStart(character)) { index++; while (index < sql.length && identifierPart(sql[index])) index++; }
    else index++;
  }
  return [...names];
}

export function sqliteParameterInfo(sql: string): QueryParameterNames {
  return {dialect: 'sqlite', names: sqliteNamedParameterNames(sql), warnings: [], noBackslashEscapes: true,
    ansiQuotes: true, noBackslashEscapesKnown: true, ansiQuotesKnown: true, maxDecimalScale: 38, allowTimeEndpointFraction: true};
}

/** 仅识别一条模板，实际 SQL 类型和原生尾部由物理只读进程复核。 */
export function sqliteQueryExportParameterNames(sql: string): QueryParameterNames {
  if (sqliteStatementRanges(sql).length !== 1) throw Error('SQLite 完整导出只接受单条 SELECT 或 WITH 查询');
  return sqliteParameterInfo(sql);
}
