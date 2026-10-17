import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { columnCollationAcknowledgements, columnCollationPatchSchema, tableColumnPatchLimits, type TableColumnPatchTarget } from '../shared/tableColumnPatches';
import type { TableEncodingPair } from '../shared/tableDefaultEncoding';
import type { ColumnCollationFacts } from './tableColumnCollationRead';
import type { ColumnCollationPhysicalResult } from './tableColumnCollationPhysicalRead';
import { buildColumnCollationDefinition, verifyColumnCollationChange, type ColumnCollationDefinitionPlan } from './tableColumnCollationSql';
import { copyColumnCollationPair } from './tableColumnCollationInput';
import { parseTableColumnDefinition } from './tableColumnDefinition';
import { qualified } from './sql';

type ObservedPhysical = Extract<ColumnCollationPhysicalResult, { status: 'observed' }>;
/** 仅Tasks内部保留；不属于IPC输入/输出，也不是实际执行或算法证明。 */
export interface ColumnCollationExecutionPlan {
  readonly kind: 'column-collation-execution-v1';
  readonly target: Readonly<TableColumnPatchTarget>;
  readonly columnRef: string; readonly columnName: string;
  readonly before: Readonly<TableEncodingPair>; readonly next: Readonly<TableEncodingPair>;
  readonly sql: string; readonly originalSourceDigest: string;
  readonly candidate: ColumnCollationDefinitionPlan;
  readonly beforeFacts: ColumnCollationFacts; readonly beforePhysical: ObservedPhysical;
  requiredAcknowledgements: string[]; warnings: string[];
}
/** 仅定义范围；失败时ID变化未确认的false不能被解释为已证明同一物理表。 */
export interface ColumnCollationExecutionVerification {
  definitionVerified: boolean; tableIdChanged: boolean; reasons: string[];
}
const warnings = Object.freeze([
  '服务器默认算法可能重建表、等待锁或隐式提交；本计划不指定或证明实际算法。',
  '定义后核仅覆盖已读取的列、旁列、索引、约束及表尾范围，不证明数据、外部程序语义或持续无并发DDL。',
]);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

