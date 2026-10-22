import { identifier, qualified, SqlScriptScanner, stringLiteral } from './sql';
import { editableIndexDefinition } from './tableIndexDefinition';
import { planIndexDependencies } from './tableIndexDependencies';
import { assertSpecialIndexDefinition, isSpecialIndexKind } from '../shared/specialIndexRules';
import { hasUnprovenBinaryDefault, tableColumnDefaultRiskMessage, tableColumnDefaultRisks } from '../shared/tableColumnPatches';
import { assertIndexDefinitionNames, indexDefinitionSchema, tableIndexPatchLimits, validateIndexPatches, type IndexDefinition, type IndexPlanIssue, type IndexPlanOperation, type IndexPlanOptions, type IndexPlanResult, type IndexPlanSnapshot, type PlannedIndex, type TrustedIndexDefinition } from '../shared/tableIndexPatches';

/** 计划错误只包含受控说明，不在异常中串入用户注释或完整 SQL。 */
function issue(code: string, message: string, indexRefs: readonly string[] = []): IndexPlanIssue { return { code, message, indexRefs, columnRefs: [], foreignKeyRefs: [] }; }
/** 对象属性插入顺序不是索引语义；尤其 optional 前缀在 IPC 克隆后可能换序。 */
function sameParts(left: readonly IndexDefinition['keyParts'][number][], right: readonly IndexDefinition['keyParts'][number][]): boolean {
  return left.length === right.length && left.every((part, index) => part.columnRef === right[index].columnRef && part.prefixLength === right[index].prefixLength && part.direction === right[index].direction);
}

/** 规范最终模型，防止未理解的原目录投影被当作受控可重建定义。 */
function checkedDefinition(definition: Readonly<IndexDefinition>, snapshot: IndexPlanSnapshot, options: IndexPlanOptions): IndexDefinition {
  const value = indexDefinitionSchema.parse(definition); assertIndexDefinitionNames(value);
  if ([...value.name].length > options.capabilities.maxIndexNameCharacters) throw new Error('索引名称超过服务器能力限制');
  if (new TextEncoder().encode(value.comment).length > options.capabilities.maxIndexCommentBytes) throw new Error('索引注释超过已证明字节预算');
  if (value.comment.includes('\0')) throw new Error('索引注释不能包含 NUL');
  if (value.keyParts.length > options.capabilities.maxKeyParts) throw new Error('索引键部分超过服务器能力限制');
  if (isSpecialIndexKind(value.kind)) {
    if (snapshot.dependencies.partition.kind !== 'none') throw new Error('特殊索引仅允许已独立确认无分区的表');
    if (value.kind === 'fulltext' && [...snapshot.columns.values()].some(column => column.name.toUpperCase() === 'FTS_DOC_ID')) throw new Error('已有显式全文文档ID，需人工核对其维护和生成索引来源');
    assertSpecialIndexDefinition(value, snapshot.columns, options.capabilities);
    return value;
  }
  let bytes = 0;
  for (const part of value.keyParts) {
    const column = snapshot.columns.get(part.columnRef);
    if (!column) throw new Error('索引字段引用不属于当前快照');
    if (column.generated || column.hidden) throw new Error('生成列或隐藏列索引首批只读');
    if (part.direction === 'desc' && !options.capabilities.descendingIndexes) throw new Error('当前服务器不能证明保留 DESC 方向');
    if (value.kind === 'primary' && (column.nullable || part.prefixLength !== undefined)) throw new Error('首批主键只接受已经 NOT NULL 的完整普通列');
    const type = column.dataType.toUpperCase(), large = /^(?:TINY|MEDIUM|LONG)?(?:TEXT|BLOB)$/.test(type);
    if (!/^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|BIT|CHAR|VARCHAR|BINARY|VARBINARY|DATE|YEAR|TIME|DATETIME|TIMESTAMP|ENUM|SET|(?:TINY|MEDIUM|LONG)?(?:TEXT|BLOB))$/.test(type)) throw new Error('字段类型的 BTREE 键能力尚未证明');
    let partBytes: number | undefined;
    if (part.prefixLength !== undefined) {
      // 仅开放已适配目录语义的字符/二进制字符串；版本、表能力门及真实长度/总字节预算仍逐项核对。
      if (!['CHAR', 'VARCHAR', 'BINARY', 'VARBINARY'].includes(type) && !large) throw new Error('该字段类型的前缀索引尚未验证');
      if (column.prefix.kind !== 'allowed') throw new Error('该字段不允许前缀或前缀能力未知');
      if (!Number.isSafeInteger(column.prefix.maxLength) || column.prefix.maxLength < 1) throw new Error('无法证明字段前缀最大长度');
      if (part.prefixLength > column.prefix.maxLength) throw new Error('索引前缀超过字段长度');
      const binary = ['BINARY', 'VARBINARY'].includes(type) || type.endsWith('BLOB');
      if (column.prefix.unit !== (binary ? 'bytes' : 'characters')) throw new Error('索引前缀单位与字段类型不一致');
      const unitBytes = binary ? 1 : column.charsetMaxBytes;
      if (!Number.isSafeInteger(unitBytes) || unitBytes! < 1) throw new Error('无法证明字符集最大字节数');
      partBytes = part.prefixLength * unitBytes!;
      // 有显式长度声明的满列前缀等价于整字段；必须由独立完整成本再次证明，不能放宽真正部分前缀。
      if (!large && part.prefixLength === column.prefix.maxLength) {
        if (!Number.isSafeInteger(column.fullKeyBytes) || column.fullKeyBytes! < 1 || partBytes !== column.fullKeyBytes) throw new Error('满列前缀与字段完整索引字节成本无法交叉证明');
        delete part.prefixLength;
      }
    } else {
      if (large) throw new Error('TEXT/BLOB 必须显式指定已验证前缀，不能接受服务器自动截短');
      partBytes = column.fullKeyBytes;
    }
    if (!Number.isSafeInteger(partBytes) || partBytes! < 1) throw new Error('无法证明字段完整索引字节预算');
    bytes += partBytes!;
    if (!Number.isSafeInteger(bytes) || bytes > options.capabilities.maxKeyBytes) throw new Error('索引超过当前页大小和行格式的最大键字节数，不能自动截短');
  }
  return value;
}

