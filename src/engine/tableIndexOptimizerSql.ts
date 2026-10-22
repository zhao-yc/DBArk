import { parseTableColumnDefinition, tableDefinitionTokens } from './tableColumnDefinition';
import { editableIndexDefinition, readTableIndexDefinition } from './tableIndexDefinition';
import { identifier, qualified, SqlScriptScanner } from './sql';
import { sameStructureFragment } from './structureDefinition';
import type { IndexStructureRead } from './tableIndexRead';
import type { IndexDefinition, IndexOperationAccess } from '../shared/tableIndexPatches';
import type { TableIndexOptimizerFacts } from './tableIndexOptimizerRead';
import { indexOptimizerMessages as text } from '../shared/tableIndexOptimizer';

export interface OptimizerIndexDefinition { indexRef: string; name: string; visible: boolean; definition: Readonly<IndexDefinition>; rawWithoutVisibility: string; }
export interface TableIndexOptimizerPlan { indexRef: string; name: string; visible: boolean; sql: string; }

/** 精确版本门独立于旧索引重建能力；不能以有IS_VISIBLE目录列推断DDL已获验证。 */
export function indexOptimizerVersionSupported(dialect: 'mysql' | 'mariadb', version: string): boolean {
  return (dialect === 'mysql' ? /^(?:8\.0\.46|8\.4\.11)(?:$|-)/ : /^(?:10\.11\.19|11\.4\.13)(?:$|-)/).test(version) && !(dialect === 'mysql' && /mariadb/i.test(version));
}

/** 仅识别完整已知的原生选项，保留长度和全部其它字符；通用解析器仍将旧隐藏键视为opaque。 */
export function optimizerIndexDefinitions(read: IndexStructureRead): Map<string, OptimizerIndexDefinition> {
  const removals: { start: number; end: number }[] = [], visible = new Map<string, boolean>();
  for (const [ref, entry] of read.model.indexes) {
    const index = entry.parsed, tailStart = index.parts.at(-1)?.range.end;
    if (tailStart === undefined) continue;
    let state = true, declarations = 0;
    const tokens = tableDefinitionTokens(index.rawSql, read.context);
    for (let cursor = 0; cursor < tokens.length; cursor++) {
      const token = tokens[cursor]; if (token.start + index.range.start < tailStart) continue;
      const word = token.kind === 'word' ? token.value.toUpperCase() : '';
      let value: boolean | undefined, end = token.end;
      if (read.context.dialect === 'mysql' && ['VISIBLE', 'INVISIBLE'].includes(word)) value = word === 'VISIBLE';
      if (read.context.dialect === 'mariadb' && word === 'IGNORED') value = false;
      if (read.context.dialect === 'mariadb' && word === 'NOT' && tokens[cursor + 1]?.kind === 'word' && tokens[cursor + 1].value.toUpperCase() === 'IGNORED') { value = true; end = tokens[++cursor].end; }
      if (token.kind === 'executable') {
        const option = read.context.dialect === 'mysql' ? /^\/\*!80000\s+(VISIBLE|INVISIBLE)\s*\*\/$/i.exec(token.value) : /^\/\*M!100600\s+(IGNORED|NOT\s+IGNORED)\s*\*\/$/i.exec(token.value);
        if (option) value = read.context.dialect === 'mysql' ? option[1].toUpperCase() === 'VISIBLE' : /^NOT\s/i.test(option[1]);
      }
      if (value === undefined) continue;
      if (++declarations > 1) throw Error('索引优化器属性重复或矛盾');
      state = value; removals.push({ start: index.range.start + token.start, end: index.range.start + end });
    }
    visible.set(ref, state);
  }
  const sorted = removals.sort((left, right) => left.start - right.start), pieces: string[] = []; let previous = 0;
  for (const range of sorted) { if (range.start < previous) throw Error('索引优化器选项范围重叠'); pieces.push(read.source.slice(previous, range.start), ' '.repeat(range.end - range.start)); previous = range.end; }
  pieces.push(read.source.slice(previous));
  const plain = parseTableColumnDefinition(pieces.join(''), read.context), parsedIndexes = readTableIndexDefinition(plain), result = new Map<string, OptimizerIndexDefinition>();
  for (const [ref, old] of read.model.indexes) {
    const candidates = parsedIndexes.indexes.filter(index => index.range.start === old.parsed.range.start && index.name === old.parsed.name);
    if (candidates.length !== 1) throw Error('索引优化器原片段无法唯一证明');
    const parsed = candidates[0], definition = editableIndexDefinition(parsed, read.model.columns);
    if (!definition || !['ordinary', 'unique', 'primary'].includes(definition.kind) || definition.method !== 'BTREE' || definition.keyParts.some(part => { const column = read.model.columns.get(part.columnRef); return !column || column.generated || column.hidden; })) continue;
    result.set(ref, { indexRef: ref, name: parsed.name, visible: visible.get(ref) ?? true, definition, rawWithoutVisibility: parsed.rawSql });
  }
  return result;
}

