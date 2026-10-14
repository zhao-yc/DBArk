import { sameStructureFragment } from './structureDefinition';
import { hasUnprovenBinaryDefault, tableColumnDefaultRisks } from '../shared/tableColumnPatches';
import { sameForeignKeyDefinition } from './tableForeignKeyPatchSql';
import type { ForeignKeyPlanResult, ForeignKeyPlanSnapshot, ForeignKeyTableSnapshot } from '../shared/tableForeignKeyPatches';

type ReadyPlan = Extract<ForeignKeyPlanResult, { kind: 'ready' }>;
/** 对象身份不由显示名或连接编号替代；父子同表只允许相同数据库和表名。 */
function sameTarget(left: ForeignKeyTableSnapshot, right: ForeignKeyTableSnapshot): boolean {
  return left.identity === right.identity && left.target.database === right.target.database && left.target.table === right.target.table;
}
/** 核对全部原索引，包含未知索引原片段；任何服务器隐式创建/删除/改名都不能伪成功。 */
function sameIndexes(before: ForeignKeyTableSnapshot, after: ForeignKeyTableSnapshot): boolean {
  if (before.indexes.size !== after.indexes.size) return false;
  const actual = new Map([...after.indexes.values()].map(index => [index.parsed.name, index]));
  if (actual.size !== after.indexes.size) return false;
  for (const old of before.indexes.values()) {
    const next = actual.get(old.parsed.name);
    if (!next || next.visible !== old.visible || next.generated !== old.generated || !sameStructureFragment(old.parsed.rawSql, next.parsed.rawSql, after.definition.context)) return false;
    if (!!next.definition !== !!old.definition) return false;
    if (old.definition && next.definition) {
      const a = old.definition, b = next.definition;
      if (a.kind !== b.kind || a.name !== b.name || a.method !== b.method || a.comment !== b.comment || a.keyParts.length !== b.keyParts.length || a.keyParts.some((part, i) => part.columnRef !== b.keyParts[i].columnRef || part.direction !== b.keyParts[i].direction || part.prefixLength !== b.keyParts[i].prefixLength)) return false;
    }
  }
  return true;
}
/** 除计划内外键外，所有列、索引和表尾都必须有完整的保留证明。 */
function sameTableBody(before: ForeignKeyTableSnapshot, after: ForeignKeyTableSnapshot): boolean {
  if (!sameTarget(before, after) || !before.catalogComplete || !after.catalogComplete || before.metadataDigest !== after.metadataDigest || before.partition !== after.partition || before.engine !== after.engine || before.rowFormat !== after.rowFormat || before.pageSize !== after.pageSize || before.isTemporary !== after.isTemporary) return false;
  const a = before.definition, b = after.definition;
  if (a.context.dialect !== b.context.dialect || a.context.mode.ansiQuotes !== b.context.mode.ansiQuotes || a.context.mode.noBackslashEscapes !== b.context.mode.noBackslashEscapes) return false;
  if (a.columns.length !== b.columns.length || a.columns.some((column, i) => column.name !== b.columns[i].name || !sameStructureFragment(column.raw, b.columns[i].raw, b.context))) return false;
  return sameIndexes(before, after) && sameStructureFragment(a.tail.raw, b.tail.raw, b.context);
}
/** 保留 CHECK 和所有非外键约束；列表显示顺序不是语义，但原片段必须逐项可配对。 */
function sameOtherConstraints(before: ForeignKeyPlanSnapshot, after: ForeignKeyPlanSnapshot): boolean {
  const values = (snapshot: ForeignKeyPlanSnapshot) => snapshot.child.definition.items.filter(item => item.kind === 'constraint' && ![...snapshot.foreignKeys.values()].some(foreignKey => foreignKey.range.start === item.range.start && foreignKey.range.end === item.range.end)).map(item => item.raw);
  const old = values(before), remaining = values(after);
  if (old.length !== remaining.length) return false;
  for (const source of old) {
    const index = remaining.findIndex(actual => sameStructureFragment(source, actual, after.child.definition.context));
    if (index < 0) return false; remaining.splice(index, 1);
  }
  return true;
}

/** 独立核对预期最终约束集合；收到 OK 与完整核验分离，不推断失败或取消已撤销 DDL。 */
export function verifyForeignKeyAfter(before: ForeignKeyPlanSnapshot, plan: ReadyPlan, after: ForeignKeyPlanSnapshot): boolean {
  try {
    if (!plan.verification.definitionCanBeFullyVerified || !before.outgoingComplete || !after.outgoingComplete || before.incomingCoverage.kind !== 'complete' || after.incomingCoverage.kind !== 'complete' || before.externalIncomingDigest !== after.externalIncomingDigest) return false;
    // 独立重算旧、新父表范围；计划标志或过滤后的读取列表不能掩盖被删除/替换旧约束的缺失父表。
    const requiredParentRefs = new Set([
      ...[...before.foreignKeys.values()].flatMap(value => value.definition ? [value.definition.parentRef] : []),
      ...plan.finalForeignKeys.flatMap(value => value.definition ? [value.definition.parentRef] : []),
    ]);
    if ([...requiredParentRefs].some(ref => !before.parents.has(ref) || !plan.verification.parentRefs.includes(ref))) return false;
    if (tableColumnDefaultRisks(after.child.definition).length || after.child.definition.columns.some(hasUnprovenBinaryDefault) || !sameTableBody(before.child, after.child) || !sameOtherConstraints(before, after)) return false;
    if (plan.finalForeignKeys.length !== after.foreignKeys.size) return false;
    const named = new Map([...after.foreignKeys.values()].map(value => [value.name, value]));
    if (named.size !== after.foreignKeys.size) return false;
    for (const expected of plan.finalForeignKeys) {
      const previous = expected.sourceForeignKeyRef ? before.foreignKeys.get(expected.sourceForeignKeyRef) : undefined;
      const name = expected.definition?.name ?? previous?.name, actual = name === undefined ? undefined : named.get(name);
      if (!actual || after.child.definition.source.slice(actual.range.start, actual.range.end) !== actual.rawSql) return false;
      if (expected.definition) {
        if (!actual.definition || !sameForeignKeyDefinition(expected.definition, actual.definition)) return false;
        const unchanged = expected.sourceForeignKeyRef !== undefined && plan.verification.unchangedForeignKeyRefs.includes(expected.sourceForeignKeyRef);
        if (!unchanged && actual.opaqueReasons.length) return false;
      }
      if (!expected.definition || (expected.sourceForeignKeyRef !== undefined && plan.verification.unchangedForeignKeyRefs.includes(expected.sourceForeignKeyRef))) {
        if (!previous || !sameStructureFragment(previous.rawSql, actual.rawSql, after.child.definition.context)) return false;
      }
    }
    for (const ref of plan.verification.parentRefs) {
      const previous = before.parents.get(ref), actual = after.parents.get(ref);
      if (!previous || !actual || !sameTarget(previous, actual)) return false;
      if (sameTarget(previous, before.child)) {
        // self 的父表就是本次子表，不能错误要求整个 CREATE TABLE 原文保持不变。
        if (!sameTableBody(actual, after.child) || actual.definition.source !== after.child.definition.source) return false;
      } else if (!sameTableBody(previous, actual) || !sameStructureFragment(previous.definition.source, actual.definition.source, actual.definition.context)) return false;
    }
    return true;
  } catch { return false; }
}
