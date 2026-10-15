import { qualified } from './sql';
import { parseTableColumnDefinition, tableDefinitionTokens } from './tableColumnDefinition';
import { sameTableEncodingPair, validateTableEncodingPair, type TableEncodingPair } from '../shared/tableDefaultEncoding';
import type { TableDefinitionContext, TableColumnDefinition } from '../shared/tableColumnPatches';
import { readControlledTimestampDefault } from '../shared/tableColumnPatches';
import type { StructureDefinitionRead } from './structureDefinition';

export interface TableDefaultEncodingDefinition { preserved: string; charset?: string; collation?: string; reasons: string[]; }
/** 编码属性的名称必须来自已确认单个属性，不能从表达式或可执行片段中猜。 */
function columnEncodingAttributes(column: TableColumnDefinition, context: TableDefinitionContext): { charset?: string; collation?: string } {
  const result: { charset?: string; collation?: string } = {};
  for (const attribute of column.attributes) if (attribute.kind === 'charset' || attribute.kind === 'collation') {
    const tokens = tableDefinitionTokens(attribute.raw, context), token = tokens.at(-1);
    if (!token || !['word', 'identifier'].includes(token.kind) || !/^[A-Za-z0-9_]+$/.test(token.value)) throw new Error('列编码属性名称不能完整证明');
    result[attribute.kind] = token.value;
  }
  return result;
}
/** 未知语法只读；显式编码名称必须与实际目录精确对应，不猜别名。 */
export function tableDefaultEncodingColumnReasons(read: StructureDefinitionRead): string[] {
  const document = parseTableColumnDefinition(read.source, read.context), reasons: string[] = [];
  for (const [index, column] of document.columns.entries()) {
    if (!column.type.known || column.default.kind === 'opaque' || column.attributes.some(attribute => attribute.kind === 'opaque') || tableDefinitionTokens(column.raw, read.context).some(token => token.kind === 'executable')) { reasons.push(`字段${JSON.stringify(column.name)}含未知或可执行语法，默认编码首批只读`); continue; }
    if (column.default.kind === 'expression' && !readControlledTimestampDefault(column.default.sql)) reasons.push(`字段${JSON.stringify(column.name)}的默认表达式未独立证明修改表默认编码后的求值保真，首批只读`);
    const attributes = columnEncodingAttributes(column, read.context), actual = read.encodings[index];
    if (!actual || actual.name !== column.name || attributes.charset !== undefined && attributes.charset !== actual.charset || attributes.collation !== undefined && attributes.collation !== actual.collation) reasons.push(`字段${JSON.stringify(column.name)}的显式编码与目录不一致，当前只读`);
  }
  if (document.items.some(item => item.kind === 'constraint' && tableDefinitionTokens(item.raw, read.context).some(token => token.kind === 'executable'))) reasons.push('约束含尚未独立证明的可执行语法，默认编码首批只读');
  return reasons;
}
/** 只能补显式显示原有效编码，已有属性不能被宽泛掩码吞掉；合法删除也保守留待复核。 */
export function onlyAddedColumnEncodingAttributes(before: StructureDefinitionRead, after: StructureDefinitionRead): boolean {
  const previous = parseTableColumnDefinition(before.source, before.context), next = parseTableColumnDefinition(after.source, after.context);
  if (previous.columns.length !== next.columns.length) return false;
  return previous.columns.every((column, index) => {
    const actual = before.encodings[index], current = next.columns[index]; if (!actual || current.name !== column.name) return false;
    const old = columnEncodingAttributes(column, before.context), now = columnEncodingAttributes(current, after.context);
    return (['charset', 'collation'] as const).every(key => old[key] !== undefined ? now[key] === old[key] : now[key] === undefined || now[key] === actual[key]);
  });
}
/** 只允许已识别的顶层默认编码选项变化；列的显式编码交给目录真值独立核对。 */
export function readTableDefaultEncodingDefinition(source: string, context: TableDefinitionContext): TableDefaultEncodingDefinition {
  const document = parseTableColumnDefinition(source, context), tokens = tableDefinitionTokens(document.tail.raw, context);
  const keys = new Set(['ENGINE', 'AUTO_INCREMENT', 'CHARSET', 'COLLATE', 'COMMENT', 'ROW_FORMAT', 'KEY_BLOCK_SIZE', 'STATS_PERSISTENT', 'STATS_AUTO_RECALC', 'STATS_SAMPLE_PAGES', 'PACK_KEYS', 'CHECKSUM', 'DELAY_KEY_WRITE', 'COMPRESSION', 'ENCRYPTION', 'AUTOEXTEND_SIZE']);
  let cursor = 1, charset: string | undefined, collation: string | undefined; const tail = [tokens[0]], reasons: string[] = [], seen = new Set<string>();
  while (cursor < tokens.length) {
    const start = cursor;
    if (tokens[cursor].value === ';' && cursor === tokens.length - 1) { cursor++; break; }
    let key = tokens[cursor]?.kind === 'word' ? tokens[cursor].value.toUpperCase() : ''; cursor++;
    if (key === 'DEFAULT') { key = tokens[cursor]?.kind === 'word' ? tokens[cursor].value.toUpperCase() : ''; cursor++; }
    if (key === 'CHARACTER' && tokens[cursor]?.value.toUpperCase() === 'SET') { key = 'CHARSET'; cursor++; }
    if (!keys.has(key) || seen.has(key)) { reasons.push('表尾含分区、重复或尚未解析的选项，默认编码仅可查看'); break; }
    seen.add(key); if (tokens[cursor]?.value === '=') cursor++;
    const value = tokens[cursor++];
    if (!value || !['word', 'number', 'string', 'identifier'].includes(value.kind)) { reasons.push('表选项值无法完整解析'); break; }
    if (key === 'CHARSET' || key === 'COLLATE') {
      if (!['word', 'identifier'].includes(value.kind)) { reasons.push('表默认编码选项不是可证明的名称'); break; }
      if (key === 'CHARSET') charset = value.value; else collation = value.value;
    } else tail.push(...tokens.slice(start, cursor));
  }
  const canonical = (text: string) => tableDefinitionTokens(text, context).map(token => [token.kind, token.kind === 'word' ? token.value.toUpperCase() : token.value]);
  const items = document.items.map(item => {
    if (item.kind !== 'column') return canonical(item.raw);
    let raw = item.raw;
    // 仅剔除解析器确认的列编码属性；默认表达式/生成表达式/约束里的COLLATE均保留。
    for (const attribute of item.attributes.filter(attribute => ['charset', 'collation'].includes(attribute.kind)).sort((a, b) => b.range.start - a.range.start)) raw = raw.slice(0, attribute.range.start - item.range.start) + ' ' + raw.slice(attribute.range.end - item.range.start);
    return canonical(raw);
  });
  return { charset, collation, reasons, preserved: JSON.stringify([canonical(document.head.raw), items, tail.map(token => [token.kind, token.kind === 'word' ? token.value.toUpperCase() : token.value])]) };
}
/** 只有服务器目录证明的完整配对可写；不接受CONVERT、列重述、任意SQL或省略COLLATE。 */
export function planTableDefaultEncoding(database: string, table: string, before: TableEncodingPair, next: TableEncodingPair, candidates: readonly TableEncodingPair[]): { sql: string; selection: TableEncodingPair } {
  const selection = validateTableEncodingPair(next);
  if (!candidates.some(candidate => sameTableEncodingPair(candidate, selection))) throw new Error('字符集与排序规则不属于同一真实候选，请重新读取');
  if (sameTableEncodingPair(before, selection)) throw new Error('表默认编码没有实际变更');
  return { sql: `ALTER TABLE ${qualified(database, table)} DEFAULT CHARACTER SET = ${selection.charset} COLLATE = ${selection.collation};`, selection };
}
