import { createHash, randomUUID } from 'node:crypto';
import { readIndexStructure, indexReferenceNames, type IndexReferenceNames, type IndexStructureRead } from './tableIndexRead';
import { readStructureDefinition, structureDocumentOf, structureTaskQuery, assertStructureDefinitionUnchanged, type StructureTaskContext } from './structureDefinition';
import { readTableForeignKeyDefinition } from './tableForeignKeyDefinition';
import { crossCheckForeignKeyCatalog, type ForeignKeyCatalogEntry } from './tableForeignKeyMetadata';
import { defaultForeignKeyAction, type ForeignKeyPlanSnapshot, type ForeignKeyPlanOptions, type ForeignKeyTableSnapshot, type TrustedForeignKey } from '../shared/tableForeignKeyPatches';
import type { TableColumnPatchTarget } from '../shared/tableColumnPatches';

type Target = { database: string; table: string };
type Row = Record<string, unknown>;
export interface ForeignKeyReferenceNames {
  parents: ReadonlyMap<string, Target>; foreignKeys: ReadonlyMap<string, string>;
  /** JSON 精确目标元组仅为内部 Map 键，不解析 renderer 的 opaque ref。 */
  tables: ReadonlyMap<string, IndexReferenceNames>;
}
export interface ForeignKeyReadOptions {
  additionalParents?: readonly Target[]; refs?: ForeignKeyReferenceNames;
  /** 仅任务从此前实际持有的父快照取非子表目标（最多31），用于删除/改指向后复核旧父；禁止 renderer 提供。 */
  retainedParents?: readonly Target[];
  namespaceNames?: ForeignKeyPlanSnapshot['namespaceNames'];
}
export interface ForeignKeyReadIO {
  readIndex: typeof readIndexStructure; readDefinition: typeof readStructureDefinition;
  query: typeof structureTaskQuery;
}
export interface ForeignKeyStructureRead {
  target: TableColumnPatchTarget; snapshot: ForeignKeyPlanSnapshot; options?: ForeignKeyPlanOptions;
  childRead: IndexStructureRead; parentReads: ReadonlyMap<string, IndexStructureRead>;
  refs: ForeignKeyReferenceNames; warnings: string[]; bytes: number; outgoingDigest: string;
}
const limits = { targets: 32, explicitParents: 16, bytes: 16 * 1024 * 1024, definitionBytes: 2 * 1024 * 1024, foreignKeys: 256, parts: 8192 } as const;
const productionIO: ForeignKeyReadIO = { readIndex: readIndexStructure, readDefinition: readStructureDefinition, query: structureTaskQuery };
const targetKey = (target: Target): string => JSON.stringify([target.database, target.table]);
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const literal = (value: string): string => `CONVERT(X'${Buffer.from(value).toString('hex')}' USING utf8mb4)`;
/** 只复用可信内部名称映射；新引用随机且不编码目标身份。 */
function reference<T>(entries: ReadonlyMap<string, T> | undefined, value: T, equal: (a: T, b: T) => boolean): string {
  const matches = entries ? [...entries].filter(([, old]) => equal(old, value)) : [];
  if (matches.length > 1) throw new Error('外键结构内部引用名称重复');
  return matches[0]?.[0] ?? randomUUID();
}
/** 目标只允许数据库标识符数据，绝不作为 SQL 原片段使用。 */
function checkedTarget(value: Target): Target {
  if (!value || typeof value.database !== 'string' || typeof value.table !== 'string' || [value.database, value.table].some(name => !name || name.includes('\0') || [...name].length > 64 || Buffer.from(name).toString() !== name)) throw new Error('父表目标名称无效');
  return { database: value.database, table: value.table };
}
/** 物理能力只来自 indexRead 已核验的 options，未知组合明确只读而非猜默认引擎。 */
function tableSnapshot(read: IndexStructureRead, target: Target): ForeignKeyTableSnapshot {
  const partition = read.model.dependencies.partition.kind;
  return { target, identity: read.identity, definition: structureDocumentOf(read), columns: read.model.columns, indexes: read.model.indexes,
    engine: read.options ? 'InnoDB' : 'unknown', rowFormat: read.options ? 'DYNAMIC' : 'unknown', pageSize: read.options ? 16384 : 0,
    isTemporary: false, catalogComplete: !!read.options, partition: partition === 'none' ? 'none' : partition === 'unknown' ? 'unknown' : 'partitioned', metadataDigest: read.catalogDigest };
}
/** 同名列必须唯一对应真实目录；不将字段名本身作为可授权引用。 */
function columnRef(table: ForeignKeyTableSnapshot, name: string): string | undefined {
  const matches = [...table.columns].filter(([, column]) => column.name === name);
  return matches.length === 1 ? matches[0][0] : undefined;
}
/** 目录失败可降为只读；取消、断线和未知服务器执行错误必须原样传播。 */
function canRetainReadOnly(context: StructureTaskContext, error: unknown): boolean {
  context.checkCancelled();
  if (context.managed.broken || context.managed.signal?.aborted) return false;
  const value = error as { code?: string; errno?: number; fatal?: boolean; message?: string };
  if (value?.fatal || /连接|中止|取消/.test(value?.message ?? '')) return false;
  if (value?.code || value?.errno) return [1044, 1142, 1143, 1146, 1109, 1227].includes(value.errno ?? -1) || ['ER_DBACCESS_DENIED_ERROR', 'ER_TABLEACCESS_DENIED_ERROR', 'ER_COLUMNACCESS_DENIED_ERROR', 'ER_SPECIFIC_ACCESS_DENIED_ERROR', 'ER_NO_SUCH_TABLE', 'ER_UNKNOWN_TABLE'].includes(value.code ?? '');
  return error instanceof Error;
}
/** 固定投影和 LIMIT+1 检测，不让被过滤掉的空目录冒充没有外键。 */
export async function readOutgoingForeignKeyRows(context: StructureTaskContext, target: Target, io: Pick<ForeignKeyReadIO, 'query'> = productionIO): Promise<{ rc: Row[]; kcu: Row[]; bytes: number }> {
  const where = `CONSTRAINT_SCHEMA = ${literal(target.database)} AND TABLE_NAME = ${literal(target.table)}`;
  const rc = (await io.query<Row[]>(context, `SELECT CONSTRAINT_SCHEMA, CONSTRAINT_NAME, TABLE_NAME, UNIQUE_CONSTRAINT_SCHEMA, REFERENCED_TABLE_NAME, UNIQUE_CONSTRAINT_NAME, MATCH_OPTION, UPDATE_RULE, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE ${where} ORDER BY CONSTRAINT_NAME LIMIT 257`)).rows;
  if (!Array.isArray(rc) || rc.length > limits.foreignKeys) throw new Error('外键规则目录超过 256 条预算');
  const kcu = (await io.query<Row[]>(context, `SELECT CONSTRAINT_SCHEMA, CONSTRAINT_NAME, TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, POSITION_IN_UNIQUE_CONSTRAINT, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE ${where} AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION LIMIT 8193`)).rows;
  if (!Array.isArray(kcu) || kcu.length > limits.parts) throw new Error('外键字段目录超过 8192 条预算');
  const bytes = Buffer.byteLength(JSON.stringify([rc, kcu]));
  if (bytes > 4 * 1024 * 1024) throw new Error('外键逻辑目录超过 4 MiB');
  return { rc, kcu, bytes };
}
/** 语义摘要仅将列/索引引用投影回真实名称，避免随机 opaque refs 污染重读比较。 */
function dependencySemantics(read: IndexStructureRead): unknown {
  const value = read.model.dependencies;
  const column = (ref: string): string => { const name = read.model.columns.get(ref)?.name; if (name === undefined) throw new Error('依赖字段引用无法对应真实名称'); return name; };
  const index = (ref: string): string => { const name = read.model.indexes.get(ref)?.parsed.name; if (name === undefined) throw new Error('依赖索引引用无法对应真实名称'); return name; };
  const partition = value.partition;
  return { ...value,
    foreignKeys: value.foreignKeys.map(key => ({ ...key, targetColumnRefs: key.targetColumnRefs.map(column), support: key.support.kind === 'known' ? { ...key.support, candidateIndexRefs: key.support.candidateIndexRefs.map(index).sort() } : key.support })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    autoIncrementColumnRefs: value.autoIncrementColumnRefs.map(column).sort(),
    partition: partition.kind === 'explicit' ? { ...partition, requiredColumnRefs: partition.requiredColumnRefs.map(column) } : partition.kind === 'implicit-key' ? { ...partition, selectedIndexRef: partition.selectedIndexRef ? index(partition.selectedIndexRef) : undefined } : partition,
    hiddenDependencies: value.hiddenDependencies.map(item => ({ ...item, indexRefs: item.indexRefs.map(index).sort() })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    automaticForeignKeyIndexProvenance: value.automaticForeignKeyIndexProvenance.kind === 'known' ? { kind: 'known', indexRefs: value.automaticForeignKeyIndexProvenance.indexRefs.map(index).sort() } : { kind: 'unknown' },
  };
}
/** 入向摘要排除 self/出向，保留目录稳定 FK 语义引用和目标列真实有序名称。 */
function externalIncoming(read: IndexStructureRead): string {
  const values = read.model.dependencies.foreignKeys.filter(key => key.direction === 'incoming').map(key => ({ foreignKeyRef: key.foreignKeyRef, columns: key.targetColumnRefs.map(ref => { const column = read.model.columns.get(ref); if (!column) throw new Error('入向依赖字段无法绑定真实目录'); return column.name; }) }));
  return hash(values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

/** 组合读取仅展开当前子表直接父目标，不递归；读取结束再核对所有成功取得的定义。 */
export async function readForeignKeyStructure(context: StructureTaskContext, target: TableColumnPatchTarget, request: ForeignKeyReadOptions = {}, io: ForeignKeyReadIO = productionIO): Promise<ForeignKeyStructureRead> {
  const childTarget = checkedTarget(target), extras = request.additionalParents ?? [], retained = request.retainedParents ?? [];
  if (!Array.isArray(extras) || extras.length > limits.explicitParents) throw new Error('一次最多显式选择 16 个父表');
  if (!Array.isArray(retained) || retained.length > limits.targets - 1) throw new Error('内部旧父表目标超过 31 个');
  const explicit = [...extras.map(checkedTarget), ...retained.map(checkedTarget)], childKey = targetKey(childTarget);
  const childRead = await io.readIndex(context, target, request.refs?.tables.get(childKey));
  if (Buffer.byteLength(childRead.source) > limits.definitionBytes || childRead.bytes > limits.bytes) throw new Error('子表定义或结构快照超过预算');
  const child = tableSnapshot(childRead, childTarget), warnings = [...childRead.warnings];
  let bytes = childRead.bytes, options: ForeignKeyPlanOptions | undefined;
  try {
    defaultForeignKeyAction({ dialect: childRead.context.dialect, serverVersion: childRead.serverVersion });
    if (childRead.options) options = { database: target.database, dialect: childRead.context.dialect, serverVersion: childRead.serverVersion, sqlMode: childRead.context.mode, checks: childRead.options.checks };
  } catch { warnings.push('当前版本未证明外键动作与变更策略，只读显示'); }
  const parsed = readTableForeignKeyDefinition(child.definition, target.database, childRead.serverVersion);
  if (parsed.foreignKeys.length > limits.foreignKeys || parsed.foreignKeys.reduce((count, key) => count + key.childColumnNames.length, 0) > limits.parts) throw new Error('源外键定义超过受控预算');
  let entries: ForeignKeyCatalogEntry[] = [], outgoingComplete = false, outgoingDigest = hash(['unread']);
  try {
    const rows = await readOutgoingForeignKeyRows(context, childTarget, io);
    if (bytes + rows.bytes > limits.bytes) throw new Error('外键结构总快照超过 16 MiB');
    bytes += rows.bytes;
    outgoingDigest = hash([rows.rc.map(row => Object.entries(row).sort()).sort(), rows.kcu.map(row => Object.entries(row).sort()).sort()]);
    entries = crossCheckForeignKeyCatalog(parsed, childTarget, rows.rc, rows.kcu); outgoingComplete = true;
  } catch (error) {
    if (!canRetainReadOnly(context, error)) throw error;
    warnings.push('子表现有外键原定义与逻辑目录未完整核对，外键变更只读');
  }
  // 自引用始终可选，复用已核验子表对象，不要求为新增 self 外键再手工加载自身。
  const targets = new Map<string, Target>([[childKey, childTarget]]);
  for (const parent of [...parsed.foreignKeys.flatMap(key => key.parentTarget ? [key.parentTarget] : []), ...explicit]) {
    const valid = checkedTarget(parent), key = targetKey(valid);
    if (targets.has(key)) continue;
    if (key !== childKey && [...targets.keys()].filter(value => value !== childKey).length >= limits.targets - 1) { outgoingComplete = false; warnings.push('父表目标超过总计 32 个表的读取预算，未读取目标保持只读'); continue; }
    targets.set(key, valid);
  }
  const parents = new Map<string, ForeignKeyTableSnapshot>(), parentReads = new Map<string, IndexStructureRead>(), parentNames = new Map<string, Target>();
  const tableRefs = new Map<string, IndexReferenceNames>([[childKey, indexReferenceNames(childRead)]]);
  for (const [key, parentTarget] of targets) {
    const ref = reference(request.refs?.parents, parentTarget, (a, b) => targetKey(a) === targetKey(b));
    parentNames.set(ref, parentTarget);
    if (key === childKey) { parents.set(ref, child); parentReads.set(ref, childRead); continue; }
    try {
      const read = await io.readIndex(context, { connectionId: target.connectionId, ...parentTarget }, request.refs?.tables.get(key));
      if (read.identity !== childRead.identity || read.serverVersion !== childRead.serverVersion || read.normalizedMode !== childRead.normalizedMode) throw new Error('父表服务器身份或规范模式与子表不一致');
      if (Buffer.byteLength(read.source) > limits.definitionBytes || bytes + read.bytes > limits.bytes) throw new Error('父表定义或总快照超过预算');
      bytes += read.bytes; parents.set(ref, tableSnapshot(read, parentTarget)); parentReads.set(ref, read); tableRefs.set(key, indexReferenceNames(read)); warnings.push(...read.warnings);
    } catch (error) {
      if (!canRetainReadOnly(context, error)) throw error;
      outgoingComplete = false;
      warnings.push(`父表 ${JSON.stringify(parentTarget.database)}.${JSON.stringify(parentTarget.table)} 未能取得可信完整快照，相关外键保持只读`);
    }
  }
  const foreignKeys = new Map<string, TrustedForeignKey>(), foreignKeyNames = new Map<string, string>();
  for (const key of parsed.foreignKeys) {
    // 无名称原片段可显示，但绝不把范围或字符串当成可修改约束身份。
    const name = key.name ?? '', ref = reference(request.refs?.foreignKeys, name, (a, b) => a === b);
    foreignKeyNames.set(ref, name);
    const entry = entries.find(value => value.name === name), reasons = [...key.opaqueReasons];
    const parentPair = entry ? [...parents].find(([, table]) => targetKey(table.target) === targetKey(entry.parentTarget)) : undefined;
    const pairs = entry && parentPair ? entry.childColumnNames.map((column, i) => ({ childColumnRef: columnRef(child, column), parentColumnRef: columnRef(parentPair[1], entry.parentColumnNames[i]) })) : undefined;
    const mapped = child.catalogComplete && !!entry && !!parentPair && parentPair[1].catalogComplete && !!pairs && pairs.every(pair => pair.childColumnRef !== undefined && pair.parentColumnRef !== undefined);
    if (!mapped) { outgoingComplete = false; reasons.push('父子完整目录或有序字段引用尚未证明'); }
    foreignKeys.set(ref, { name, range: key.range, rawSql: key.rawSql, opaqueReasons: reasons, ...(mapped ? { definition: { name, parentRef: parentPair![0], pairs: pairs!.map(pair => ({ childColumnRef: pair.childColumnRef!, parentColumnRef: pair.parentColumnRef! })), onUpdate: entry!.onUpdate, onDelete: entry!.onDelete } } : {}) });
  }
  const allReads = new Map<string, { target: Target; read: IndexStructureRead }>([[childKey, { target: childTarget, read: childRead }]]);
  for (const [ref, read] of parentReads) allReads.set(targetKey(parents.get(ref)!.target), { target: parents.get(ref)!.target, read });
  for (const value of allReads.values()) {
    const end = await io.readDefinition(context, { connectionId: target.connectionId, ...value.target }, false);
    assertStructureDefinitionUnchanged(value.read, { ...end, originalMode: value.read.originalMode });
  }
  context.checkCancelled();
  const namespace = request.namespaceNames;
  const snapshot: ForeignKeyPlanSnapshot = { child, parents, foreignKeys, outgoingComplete, incomingCoverage: childRead.model.dependencies.incomingCoverage, externalIncomingDigest: externalIncoming(childRead), namespaceNames: namespace ? { complete: namespace.complete, names: [...namespace.names], ...(namespace.comparisons ? { comparisons: new Map(namespace.comparisons) } : {}) } : { complete: false, names: [...foreignKeyNames.values()] } };
  const refs = { parents: parentNames, foreignKeys: foreignKeyNames, tables: tableRefs };
  bytes += Buffer.byteLength(JSON.stringify({ warnings, refs: [...parentNames], foreignKeys: [...foreignKeys] }));
  if (bytes > limits.bytes) throw new Error('外键结构总快照超过 16 MiB');
  return { target: { ...target }, snapshot, options, childRead, parentReads, refs, warnings: [...new Set(warnings)], bytes, outgoingDigest };
}

/** 重读引用映射仅供引擎缓存内部传递，不通过 renderer 提供身份授权。 */
export function foreignKeyReferenceNames(read: ForeignKeyStructureRead): ForeignKeyReferenceNames { return read.refs; }
/** 忽略随机引用，但完整核对各目标、定义、模式、真实目录、依赖和可选名称证明。 */
export function assertForeignKeyStructureUnchanged(before: ForeignKeyStructureRead, after: ForeignKeyStructureRead): void {
  if (before.target.connectionId !== after.target.connectionId || targetKey(before.target) !== targetKey(after.target)) throw new Error('外键结构目标已变化，请重新读取；未发送 DDL');
  const compare = (left: IndexStructureRead, right: IndexStructureRead): void => {
    assertStructureDefinitionUnchanged(left, right);
    const references = (read: IndexStructureRead) => ({ columns: [...indexReferenceNames(read).columns].sort(), indexes: [...indexReferenceNames(read).indexes].sort() });
    // preview/apply 复用相同 refs 时，还须保留原目录证据摘要的全部保护，不能只看可解释的依赖投影。
    if (hash(references(left)) === hash(references(right)) && left.dependencyDigest !== right.dependencyDigest) throw new Error('外键原始依赖目录证据已变化，请重新读取；未发送 DDL');
    if (left.catalogDigest !== right.catalogDigest || hash(dependencySemantics(left)) !== hash(dependencySemantics(right)) || JSON.stringify(left.options) !== JSON.stringify(right.options)) throw new Error('外键结构目录、能力或依赖已变化，请重新读取；未发送 DDL');
  };
  compare(before.childRead, after.childRead);
  const byTarget = (read: ForeignKeyStructureRead) => new Map([...read.parentReads].map(([ref, item]) => [targetKey(read.snapshot.parents.get(ref)!.target), item]));
  const old = byTarget(before), next = byTarget(after);
  const requested = (read: ForeignKeyStructureRead) => [...read.refs.parents.values()].map(targetKey).sort();
  if (old.size !== next.size || [...old].some(([key]) => !next.has(key)) || hash(requested(before)) !== hash(requested(after))) throw new Error('父表读取范围已变化，请重新读取；未发送 DDL');
  for (const [key, value] of old) compare(value, next.get(key)!);
  const namespace = (value: ForeignKeyStructureRead) => { const names = value.snapshot.namespaceNames; return { complete: names.complete, names: [...names.names].sort(), comparisons: [...(names.comparisons ?? [])].sort() }; };
  if (before.outgoingDigest !== after.outgoingDigest || before.snapshot.outgoingComplete !== after.snapshot.outgoingComplete || JSON.stringify(before.options) !== JSON.stringify(after.options) || hash(namespace(before)) !== hash(namespace(after))) throw new Error('外键逻辑目录或名称证明已变化，请重新预览；未发送 DDL');
}
