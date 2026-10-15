import type {
  ForeignKeyDependency, IndexDefinition, IndexDependencyDecision, IndexPlanIssue,
  IndexPlanOperation, IndexPlanOptions, IndexPlanSnapshot, PlannedIndex, TrustedIndexDefinition,
} from '../shared/tableIndexPatches';

/** 定义比较只服务于可信计划一致性，不解析 SQL，也不以名称猜测旧引用。 */
function sameDefinition(left: Readonly<IndexDefinition>, right: Readonly<IndexDefinition>, ignoreName = false): boolean {
  return (ignoreName || left.name === right.name) && left.kind === right.kind && left.method === right.method
    && left.comment === right.comment && left.keyParts.length === right.keyParts.length
    && left.keyParts.every((part, index) => {
      const other = right.keyParts[index];
      return part.columnRef === other.columnRef && part.prefixLength === other.prefixLength && part.direction === other.direction;
    });
}

/** 只有已知完整列的有序前导部分可以支撑外键；前缀、未知定义均不作证明。 */
function leadingFull(definition: Readonly<IndexDefinition> | undefined, refs: readonly string[]): boolean {
  return !!definition && definition.method === 'BTREE' && refs.length > 0 && definition.keyParts.length >= refs.length
    && refs.every((ref, index) => definition.keyParts[index].columnRef === ref && definition.keyParts[index].prefixLength === undefined);
}

/** 父键规则来自可信依赖读取，不根据当前方言字符串放宽唯一性或列顺序。 */
function supportsForeignKey(definition: Readonly<IndexDefinition> | undefined, dependency: ForeignKeyDependency): boolean {
  if (dependency.support.kind !== 'known' || !leadingFull(definition, dependency.targetColumnRefs)) return false;
  return dependency.support.rule !== 'parent-exact-unique'
    || (['primary', 'unique'].includes(definition!.kind) && definition!.keyParts.length === dependency.targetColumnRefs.length);
}

/** 未知入向依赖只排除明确不能支撑外键的索引，不把不透明旧键当作没有依赖。 */
function possiblySupportsForeignKey(index: TrustedIndexDefinition): boolean {
  if (index.definition) return index.definition.method === 'BTREE' && index.definition.keyParts.length > 0 && index.definition.keyParts[0].prefixLength === undefined;
  return index.parsed.kind !== 'fulltext' && index.parsed.kind !== 'spatial';
}

/** 不透明旧键不能被当作已证普通索引，分区选择保护须按潜在唯一键处理。 */
function possiblyUnique(index: TrustedIndexDefinition): boolean {
  const kind = index.definition?.kind ?? index.parsed.kind;
  return kind === 'primary' || kind === 'unique' || kind === 'opaque';
}

