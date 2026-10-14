import { z } from 'zod';
import { inspectStructurePatchInput } from './structurePatchInput';
import type { DefinitionRange, TableColumnDefinitionDocument } from './tableColumnPatches';
import type { DependencyCoverage, TrustedIndexColumn, TrustedIndexDefinition } from './tableIndexPatches';

export const tableForeignKeyPatchLimits = { patches: 100, patchBytes: 512 * 1024, foreignKeys: 256, keyParts: 32, ddlBytes: 4 * 1024 * 1024 } as const;
export type ForeignKeyAction = 'RESTRICT' | 'NO ACTION' | 'CASCADE' | 'SET NULL';
export interface ForeignKeyPair { childColumnRef: string; parentColumnRef: string; }
export interface ForeignKeyDefinition { name: string; parentRef: string; pairs: ForeignKeyPair[]; onUpdate: ForeignKeyAction; onDelete: ForeignKeyAction; }
export type ForeignKeyChanges = Partial<ForeignKeyDefinition>;
export type ForeignKeyPatch = { op: 'add'; clientKey: string; definition: ForeignKeyDefinition } | { op: 'drop'; foreignKeyRef: string } | { op: 'alter'; foreignKeyRef: string; changes: ForeignKeyChanges };
export interface TrustedForeignKey { name: string; rawSql: string; range: DefinitionRange; definition?: Readonly<ForeignKeyDefinition>; opaqueReasons: readonly string[]; }
export interface ForeignKeyTableSnapshot {
  target: { database: string; table: string }; identity: string;
  definition: TableColumnDefinitionDocument; columns: ReadonlyMap<string, TrustedIndexColumn>; indexes: ReadonlyMap<string, TrustedIndexDefinition>;
  engine: string; rowFormat: string; pageSize: number; isTemporary: boolean; catalogComplete: boolean;
  partition: 'none' | 'partitioned' | 'unknown';
  /** 表/列/索引的真实非易变属性摘要，不含本次允许改变的外键、统计基数或连接编号。 */
  metadataDigest: string;
}
export interface ForeignKeyPlanSnapshot {
  child: ForeignKeyTableSnapshot;
  /** 仅可信读取器实际持有的父表授权快照。旧约束可保留未读取父表的 ref，但这不构成读取授权，也不能承诺完整核验；新增/替换的新父目标必须在此映射内。 */
  parents: ReadonlyMap<string, ForeignKeyTableSnapshot>;
  foreignKeys: ReadonlyMap<string, TrustedForeignKey>; outgoingComplete: boolean; incomingCoverage: DependencyCoverage;
  /** 仅外部对象指向子表的入向关系，排除本子表自身可计划的 self/出向外键。 */
  externalIncomingDigest: string;
  namespaceNames: { complete: boolean; names: readonly string[];
    /** 由服务器在适用约束名称比较规则下核对；不能把客户端 lowerCase 结果当作可用证明。 */
    comparisons?: ReadonlyMap<string, 'available' | 'conflict' | 'unknown'> };
}
export interface ForeignKeyPlanOptions {
  database: string; dialect: 'mysql' | 'mariadb'; serverVersion: string;
  sqlMode: { ansiQuotes: boolean; noBackslashEscapes: boolean };
  checks: { foreignKeyChecks: 1; uniqueChecks: 1 };
}
export interface ForeignKeyPlanIssue { code: string; message: string; foreignKeyRefs: readonly string[]; columnRefs: readonly string[]; }
export interface PlannedForeignKey { sourceForeignKeyRef?: string; clientKey?: string; definition?: Readonly<ForeignKeyDefinition>; }
export interface ForeignKeyPlanOperation { sourceForeignKeyRef?: string; clientKey?: string; strategy: 'add' | 'drop' | 'replace'; clauses: readonly string[]; }
export type ForeignKeyPlanResult =
  | { kind: 'blocked'; issues: readonly ForeignKeyPlanIssue[] }
  | { kind: 'noop'; warnings: readonly ForeignKeyPlanIssue[] }
  | { kind: 'ready'; sql: string; operations: readonly ForeignKeyPlanOperation[]; finalForeignKeys: readonly PlannedForeignKey[]; warnings: readonly ForeignKeyPlanIssue[];
      verification: { unchangedForeignKeyRefs: readonly string[]; parentRefs: readonly string[]; preserveColumns: true; preserveIndexes: true; preserveOtherConstraints: true; preserveTableTail: true; definitionCanBeFullyVerified: boolean } };

const ref = z.string().min(1).max(200);
const name = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, '首批新增或修改的外键名仅允许 64 位以内 ASCII 字母、数字和下划线，且不能以数字开头');
const action = z.enum(['RESTRICT', 'NO ACTION', 'CASCADE', 'SET NULL']);
const pairs = z.array(z.object({ childColumnRef: ref, parentColumnRef: ref }).strict()).min(1).max(tableForeignKeyPatchLimits.keyParts);
export const foreignKeyDefinitionSchema = z.object({ name, parentRef: ref, pairs, onUpdate: action, onDelete: action }).strict();
const patch = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), clientKey: ref, definition: foreignKeyDefinitionSchema }).strict(),
  z.object({ op: z.literal('drop'), foreignKeyRef: ref }).strict(),
  z.object({ op: z.literal('alter'), foreignKeyRef: ref, changes: z.object({ name: name.optional(), parentRef: ref.optional(), pairs: pairs.optional(), onUpdate: action.optional(), onDelete: action.optional() }).strict() }).strict(),
]);

/** 先检查不可信描述符和 UTF-8 预算，再克隆校验，禁止 getter/toJSON 与非法可选值。 */
export function validateForeignKeyPatches(input: unknown): ForeignKeyPatch[] {
  const inspected = inspectStructurePatchInput(input, '外键补丁');
  const values = z.array(patch).min(1).max(tableForeignKeyPatchLimits.patches).parse(inspected.value);
  const source = new Set<string>(), added = new Set<string>();
  for (const value of values) {
    const seen = value.op === 'add' ? added : source, key = value.op === 'add' ? value.clientKey : value.foreignKeyRef;
    if (seen.has(key)) throw new Error('外键补丁引用重复'); seen.add(key);
    if (value.op === 'alter' && !Object.keys(value.changes).length) throw new Error('外键修改不能为空');
    const mapping = value.op === 'add' ? value.definition.pairs : value.op === 'alter' ? value.changes.pairs : undefined;
    if (mapping && (new Set(mapping.map(pair => pair.childColumnRef)).size !== mapping.length || new Set(mapping.map(pair => pair.parentColumnRef)).size !== mapping.length)) throw new Error('外键有序映射不能重复引用任一侧字段');
  }
  return values;
}

/** 只规范已证明版本中省略的动作，不把 RESTRICT 与 NO ACTION 的目录语义合并。 */
export function defaultForeignKeyAction(options: Pick<ForeignKeyPlanOptions, 'dialect' | 'serverVersion'>): ForeignKeyAction {
  const version = /^(\d+\.\d+\.\d+)(?:$|-)/.exec(options.serverVersion)?.[1];
  if (options.dialect === 'mysql' && !/mariadb/i.test(options.serverVersion)) {
    if (version === '5.7.44') return 'RESTRICT';
    if (version === '8.0.46' || version === '8.4.11') return 'NO ACTION';
  }
  if (options.dialect === 'mariadb' && (version === '10.11.19' || version === '11.4.13')) return 'RESTRICT';
  throw new Error('该版本外键动作及修改策略尚未证明');
}
