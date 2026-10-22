import { readTableForeignKeyDefinition, type TableForeignKeyDefinitionRead } from './tableForeignKeyDefinition';
import { readOutgoingForeignKeyRows } from './tableForeignKeyRead';
import { crossCheckForeignKeyCatalog } from './tableForeignKeyMetadata';
import { qualified } from './sql';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import type { TableColumnDefinitionDocument } from '../shared/tableColumnPatches';
import type { TableCreateDesign } from '../shared/tableCreate';

/** SHOW完整语义须逐项等于本次结构化设计；不合并NO ACTION/RESTRICT，也不猜父库或列序。 */
export function readCreatedForeignKeys(document: TableColumnDefinitionDocument, design: Pick<TableCreateDesign, 'database' | 'foreignKeys'>, serverVersion: string): TableForeignKeyDefinitionRead {
  const parsed = readTableForeignKeyDefinition(document, design.database, serverVersion);
  if (!parsed.complete || parsed.unclassifiedConstraintRanges.length || parsed.foreignKeys.length !== design.foreignKeys.length) throw Error('新表外键完整定义未知或数量不符');
  const names = new Set<string>();
  for (const expected of design.foreignKeys) {
    const actual = parsed.foreignKeys.find(key => key.name === expected.name);
    if (names.has(expected.name) || !actual || actual.opaqueReasons.length || JSON.stringify([actual.childColumnNames, actual.parentTarget, actual.parentColumnNames, actual.onUpdate, actual.onDelete]) !== JSON.stringify([expected.columns, { database: expected.referencedDatabase, table: expected.referencedTable }, expected.referencedColumns, expected.onUpdate.toUpperCase(), expected.onDelete.toUpperCase()])) throw Error('新表外键名称、父子映射或动作与设计不一致');
    names.add(expected.name);
  }
  return parsed;
}

/** 复用原有有界RC/KCU读取和交叉证明，最后重读原SHOW，拒绝核验期间已观测到的定义变化。 */
export async function verifyCreatedForeignKeyCatalog(context: StructureTaskContext, target: { database: string; table: string }, document: TableColumnDefinitionDocument, parsed: TableForeignKeyDefinitionRead): Promise<boolean> {
  const rows = await readOutgoingForeignKeyRows(context, target);
  crossCheckForeignKeyCatalog(parsed, target, rows.rc, rows.kcu);
  const after = (await structureTaskQuery<Record<string, unknown>[]>(context, `SHOW CREATE TABLE ${qualified(target.database, target.table)}`)).rows;
  // 只承诺两次已观测定义一致，不把目录读取描述为DDL物理CAS或跨连接原子快照。
  return after?.length === 1 && typeof after[0]['Create Table'] === 'string' && after[0]['Create Table'] === document.source;
}
