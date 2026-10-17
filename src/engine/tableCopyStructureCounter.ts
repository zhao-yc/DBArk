import { parseTableColumnDefinition, tableDefinitionTokens } from './tableColumnDefinition';
import { readTableAutoIncrementDefinition, tableAutoIncrementMaximum } from './tableAutoIncrementSql';
import { renameDefinitionBody } from './tableRenameSql';
import { validateTableAutoIncrement, type TableAutoIncrementColumn } from '../shared/tableAutoIncrement';
import type { TableDefinitionContext } from '../shared/tableColumnPatches';
import type { TableCopyStructureTarget } from '../shared/tableCopyStructure';
import type { TableCopyStructureCounterPlan } from '../shared/tableCopyStructureCounter';
import type { TableAutoIncrementPolicy } from '../shared/tableAutoIncrement';
import type { TableCommentRead } from './tableCommentRead';
import { readTableRename } from './tableRenameRead';
import { readTableAutoIncrementPolicy } from './tableAutoIncrementCapabilities';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { tableCopyStructureServerProfile } from '../shared/tableCopyStructureProfiles';

export interface TableCopyStructureCounterDefinition {
  /** 只供内存比较，绝不作为发送给数据库的新DDL。 */
  sourceWithoutCounter: string; comparison: string;
  column?: TableAutoIncrementColumn; declaredValue?: string;
}
/** 仅剔除已完整解析的顶层AUTO_INCREMENT数值选项及一个分隔空格；其余原文逐字保留。 */
export function tableCopyStructureCounterDefinition(source: string, context: TableDefinitionContext): TableCopyStructureCounterDefinition {
  const document = parseTableColumnDefinition(source, context), parsed = readTableAutoIncrementDefinition(source, context);
  if (parsed.reasons.length) throw Error('复制结构计数边界未知：' + parsed.reasons.join('；'));
  const columns = document.columns.filter(column => column.attributes.some(attribute => attribute.kind === 'auto-increment'));
  if (columns.length > 1 || !columns.length && parsed.value !== undefined) throw Error('表尾计数与唯一自增列不一致');
  let column: TableAutoIncrementColumn | undefined;
  if (columns.length) {
    const actual = columns[0], maximum = tableAutoIncrementMaximum(actual.type.raw);
    if (!maximum || actual.nullable !== false || actual.attributes.some(attribute => ['generated', 'opaque', 'visibility'].includes(attribute.kind))) throw Error('自增列不是已证明的普通非空整数，未知或生成/隐藏属性不推断');
    column = { name: actual.name, type: actual.type.raw, maximum };
    if (parsed.value !== undefined) validateTableAutoIncrement(parsed.value, maximum);
  }
  let sourceWithoutCounter = source;
  if (parsed.value !== undefined) {
    const tokens = tableDefinitionTokens(document.tail.raw, context);
    let cursor = 1, start: number | undefined, end: number | undefined;
    while (cursor < tokens.length) {
      const option = cursor; let key = tokens[cursor++].value.toUpperCase(); if (key === ';') break;
      if (key === 'DEFAULT') key = tokens[cursor++].value.toUpperCase();
      if (key === 'CHARACTER') { cursor++; key = 'CHARSET'; }
      if (tokens[cursor]?.value === '=') cursor++;
      const value = tokens[cursor++];
      if (key === 'AUTO_INCREMENT') {
        if (tokens[option].kind !== 'word' || tokens[option].value.toUpperCase() !== 'AUTO_INCREMENT' || start !== undefined || value?.kind !== 'number' || value.value !== parsed.value) throw Error('顶层计数范围或数值无法唯一证明');
        start = document.tail.range.start + tokens[option].start; end = document.tail.range.start + value.end;
      }
    }
    if (start === undefined || end === undefined || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < document.tail.range.start || end <= start || end > source.length) throw Error('顶层计数范围缺失，不能比较定义');
    // 仅移除该选项相邻的一个普通空格；不规范化其它空白、大小写、引号或文字量。
    if (source[start - 1] === ' ') start--;
    sourceWithoutCounter = source.slice(0, start) + source.slice(end);
  }
  return { sourceWithoutCounter, comparison: renameDefinitionBody({ source: sourceWithoutCounter, context }), ...(column ? { column } : {}), ...(parsed.value !== undefined ? { declaredValue: parsed.value } : {}) };
}
/** 目录必须提供精确字符串；SHOW CREATE没有表尾选项时不补1，真实计数仍须单独读取。 */
export function tableCopyStructureObservedCounter(value: unknown, definition: TableCopyStructureCounterDefinition): string | null {
  if (!definition.column) { if (value !== null) throw Error('无自增列但目录提供计数，不能推断'); return null; }
  const observed = validateTableAutoIncrement(value, definition.column.maximum);
  if (definition.declaredValue !== undefined && definition.declaredValue !== observed) throw Error('原定义与准确目录计数不同，可能有并发写入；未发送DDL');
  return observed;
}
/** MySQL8.4.11独立结构连接重读准确计数，不借自增修改任务要求ALTER，也不读取业务MAX。 */
export async function readTableCopyStructureCounter(context: StructureTaskContext, target: TableCopyStructureTarget, initial: TableCommentRead): Promise<{ read: TableCommentRead; plan: TableCopyStructureCounterPlan; policy: TableAutoIncrementPolicy }> {
  // 第二道版本门在任何SQL前拒绝准备态，调用方误放宽版本也不能把8.4的计数规则带到8.0。
  const profile = tableCopyStructureServerProfile(context.managed.status.dialect, context.managed.status.version);
  if (!profile.canWrite || profile.expectedNewCounter === null) throw Error(profile.readonlyReason);
  await structureTaskQuery(context, 'SET SESSION information_schema_stats_expiry = 0');
  const expiry = (await structureTaskQuery<{ expiry: string }[]>(context, 'SELECT CAST(@@SESSION.information_schema_stats_expiry AS CHAR) AS expiry')).rows;
  if (expiry.length !== 1 || expiry[0].expiry !== '0') throw Error('无法证明自增目录已绕过统计缓存，当前只读');
  const fresh = await readTableRename(context, target, undefined, 'verify');
  if (initial.identity !== fresh.identity || initial.tableId !== fresh.tableId) throw Error('准确计数重读期间源物理身份变化，当前只读');
  // 首次规范化前的模式仍须保留，不能由第二次读取掩盖隐藏定义的原模式。
  const read = { ...fresh, originalMode: initial.originalMode }, definition = tableCopyStructureCounterDefinition(read.source, read.context);
  const observed = tableCopyStructureObservedCounter(read.autoIncrement, definition);
  if (!definition.column || observed === null || definition.declaredValue === undefined && observed !== '1') throw Error('唯一自增列、准确计数或默认1省略形式未知，当前只读');
  const literal = (value: string) => `CONVERT(X'${Buffer.from(value).toString('hex')}' USING utf8mb4)`;
  const columns = (await structureTaskQuery<{ name: string; dataType: string; columnType: string; extra: string }[]>(context, `SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, EXTRA AS extra FROM information_schema.COLUMNS WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(${literal(target.database)} AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(${literal(target.table)} AS BINARY) ORDER BY ORDINAL_POSITION LIMIT 4097`)).rows;
  const document = parseTableColumnDefinition(read.source, read.context), auto = columns.filter(column => typeof column.extra === 'string' && /(?:^| )auto_increment(?: |$)/i.test(column.extra));
  // 仅规范目录类型的大小写/分隔空白用于对照；DDL比较投影仍保留其它原文，不作通用重写。
  const actual = auto[0], canonical = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  if (columns.length !== document.columns.length || columns.some((column, index) => column.name !== document.columns[index].name) || auto.length !== 1 || actual.name !== definition.column.name || typeof actual.columnType !== 'string' || typeof actual.dataType !== 'string' || actual.columnType.split(/[ (]/)[0].toLowerCase() !== actual.dataType.toLowerCase() || canonical(actual.columnType) !== canonical(definition.column.type) || tableAutoIncrementMaximum(actual.columnType) !== definition.column.maximum) throw Error('完整目录与自增列属性或类型不一致，当前只读');
  const policy = await readTableAutoIncrementPolicy(context);
  // Root固定8.4.11/Linux、步长与偏移1的三个隔离样本均为1；不外推其它运行策略。
  return { read, plan: { column: definition.column, sourceValue: observed, expectedNewValue: profile.expectedNewCounter }, policy };
}
