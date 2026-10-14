import type { FieldPacket } from 'mysql2';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import {
  buildForeignKeyNamespaceEvidence, foreignKeyNamespaceLimits, mergeForeignKeyNameComparisons, planForeignKeyNameComparisons,
  type ForeignKeyNameAvailability, type ForeignKeyNameComparisonReply, type ForeignKeyNamespaceEvidence, type ForeignKeyNamespaceFacts, type ForeignKeyNamespaceInput
} from './tableForeignKeyNamespaceEvidence';

type Row = Record<string, unknown>;
type Directory = 'headers' | 'nativeColumns' | 'rc' | 'kcu';
type PartialReason = Extract<ForeignKeyNamespaceEvidence, { kind: 'partial' }>['reason'];
interface Catalog { key: Directory; table: string; fields: readonly string[]; order: string; where?: string; maximum: number; }
const batchSize = 128;
const factsSql = 'SELECT @@version_compile_os AS compileOs, @@lower_case_table_names AS lowerCaseTableNames';
const externalDdlWarning = '全局目录通过多次只读查询取得，期间可能有外部 DDL；预览与执行前必须重新读取并核对，不能将本次读取视为跨查询原子快照。';

class NamespaceReadError extends Error {
  /** 只保存可公开的固定说明，不把驱动中的账号、SQL 或服务器路径传播给界面。 */
  constructor(readonly reason: PartialReason, message: string) { super(message); }
}

