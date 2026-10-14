import { identifier, qualified, SqlScriptScanner } from './sql';
import { tableDefinitionTokens } from './tableColumnDefinition';
import { hasUnprovenBinaryDefault, tableColumnDefaultRisks } from '../shared/tableColumnPatches';
import { defaultForeignKeyAction, foreignKeyDefinitionSchema, tableForeignKeyPatchLimits, validateForeignKeyPatches, type ForeignKeyDefinition, type ForeignKeyPlanIssue, type ForeignKeyPlanOperation, type ForeignKeyPlanOptions, type ForeignKeyPlanResult, type ForeignKeyPlanSnapshot, type ForeignKeyTableSnapshot, type PlannedForeignKey } from '../shared/tableForeignKeyPatches';
import type { TrustedIndexColumn } from '../shared/tableIndexPatches';

/** 提供受控说明，不把用户 SQL 或定义内容拼入错误。 */
function issue(code: string, message: string): ForeignKeyPlanIssue { return { code, message, foreignKeyRefs: [], columnRefs: [] }; }
/** 名称与有序映射均属于约束语义，动作不做等价合并。 */
export function sameForeignKeyDefinition(left: Readonly<ForeignKeyDefinition>, right: Readonly<ForeignKeyDefinition>): boolean {
  return left.name === right.name && left.parentRef === right.parentRef && left.onUpdate === right.onUpdate && left.onDelete === right.onDelete && left.pairs.length === right.pairs.length && left.pairs.every((pair, index) => pair.childColumnRef === right.pairs[index].childColumnRef && pair.parentColumnRef === right.pairs[index].parentColumnRef);
}
/** 完整目录和受证物理能力是输入证明；普通页目录不能冒充结构快照。 */
function assertTable(table: ForeignKeyTableSnapshot, options: ForeignKeyPlanOptions, additions: boolean): void {
  if (!table.catalogComplete || !table.identity || !table.metadataDigest || table.definition.table !== table.target.table || (table.definition.database !== undefined && table.definition.database !== table.target.database)) throw new Error('表身份或完整结构目录尚未证明');
  if (table.engine.toUpperCase() !== 'INNODB' || table.rowFormat.toUpperCase() !== 'DYNAMIC' || table.pageSize !== 16384 || table.isTemporary) throw new Error('首批仅支持已证 InnoDB/DYNAMIC/16KiB 非临时表');
  if (table.definition.context.dialect !== options.dialect || table.definition.context.mode.ansiQuotes !== options.sqlMode.ansiQuotes || table.definition.context.mode.noBackslashEscapes !== options.sqlMode.noBackslashEscapes) throw new Error('结构 SQL 模式与计划不一致');
  if (additions && table.partition !== 'none') throw new Error('分区或未知分区表参与新增外键的能力尚未证明');
  const names = [...table.columns.values()].map(column => column.name);
  if (names.length !== table.definition.columns.length || new Set(names).size !== names.length || table.definition.columns.some(column => !names.includes(column.name))) throw new Error('字段引用没有完整对应当前表定义');
}
/** 首批采用严格类型等价：不推测不同长度/精度是否可兼容，不用数据行值证明类型。 */
function compatible(child: TrustedIndexColumn, parent: TrustedIndexColumn, options: ForeignKeyPlanOptions): boolean {
  const allowed = /^(?:TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT|DECIMAL|FLOAT|DOUBLE|BIT|CHAR|VARCHAR|BINARY|VARBINARY|DATE|YEAR|TIME|DATETIME|TIMESTAMP)$/;
  const type = child.dataType.toUpperCase();
  if (!allowed.test(type) || type !== parent.dataType.toUpperCase() || child.generated || child.hidden || parent.generated || parent.hidden) return false;
  const character = type === 'CHAR' || type === 'VARCHAR';
  if (character ? !child.charset || !child.collation || !parent.charset || !parent.collation : child.charset !== undefined || child.collation !== undefined || parent.charset !== undefined || parent.collation !== undefined) return false;
  const tokens = (value: string) => JSON.stringify(tableDefinitionTokens(value, { dialect: options.dialect, mode: options.sqlMode }).map(token => [token.kind, token.kind === 'word' ? token.value.toUpperCase() : token.value]));
  return tokens(child.columnType) === tokens(parent.columnType) && child.charset === parent.charset && child.collation === parent.collation && Number.isSafeInteger(child.fullKeyBytes) && child.fullKeyBytes! > 0 && Number.isSafeInteger(parent.fullKeyBytes) && parent.fullKeyBytes! > 0;
}
/** 只使用目录中已存在的完整、升序、可见非生成 BTREE；不创建或替换支持索引。 */
function hasSupport(table: ForeignKeyTableSnapshot, refs: string[], unique: boolean): boolean {
  return [...table.indexes.values()].some(index => {
    const value = index.definition;
    return value && index.visible === true && index.generated === false && !index.parsed.opaqueReasons.length && value.method === 'BTREE' && (!unique || (value.kind !== 'ordinary' && value.keyParts.length === refs.length)) && value.keyParts.length >= refs.length && value.keyParts.every(part => part.prefixLength === undefined && part.direction === 'asc' && table.columns.has(part.columnRef)) && refs.every((ref, position) => value.keyParts[position].columnRef === ref);
  });
}
/** 新约束只接受服务器确认可用的 ASCII 名称，不由 JS 大小写比较推导命名空间可用。 */
function assertAvailableName(value: Readonly<ForeignKeyDefinition>, snapshot: ForeignKeyPlanSnapshot): void {
  if (snapshot.namespaceNames.comparisons?.get(value.name) !== 'available') throw new Error('外键名称尚未由服务器确认在本库命名空间可用');
  if ([...snapshot.foreignKeys.values()].some(old => old.name.toLowerCase() === value.name.toLowerCase())) throw new Error('不能在同条 ALTER 中复用既有外键名；必须由用户明确选择不同名称');
}
/** 对新增或替换后的完整模型执行引用、类型、动作与支持键裁决。 */
function checkedDefinition(value: Readonly<ForeignKeyDefinition>, snapshot: ForeignKeyPlanSnapshot, options: ForeignKeyPlanOptions): ForeignKeyDefinition {
  const definition = foreignKeyDefinitionSchema.parse(value), parent = snapshot.parents.get(definition.parentRef);
  if (!parent) throw new Error('父表引用不属于当前快照');
  assertTable(parent, options, true);
  if (parent.identity !== snapshot.child.identity) throw new Error('父表不属于同一可信服务器身份');
  if (parent.target.database === snapshot.child.target.database && parent.target.table === snapshot.child.target.table && (parent.definition.source !== snapshot.child.definition.source || parent.metadataDigest !== snapshot.child.metadataDigest)) throw new Error('自引用父表与子表必须来自同一完整定义');
  if (definition.pairs.length > (options.dialect === 'mysql' ? 16 : 32)) throw new Error('外键列数超过当前服务器受控上限');
  if (new Set(definition.pairs.map(pair => pair.childColumnRef)).size !== definition.pairs.length || new Set(definition.pairs.map(pair => pair.parentColumnRef)).size !== definition.pairs.length) throw new Error('外键字段映射不能重复');
  for (const pair of definition.pairs) {
    const childColumn = snapshot.child.columns.get(pair.childColumnRef), parentColumn = parent.columns.get(pair.parentColumnRef);
    if (!childColumn || !parentColumn) throw new Error('外键字段引用不属于对应的子表或父表快照');
    if (!compatible(childColumn, parentColumn, options)) throw new Error('字段类型、精度、字符集、排序规则或隐藏生成属性未证明兼容');
    if ((definition.onUpdate === 'SET NULL' || definition.onDelete === 'SET NULL') && !childColumn.nullable) throw new Error('SET NULL 要求全部子字段已真实可空，不会自动修改字段');
  }
  if (!hasSupport(snapshot.child, definition.pairs.map(pair => pair.childColumnRef), false)) throw new Error('缺少已存在的完整子表支持索引；请先显式创建索引并重新读取');
  if (!hasSupport(parent, definition.pairs.map(pair => pair.parentColumnRef), true)) throw new Error('父表缺少精确有序的完整 PRIMARY/UNIQUE 支持键，非标准或未知支持键首批只读');
  assertAvailableName(definition, snapshot); return definition;
}
/** 所有 SQL 标识符只从可信表/列映射取值，客户端只能选择 opaque refs。 */
function addClause(value: Readonly<ForeignKeyDefinition>, snapshot: ForeignKeyPlanSnapshot): string {
  const parent = snapshot.parents.get(value.parentRef)!;
  return `ADD CONSTRAINT ${identifier(value.name)} FOREIGN KEY (${value.pairs.map(pair => identifier(snapshot.child.columns.get(pair.childColumnRef)!.name)).join(', ')}) REFERENCES ${qualified(parent.target.database, parent.target.table)} (${value.pairs.map(pair => identifier(parent.columns.get(pair.parentColumnRef)!.name)).join(', ')}) ON UPDATE ${value.onUpdate} ON DELETE ${value.onDelete}`;
}