/** 同值属性仍可判定无修改；完整排序固定，避免对象键顺序形成伪差异。 */
function equalDefinition(left: Readonly<IndexDefinition>, right: Readonly<IndexDefinition>): boolean {
  return left.kind === right.kind && left.name === right.name && left.method === right.method && left.comment === right.comment && sameParts(left.keyParts, right.keyParts);
}

/** 只拼本次新增或替换的索引；未改注释和键部分优先使用已理解的原片段。 */
function addClause(value: Readonly<IndexDefinition>, snapshot: IndexPlanSnapshot, options: IndexPlanOptions, old?: TrustedIndexDefinition): string {
  if (isSpecialIndexKind(value.kind)) return `ADD ${value.kind === 'fulltext' ? 'FULLTEXT' : 'SPATIAL'} INDEX ${identifier(value.name)} (${value.keyParts.map(part => identifier(snapshot.columns.get(part.columnRef)!.name)).join(', ')}) COMMENT ${stringLiteral(value.comment, options.sqlMode.noBackslashEscapes)}`;
  const preserveParts = old?.definition && sameParts(old.definition.keyParts, value.keyParts);
  const parts = preserveParts ? old.parsed.parts.map(part => part.rawSql).join(', ') : value.keyParts.map(part => {
    const column = snapshot.columns.get(part.columnRef)!;
    return identifier(column.name) + (part.prefixLength === undefined ? '' : `(${part.prefixLength})`) + (part.direction === 'desc' ? ' DESC' : ' ASC');
  }).join(', ');
  const originalComment = old?.definition?.comment === value.comment ? old.parsed.attributes.find(attribute => attribute.kind === 'comment')?.rawSql : undefined;
  const comment = originalComment ?? `COMMENT ${stringLiteral(value.comment, options.sqlMode.noBackslashEscapes)}`;
  return `ADD ${value.kind === 'primary' ? 'PRIMARY KEY' : value.kind === 'unique' ? 'UNIQUE INDEX ' + identifier(value.name) : 'INDEX ' + identifier(value.name)} USING BTREE (${parts}) ${comment}`;
}
function dropClause(value: Readonly<IndexDefinition>): string { return value.kind === 'primary' ? 'DROP PRIMARY KEY' : `DROP INDEX ${identifier(value.name)}`; }

