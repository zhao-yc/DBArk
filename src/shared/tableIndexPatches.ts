import { z } from 'zod';
import { inspectStructurePatchInput } from './structurePatchInput';
import type { DefinitionRange, TableColumnDefinitionDocument } from './tableColumnPatches';

export const tableIndexPatchLimits = { patches: 100, patchBytes: 512 * 1024, indexes: 256, keyParts: 32, ddlBytes: 4 * 1024 * 1024 } as const;
export type ColumnRef = string;
export type IndexRef = string;
export interface IndexKeyPart { columnRef: ColumnRef; prefixLength?: number; direction: 'asc' | 'desc'; }
export interface IndexDefinition { kind: 'ordinary' | 'unique' | 'primary' | 'fulltext' | 'spatial'; name: string; method: 'BTREE' | 'FULLTEXT' | 'RTREE'; keyParts: IndexKeyPart[]; comment: string; }
export interface IndexChanges { kind?: IndexDefinition['kind']; name?: string; keyParts?: IndexKeyPart[]; comment?: string; optimizerVisible?: boolean; }
export type IndexPatch = { op: 'add'; clientKey: string; definition: IndexDefinition } | { op: 'drop'; indexRef: IndexRef } | { op: 'alter'; indexRef: IndexRef; changes: IndexChanges };
export interface IndexOperationAccess { allowed: boolean; reasons: string[]; }
export interface TableIndexView {
  indexRef: IndexRef; name: string; rawSql: string; kind: IndexDefinition['kind'] | 'unsupported';
  editableDefinition?: IndexDefinition; unsupportedReasons: string[];
  /** 只用于界面显示；预览不接受客户端提交的权限投影。 */
  access: { drop: IndexOperationAccess; rename: IndexOperationAccess; replace: IndexOperationAccess };
  /** 独立原生优化器属性；缺省不授权，也不扩大旧删除、改名或重建权限。 */
  optimizer?: { visible: boolean; access: IndexOperationAccess };
}
export interface ParsedIndexPart {
  range: DefinitionRange; rawSql: string; columnName?: string; prefixLength?: number;
  direction?: 'asc' | 'desc'; expressionSql?: string; opaqueReasons: string[];
}
export interface ParsedIndex {
  range: DefinitionRange; rawSql: string; name: string;
  kind: 'ordinary' | 'unique' | 'primary' | 'fulltext' | 'spatial' | 'opaque';
  method?: string; parts: readonly ParsedIndexPart[]; comment?: string;
  attributes: readonly { kind: string; range: DefinitionRange; rawSql: string }[];
  opaqueReasons: readonly string[];
}
export interface TableIndexDefinitionDocument {
  source: string; indexes: readonly ParsedIndex[]; columnRanges: readonly DefinitionRange[];
  otherConstraintRanges: readonly DefinitionRange[]; tableTailRange: DefinitionRange;
}
export type DependencyCoverage = { kind: 'complete'; source: 'innodb-dictionary' } | { kind: 'partial'; reason: 'permission' | 'budget' | 'identity-unproven' | 'unsupported-catalog' | 'inconsistent' };
export interface ForeignKeyDependency {
  foreignKeyRef: string; direction: 'incoming' | 'outgoing' | 'self'; targetColumnRefs: readonly ColumnRef[];
  support: { kind: 'known'; candidateIndexRefs: readonly IndexRef[]; rule: 'child-leading-full' | 'parent-leading-full' | 'parent-exact-unique' } | { kind: 'unknown'; reason: string };
}
export interface IndexDependencyInput {
  incomingCoverage: DependencyCoverage; outgoingComplete: boolean; foreignKeys: readonly ForeignKeyDependency[];
  autoIncrementColumnRefs: readonly ColumnRef[];
  partition: { kind: 'none' } | { kind: 'explicit'; requiredColumnRefs: readonly ColumnRef[] } | { kind: 'implicit-key'; selectedIndexRef?: IndexRef; reason: string } | { kind: 'unknown'; reason: string };
  hiddenDependencies: readonly { indexRefs: readonly IndexRef[]; reason: string }[];
  automaticForeignKeyIndexProvenance: { kind: 'known'; indexRefs: readonly IndexRef[] } | { kind: 'unknown' };
}
export interface IndexPlanIssue { code: string; message: string; indexRefs: readonly IndexRef[]; columnRefs: readonly ColumnRef[]; foreignKeyRefs: readonly string[]; }
export interface IndexPlanOptions {
  database: string; dialect: 'mysql' | 'mariadb'; serverVersion: string; engine: 'InnoDB';
  sqlMode: { ansiQuotes: boolean; noBackslashEscapes: boolean };
  capabilities: { renameIndex: boolean; descendingIndexes: boolean; maxKeyParts: number; maxIndexNameCharacters: number; maxIndexCommentBytes: number; maxKeyBytes: number;
    /** 特殊索引与普通键预算分开；缺少投影就是未知，不能沿用BTREE能力。 */
    specialIndexes?: { fulltext: boolean; spatial: boolean; spatialRequiresSrid: boolean } };
  checks: { foreignKeyChecks: 1; uniqueChecks: 1 };
}
export interface TrustedIndexColumn {
  name: string; nullable: boolean; dataType: string; columnType: string; charset?: string; collation?: string;
  characterMaxLength?: string; characterOctetLength?: string; charsetMaxBytes?: number;
  generated: boolean; hidden: boolean;
  /** 非前缀列的完整键字节上限由可信目录及类型能力提供；未知时不能猜长度。 */
  fullKeyBytes?: number;
  prefix: { kind: 'allowed'; unit: 'characters' | 'bytes'; maxLength: number } | { kind: 'forbidden'; reason: string } | { kind: 'unknown'; reason: string };
  specialIndexes?: { fulltext: IndexOperationAccess; spatial: IndexOperationAccess; srid?: number };
}
export interface TrustedIndexDefinition { parsed: ParsedIndex; definition?: Readonly<IndexDefinition>; visible: boolean | 'unknown'; generated: boolean | 'unknown'; }
export interface IndexPlanSnapshot {
  definition: TableColumnDefinitionDocument; indexDocument: TableIndexDefinitionDocument;
  columns: ReadonlyMap<ColumnRef, TrustedIndexColumn>; indexes: ReadonlyMap<IndexRef, TrustedIndexDefinition>;
  dependencies: IndexDependencyInput;
}
export interface PlannedIndex { sourceIndexRef?: IndexRef; clientKey?: string; definition?: Readonly<IndexDefinition>; }
export interface IndexPlanOperation { sourceIndexRef?: IndexRef; clientKey?: string; strategy: 'add' | 'drop' | 'rename' | 'replace'; clauses: readonly string[]; }
export interface IndexDependencyDecision { allowed: boolean; blockers: readonly IndexPlanIssue[]; warnings: readonly IndexPlanIssue[]; }
export type IndexPlanResult =
  | { kind: 'blocked'; issues: readonly IndexPlanIssue[] }
  | { kind: 'noop'; warnings: readonly IndexPlanIssue[] }
  | { kind: 'ready'; sql: string; operations: readonly IndexPlanOperation[]; finalIndexes: readonly PlannedIndex[];
      preservedOpaqueIndexRefs: readonly IndexRef[]; warnings: readonly IndexPlanIssue[];
      verification: { unchangedColumnRanges: readonly DefinitionRange[]; unchangedConstraintRanges: readonly DefinitionRange[]; unchangedIndexRefs: readonly IndexRef[]; preserveTableTail: true; requiresDependencyRecheck: true; definitionCanBeFullyVerified: boolean } };

