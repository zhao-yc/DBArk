import { qualified, stringLiteral } from './sql';
import { parseTableColumnDefinition, tableDefinitionTokens } from './tableColumnDefinition';
import { tableCommentHasEngineOptions, validateTableComment, type TableCommentBudget } from '../shared/tableComment';
import type { TableDefinitionContext } from '../shared/tableColumnPatches';

export interface TableCommentDefinition { comment: string; preserved: string; reasons: string[]; }
/** 表尾只解析已知无歧义键值；列、索引、生成表达式和可执行列片段保持完整原文。 */
export function readTableCommentDefinition(source: string, context: TableDefinitionContext): TableCommentDefinition {
  const document = parseTableColumnDefinition(source, context), tokens = tableDefinitionTokens(document.tail.raw, context);
  const keys = new Set(['ENGINE', 'AUTO_INCREMENT', 'CHARSET', 'COLLATE', 'COMMENT', 'ROW_FORMAT', 'KEY_BLOCK_SIZE', 'STATS_PERSISTENT', 'STATS_AUTO_RECALC', 'STATS_SAMPLE_PAGES', 'PACK_KEYS', 'CHECKSUM', 'DELAY_KEY_WRITE', 'COMPRESSION', 'ENCRYPTION', 'AUTOEXTEND_SIZE']);
  let cursor = 1, comment = '', seenComment = false; const preserved = [tokens[0]], reasons: string[] = [], seen = new Set<string>();
  while (cursor < tokens.length) {
    const start = cursor;
    if (tokens[cursor].value === ';' && cursor === tokens.length - 1) { cursor++; break; }
    let key = tokens[cursor]?.kind === 'word' ? tokens[cursor].value.toUpperCase() : ''; cursor++;
    if (key === 'DEFAULT') { key = tokens[cursor]?.kind === 'word' ? tokens[cursor].value.toUpperCase() : ''; cursor++; }
    if (key === 'CHARACTER' && tokens[cursor]?.value.toUpperCase() === 'SET') { key = 'CHARSET'; cursor++; }
    if (!keys.has(key) || seen.has(key)) { reasons.push('表尾含分区、重复或尚未解析的选项，当前只能查看注释'); break; }
    seen.add(key); if (tokens[cursor]?.value === '=') cursor++;
    const value = tokens[cursor++];
    if (!value || !['word', 'number', 'string', 'identifier'].includes(value.kind)) { reasons.push('表选项值无法完整解析'); break; }
    if (key === 'COMMENT') {
      if (value.kind !== 'string') { reasons.push('表注释不是可证明的单个字符串'); break; }
      comment = value.value; seenComment = true;
    } else preserved.push(...tokens.slice(start, cursor));
  }
  if (tableCommentHasEngineOptions(comment)) reasons.push('已有表注释包含MERGE_THRESHOLD等引擎参数，不能作为普通说明覆盖');
  const canonical = (text: string) => tableDefinitionTokens(text, context).map(token => [token.kind, token.kind === 'word' ? token.value.toUpperCase() : token.value]);
  // 唯一允许变化的是整个顶层COMMENT选项；不能忽略其他表尾或列中的COMMENT。
  return { comment: seenComment ? comment : '', reasons, preserved: JSON.stringify([canonical(source.slice(0, document.body.end)), preserved.map(token => [token.kind, token.kind === 'word' ? token.value.toUpperCase() : token.value])]) };
}
/** 只生成一条COMMENT语句，目标来自快照，调用方不能附加任意SQL。 */
export function planTableComment(database: string, table: string, before: string, next: unknown, context: TableDefinitionContext, budget: TableCommentBudget): { sql: string; comment: string } {
  const comment = validateTableComment(next, budget);
  if (tableCommentHasEngineOptions(before)) throw new Error('原注释包含引擎参数，未发送DDL');
  if (before === comment) throw new Error('表注释没有实际变更');
  return { sql: `ALTER TABLE ${qualified(database, table)} COMMENT = ${stringLiteral(comment, context.mode.noBackslashEscapes)};`, comment };
}
