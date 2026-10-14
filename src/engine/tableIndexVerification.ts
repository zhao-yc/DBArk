import { sameStructureFragment } from './structureDefinition';
import { hasUnprovenBinaryDefault, tableColumnDefaultRisks } from '../shared/tableColumnPatches';
import type { IndexPlanResult, IndexPlanSnapshot, IndexDefinition, IndexDependencyInput } from '../shared/tableIndexPatches';
import type { IndexStructureRead } from './tableIndexRead';

type ReadyPlan = Extract<IndexPlanResult, { kind: 'ready' }>;
/** 属性顺序及索引展示顺序都不是语义；键部分顺序、名称、方向、前缀则必须精确保持。 */
function sameIndex(left: Readonly<IndexDefinition>, right: Readonly<IndexDefinition>): boolean {
  return left.kind === right.kind && left.name === right.name && left.method === right.method && left.comment === right.comment && left.keyParts.length === right.keyParts.length && left.keyParts.every((part, position) => {
    const other = right.keyParts[position]; return part.columnRef === other.columnRef && part.direction === other.direction && part.prefixLength === other.prefixLength;
  });
}
/** 候选支持键会随新增索引合法变化；外键身份、目标列及已证规则必须仍相同。 */
function dependencies(input: IndexDependencyInput): string {
  const foreignKeys = input.foreignKeys.map(foreignKey => ({ ref: foreignKey.foreignKeyRef, direction: foreignKey.direction, columns: foreignKey.targetColumnRefs,
    support: foreignKey.support.kind === 'known' ? { kind: 'known', rule: foreignKey.support.rule } : { kind: 'unknown' } })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({ foreignKeys, incoming: input.incomingCoverage, outgoing: input.outgoingComplete, autoIncrement: [...input.autoIncrementColumnRefs].sort(), partition: input.partition });
}

/** 独立后核验：原列、外键/CHECK、表尾和全部最终索引均有证据才报告完整核验。 */
export function verifyIndexAfter(before: IndexStructureRead, plan: ReadyPlan, after: IndexStructureRead): boolean {
  if (!plan.verification.definitionCanBeFullyVerified || before.identity !== after.identity || before.normalizedMode !== after.normalizedMode || !after.options || JSON.stringify(before.options) !== JSON.stringify(after.options)) return false;
  const original = before.model, current = after.model;
  if (tableColumnDefaultRisks(current.definition).length || current.definition.columns.some(hasUnprovenBinaryDefault)) return false;
  if (JSON.stringify(before.nullability) !== JSON.stringify(after.nullability) || JSON.stringify(before.encodings) !== JSON.stringify(after.encodings) || JSON.stringify(before.tableEncoding) !== JSON.stringify(after.tableEncoding)) return false;
  if (original.definition.columns.length !== current.definition.columns.length || original.definition.columns.some((column, index) => column.name !== current.definition.columns[index].name || !sameStructureFragment(column.raw, current.definition.columns[index].raw, current.definition.context))) return false;
  const constraints = (model: IndexPlanSnapshot) => model.indexDocument.otherConstraintRanges.map(range => model.definition.source.slice(range.start, range.end));
  const previousConstraints = constraints(original), nextConstraints = constraints(current);
  if (previousConstraints.length !== nextConstraints.length || previousConstraints.some((value, position) => !sameStructureFragment(value, nextConstraints[position], current.definition.context))) return false;
  if (!sameStructureFragment(original.definition.tail.raw, current.definition.tail.raw, current.definition.context) || dependencies(original.dependencies) !== dependencies(current.dependencies)) return false;
  if (plan.finalIndexes.length !== current.indexes.size) return false;
  const seen = new Set<string>();
  for (const final of plan.finalIndexes) {
    const previous = final.sourceIndexRef ? original.indexes.get(final.sourceIndexRef) : undefined;
    const name = final.definition?.name ?? previous?.parsed.name;
    const matches = [...current.indexes].filter(([, index]) => index.parsed.name === name);
    if (matches.length !== 1 || seen.has(matches[0][0])) return false;
    seen.add(matches[0][0]); const actual = matches[0][1];
    if (final.definition) {
      if (!actual.definition || !sameIndex(final.definition, actual.definition)) return false;
      const untouched = final.sourceIndexRef !== undefined && plan.verification.unchangedIndexRefs.includes(final.sourceIndexRef);
      if (untouched ? !previous || actual.visible !== previous.visible || actual.generated !== previous.generated || !sameStructureFragment(previous.parsed.rawSql, actual.parsed.rawSql, current.definition.context) : actual.visible !== true || actual.generated !== false) return false;
    } else if (!previous || !sameStructureFragment(previous.parsed.rawSql, actual.parsed.rawSql, current.definition.context)) return false;
  }
  return true;
}