/** 只复制普通有界证据；访问器/Proxy/自定义原型/循环不执行，重复引用和原生Map独立保留。 */
function copyEvidence<T>(value: T): T {
  const copies = new WeakMap<object, unknown>(), active = new WeakSet<object>(); let nodes = 0, bytes = 0;
  const copy = (item: unknown, depth: number): unknown => {
    if (++nodes > 300000 || depth > 48) throw Error('列排序规则执行证据超过节点或深度预算');
    if (typeof item === 'string') { bytes += Buffer.byteLength(item); if (bytes > 32 * 1024 * 1024) throw Error('列排序规则执行证据超过32 MiB'); return item; }
    if (item === null || item === undefined || typeof item === 'boolean') return item;
    if (typeof item === 'number') { if (!Number.isFinite(item)) throw Error('列排序规则执行证据包含无效数值'); return item; }
    if (typeof item !== 'object' || types.isProxy(item)) throw Error('列排序规则执行证据不是普通数据');
    if (active.has(item)) throw Error('列排序规则执行证据包含循环');
    if (copies.has(item)) return copies.get(item);
    active.add(item); const prototype = Object.getPrototypeOf(item); let output: unknown;
    if (types.isMap(item)) {
      if (prototype !== Map.prototype || Reflect.ownKeys(item).length || Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!.call(item) > 300000) throw Error('列排序规则执行证据Map无效');
      const result = new Map(); output = result; copies.set(item, result);
      for (const [key, entry] of Map.prototype.entries.call(item)) { if (typeof key !== 'string') throw Error('列排序规则证据引用必须为字符串'); result.set(copy(key, depth + 1), copy(entry, depth + 1)); }
    } else if (Array.isArray(item)) {
      if (prototype !== Array.prototype || item.length > 300000 || Reflect.ownKeys(item).length !== item.length + 1) throw Error('列排序规则执行证据数组无效');
      const result: unknown[] = []; output = result; copies.set(item, result);
      for (let index = 0; index < item.length; index++) { const field = Object.getOwnPropertyDescriptor(item, String(index)); if (!field?.enumerable || !Object.hasOwn(field, 'value')) throw Error('列排序规则执行证据数组缺项'); result.push(copy(field.value, depth + 1)); }
    } else {
      if (prototype !== Object.prototype && prototype !== null) throw Error('列排序规则执行证据原型无效');
      const result = Object.create(null); output = result; copies.set(item, result);
      for (const key of Reflect.ownKeys(item)) { const field = Object.getOwnPropertyDescriptor(item, key); if (typeof key !== 'string' || key === 'toJSON' || !field?.enumerable || !Object.hasOwn(field, 'value')) throw Error('列排序规则执行证据字段不是数据'); result[key] = copy(field.value, depth + 1); }
    }
    active.delete(item); return Object.freeze(output);
  };
  return copy(value, 0) as T;
}
/** 全内容比较保留类型、数组/Map顺序及undefined；不调用输入的toJSON。 */
function evidenceDigest(value: unknown): string {
  const saved = new WeakMap<object, string>();
  const tagged = (item: unknown): string => {
    if (item === null) return sha('["null"]');
    if (item === undefined) return sha('["undefined"]');
    if (typeof item !== 'object') return sha(JSON.stringify([typeof item, item]));
    if (saved.has(item)) return saved.get(item)!;
    const content = item instanceof Map ? ['map', [...item].map(([key, entry]) => [key, tagged(entry)])] : Array.isArray(item) ? ['array', item.map(tagged)] : ['object', Object.keys(item).sort().map(key => [key, tagged((item as Record<string, unknown>)[key])])];
    const digest = sha(JSON.stringify(content)); saved.set(item, digest); return digest;
  };
  return tagged(value);
}
/** 固定版本的准确字段集合不接收能力布尔或额外调用方授权。 */
function exact(value: object, keys: readonly string[]): void {
  const actual = Object.keys(value); if (actual.length !== keys.length || keys.some(key => !actual.includes(key))) throw Error('列排序规则执行证据字段不准确');
}
/** 私有facts保留原v1固定阻断门，来源/版本/规范会话仍需自洽，不能靠新标志绕过。 */
function copyFacts(value: ColumnCollationFacts): ColumnCollationFacts {
  const facts = copyEvidence(value);
  exact(facts, ['kind', 'target', 'base', 'references', 'indexes', 'catalog', 'directAlterProven', 'bytes', 'execution']);
  if (!Number.isSafeInteger(facts.bytes) || facts.bytes < 1 || facts.bytes > 16 * 1024 * 1024 || typeof facts.base.source !== 'string' || Buffer.byteLength(facts.base.source) > tableColumnPatchLimits.definitionBytes || typeof facts.base.identity !== 'string' || !facts.base.identity || facts.base.identity.length > 256) throw Error('列排序规则原事实预算或身份无效');
  if (facts.indexes.identity !== facts.base.identity || facts.indexes.serverVersion !== facts.base.serverVersion || facts.indexes.normalizedMode !== facts.base.normalizedMode || facts.indexes.originalMode !== facts.base.normalizedMode || evidenceDigest(facts.indexes.context) !== evidenceDigest(facts.base.context)) throw Error('列排序规则原事实会话/服务器不一致');
  exact(facts.base.context, ['dialect', 'mode']); exact(facts.base.context.mode, ['ansiQuotes', 'noBackslashEscapes']);
  if (typeof facts.base.context.mode.ansiQuotes !== 'boolean' || typeof facts.base.context.mode.noBackslashEscapes !== 'boolean' || typeof facts.base.originalMode !== 'string' || typeof facts.base.normalizedMode !== 'string') throw Error('列排序规则原模式事实无效');
  return facts;
}
/** 物理映射必须逐项等于reader实际支持范围，ID保持准确uint64十进制文本，不转Number。 */
function copyPhysical(facts: ColumnCollationFacts, value: ColumnCollationPhysicalResult): ObservedPhysical {
  const result = copyEvidence(value);
  if (result.status !== 'observed') throw Error('列排序规则物理身份未实际观测');
  exact(result, ['status', 'tableId', 'target', 'serverIdentity', 'mapping', 'bytes']); exact(result.target, ['connectionId', 'database', 'table']); exact(facts.target, ['connectionId', 'database', 'table']);
  const target = result.target, mapping = result.mapping;
  if (typeof target.connectionId !== 'string' || !target.connectionId || target.connectionId.length > 256 || ![target.database, target.table].every(name => typeof name === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(name)) || evidenceDigest(target) !== evidenceDigest(facts.target)) throw Error('列排序规则物理目标不一致');
  exact(mapping, ['dialect', 'version', 'compileOs', 'compileOsReported', 'lowerCaseTableNames', 'tableType', 'engine', 'partitionName', 'catalog', 'nativeName']);
  if (mapping.dialect !== 'mysql' || mapping.version !== '8.4.11' || facts.base.context.dialect !== 'mysql' || facts.base.serverVersion !== '8.4.11' || !['linux', 'debian-linux-gnu'].includes(mapping.compileOs) || typeof mapping.compileOsReported !== 'string' || mapping.compileOsReported.toLowerCase() !== mapping.compileOs || !Object.is(mapping.lowerCaseTableNames, 0) || mapping.tableType !== 'BASE TABLE' || mapping.engine !== 'InnoDB' || mapping.partitionName !== null || mapping.catalog !== 'information_schema.INNODB_TABLES' || mapping.nativeName !== target.database + '/' + target.table || result.serverIdentity !== facts.base.identity || facts.indexes.options?.database !== target.database) throw Error('列排序规则物理映射或服务器身份不准确');
  if (typeof result.tableId !== 'string' || !/^[1-9]\d{0,19}$/.test(result.tableId) || result.tableId.length === 20 && result.tableId > '18446744073709551615' || !Number.isSafeInteger(result.bytes) || result.bytes < 1 || result.bytes > 4 * 65536 + 4096) throw Error('列排序规则物理ID或预算无效');
  return result;
}