/** 恢复和禁用分别裁决，不将“已隐藏”自身误认为无法恢复的未知定义。 */
function assertOptimizerTarget(read: IndexStructureRead, facts: TableIndexOptimizerFacts, ref: string, visible: boolean): OptimizerIndexDefinition {
  if (!indexOptimizerVersionSupported(read.context.dialect, read.serverVersion)) throw Error(text.unsupported);
  if (facts.physical.identity !== read.identity || facts.physical.dialect !== read.context.dialect || facts.physical.version !== read.serverVersion || facts.physical.nativeName !== read.options?.database + '/' + read.model.definition.table) throw Error(text.changed);
  const index = facts.indexes.find(value => value.indexRef === ref), old = read.model.indexes.get(ref);
  if (!read.options || !index || !old || typeof old.visible !== 'boolean' || old.visible !== index.visible) throw Error(text.readonly);
  if (index.definition.kind === 'primary' || facts.physical.clusteredIndexName === index.name) throw Error(text.primary);
  if (index.visible === visible) throw Error('索引优化器参与状态没有实际变化');
  if (!visible) {
    // 角色是读取器证明的实际clustered索引，不把所有无PK唯一索引一律封禁。
    if (!facts.physical.clusteredIndexName) throw Error('实际隐式聚簇索引角色尚未证明，不能禁用候选索引');
    // 已验原生属性不解除FK/自增支持，也不改变唯一约束；不能套用DROP的支持键删除判定。
  }
  return index;
}
export function tableIndexOptimizerAccess(read: IndexStructureRead, facts: TableIndexOptimizerFacts | undefined, ref: string, unavailableReason: string = text.unavailable): IndexOperationAccess {
  try { if (!facts) throw Error(unavailableReason); const index = facts.indexes.find(value => value.indexRef === ref); if (!index) throw Error(text.readonly); assertOptimizerTarget(read, facts, ref, !index.visible); return { allowed: true, reasons: [] }; }
  catch (error) { return { allowed: false, reasons: [error instanceof Error ? error.message : text.unavailable] }; }
}
/** 仅原生属性ALTER，绝不删除/重建索引，也不引入客户端可提交的SQL片段。 */
export function planTableIndexOptimizer(read: IndexStructureRead, facts: TableIndexOptimizerFacts, ref: string, visible: boolean, database: string): TableIndexOptimizerPlan {
  if (typeof visible !== 'boolean') throw Error('索引优化器参与状态必须为明确布尔值');
  if (database !== read.options?.database) throw Error('索引优化器目标数据库与真实快照不一致');
  const index = assertOptimizerTarget(read, facts, ref, visible);
  const option = read.context.dialect === 'mysql' ? visible ? 'VISIBLE' : 'INVISIBLE' : visible ? 'NOT IGNORED' : 'IGNORED';
  const sql = `ALTER TABLE ${qualified(database, read.model.definition.table)} ALTER INDEX ${identifier(index.name)} ${option}, ALGORITHM=INPLACE, LOCK=NONE;`;
  if (Buffer.byteLength(sql) > 4 * 1024 * 1024 || new SqlScriptScanner(read.context.mode.noBackslashEscapes, read.context.mode.ansiQuotes).push(sql, true).length !== 1) throw Error('索引优化器计划必须为预算内单条ALTER');
  return { indexRef: ref, name: index.name, visible, sql };
}

/** 原生属性改变不应更换表/索引实体或重写列、关系、表尾；只豁免目标实际可见性。 */
export function verifyTableIndexOptimizer(before: IndexStructureRead, beforeFacts: TableIndexOptimizerFacts, after: IndexStructureRead, afterFacts: TableIndexOptimizerFacts, plan: TableIndexOptimizerPlan): boolean {
  if (before.identity !== after.identity || before.normalizedMode !== after.normalizedMode || JSON.stringify(beforeFacts.physical) !== JSON.stringify(afterFacts.physical) || JSON.stringify(before.options) !== JSON.stringify(after.options) || JSON.stringify([before.nullability, before.encodings, before.tableEncoding, before.columnExtras]) !== JSON.stringify([after.nullability, after.encodings, after.tableEncoding, after.columnExtras])) return false;
  const original = before.model.definition, current = after.model.definition;
  if (original.columns.length !== current.columns.length || original.columns.some((column, index) => column.raw !== current.columns[index].raw) || original.tail.raw !== current.tail.raw) return false;
  const constraints = (read: IndexStructureRead) => read.model.indexDocument.otherConstraintRanges.map(range => read.source.slice(range.start, range.end));
  const left = constraints(before), right = constraints(after);
  if (left.length !== right.length || left.some((value, index) => value !== right[index]) || before.model.indexes.size !== after.model.indexes.size || JSON.stringify(before.model.indexDocument.indexes.map(index => index.name)) !== JSON.stringify(after.model.indexDocument.indexes.map(index => index.name))) return false;
  const oldIndexes = beforeFacts.indexes, newIndexes = afterFacts.indexes;
  if (oldIndexes.length !== newIndexes.length || JSON.stringify(beforeFacts.nativeIndexes) !== JSON.stringify(afterFacts.nativeIndexes)) return false;
  for (const [ref, old] of before.model.indexes) {
    const actual = after.model.indexes.get(ref); if (!actual) return false;
    if (ref !== plan.indexRef) { if (old.visible !== actual.visible || old.parsed.rawSql !== actual.parsed.rawSql) return false; continue; }
    const previous = oldIndexes.find(index => index.indexRef === ref), next = newIndexes.find(index => index.indexRef === ref);
    if (!previous || !next || next.visible !== plan.visible || JSON.stringify(previous.definition) !== JSON.stringify(next.definition) || !sameStructureFragment(previous.rawWithoutVisibility, next.rawWithoutVisibility, after.context)) return false;
  }
  // 候选支持列表可能因优化器属性合法变化；真实外键身份、有序列与完整范围必须不变。
  const relations = (read: IndexStructureRead) => ({ incoming: read.model.dependencies.incomingCoverage, outgoing: read.model.dependencies.outgoingComplete, foreignKeys: read.model.dependencies.foreignKeys.map(value => ({ foreignKeyRef: value.foreignKeyRef, direction: value.direction, targetColumnRefs: value.targetColumnRefs })), auto: read.model.dependencies.autoIncrementColumnRefs, partition: read.model.dependencies.partition });
  return JSON.stringify(relations(before)) === JSON.stringify(relations(after));
}