/** 快照必须覆盖全部索引和列，不能把遗漏的旧索引当成空闲名称或无依赖。 */
function assertSnapshot(snapshot: IndexPlanSnapshot, options: IndexPlanOptions): void {
  if (snapshot.definition.source !== snapshot.indexDocument.source || snapshot.indexDocument.indexes.length !== snapshot.indexes.size || snapshot.definition.columns.length !== snapshot.columns.size) throw new Error('索引快照不完整或来源不一致');
  if (snapshot.indexes.size > tableIndexPatchLimits.indexes) throw new Error('索引快照超过数量预算');
  if (options.dialect !== snapshot.definition.context.dialect || options.sqlMode.ansiQuotes !== snapshot.definition.context.mode.ansiQuotes || options.sqlMode.noBackslashEscapes !== snapshot.definition.context.mode.noBackslashEscapes) throw new Error('索引快照与实际 SQL 模式不一致');
  if (snapshot.definition.database !== undefined && snapshot.definition.database !== options.database) throw new Error('目标数据库与原定义不一致');
  if (options.engine !== 'InnoDB' || options.checks.foreignKeyChecks !== 1 || options.checks.uniqueChecks !== 1) throw new Error('索引修改要求 InnoDB 且实际外键和唯一检查均开启');
  for (const value of [options.capabilities.maxKeyParts, options.capabilities.maxIndexNameCharacters, options.capabilities.maxIndexCommentBytes, options.capabilities.maxKeyBytes]) if (!Number.isSafeInteger(value) || value < 1) throw new Error('索引服务器预算能力未知');
  const columnNames = new Set<string>();
  for (const column of snapshot.columns.values()) {
    if (!snapshot.definition.columnsByName.has(column.name) || columnNames.has(column.name)) throw new Error('字段引用未精确覆盖当前定义'); columnNames.add(column.name);
  }
  const ranges = new Set<string>();
  for (const old of snapshot.indexes.values()) {
    const key = `${old.parsed.range.start}:${old.parsed.range.end}`;
    if (ranges.has(key) || !snapshot.indexDocument.indexes.some(index => index.range.start === old.parsed.range.start && index.range.end === old.parsed.range.end && index.rawSql === old.parsed.rawSql)) throw new Error('索引引用未精确覆盖当前定义'); ranges.add(key);
    if (old.definition) {
      const expected = editableIndexDefinition(old.parsed, snapshot.columns);
      if (!expected || !equalDefinition(expected, old.definition)) throw new Error('索引目录投影与原片段不一致');
    }
  }
}

