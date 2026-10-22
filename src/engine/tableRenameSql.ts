import { qualified } from './sql';
import { tableDefinitionTokens } from './tableColumnDefinition';
import type { TableCommentRead } from './tableCommentRead';
import type { TableRenameRead } from './tableRenameRead';
import { validateTableRenameName, type TableRenameTarget } from '../shared/tableRename';

/** 仅生成同库单表RENAME，不接受客户端SQL、IF EXISTS、多表交换或跨库移动。 */
export function planTableRename(target: TableRenameTarget, value: unknown): { sql: string; newName: string } {
  const newName = validateTableRenameName(value);
  if (newName === target.table) throw new Error('表名没有实际变更');
  return { sql: `RENAME TABLE ${qualified(target.database, target.table)} TO ${qualified(target.database, newName)};`, newName };
}

/** 只豁免SHOW CREATE首部的表标识符，列、约束名、文字量和全部尾选项仍逐字比较。 */
export function renameDefinitionBody(read: Pick<TableCommentRead, 'source' | 'context'>): string {
  const tokens = tableDefinitionTokens(read.source, read.context);
  if (tokens[0]?.value.toUpperCase() !== 'CREATE' || tokens[1]?.value.toUpperCase() !== 'TABLE' || !['word', 'identifier'].includes(tokens[2]?.kind)) throw new Error('表定义首部超出已证明范围');
  let end = tokens[2].end;
  if (tokens[3]?.value === '.') {
    if (!['word', 'identifier'].includes(tokens[4]?.kind)) throw new Error('表定义限定名无效');
    end = tokens[4].end;
    if (tokens[5]?.value !== '(') throw new Error('表定义限定名超出同库范围');
  } else if (tokens[3]?.value !== '(') {
    throw new Error('表定义首部超出已证明范围');
  }
  return read.source.slice(0, tokens[2].start) + '<表身份>' + read.source.slice(end);
}

/** 成功响应后须在新名称找到相同TABLE_ID，且除名称外完整定义和目录属性一致。 */
export function verifyTableRename(before: TableRenameRead, after: TableRenameRead): boolean {
  return !after.reasons.length && before.renameViewDigest === after.renameViewDigest && !!before.tableId && before.tableId === after.tableId && before.identity === after.identity && before.normalizedMode === after.originalMode && before.normalizedMode === after.normalizedMode && renameDefinitionBody(before) === renameDefinitionBody(after) && JSON.stringify([before.nullability, before.encodings, before.tableEncoding, before.engine, before.rowFormat, before.autoIncrement]) === JSON.stringify([after.nullability, after.encodings, after.tableEncoding, after.engine, after.rowFormat, after.autoIncrement]);
}