/** 纯依赖判定：输入必须来自可信快照和纯计划器，输出只含原因及引用，不携带 SQL/行值。 */
export function planIndexDependencies(
  snapshot: IndexPlanSnapshot,
  finalIndexes: readonly PlannedIndex[],
  operations: readonly IndexPlanOperation[],
  options: IndexPlanOptions,
): IndexDependencyDecision {
  const blockers: IndexPlanIssue[] = [], warnings: IndexPlanIssue[] = [], seenIssues = new Set<string>();
  /** 保留精确引用且去重；不把服务端原因原文、SQL 或未知名称拼进消息。 */
  const issue = (level: 'blocker' | 'warning', code: string, message: string, indexRefs: readonly string[] = [], columnRefs: readonly string[] = [], foreignKeyRefs: readonly string[] = []) => {
    const value: IndexPlanIssue = { code, message, indexRefs: [...new Set(indexRefs)], columnRefs: [...new Set(columnRefs)], foreignKeyRefs: [...new Set(foreignKeyRefs)] };
    const key = JSON.stringify([level, value]);
    if (!seenIssues.has(key)) { seenIssues.add(key); (level === 'blocker' ? blockers : warnings).push(value); }
  };
  const finish = (): IndexDependencyDecision => ({ allowed: blockers.length === 0, blockers, warnings });
  if (options.engine !== 'InnoDB' || options.checks.foreignKeyChecks !== 1 || options.checks.uniqueChecks !== 1) {
    issue('blocker', 'checks-unproven', '必须确认 InnoDB 的外键检查和唯一性检查均为 1。');
  }

  const finalByRef = new Map<string, PlannedIndex>(), finalByClient = new Map<string, PlannedIndex>();
  const operationByRef = new Map<string, IndexPlanOperation>(), operationByClient = new Map<string, IndexPlanOperation>();
  /** 先核计划闭合性，不能遗漏旧键或把未声明的替换伪装成安全新增/改名。 */
  for (const final of finalIndexes) {
    if ((final.sourceIndexRef === undefined) === (final.clientKey === undefined)) { issue('blocker', 'invalid-final-reference', '最终索引必须具有唯一的旧引用或新增引用。'); continue; }
    if (final.sourceIndexRef !== undefined) {
      if (!snapshot.indexes.has(final.sourceIndexRef) || finalByRef.has(final.sourceIndexRef)) issue('blocker', 'invalid-final-reference', '最终索引旧引用不存在或重复。', [final.sourceIndexRef]);
      finalByRef.set(final.sourceIndexRef, final);
    } else {
      if (finalByClient.has(final.clientKey!) || !final.definition) issue('blocker', 'invalid-final-reference', '新增索引引用重复或缺少可信最终定义。');
      finalByClient.set(final.clientKey!, final);
    }
    for (const part of final.definition?.keyParts ?? []) if (!snapshot.columns.has(part.columnRef)) issue('blocker', 'unknown-column-reference', '最终索引引用了快照外字段。', final.sourceIndexRef ? [final.sourceIndexRef] : [], [part.columnRef]);
  }
  for (const operation of operations) {
    if (operation.strategy === 'add') {
      if (operation.sourceIndexRef !== undefined || operation.clientKey === undefined || operationByClient.has(operation.clientKey) || !finalByClient.has(operation.clientKey)) issue('blocker', 'invalid-operation-reference', '新增操作与最终索引引用不一致。');
      if (operation.clientKey !== undefined) operationByClient.set(operation.clientKey, operation);
    } else {
      const ref = operation.sourceIndexRef;
      if (ref === undefined || operation.clientKey !== undefined || !snapshot.indexes.has(ref) || operationByRef.has(ref)) issue('blocker', 'invalid-operation-reference', '旧索引操作引用不存在或重复。', ref === undefined ? [] : [ref]);
      if (ref !== undefined) operationByRef.set(ref, operation);
    }
  }
  for (const [ref, original] of snapshot.indexes) {
    const final = finalByRef.get(ref), operation = operationByRef.get(ref);
    if (operation && (!original.definition || original.parsed.opaqueReasons.length || original.visible !== true || original.generated !== false)) issue('blocker', 'readonly-index-operation', '该旧索引的完整定义、可见性或生成属性未证明，首批只保留而不修改。', [ref]);
    if (!final) {
      if (operation?.strategy !== 'drop') issue('blocker', 'undeclared-index-removal', '最终集合遗漏旧索引，必须明确声明删除。', [ref]);
      continue;
    }
    if (operation?.strategy === 'drop') issue('blocker', 'invalid-operation-reference', '已删除的旧索引仍在最终集合。', [ref]);
    if (operation?.strategy === 'replace' && !final.definition) issue('blocker', 'unknown-final-definition', '替换后的索引缺少可信完整定义。', [ref]);
    if (operation?.strategy === 'rename' && (!original.definition || !final.definition || !sameDefinition(original.definition, final.definition, true))) issue('blocker', 'rename-changes-definition', '受控改名只能改变名称，不能同时修改或猜测未知定义。', [ref]);
    if (!operation && final.definition && (!original.definition || !sameDefinition(original.definition, final.definition))) issue('blocker', 'undeclared-index-change', '最终定义改变但没有相应旧索引操作。', [ref]);
  }
  for (const clientKey of finalByClient.keys()) if (!operationByClient.has(clientKey)) issue('blocker', 'undeclared-index-addition', '最终集合出现未声明的新增索引。');
  if (blockers.length) return finish();

  const dependencies = snapshot.dependencies;
  const destructive = operations.filter(operation => operation.strategy === 'drop' || operation.strategy === 'replace');
  const creations = operations.filter(operation => operation.strategy === 'add' || operation.strategy === 'replace').map(operation => ({ operation, final: operation.sourceIndexRef === undefined ? finalByClient.get(operation.clientKey!)! : finalByRef.get(operation.sourceIndexRef)! }));
  const resolve = (final: PlannedIndex) => final.definition ?? (final.sourceIndexRef === undefined ? undefined : snapshot.indexes.get(final.sourceIndexRef)?.definition);
  const finalDefinitions = finalIndexes.map(resolve);
  /** 只有主键/唯一键集合变化可能改变隐式选择；已证明纯改名不改变键定义。 */
  const changesUniqueSelection = (operation: IndexPlanOperation): boolean => {
    if (operation.strategy === 'rename') return false;
    const old = operation.sourceIndexRef === undefined ? undefined : snapshot.indexes.get(operation.sourceIndexRef);
    const final = operation.strategy === 'drop' ? undefined : operation.sourceIndexRef === undefined ? finalByClient.get(operation.clientKey!) : finalByRef.get(operation.sourceIndexRef);
    return !!((old && possiblyUnique(old)) || (final && ['primary', 'unique'].includes(resolve(final)?.kind ?? '')));
  };

  if (dependencies.incomingCoverage.kind !== 'complete' || !dependencies.outgoingComplete) {
    for (const operation of destructive) {
      const ref = operation.sourceIndexRef!, original = snapshot.indexes.get(ref)!;
      if (possiblySupportsForeignKey(original)) issue('blocker', 'foreign-coverage-incomplete', '外键目录完整性未证明，不能删除或重建可能支撑依赖的旧索引。', [ref]);
    }
    issue('warning', 'foreign-coverage-partial', '外键目录尚不完整；仅允许能够独立证明不破坏既有依赖的操作。');
  }

  for (const foreignKey of dependencies.foreignKeys) {
    const refs = foreignKey.targetColumnRefs, fkRefs = [foreignKey.foreignKeyRef];
    if (!refs.length || refs.some(ref => !snapshot.columns.has(ref))) { issue('blocker', 'foreign-columns-unproven', '外键关联字段无法与可信快照精确对应。', [], refs, fkRefs); continue; }
    if (foreignKey.support.kind === 'known') {
      if (!foreignKey.support.candidateIndexRefs.length || foreignKey.support.candidateIndexRefs.some(ref => !snapshot.indexes.has(ref))) issue('blocker', 'foreign-support-unproven', '外键支持索引引用无法与可信快照精确对应。', foreignKey.support.candidateIndexRefs, refs, fkRefs);
      for (const operation of destructive) if (foreignKey.support.candidateIndexRefs.includes(operation.sourceIndexRef!)) issue('blocker', 'foreign-bound-index-rebuild', '该旧索引已被外键依赖；尚未证明同条删除重建的绑定行为，不能用等价新键替代。', [operation.sourceIndexRef!], refs, fkRefs);
      if (!finalDefinitions.some(definition => supportsForeignKey(definition, foreignKey))) issue('blocker', 'foreign-final-support-missing', '最终集合没有可证明符合顺序、完整列及可信父键规则的外键支持索引。', foreignKey.support.candidateIndexRefs, refs, fkRefs);
    } else {
      for (const operation of destructive) {
        const original = snapshot.indexes.get(operation.sourceIndexRef!)!;
        if ((!original.definition && possiblySupportsForeignKey(original)) || leadingFull(original.definition, refs)) issue('blocker', 'foreign-support-unknown', '外键支持规则尚未证明，不能删除或重建可能关联的旧索引。', [operation.sourceIndexRef!], refs, fkRefs);
      }
      issue('warning', 'foreign-support-partial', '存在支持规则未证明的外键，本次不会将未知定义推断为可靠支持键。', [], refs, fkRefs);
    }
  }

  for (const columnRef of dependencies.autoIncrementColumnRefs) {
    if (!snapshot.columns.has(columnRef) || !finalDefinitions.some(definition => leadingFull(definition, [columnRef]))) issue('blocker', 'auto-increment-support-missing', '最终集合必须保留以自增字段为首个完整列的已知索引；不会自动补键。', [], [columnRef]);
  }

  for (const hidden of dependencies.hiddenDependencies) {
    if (hidden.indexRefs.some(ref => !snapshot.indexes.has(ref))) issue('blocker', 'hidden-reference-unproven', '隐藏依赖引用未与当前索引快照对应，不能据此排除影响。', hidden.indexRefs);
    // 空引用表示未证的隐式聚簇/表级选择依赖，保护主键和唯一键选择，不封禁无关普通键。
    // 具体不透明、隐藏或生成键必须提供精确引用，不能借空数组扩张为任意名称依赖。
    if (!hidden.indexRefs.length && operations.some(changesUniqueSelection)) issue('blocker', 'table-dependency-unproven', '存在未证明的表级索引选择依赖，不能改变主键或唯一键集合。');
    for (const operation of operations) if (operation.sourceIndexRef !== undefined && hidden.indexRefs.includes(operation.sourceIndexRef)) issue('blocker', 'hidden-index-dependency', '该索引存在未解析依赖，不能删除、替换或改名。', [operation.sourceIndexRef]);
  }

  const partition = dependencies.partition;
  if (partition.kind === 'explicit') {
    for (const { operation, final } of creations) {
      const definition = resolve(final)!;
      if (!['primary', 'unique'].includes(definition.kind)) continue;
      // 首批分区唯一键要求所有 key part 都为完整列，避免未验证前缀参与分区唯一性。
      if (partition.requiredColumnRefs.some(ref => !snapshot.columns.has(ref)) || definition.keyParts.some(part => part.prefixLength !== undefined) || !partition.requiredColumnRefs.every(ref => definition.keyParts.some(part => part.columnRef === ref))) issue('blocker', 'partition-unique-columns', '分区新增或替换的唯一键必须包含全部可信分区字段，且不使用前缀。', operation.sourceIndexRef ? [operation.sourceIndexRef] : [], partition.requiredColumnRefs);
    }
  } else if (partition.kind !== 'none') {
    for (const operation of operations) {
      if (changesUniqueSelection(operation)) issue('blocker', 'partition-selection-unproven', '隐式或未知分区键选择尚未证明，不能改变可能影响选择的唯一键或主键。', operation.sourceIndexRef ? [operation.sourceIndexRef] : []);
    }
  }

  const outgoing = dependencies.foreignKeys.filter(foreignKey => foreignKey.direction === 'outgoing' || (foreignKey.direction === 'self' && (foreignKey.support.kind === 'unknown' || foreignKey.support.rule === 'child-leading-full')));
  const provenance = dependencies.automaticForeignKeyIndexProvenance;
  for (const { final } of creations) {
    const definition = resolve(final)!;
    if (!leadingFull(definition, [definition.keyParts[0]?.columnRef ?? ''])) continue;
    if (provenance.kind === 'known') {
      for (const ref of provenance.indexRefs) {
        const old = snapshot.indexes.get(ref);
        if (!old || !old.definition || leadingFull(definition, old.definition.keyParts.map(part => part.columnRef))) issue('blocker', 'automatic-index-removal-risk', '新增或重建可能使服务器自动删除既有外键索引；首批不接受这种未显式计划的变化。', [ref]);
      }
    } else {
      for (const foreignKey of outgoing) if (leadingFull(definition, foreignKey.targetColumnRefs)) issue('blocker', 'automatic-index-provenance-unknown', '新索引覆盖既有外键支持关系，但旧索引来源未证明，可能触发服务器自动删键。', foreignKey.support.kind === 'known' ? foreignKey.support.candidateIndexRefs : [], foreignKey.targetColumnRefs, [foreignKey.foreignKeyRef]);
      // 出向目录不完整时，只能按旧键的首个完整列排除明显不重叠的新增；不透明旧键无法排除。
      if (!dependencies.outgoingComplete) for (const [ref, old] of snapshot.indexes) {
        if ((!old.definition && possiblySupportsForeignKey(old)) || (old.definition && leadingFull(definition, [old.definition.keyParts[0]?.columnRef ?? '']) && old.definition.keyParts[0]?.prefixLength === undefined)) issue('blocker', 'automatic-index-provenance-unknown', '出向依赖不完整且新索引可能覆盖旧支持键，无法排除服务器自动删键。', [ref]);
      }
    }
  }
  return finish();
}