/** 纯计划只输出一条 ALTER；同名替换五版均拒，不自动改名、拆句或失败后回退。 */
export function planTableForeignKeyPatches(snapshot: ForeignKeyPlanSnapshot, input: unknown, options: ForeignKeyPlanOptions): ForeignKeyPlanResult {
  try {
    const patches = validateForeignKeyPatches(input); defaultForeignKeyAction(options);
    if (options.database !== snapshot.child.target.database || options.checks.foreignKeyChecks !== 1 || options.checks.uniqueChecks !== 1) throw new Error('目标或实际约束检查状态不符合计划要求');
    if (!snapshot.outgoingComplete) throw new Error('子表现有外键目录尚未完整核对');
    if (snapshot.foreignKeys.size > tableForeignKeyPatchLimits.foreignKeys) throw new Error('现有外键超过受控预算');
    assertTable(snapshot.child, options, patches.some(patch => patch.op !== 'drop'));
    for (const old of snapshot.foreignKeys.values()) if (snapshot.child.definition.source.slice(old.range.start, old.range.end) !== old.rawSql || (old.definition && old.definition.name !== old.name)) throw new Error('旧外键原片段或名称与可信快照不一致');
    const operations: ForeignKeyPlanOperation[] = [], final = new Map<string, PlannedForeignKey>([...snapshot.foreignKeys].map(([ref, old]) => [ref, { sourceForeignKeyRef: ref, ...(old.definition ? { definition: old.definition } : {}) }]));
    const created: PlannedForeignKey[] = [];
    for (const patch of patches) {
      if (patch.op === 'add') {
        const value = checkedDefinition(patch.definition, snapshot, options);
        operations.push({ clientKey: patch.clientKey, strategy: 'add', clauses: [addClause(value, snapshot)] }); created.push({ clientKey: patch.clientKey, definition: value }); continue;
      }
      const old = snapshot.foreignKeys.get(patch.foreignKeyRef);
      if (!old) throw new Error('外键引用不属于当前快照');
      if (!old.definition || old.opaqueReasons.length || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(old.name)) throw new Error('该旧外键存在未证明语法或名称规则，首批只读保留');
      if (patch.op === 'drop') { operations.push({ sourceForeignKeyRef: patch.foreignKeyRef, strategy: 'drop', clauses: [`DROP FOREIGN KEY ${identifier(old.name)}`] }); final.delete(patch.foreignKeyRef); continue; }
      const merged = { ...old.definition, ...patch.changes };
      if (sameForeignKeyDefinition(old.definition, merged)) continue;
      if (!patch.changes.name || patch.changes.name.toLowerCase() === old.name.toLowerCase()) throw new Error('同名替换未获支持，请明确选择不同外键名称；不会自动改名');
      const value = checkedDefinition(merged, snapshot, options);
      operations.push({ sourceForeignKeyRef: patch.foreignKeyRef, strategy: 'replace', clauses: [`DROP FOREIGN KEY ${identifier(old.name)}`, addClause(value, snapshot)] }); final.set(patch.foreignKeyRef, { sourceForeignKeyRef: patch.foreignKeyRef, definition: value });
    }
    const finalForeignKeys = [...final.values(), ...created];
    if (finalForeignKeys.length > tableForeignKeyPatchLimits.foreignKeys) throw new Error('最终外键超过受控预算');
    const names = finalForeignKeys.map(value => value.definition?.name ?? snapshot.foreignKeys.get(value.sourceForeignKeyRef!)!.name), ascii = names.filter(name => /^[\x00-\x7f]+$/.test(name)).map(name => name.toLowerCase());
    if (new Set(names).size !== names.length || new Set(ascii).size !== ascii.length) throw new Error('同批最终外键名称冲突');
    const warnings: ForeignKeyPlanIssue[] = [];
    if (snapshot.incomingCoverage.kind !== 'complete') warnings.push(issue('incoming-partial', '入向目录不完整；本次不修改任何索引、列或父表，执行后完整依赖核验仍受限'));
    if (!operations.length) return { kind: 'noop', warnings };
    if (tableColumnDefaultRisks(snapshot.child.definition).length) throw new Error('MariaDB 表中存在不可证明重述安全的默认值，本批全部 ALTER 受保护');
    const binaryRisk = snapshot.child.definition.columns.some(hasUnprovenBinaryDefault);
    if (binaryRisk) warnings.push(issue('binary-default-unverified', '未改二进制默认值原始字节不可证明，操作可执行但不能报告完整定义核验'));
    warnings.push(issue('server-validation', '由服务器在检查开启时验证现有行；不会自动修复数据、创建支持索引或重放失败 DDL'));
    const clauses = operations.flatMap(operation => operation.clauses), sql = `ALTER TABLE ${qualified(options.database, snapshot.child.target.table)} ${clauses.join(', ')};`;
    if (Buffer.byteLength(sql) > tableForeignKeyPatchLimits.ddlBytes) throw new Error('生成 SQL 超过预算');
    const scanner = new SqlScriptScanner(options.sqlMode.noBackslashEscapes, options.sqlMode.ansiQuotes); if (scanner.push(sql, true).length !== 1) throw new Error('计划不是一条完整 ALTER');
    const changed = new Set(operations.flatMap(operation => operation.sourceForeignKeyRef ? [operation.sourceForeignKeyRef] : []));
    // 删除或改指向后旧父表仍属于本次影响范围；只引用快照实际持有的父表，不能凭字符串造读取授权。
    const requiredParentRefs = [...new Set([
      ...[...snapshot.foreignKeys.values()].flatMap(value => value.definition ? [value.definition.parentRef] : []),
      ...finalForeignKeys.flatMap(value => value.definition ? [value.definition.parentRef] : []),
    ])];
    const parentRefs = requiredParentRefs.filter(ref => snapshot.parents.has(ref));
    const parentsComplete = parentRefs.length === requiredParentRefs.length;
    if (!parentsComplete) warnings.push(issue('parent-snapshot-incomplete', '旧外键的父表快照缺失；不会从未授权引用读取父表，本次不能报告完整定义核验'));
    return { kind: 'ready', sql, operations, finalForeignKeys, warnings, verification: { unchangedForeignKeyRefs: [...snapshot.foreignKeys.keys()].filter(ref => !changed.has(ref)), parentRefs, preserveColumns: true, preserveIndexes: true, preserveOtherConstraints: true, preserveTableTail: true, definitionCanBeFullyVerified: parentsComplete && !binaryRisk && snapshot.incomingCoverage.kind === 'complete' } };
  } catch (error) { return { kind: 'blocked', issues: [issue('foreign-key-plan-blocked', error instanceof Error ? error.message : '外键计划无法确认')] }; }
}