const ref = z.string().min(1).max(200);
const name = z.string().min(1).max(64).refine(value => !value.includes('\0') && !/\s$/.test(value), '索引名称不能含 NUL 或以空白结束');
const keyPart = z.object({ columnRef: ref, prefixLength: z.number().int().min(1).max(4294967295).optional(), direction: z.enum(['asc', 'desc']) }).strict();
const parts = z.array(keyPart).min(1).max(tableIndexPatchLimits.keyParts);
const kind = z.enum(['ordinary', 'unique', 'primary', 'fulltext', 'spatial']);
export const indexDefinitionSchema = z.object({ kind, name, method: z.enum(['BTREE', 'FULLTEXT', 'RTREE']), keyParts: parts, comment: z.string() }).strict().superRefine((value, context) => {
  const expected = value.kind === 'fulltext' ? 'FULLTEXT' : value.kind === 'spatial' ? 'RTREE' : 'BTREE';
  if (value.method !== expected) context.addIssue({ code: 'custom', message: '索引种类和方法不一致', path: ['method'] });
  if (value.kind === 'fulltext' || value.kind === 'spatial') {
    if (value.keyParts.some(part => part.prefixLength !== undefined || part.direction !== 'asc')) context.addIssue({ code: 'custom', message: '特殊索引不接受前缀或方向设置', path: ['keyParts'] });
    if (value.kind === 'spatial' && value.keyParts.length !== 1) context.addIssue({ code: 'custom', message: '空间索引只接受一个完整空间字段', path: ['keyParts'] });
  }
});
export const indexPatchSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), clientKey: ref, definition: indexDefinitionSchema }).strict(),
  z.object({ op: z.literal('drop'), indexRef: ref }).strict(),
  z.object({ op: z.literal('alter'), indexRef: ref, changes: z.object({ kind: kind.optional(), name: name.optional(), keyParts: parts.optional(), comment: z.string().optional(), optimizerVisible: z.boolean().optional() }).strict() }).strict(),
]);

