import { readTableComment, assertTableCommentUnchanged, type TableCommentRead } from './tableCommentRead';
import { structureTaskQuery, structureDocumentOf, type StructureTaskContext } from './structureDefinition';
import { readTableDefaultEncodingAlter } from './tableDefaultEncodingPrivileges';
import { readTableAutoIncrementDefinition, tableAutoIncrementMaximum } from './tableAutoIncrementSql';
import { compareAutoIncrementDecimal, type TableAutoIncrementTarget, type TableAutoIncrementColumn, type TableAutoIncrementPolicy, type TableAutoIncrementCapability } from '../shared/tableAutoIncrement';
import { tableAutoIncrementCapability, readTableAutoIncrementNativeCounter, readTableAutoIncrementPolicy } from './tableAutoIncrementCapabilities';

export interface TableAutoIncrementRead extends TableCommentRead { column?: TableAutoIncrementColumn; policy?: TableAutoIncrementPolicy; capability?: TableAutoIncrementCapability; }
const literal = (value: string) => `CONVERT(X'${Buffer.from(value).toString('hex')}' USING utf8mb4)`;
/** MySQL8绕过统计缓存；旧引擎用原生状态前后夹读完整定义及目录，不发送业务MAX或全局修改。 */
export async function readTableAutoIncrement(context: StructureTaskContext, target: TableAutoIncrementTarget): Promise<TableAutoIncrementRead> {
  const capability = tableAutoIncrementCapability(context.managed.status.dialect, context.managed.status.version);
  const native = !!capability && capability !== 'mysql8-stats-expiry';
  const additional: string[] = [];
  let nativeBefore: string | undefined;
  if (capability === 'mysql8-stats-expiry') {
    try {
      await structureTaskQuery(context, 'SET SESSION information_schema_stats_expiry = 0');
      const rows = (await structureTaskQuery<{ expiry: string }[]>(context, 'SELECT CAST(@@SESSION.information_schema_stats_expiry AS CHAR) AS expiry')).rows;
      if (rows.length !== 1 || rows[0].expiry !== '0') throw new Error('无法证明目录已绕过统计缓存，当前只读');
    } catch (error) { context.checkCancelled(); additional.push(error instanceof Error ? error.message : '目录缓存能力未知，当前只读'); }
  } else if (native) {
    try { nativeBefore = await readTableAutoIncrementNativeCounter(context, target); }
    catch (error) { context.checkCancelled(); additional.push(error instanceof Error ? error.message : '原生计数能力未知，当前只读'); }
  } else additional.push('当前只开放MySQL 8.0.30及以上8.0版本、8.4、5.7.44及MariaDB 10.11.19/11.4.13；其他版本的计数目录能力暂不开放');
  const read = await readTableComment(context, target), parsed = readTableAutoIncrementDefinition(read.source, read.context), reasons = [...read.reasons, ...parsed.reasons, ...additional];
  let column: TableAutoIncrementColumn | undefined, policy: TableAutoIncrementPolicy | undefined;
  const db = literal(target.database), table = literal(target.table);
  const rows = (await structureTaskQuery<{ name: string; dataType: string; columnType: string; extra: string }[]>(context, `SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, EXTRA AS extra FROM information_schema.COLUMNS WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(${db} AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(${table} AS BINARY) ORDER BY ORDINAL_POSITION LIMIT 4097`)).rows;
  const document = structureDocumentOf(read), auto = rows.filter(row => typeof row.extra === 'string' && /(?:^| )auto_increment(?: |$)/i.test(row.extra));
  const sourceAuto = document.columns.filter(item => item.attributes.some(attribute => attribute.kind === 'auto-increment'));
  if (rows.length !== document.columns.length || rows.some((row, index) => row.name !== document.columns[index].name) || auto.length !== 1 || sourceAuto.length !== 1 || auto[0]?.name !== sourceAuto[0]?.name) reasons.push('无法从完整列目录与定义证明唯一自增列；不会新增或修改列级AUTO_INCREMENT');
  else {
    const actual = auto[0], maximum = typeof actual.columnType === 'string' ? tableAutoIncrementMaximum(actual.columnType) : undefined;
    const sameType = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!maximum || typeof actual.dataType !== 'string' || actual.columnType.split(/[ (]/)[0].toLowerCase() !== actual.dataType.toLowerCase() || !sourceAuto[0].type.known || !sameType(sourceAuto[0].type.raw, actual.columnType)) reasons.push('自增列类型与完整定义不一致或不是已证明范围的整数类型，当前只读');
    else column = { name: actual.name, type: actual.columnType, maximum };
  }
  if (read.autoIncrement === null || !/^[1-9][0-9]{0,19}$/.test(read.autoIncrement)) reasons.push('真实目录未提供规范正十进制计数，当前只读');
  else {
    if ((parsed.value ?? '1') !== read.autoIncrement) reasons.push('SHOW CREATE与实际目录计数不同，可能有并发DML；请暂停写入后重新读取');
    if (column && compareAutoIncrementDecimal(read.autoIncrement, column.maximum) > 0) reasons.push('目录计数超出实际整数列上限，当前只读');
  }
  if (native) {
    try {
      const after = await readTableAutoIncrementNativeCounter(context, target);
      if (!nativeBefore || nativeBefore !== read.autoIncrement || after !== nativeBefore) throw new Error('原生表状态前后与完整定义/目录计数不一致，可能有并发DML；请暂停写入后重新读取');
    } catch (error) { context.checkCancelled(); reasons.push(error instanceof Error ? error.message : '原生计数复核失败，当前只读'); }
  }
  if (capability) try {
    policy = await readTableAutoIncrementPolicy(context);
    if (!await readTableDefaultEncodingAlter(context, target, read.context)) throw new Error('无法证明直接ALTER权限，角色与部分撤销暂不展开，当前只读');
  } catch (error) { context.checkCancelled(); reasons.push(error instanceof Error ? error.message : '实际自增能力无法证明，当前只读'); }
  return { ...read, preserved: parsed.preserved, column, policy, capability, reasons };
}
/** DML在预览或发送前推进计数也令快照失效；完整原文、原生身份与模式仍严格绑定。 */
export function assertTableAutoIncrementUnchanged(before: TableAutoIncrementRead, after: TableAutoIncrementRead): void {
  assertTableCommentUnchanged(before, after);
  if (!before.column || !before.policy || !before.capability || JSON.stringify([before.column, before.policy, before.capability]) !== JSON.stringify([after.column, after.policy, after.capability])) throw new Error('自增列类型或实际运行能力已变化；未发送DDL');
}
/** 只豁免表尾计数，不豁免其他定义；值是否吻合另行报告，不能从OK包或较大数值推断成功。 */
export function verifyTableAutoIncrementStructure(before: TableAutoIncrementRead, after: TableAutoIncrementRead): boolean {
  return !after.reasons.length && !!before.capability && before.capability === after.capability && !!before.tableId && before.tableId === after.tableId && before.identity === after.identity && before.normalizedMode === after.originalMode && before.normalizedMode === after.normalizedMode && before.preserved === after.preserved && JSON.stringify([before.nullability, before.encodings, before.tableEncoding, before.engine, before.rowFormat, before.comment, before.column, before.policy]) === JSON.stringify([after.nullability, after.encodings, after.tableEncoding, after.engine, after.rowFormat, after.comment, after.column, after.policy]);
}
