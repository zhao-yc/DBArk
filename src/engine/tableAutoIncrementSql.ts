import { qualified } from './sql';
import { parseTableColumnDefinition, tableDefinitionTokens } from './tableColumnDefinition';
import { compareAutoIncrementDecimal, validateTableAutoIncrement, type TableAutoIncrementColumn } from '../shared/tableAutoIncrement';
import type { TableDefinitionContext } from '../shared/tableColumnPatches';

/** 只豁免顶层计数选项；列级AUTO_INCREMENT、表达式、COMMENT及全部物理选项仍保留。 */
export function readTableAutoIncrementDefinition(source: string, context: TableDefinitionContext): { value?: string; preserved: string; reasons: string[] } {
  const document = parseTableColumnDefinition(source, context), tokens = tableDefinitionTokens(document.tail.raw, context);
  const keys = new Set(['ENGINE', 'AUTO_INCREMENT', 'CHARSET', 'COLLATE', 'COMMENT', 'ROW_FORMAT', 'KEY_BLOCK_SIZE', 'STATS_PERSISTENT', 'STATS_AUTO_RECALC', 'STATS_SAMPLE_PAGES', 'PACK_KEYS', 'CHECKSUM', 'DELAY_KEY_WRITE', 'COMPRESSION', 'ENCRYPTION', 'AUTOEXTEND_SIZE']);
  let cursor = 1, value: string | undefined; const tail = [tokens[0]], reasons: string[] = [], seen = new Set<string>();
  while (cursor < tokens.length) {
    const start = cursor;
    if (tokens[cursor].value === ';' && cursor === tokens.length - 1) { cursor++; break; }
    let key = tokens[cursor]?.kind === 'word' ? tokens[cursor].value.toUpperCase() : ''; cursor++;
    if (key === 'DEFAULT') { key = tokens[cursor]?.kind === 'word' ? tokens[cursor].value.toUpperCase() : ''; cursor++; }
    if (key === 'CHARACTER' && tokens[cursor]?.value.toUpperCase() === 'SET') { key = 'CHARSET'; cursor++; }
    if (!keys.has(key) || seen.has(key)) { reasons.push('表尾含分区、重复或未知选项，下一自增值仅可查看'); break; }
    seen.add(key); if (tokens[cursor]?.value === '=') cursor++;
    const token = tokens[cursor++];
    if (!token || !['word', 'number', 'string', 'identifier'].includes(token.kind)) { reasons.push('表选项值无法完整解析'); break; }
    if (key === 'AUTO_INCREMENT') {
      if (token.kind !== 'number' || !/^[1-9][0-9]{0,19}$/.test(token.value)) { reasons.push('原自增计数不是规范正十进制，当前只读'); break; }
      value = token.value;
    } else tail.push(...tokens.slice(start, cursor));
  }
  const canonical = (token: typeof tokens[number]) => [token.kind, token.kind === 'word' ? token.value.toUpperCase() : token.value];
  return { value, reasons, preserved: JSON.stringify([source.slice(0, document.body.end), tail.map(canonical)]) };
}
/** 首批只上调目录观测值，不查询MAX、不重述列/表，也不附加其他ALTER子句。 */
export function planTableAutoIncrement(database: string, table: string, before: string, next: unknown, column: TableAutoIncrementColumn): { sql: string; value: string } {
  const value = validateTableAutoIncrement(next, column.maximum); validateTableAutoIncrement(before, column.maximum);
  if (compareAutoIncrementDecimal(value, before) <= 0) throw new Error('首批只允许上调当前目录观测值；不降低、复用或扫描整表猜测最大值');
  return { sql: `ALTER TABLE ${qualified(database, table)} AUTO_INCREMENT = ${value};`, value };
}

/** 目录类型严格限定整数及可选显示宽度；浮点、DECIMAL、ZEROFILL和未知语法不猜上限。 */
export function tableAutoIncrementMaximum(type: string): string | undefined {
  const match = /^(tinyint|smallint|mediumint|int|bigint)(?:\([0-9]{1,3}\))?( unsigned)?$/i.exec(type);
  if (!match) return;
  const limits: Record<string, readonly [string, string]> = { tinyint: ['127', '255'], smallint: ['32767', '65535'], mediumint: ['8388607', '16777215'], int: ['2147483647', '4294967295'], bigint: ['9223372036854775807', '18446744073709551615'] };
  return limits[match[1].toLowerCase()][match[2] ? 1 : 0];
}