/** 名称约束在新增及合成最终定义后共用，不把用户名称自动修正为保留名。 */
export function assertIndexDefinitionNames(definition: Readonly<IndexDefinition>): void {
  if (definition.kind === 'primary' ? definition.name !== 'PRIMARY' : definition.name.toUpperCase() === 'PRIMARY') throw new Error('主键名称必须精确为 PRIMARY，其他索引不能使用该保留名');
  if (definition.name.toUpperCase() === 'GEN_CLUST_INDEX') throw new Error('不能使用 InnoDB 系统聚簇索引保留名');
  if (definition.name.toUpperCase() === 'FTS_DOC_ID_INDEX') throw new Error('全文文档定位索引由服务器或人工专门管理，本批不能创建或重建');
  const refs = new Set<string>();
  for (const part of definition.keyParts) { if (refs.has(part.columnRef)) throw new Error('索引不能重复引用同一字段'); refs.add(part.columnRef); }
}

/** 先检查不可信结构与 JSON 字节预算，再交给 Zod 克隆；不执行 getter 或 toJSON。 */
export function validateIndexPatches(input: unknown): IndexPatch[] {
  const checked = inspectStructurePatchInput(input, '索引补丁');
  const patches = z.array(indexPatchSchema).min(1).max(tableIndexPatchLimits.patches).parse(checked.value);
  const seen = new Set<string>(), added = new Set<string>();
  for (const patch of patches) {
    const set = patch.op === 'add' ? added : seen, key = patch.op === 'add' ? patch.clientKey : patch.indexRef;
    if (set.has(key)) throw new Error('索引补丁引用重复'); set.add(key);
    if (patch.op === 'add') assertIndexDefinitionNames(patch.definition);
    if (patch.op === 'alter' && Object.keys(patch.changes).length === 0) throw new Error('索引修改不能为空');
    // 专用属性不能混入会删除/重建键的旧计划，也不能借undefined表示继承。
    if (patch.op === 'alter' && Object.hasOwn(patch.changes, 'optimizerVisible') && (patches.length !== 1 || Object.keys(patch.changes).length !== 1 || typeof patch.changes.optimizerVisible !== 'boolean')) throw new Error('索引优化器参与状态必须为独立单项、单属性的明确布尔变更');
  }
  return patches;
}