/** 独立纯计划：先验证全部补丁与最终集合，再做依赖裁决，最终只生成一条 ALTER。 */
export function planTableIndexPatches(snapshot: IndexPlanSnapshot, input: unknown, options: IndexPlanOptions): IndexPlanResult {
  try {
    const patches = validateIndexPatches(input); assertSnapshot(snapshot, options);
    if (patches.some(patch => patch.op === 'alter' && Object.hasOwn(patch.changes, 'optimizerVisible'))) throw new Error('索引优化器参与状态必须使用专用原生属性计划；旧通用计划不能忽略该属性');
    const final = new Map<string, PlannedIndex>([...snapshot.indexes].map(([ref, old]) => [ref, { sourceIndexRef: ref, ...(old.definition ? { definition: old.definition } : {}) }]));
    const additions: PlannedIndex[] = [], operations: IndexPlanOperation[] = [];
    for (const patch of patches) {
      if (patch.op === 'add') {
        const definition = checkedDefinition(patch.definition, snapshot, options);
        additions.push({ clientKey: patch.clientKey, definition });
        operations.push({ clientKey: patch.clientKey, strategy: 'add', clauses: [addClause(definition, snapshot, options)] }); continue;
      }
      const old = snapshot.indexes.get(patch.indexRef);
      if (!old) throw new Error('索引引用不属于当前快照');
      if (!old.definition || old.parsed.opaqueReasons.length || old.visible !== true || old.generated !== false) throw new Error('目标索引包含未知、隐藏或生成属性，首批只读');
      if (patch.op === 'drop') { final.delete(patch.indexRef); operations.push({ sourceIndexRef: patch.indexRef, strategy: 'drop', clauses: [dropClause(old.definition)] }); continue; }
      if (isSpecialIndexKind(old.definition.kind) || patch.changes.kind && isSpecialIndexKind(patch.changes.kind)) throw new Error('特殊索引本批仅新增或明确删除，不改名、重建或与BTREE互换');
      const next = { ...old.definition, ...patch.changes };
      if (equalDefinition(next, old.definition)) continue;
      const definition = checkedDefinition(next, snapshot, options);
      // 显式满列长度规范后可能与原整字段完全相同，此时不能误生成DROP+ADD。
      if (equalDefinition(definition, old.definition)) continue;
      const rename = definition.kind === old.definition.kind && definition.name !== old.definition.name && sameParts(definition.keyParts, old.definition.keyParts) && definition.comment === old.definition.comment;
      if (rename && definition.kind === 'primary') throw new Error('主键不能重命名');
      if (rename && !options.capabilities.renameIndex) throw new Error('当前服务器未证明支持原生索引改名');
      final.set(patch.indexRef, { sourceIndexRef: patch.indexRef, definition });
      operations.push({ sourceIndexRef: patch.indexRef, strategy: rename ? 'rename' : 'replace', clauses: rename ? [`RENAME INDEX ${identifier(old.definition.name)} TO ${identifier(definition.name)}`] : [dropClause(old.definition), addClause(definition, snapshot, options, old)] });
    }
    const finalIndexes = [...final.values(), ...additions];
    if (finalIndexes.length > tableIndexPatchLimits.indexes) throw new Error('最终索引数量超过 256 项预算');
    const names = new Set<string>(); let primary = 0;
    for (const item of finalIndexes) {
      const name = item.definition?.name ?? snapshot.indexes.get(item.sourceIndexRef!)!.parsed.name;
      if (!name) throw new Error('旧索引名称未知，无法证明最终名称无冲突');
      const folded = name.toLowerCase(); if (names.has(folded)) throw new Error('最终索引名称重复'); names.add(folded);
      if (item.definition?.kind === 'primary' && ++primary > 1) throw new Error('最终只能保留一个主键');
    }
    // 改名不引入临时名称。名称环或仍被另一原索引占据时保守拒绝；显式 DROP 的名称可复用。
    for (const operation of operations.filter(value => value.strategy === 'rename')) {
      const name = final.get(operation.sourceIndexRef!)!.definition!.name.toLowerCase();
      for (const [ref, old] of snapshot.indexes) if (ref !== operation.sourceIndexRef && old.parsed.name.toLowerCase() === name && !operations.some(value => value.sourceIndexRef === ref && value.strategy === 'drop')) throw new Error('索引改名目标仍被原索引占用，不自动插入临时改名');
    }
    if (!operations.length) return { kind: 'noop', warnings: [] };
    if (additions.filter(index => index.definition?.kind === 'fulltext').length > 1) throw new Error('单次ALTER最多新增一个全文索引；本工具不拆成多次DDL');
    const risks = tableColumnDefaultRisks(snapshot.definition);
    if (risks.length) return { kind: 'blocked', issues: [issue('maria-default-restate', tableColumnDefaultRiskMessage(risks))] };
    const dependencies = planIndexDependencies(snapshot, finalIndexes, operations, options);
    if (!dependencies.allowed) return { kind: 'blocked', issues: dependencies.blockers };
    // 所有显式删除先执行，避免 DROP+ADD 改名称或替换主键时碰撞；仍只有一次服务器 ALTER。
    const clauses = [...operations.flatMap(operation => operation.strategy === 'drop' || operation.strategy === 'replace' ? [operation.clauses[0]] : []), ...operations.flatMap(operation => operation.strategy === 'replace' ? operation.clauses.slice(1) : operation.strategy === 'drop' ? [] : operation.clauses)];
    const sql = `ALTER TABLE ${qualified(options.database, snapshot.definition.table)} ${clauses.join(', ')};`;
    if (new TextEncoder().encode(sql).length > tableIndexPatchLimits.ddlBytes) throw new Error('索引 ALTER 超过 4 MiB 预算');
    const scanner = new SqlScriptScanner(options.sqlMode.noBackslashEscapes, options.sqlMode.ansiQuotes), statements = scanner.push(sql, true);
    if (statements.length !== 1) throw new Error('索引计划必须恰好包含一条 ALTER');
    const binaryRisk = snapshot.definition.columns.some(hasUnprovenBinaryDefault);
    const changed = new Set(operations.map(operation => operation.sourceIndexRef).filter(Boolean));
    const specialWarnings = additions.some(index => index.definition?.kind === 'fulltext') ? [issue('fulltext-internal-rebuild', '新增全文索引可能重建表并由InnoDB保留隐藏FTS_DOC_ID及辅助索引；不自动增删文档ID或解析器，后核验只覆盖公开表定义。')] : [];
    return { kind: 'ready', sql, operations, finalIndexes, preservedOpaqueIndexRefs: [...snapshot.indexes].filter(([, old]) => !old.definition).map(([ref]) => ref), warnings: [...dependencies.warnings, ...specialWarnings, ...(binaryRisk ? [issue('binary-default-unverified', '未改二进制默认值的原始字节无法证明，索引操作可执行但完整定义必须人工核对')] : [])], verification: { unchangedColumnRanges: snapshot.indexDocument.columnRanges, unchangedConstraintRanges: snapshot.indexDocument.otherConstraintRanges, unchangedIndexRefs: [...snapshot.indexes.keys()].filter(ref => !changed.has(ref)), preserveTableTail: true, requiresDependencyRecheck: true, definitionCanBeFullyVerified: !binaryRisk } };
  } catch (error) {
    // Zod 详细输入诊断不流入任务摘要；受控中文错误可以直接显示。
    const message = error instanceof Error && error.name !== 'ZodError' ? error.message : '索引补丁包含未知字段、非法值或不受支持的结构';
    return { kind: 'blocked', issues: [issue('invalid-index-plan', message)] };
  }
}