/** 每个捕获边界都重新检查主任务取消，取消不能被降级为可继续使用的 partial 结果。 */
function checkCancelled(context: StructureTaskContext): void {
  context.checkCancelled();
  if (context.managed.signal?.aborted) throw new Error('外键命名空间读取已取消');
}
/** 目录只能包含显式选择的自有数据字段，不执行访问器或补造缺省值。 */
function own(row: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(row, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new NamespaceReadError('inconsistent', '外键目录字段缺失或不是自有数据属性');
  return descriptor.value;
}
/** 空结果也必须核对协议字段，不能把缺列或错误命令的空回包当作可靠 EOF。 */
function fieldsMatch(fields: FieldPacket[], expected: readonly string[]): boolean {
  return Array.isArray(fields) && fields.length === expected.length && fields.every((field, index) => field?.name === expected[index]);
}
/** 编译平台与大小写模式在读取前后都取服务器真值，版本和方言取原结构会话身份。 */
async function readFacts(context: StructureTaskContext): Promise<ForeignKeyNamespaceFacts> {
  checkCancelled(context);
  const { rows, fields } = await structureTaskQuery<unknown>(context, factsSql);
  checkCancelled(context);
  if (!fieldsMatch(fields, ['compileOs', 'lowerCaseTableNames']) || !Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object' || Array.isArray(rows[0])) throw new NamespaceReadError('inconsistent', '无法确认全局外键目录的服务器规则');
  const compileOs = own(rows[0], 'compileOs'), lower = own(rows[0], 'lowerCaseTableNames');
  if (Reflect.ownKeys(rows[0]).length !== 2 || typeof compileOs !== 'string' || !compileOs || ![0, 1, 2, '0', '1', '2'].includes(lower as number)) throw new NamespaceReadError('inconsistent', '全局外键目录的服务器规则回包无效');
  return { dialect: context.managed.status.dialect, serverVersion: context.managed.status.version, compileOs, lowerCaseTableNames: Number(lower) };
}
/** 精确比较已证明规则，不将相似平台名、补丁版本或大小写模式合并。 */
function sameFacts(before: ForeignKeyNamespaceFacts, after: ForeignKeyNamespaceFacts): boolean {
  return before.dialect === after.dialect && before.serverVersion === after.serverVersion && before.compileOs === after.compileOs && before.lowerCaseTableNames === after.lowerCaseTableNames;
}
/** 只选固定字段；文本身份逐项二进制排序，序号保持数值排序；不按当前子表缩窄全局范围。 */
function catalogs(facts: ForeignKeyNamespaceFacts): Catalog[] {
  const modern = facts.dialect === 'mysql' && !facts.serverVersion.startsWith('5.7.');
  return [
    { key: 'headers', table: modern ? 'INNODB_FOREIGN' : 'INNODB_SYS_FOREIGN', fields: ['ID', 'FOR_NAME', 'REF_NAME', 'N_COLS', 'TYPE'], order: 'BINARY ID', maximum: foreignKeyNamespaceLimits.foreignKeys },
    { key: 'nativeColumns', table: modern ? 'INNODB_FOREIGN_COLS' : 'INNODB_SYS_FOREIGN_COLS', fields: ['ID', 'FOR_COL_NAME', 'REF_COL_NAME', 'POS'], order: 'BINARY ID, POS', maximum: foreignKeyNamespaceLimits.parts },
    { key: 'rc', table: 'REFERENTIAL_CONSTRAINTS', fields: ['CONSTRAINT_SCHEMA', 'CONSTRAINT_NAME', 'TABLE_NAME', 'UNIQUE_CONSTRAINT_SCHEMA', 'REFERENCED_TABLE_NAME', 'MATCH_OPTION', 'UPDATE_RULE', 'DELETE_RULE', 'UNIQUE_CONSTRAINT_NAME'], order: 'BINARY CONSTRAINT_SCHEMA, BINARY TABLE_NAME, BINARY CONSTRAINT_NAME', maximum: foreignKeyNamespaceLimits.foreignKeys },
    { key: 'kcu', table: 'KEY_COLUMN_USAGE', fields: ['CONSTRAINT_SCHEMA', 'CONSTRAINT_NAME', 'TABLE_SCHEMA', 'TABLE_NAME', 'COLUMN_NAME', 'ORDINAL_POSITION', 'REFERENCED_TABLE_SCHEMA', 'REFERENCED_TABLE_NAME', 'REFERENCED_COLUMN_NAME', 'POSITION_IN_UNIQUE_CONSTRAINT'], order: 'BINARY CONSTRAINT_SCHEMA, BINARY TABLE_SCHEMA, BINARY TABLE_NAME, BINARY CONSTRAINT_NAME, ORDINAL_POSITION', where: 'REFERENCED_TABLE_NAME IS NOT NULL', maximum: foreignKeyNamespaceLimits.parts }
  ];
}
/** 不先 stringify 大字段；计量 JSON 实际转义与 UTF-8 字节，达到预算立即停止扫描。 */
function scalarBytes(value: unknown, remaining: number): number {
  if (value === null || (typeof value === 'number' && Number.isFinite(value))) return Buffer.byteLength(JSON.stringify(value));
  if (typeof value !== 'string') throw new NamespaceReadError('inconsistent', '外键目录包含非法标量值');
  let bytes = 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) bytes += 2;
    else if (code < 32) bytes += 6;
    else if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index++; }
    else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
    else bytes += 3;
    if (bytes > remaining) throw new NamespaceReadError('budget', '全局外键目录超过 4 MiB 字节预算');
  }
  return bytes;
}
/** 逐行检查并累加四套目录共享预算，只保留已通过检查的行引用。 */
function appendRow(value: unknown, target: Row[], catalog: Catalog, budget: { bytes: number }): void {
  if (target.length >= catalog.maximum) throw new NamespaceReadError('budget', '全局外键目录超过 1000 个外键头或 32000 个字段映射预算');
  if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).length !== catalog.fields.length) throw new NamespaceReadError('inconsistent', '外键目录行字段数量或类型无效');
  let added = 3;
  for (const key of catalog.fields) {
    const cell = own(value, key);
    added += Buffer.byteLength(JSON.stringify(key)) + 2;
    added += scalarBytes(cell, foreignKeyNamespaceLimits.bytes - budget.bytes - added);
    if (budget.bytes + added > foreignKeyNamespaceLimits.bytes) throw new NamespaceReadError('budget', '全局外键目录超过 4 MiB 字节预算');
  }
  budget.bytes += added; target.push(value as Row);
}
/** 驱动错误统一收窄为目录未完成；权限不足不可解释为全局空集。 */
function readFailure(error: unknown): NamespaceReadError {
  if (error instanceof NamespaceReadError) return error;
  const errno = (error as { errno?: number } | null)?.errno;
  return new NamespaceReadError('incomplete', [1044, 1045, 1142, 1227].includes(errno ?? 0) ? '读取全局外键目录的权限不足，名称占用仍然未知' : '全局外键目录读取未完成，名称占用仍然未知');
}