/** 只组装一条可信完整MODIFY；不执行DDL，不解除旧v1阻断门或声称已证明算法/外部程序。 */
export function buildColumnCollationExecutionPlan(facts: ColumnCollationFacts, physical: ObservedPhysical, columnRef: string, next: TableEncodingPair): ColumnCollationExecutionPlan {
  const beforeFacts = copyFacts(facts), beforePhysical = copyPhysical(beforeFacts, physical);
  if (typeof columnRef !== 'string' || !columnRef || columnRef.length > 256) throw Error('列排序规则稳定引用无效');
  const pair = columnCollationPatchSchema.parse(copyColumnCollationPair(next));
  const candidate = buildColumnCollationDefinition(beforeFacts, columnRef, pair), document = parseTableColumnDefinition(beforeFacts.base.source, beforeFacts.base.context), column = document.columns.find(item => item.name === candidate.columnName);
  if (beforeFacts.references.columns.size !== document.columns.length || new Set(beforeFacts.references.columns.values()).size !== document.columns.length || document.columns.some(item => ![...beforeFacts.references.columns.values()].includes(item.name)) || beforeFacts.indexes.model.columns.size !== document.columns.length || [...beforeFacts.references.columns].some(([ref, name]) => beforeFacts.indexes.model.columns.get(ref)?.name !== name) || beforeFacts.references.indexes.size !== beforeFacts.indexes.model.indexes.size || [...beforeFacts.references.indexes].some(([ref, name]) => beforeFacts.indexes.model.indexes.get(ref)?.definition?.name !== name)) throw Error('列排序规则稳定引用未覆盖完整原定义');
  if (!column || !Number.isSafeInteger(candidate.edit.range.start) || !Number.isSafeInteger(candidate.edit.range.end) || candidate.edit.range.start < column.range.start || candidate.edit.range.end > column.range.end || candidate.edit.range.end < candidate.edit.range.start || column.raw.slice(0, candidate.edit.range.start - column.range.start) + candidate.edit.value + column.raw.slice(candidate.edit.range.end - column.range.start) !== candidate.definition || candidate.originalDigest !== sha(JSON.stringify([beforeFacts.target, beforeFacts.base, beforeFacts.catalog.digest]))) throw Error('列排序规则候选范围或原摘要不一致');
  const sql = `ALTER TABLE ${qualified(beforeFacts.target.database, beforeFacts.target.table)} MODIFY COLUMN ${candidate.definition}`;
  if (Buffer.byteLength(sql) > tableColumnPatchLimits.ddlBytes) throw Error('列排序规则单条DDL超过预算');
  const plan: ColumnCollationExecutionPlan = { kind: 'column-collation-execution-v1', target: beforeFacts.target, columnRef, columnName: candidate.columnName, before: candidate.before, next: candidate.next, sql, originalSourceDigest: sha(beforeFacts.base.source), candidate, beforeFacts, beforePhysical, requiredAcknowledgements: ['ddl-implicit-commit', 'external-ddl-window', ...columnCollationAcknowledgements], warnings: [...warnings] };
  return copyEvidence(plan);
}

/** 后核聚合准确物理映射与旧纯范围核对；允许TABLE_ID重建变化，定义通过不代表数据或并发证明。 */
export function verifyColumnCollationExecution(beforeFacts: ColumnCollationFacts, afterFacts: ColumnCollationFacts, beforePhysical: ObservedPhysical, afterPhysical: ObservedPhysical, executionPlan: ColumnCollationExecutionPlan): ColumnCollationExecutionVerification {
  let tableIdChanged = false, stage = '私有准备事实';
  try {
    const before = copyFacts(beforeFacts), after = copyFacts(afterFacts), plan = copyEvidence(executionPlan);
    stage = '原执行计划';
    const physicalBefore = copyPhysical(before, beforePhysical), expected = buildColumnCollationExecutionPlan(before, physicalBefore, plan.columnRef, plan.next);
    if (evidenceDigest(plan) !== evidenceDigest(expected)) throw Error('原执行计划不匹配');
    stage = '结构范围'; const structuralMatch = verifyColumnCollationChange(before, after, plan.candidate).structuralMatch;
    stage = '后核物理身份'; const physicalAfter = copyPhysical(after, afterPhysical);
    if (physicalBefore.serverIdentity !== physicalAfter.serverIdentity || evidenceDigest(physicalBefore.target) !== evidenceDigest(physicalAfter.target) || evidenceDigest(physicalBefore.mapping) !== evidenceDigest(physicalAfter.mapping)) throw Error('后核服务器、逻辑目标或映射变化');
    tableIdChanged = physicalBefore.tableId !== physicalAfter.tableId;
    if (!structuralMatch) return { definitionVerified: false, tableIdChanged, reasons: ['结构范围后核未通过'] };
    return { definitionVerified: true, tableIdChanged, reasons: [] };
  } catch { return { definitionVerified: false, tableIdChanged, reasons: [stage + '核对未通过'] }; }
}