/** 在原结构短会话中全局读取四套目录；EOF、容量和前后规则均已证后才交给纯证据模块闭合。 */
export async function readForeignKeyNamespace(context: StructureTaskContext): Promise<{ evidence: ForeignKeyNamespaceEvidence; warnings: string[]; bytes: number }> {
  checkCancelled(context);
  const warnings = [externalDdlWarning], budget = { bytes: 8 };
  /** partial 从不携带可用名称证明，即使已有其它目录真实返回空集。 */
  const partial = (failure: NamespaceReadError) => {
    const messages = [...warnings, failure.message];
    return { evidence: { kind: 'partial', reason: failure.reason, warnings: messages, bytes: budget.bytes } as ForeignKeyNamespaceEvidence, warnings: messages, bytes: budget.bytes };
  };
  let facts: ForeignKeyNamespaceFacts;
  try { facts = await readFacts(context); }
  catch (error) { checkCancelled(context); return partial(readFailure(error)); }
  const input: ForeignKeyNamespaceInput = { facts, readComplete: { headers: false, nativeColumns: false, rc: false, kcu: false }, headers: [], nativeColumns: [], rc: [], kcu: [] };
  // 复用冻结模块的精确能力门，仅检查 capability；此空输入绝不作为读取结论返回。
  const capability = buildForeignKeyNamespaceEvidence(input);
  if (capability.kind === 'partial' && capability.reason === 'capability') return partial(new NamespaceReadError('capability', capability.warnings.join('；')));
  let failure: NamespaceReadError | undefined;
  try {
    for (const catalog of catalogs(facts)) {
      const target = input[catalog.key] as Row[];
      for (let offset = 0; ; offset += batchSize) {
        checkCancelled(context);
        const sql = `SELECT ${catalog.fields.map(field => `${field} AS ${field}`).join(', ')} FROM information_schema.${catalog.table}${catalog.where ? ` WHERE ${catalog.where}` : ''} ORDER BY ${catalog.order} LIMIT ${batchSize} OFFSET ${offset}`;
        const { rows, fields } = await structureTaskQuery<unknown>(context, sql);
        checkCancelled(context);
        if (!fieldsMatch(fields, catalog.fields) || !Array.isArray(rows) || rows.length > batchSize) throw new NamespaceReadError('inconsistent', '外键目录分页回包或字段别名不完整');
        for (let index = 0; index < rows.length; index++) appendRow(own(rows, String(index)), target, catalog, budget);
        if (rows.length < batchSize) { input.readComplete[catalog.key] = true; break; }
        context.report();
      }
    }
  } catch (error) { checkCancelled(context); failure = readFailure(error); }
  try {
    const after = await readFacts(context);
    if (!sameFacts(facts, after)) failure = new NamespaceReadError('inconsistent', '读取期间服务器版本、平台或标识符大小写规则变化，必须重新读取');
  } catch (error) { checkCancelled(context); failure ??= readFailure(error); }
  checkCancelled(context);
  if (failure) return partial(failure);
  const evidence = buildForeignKeyNamespaceEvidence(input);
  if (evidence.kind === 'partial') warnings.push(...evidence.warnings);
  return { evidence, warnings, bytes: budget.bytes };
}

/** 名称比较只执行冻结计划生成的常量 SELECT；任何缺回包或读错都由严格合并保留 unknown。 */
export async function compareForeignKeyNames(context: StructureTaskContext, evidence: ForeignKeyNamespaceEvidence, database: string, names: readonly string[]): Promise<ReadonlyMap<string, ForeignKeyNameAvailability>> {
  checkCancelled(context);
  const plan = planForeignKeyNameComparisons(evidence, database, names);
  const unknown = () => new Map<string, ForeignKeyNameAvailability>(plan.candidates.map(name => [name, 'unknown']));
  if (plan.kind !== 'ready' || evidence.kind !== 'complete') return unknown();
  const replies: ForeignKeyNameComparisonReply[] = [];
  try {
    if (!sameFacts(evidence.facts, await readFacts(context))) return unknown();
    for (const query of plan.queries) {
      checkCancelled(context);
      const { rows, fields } = await structureTaskQuery<unknown>(context, query.sql);
      checkCancelled(context);
      replies.push({ id: query.id, rows: fieldsMatch(fields, ['candidateOrdinal', 'matched']) && Array.isArray(rows) && rows.length <= foreignKeyNamespaceLimits.candidateBatch ? rows : [] });
    }
    if (!sameFacts(evidence.facts, await readFacts(context))) return unknown();
  } catch { checkCancelled(context); return unknown(); }
  checkCancelled(context);
  return mergeForeignKeyNameComparisons(plan, replies);
}
