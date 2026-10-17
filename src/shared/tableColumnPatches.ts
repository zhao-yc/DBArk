import { z } from 'zod';
import { inspectStructurePatchInput } from './structurePatchInput';
import type { SqlLexicalMode } from './queryParameters';
import type { TableEncodingPair } from './tableDefaultEncoding';

export const tableColumnPatchLimits = { definitionBytes: 2 * 1024 * 1024, columns: 4096, tokens: 150000, nesting: 128, patches: 100, patchBytes: 512 * 1024, ddlBytes: 4 * 1024 * 1024 } as const;
/** 这些兼容模式会省略 SHOW CREATE 属性，结构读取可规范化，未经规范化的结构导出必须拒绝。 */
export const definitionOmittingSqlModes = ['NO_FIELD_OPTIONS', 'NO_KEY_OPTIONS', 'NO_TABLE_OPTIONS', 'ANSI', 'DB2', 'MAXDB', 'MSSQL', 'ORACLE', 'POSTGRESQL', 'MYSQL323', 'MYSQL40'] as const;
/** 范围使用 JS 字符串的 UTF-16 偏移，end 不包含在范围内，可直接 source.slice。 */
export interface DefinitionRange { start: number; end: number; }
export interface DefinitionFragment { range: DefinitionRange; raw: string; }
export type ColumnEditableAttribute = 'name' | 'type' | 'nullable' | 'default' | 'comment' | 'position' | 'onUpdate';
export interface ColumnAttributeAccess { editable: boolean; reason?: string; }
export interface TableDefinitionContext { dialect: 'mysql' | 'mariadb'; mode: SqlLexicalMode; }
export type ReadColumnDefault =
  | { kind: 'none' }
  | { kind: 'null' }
  | { kind: 'literal'; valueType: 'text' | 'number' | 'boolean' | 'binary'; value: string; introducer?: string; encoding?: 'hex' | 'bits' }
  | { kind: 'expression'; sql: string }
  | { kind: 'opaque'; sql: string; reason: string };
export interface ColumnDefinitionAttribute extends DefinitionFragment {
  kind: 'nullable' | 'default' | 'comment' | 'charset' | 'collation' | 'auto-increment' | 'on-update' | 'generated' | 'visibility' | 'storage' | 'column-format' | 'srid' | 'check' | 'opaque';
}
export interface TableColumnDefinition extends DefinitionFragment {
  kind: 'column'; name: string; nameRange: DefinitionRange; ordinal: number;
  type: DefinitionFragment & { known: boolean };
  nullable: boolean | undefined; default: ReadColumnDefault; comment: string | undefined;
  attributes: ColumnDefinitionAttribute[]; access: Record<ColumnEditableAttribute, ColumnAttributeAccess>;
}
export interface TableConstraintDefinition extends DefinitionFragment { kind: 'constraint'; constraintKind: string; }
export interface TableColumnDefinitionDocument {
  source: string; context: TableDefinitionContext; database?: string; table: string;
  head: DefinitionFragment; tail: DefinitionFragment; body: DefinitionRange;
  items: (TableColumnDefinition | TableConstraintDefinition)[];
  separators: DefinitionRange[]; columns: TableColumnDefinition[];
  /** Map 只供执行进程内部查找；IPC 投影使用 columns 数组。 */
  columnsByName: Map<string, TableColumnDefinition>;
}

/** 只识别服务器受控时间默认值及规范外括号，不接受文字量、注释或任何运算表达式。 */
export function readControlledTimestampDefault(sql: string): { precision: number } | undefined {
  if (sql.length > 512) return undefined;
  let value = sql.trim(), depth = 0;
  while (value.startsWith('(') && value.endsWith(')')) {
    if (++depth > 128) return undefined;
    value = value.slice(1, -1).trim();
  }
  const match = /^(?:CURRENT_TIMESTAMP(?:\s*\(\s*([0-6]?)\s*\))?|NOW\s*\(\s*([0-6]?)\s*\))$/i.exec(value);
  return match ? { precision: Number(match[1] || match[2] || '0') } : undefined;
}

/** 二进制列的普通文本默认值可能已被 SHOW CREATE 转码损坏，不能从该文本重建原始字节。 */
export function hasUnprovenBinaryDefault(column: TableColumnDefinition): boolean {
  return /^(?:BINARY|VARBINARY)\b/i.test(column.type.raw) && column.default.kind === 'literal' && column.default.valueType === 'text';
}

/** MariaDB 任意 ALTER 都可能内部重述未改默认表达式，不能与仅目标列的二进制风险混为一类。 */
function mariaDefaultRestateAccess(column: TableColumnDefinition, dialect: TableDefinitionContext['dialect']): ColumnAttributeAccess {
  const value = column.default;
  const unsafe = dialect === 'mariadb' && (value.kind === 'opaque' || (value.kind === 'expression' && !readControlledTimestampDefault(value.sql)) || (value.kind === 'literal' && value.introducer !== undefined && !['x', 'b', '0x'].includes(value.introducer.toLowerCase())));
  return unsafe ? { editable: false, reason: 'MariaDB 非受控默认表达式或字符集引导值不能证明内部重述等价；需先显式替换或删除表中全部风险默认值，原生改名也不安全' } : { editable: true };
}

/** 目标列完整重述同时受表达式和字节保真约束；旁列是否允许由独立的整表风险门决定。 */
export function columnRestateAccess(column: TableColumnDefinition, dialect: TableDefinitionContext['dialect']): ColumnAttributeAccess {
  if (hasUnprovenBinaryDefault(column)) return { editable: false, reason: '二进制列的文本默认值不能证明原始字节，不能重述该列；可专用替换或删除默认值，旁列仍可修改但完整结果需人工核对' };
  return mariaDefaultRestateAccess(column, dialect);
}

/** 界面与计划器共用目标列能力；是否覆盖全部风险默认值必须由整表预览另行检查。 */
export function columnPatchAccess(column: TableColumnDefinition, dialect: TableDefinitionContext['dialect'], serverVersion?: string): TableColumnDefinition['access'] {
  const access = Object.fromEntries(Object.entries(column.access).map(([key, value]) => [key, { ...value }])) as TableColumnDefinition['access'];
  const restate = columnRestateAccess(column, dialect);
  if (!restate.editable) for (const key of ['name', 'type', 'nullable', 'comment', 'position'] as const) access[key] = restate;
  access.onUpdate = columnOnUpdateAccess(column, dialect, serverVersion);
  return access;
}

/** 原ON UPDATE只投影已识别的受控时间表达式；undefined表示未知，不冒充移除。 */
export function readColumnOnUpdate(column: TableColumnDefinition): ColumnOnUpdatePatch | undefined {
  const attributes = column.attributes.filter(attribute => attribute.kind === 'on-update');
  if (!attributes.length) return null;
  if (attributes.length !== 1) return undefined;
  const expression = /^ON\s+UPDATE\s+(.+)$/is.exec(attributes[0].raw)?.[1];
  const value = expression && readControlledTimestampDefault(expression);
  return value ? { kind: 'expression', expression: 'current-timestamp', precision: value.precision } : undefined;
}

/** 精度沿用字段本身；未提供精度不代表零，显式null才表示删除ON UPDATE。 */
export function sameColumnOnUpdate(left: ColumnOnUpdatePatch | undefined, right: ColumnOnUpdatePatch | undefined, typeSql: string): boolean {
  if (left === undefined || right === undefined) return false;
  if (left === null || right === null) return left === right;
  const precision = Number(/\((\d+)\)/.exec(typeSql)?.[1] ?? 0);
  return (left.precision ?? precision) === (right.precision ?? precision);
}

/** 既有和新增自动时间属性使用同一已知版本门，不按相近版本推断支持。 */
export function columnOnUpdateVersionSupported(dialect: TableDefinitionContext['dialect'], serverVersion?: string): boolean {
  const version = serverVersion?.replace(/^5\.5\.5-/, '').match(/^\d+\.\d+\.\d+/)?.[0];
  return (dialect === 'mysql' ? ['5.7.44', '8.0.46', '8.4.11'] : ['10.11.19', '11.4.13']).includes(version ?? '');
}

/** 首片仅开放既定五版普通时间列；TIMESTAMP必须已有明确默认值，避免隐式默认行为。 */
export function columnOnUpdateAccess(column: TableColumnDefinition, dialect: TableDefinitionContext['dialect'], serverVersion?: string): ColumnAttributeAccess {
  if (!columnOnUpdateVersionSupported(dialect, serverVersion)) return { editable: false, reason: '当前版本尚未开放自动更新时间属性' };
  if (!/^(?:DATETIME|TIMESTAMP)(?:\s*\([0-6]\))?$/i.test(column.type.raw.trim())) return { editable: false, reason: '自动更新时间只开放既有普通DATETIME/TIMESTAMP字段' };
  if (column.access.type?.editable !== true || column.access.default?.editable !== true || column.attributes.some(attribute => ['generated', 'opaque', 'visibility', 'auto-increment'].includes(attribute.kind))) return { editable: false, reason: '字段含只读或不可靠属性，不能修改自动更新时间' };
  const restate = columnRestateAccess(column, dialect); if (!restate.editable) return restate;
  if (column.nullable === undefined) return { editable: false, reason: '字段可空性未确认，不能重述时间字段' };
  if (column.default.kind === 'none') return { editable: false, reason: '时间字段没有明确DEFAULT，不能证明自动时间属性变化后默认行为保持' };
  if (/^TIMESTAMP\b/i.test(column.type.raw) && !column.attributes.some(attribute => attribute.kind === 'nullable')) return { editable: false, reason: 'TIMESTAMP没有明确NULL属性，不能证明隐式可空行为保持' };
  const value = readColumnOnUpdate(column), precision = Number(/\((\d+)\)/.exec(column.type.raw)?.[1] ?? 0);
  if (column.default.kind === 'expression') {
    const defaultTime = readControlledTimestampDefault(column.default.sql);
    if (!defaultTime || defaultTime.precision !== precision) return { editable: false, reason: '时间字段默认表达式或精度不受控，不能重述自动更新时间' };
  }
  if (value === undefined || (value !== null && value.precision !== precision)) return { editable: false, reason: '原自动更新时间表达式或精度不能可靠识别' };
  return { editable: true };
}

/** 返回整表仍不可证明可保留的默认值列；名称数组不使用原型敏感字典。 */
export function tableColumnDefaultRisks(document: TableColumnDefinitionDocument): string[] {
  return document.columns.filter(column => !mariaDefaultRestateAccess(column, document.context.dialect).editable).map(column => column.name);
}

/** 保留具体列名帮助用户定位；不把某个异常字符串特征当作风险识别条件。 */
export function tableColumnDefaultRiskMessage(names: string[]): string {
  return `MariaDB 表中存在不能证明内部重述等价的默认值（字段：${names.map(name => JSON.stringify(name)).join('、')}）。任意字段 ALTER，包括旁列修改和原生改名，都可能改变这些默认值；请先单独预览显式替换或删除全部风险默认值。默认属性本身无法可靠解析时仍只读，当前编辑器不保证可解除该限制，需独立核对处理。`;
}

/** 基本表和视图都必须具有可信完整模式；不能通过对象种类绕过隐藏定义保护。 */
export function assertStructureExportMode(sqlMode: string | undefined): asserts sqlMode is string {
  if (typeof sqlMode !== 'string' || !/^[A-Z0-9_,]*$/i.test(sqlMode)) throw new Error('无法确认完整 SQL 模式，未导出表结构；可以单独导出数据');
  const modes = sqlMode.toUpperCase().split(',');
  if (definitionOmittingSqlModes.some(mode => modes.includes(mode))) throw new Error('当前兼容 SQL 模式会隐藏完整表定义，未导出结构；请先核对连接模式或单独导出数据');
}

/** 自动基本表结构导出不能交付已知不可保真重建的定义；数据文件不使用本检查。 */
export function assertTableStructureExportable(document: TableColumnDefinitionDocument, sqlMode: string | undefined): void {
  assertStructureExportMode(sqlMode);
  const binary = document.columns.filter(hasUnprovenBinaryDefault).map(column => column.name);
  if (binary.length) throw new Error(`二进制默认值不能证明原始字节（字段：${binary.map(name => JSON.stringify(name)).join('、')}），已拒绝含结构 SQL 导出；原目标文件保留，可单独导出数据。`);
  const risks = tableColumnDefaultRisks(document);
  if (risks.length) throw new Error(`该 MariaDB 表含不能证明重建保真的默认值（字段：${risks.map(name => JSON.stringify(name)).join('、')}），已拒绝含结构 SQL 导出；原目标文件保留，可单独导出数据。`);
}

const name = z.string().min(1).max(64).refine(value => !value.includes('\0'), '名称不能包含 NUL');
const ref = z.string().min(1).max(200);
export const columnTypePatchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('integer'), type: z.enum(['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT']), unsigned: z.boolean() }).strict(),
  z.object({ kind: z.literal('decimal'), precision: z.number().int().min(1).max(65), scale: z.number().int().min(0).max(38), unsigned: z.boolean() }).strict(),
  z.object({ kind: z.literal('float'), type: z.enum(['FLOAT', 'DOUBLE']), unsigned: z.boolean() }).strict(),
  z.object({ kind: z.literal('bit'), length: z.number().int().min(1).max(64) }).strict(),
  z.object({ kind: z.literal('string'), type: z.enum(['CHAR', 'VARCHAR', 'BINARY', 'VARBINARY']), length: z.number().int().min(1).max(65535) }).strict(),
  z.object({ kind: z.literal('large'), type: z.enum(['TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB']) }).strict(),
  z.object({ kind: z.literal('temporal'), type: z.enum(['DATE', 'YEAR', 'TIME', 'DATETIME', 'TIMESTAMP']), precision: z.number().int().min(0).max(6).optional() }).strict(),
  z.object({ kind: z.literal('enumeration'), type: z.enum(['ENUM', 'SET']), values: z.array(z.string()).min(1).max(65535) }).strict(),
]);
export type ColumnTypePatch = z.infer<typeof columnTypePatchSchema>;
export const columnTimestampExpressionSchema = z.object({ kind: z.literal('expression'), expression: z.literal('current-timestamp'), precision: z.number().int().min(0).max(6).optional() }).strict();
export const columnDefaultPatchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(), z.object({ kind: z.literal('null') }).strict(),
  z.object({ kind: z.literal('literal'), valueType: z.enum(['text', 'number', 'boolean', 'binary']), value: z.string() }).strict(),
  columnTimestampExpressionSchema,
]);
export type ColumnDefaultPatch = z.infer<typeof columnDefaultPatchSchema>;
export const columnOnUpdatePatchSchema = columnTimestampExpressionSchema.nullable();
export type ColumnOnUpdatePatch = z.infer<typeof columnOnUpdatePatchSchema>;
/** 只承载实际目录中的完整配对；同字符集、差异和权限仍由专用引擎流程重核。 */
export const columnCollationPatchSchema = z.object({ charset: z.string().regex(/^[A-Za-z0-9_]{1,64}$/), collation: z.string().regex(/^[A-Za-z0-9_]{1,64}$/) }).strict();
/** 默认算法可能重建或等待锁；外部查询的排序语义不由定义后核证明。 */
export const columnCollationAcknowledgements = ['column-collation-semantics', 'column-collation-default-algorithm'] as const;
const position = z.discriminatedUnion('kind', [z.object({ kind: z.literal('first') }).strict(), z.object({ kind: z.literal('last') }).strict(), z.object({ kind: z.literal('after'), columnRef: ref }).strict()]);
export const columnPatchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), clientKey: ref, name, type: columnTypePatchSchema, nullable: z.boolean(), default: columnDefaultPatchSchema, comment: z.string(), position, onUpdate: columnOnUpdatePatchSchema.optional() }).strict(),
  z.object({ kind: z.literal('drop'), columnRef: ref }).strict(),
  z.object({ kind: z.literal('alter'), columnRef: ref, changes: z.object({ name: name.optional(), type: columnTypePatchSchema.optional(), nullable: z.boolean().optional(), default: columnDefaultPatchSchema.optional(), comment: z.string().optional(), position: position.optional(), onUpdate: columnOnUpdatePatchSchema.optional(), collation: columnCollationPatchSchema.optional() }).strict() }).strict(),
]);
export type ColumnPatch = z.infer<typeof columnPatchSchema>;

/** 新增字段不借用既有列模型；只验证显式受控属性，省略该键完全沿用原ADD行为。 */
export function assertAddedColumnOnUpdate(column: Pick<Extract<ColumnPatch, { kind: 'add' }>, 'type' | 'nullable' | 'default' | 'onUpdate'>): void {
  if (!Object.hasOwn(column, 'onUpdate')) return;
  if (column.type.kind !== 'temporal' || !['DATETIME', 'TIMESTAMP'].includes(column.type.type)) throw new Error('新增自动更新时间只接受普通DATETIME/TIMESTAMP字段');
  // 即使显式选择null，也不能让旧TIMESTAMP规则偷偷附加自动属性；未勾选才沿原ADD路径。
  if (column.default.kind === 'none') throw new Error('新增自动更新时间必须显式设置DEFAULT，不能依赖隐式默认值');
  if (column.default.kind === 'null' && !column.nullable) throw new Error('NOT NULL列不能设置NULL默认值');
  const precision = column.type.precision ?? 0;
  if (column.default.kind === 'expression' && column.default.precision !== undefined && column.default.precision !== precision) throw new Error('新增默认时间表达式精度必须与字段精度一致');
  if (column.onUpdate === null) return;
  if (!column.onUpdate || (column.onUpdate.precision !== undefined && column.onUpdate.precision !== precision)) throw new Error('新增自动更新时间精度必须与字段精度一致');
}

/** 新字段编辑器的属性开关显示受控能力；最终载荷仍由严格Schema和计划器重核。 */
export function addedColumnOnUpdateAccess(column: { type: ColumnTypePatch; nullable: boolean | undefined; default: ColumnDefaultPatch }, dialect: TableDefinitionContext['dialect'], serverVersion?: string): ColumnAttributeAccess {
  if (!columnOnUpdateVersionSupported(dialect, serverVersion)) return { editable: false, reason: '当前版本尚未开放自动更新时间属性' };
  if (column.nullable === undefined) return { editable: false, reason: '请明确选择NULL或NOT NULL后设置新增自动更新时间' };
  try { assertAddedColumnOnUpdate({ ...column, nullable: column.nullable, onUpdate: { kind: 'expression', expression: 'current-timestamp' } }); return { editable: true }; }
  catch (error) { return { editable: false, reason: error instanceof Error ? error.message : '新增自动更新时间属性不可用' }; }
}

/** 字段补丁复用结构输入守卫，保留原公开入口和字段错误前缀。 */
export function inspectColumnPatchInput(input: unknown): { value: unknown; bytes: number } {
  return inspectStructurePatchInput(input, '字段补丁');
}

/** 只验证纯补丁语法与预算；目标存在性、依赖、位次环和服务器能力由计划器检查。 */
export function validateColumnPatches(input: unknown, maxDecimalScale: 30 | 38 = 30): ColumnPatch[] {
  const checked = inspectColumnPatchInput(input);
  const patches = z.array(columnPatchSchema).min(1).max(tableColumnPatchLimits.patches).parse(checked.value);
  // 首片只能单列单属性，不能静默拆分、忽略旁属性或先发送一部分DDL。
  const collation = patches.find(patch => patch.kind === 'alter' && Object.hasOwn(patch.changes, 'collation'));
  if (collation && (patches.length !== 1 || collation.kind !== 'alter' || Object.keys(collation.changes).length !== 1)) throw new Error('列排序规则只能单列单属性独立修改');
  const references = new Set<string>(), added = new Set<string>();
  for (const patch of patches) {
    const seen = patch.kind === 'add' ? added : references, key = patch.kind === 'add' ? patch.clientKey : patch.columnRef;
    if (seen.has(key)) throw new Error('字段补丁引用重复'); seen.add(key);
    if (patch.kind === 'drop') continue;
    if (patch.kind === 'add') assertAddedColumnOnUpdate(patch);
    const values = patch.kind === 'alter' ? patch.changes : patch;
    if (patch.kind === 'alter' && !Object.values(values).some(value => value !== undefined)) throw new Error('字段修改不能为空');
    const type = values.type;
    if (type?.kind === 'decimal' && (type.scale > type.precision || type.scale > maxDecimalScale)) throw new Error('DECIMAL 精度或当前方言小数位无效');
    if (type?.kind === 'temporal' && ['DATE', 'YEAR'].includes(type.type) && type.precision !== undefined) throw new Error('DATE/YEAR 不接受小数秒精度');
    if (type?.kind === 'enumeration' && (new Set(type.values).size !== type.values.length || (type.type === 'SET' && type.values.length > 64))) throw new Error('ENUM/SET 元素重复或超出数量范围');
    const value = values.default;
    if (value?.kind === 'literal') {
      if (value.valueType === 'number' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.value)) throw new Error('数字默认值必须是精确数字文本');
      if (value.valueType === 'boolean' && !['true', 'false'].includes(value.value)) throw new Error('布尔默认值只能为 true/false');
      if (value.valueType === 'binary' && !/^(?:[a-fA-F0-9]{2})*$/.test(value.value)) throw new Error('二进制默认值要求偶数位 hex');
    }
  }
  return patches;
}

/** 字段差异 IPC 只传目标、快照引用或一次性预览令牌；执行不接受客户端 SQL。 */
export interface TableColumnPatchTarget { connectionId: string; database: string; table: string; }
export interface TableColumnGetInput extends TableColumnPatchTarget { taskId: string; }
export interface TableColumnPreviewInput { snapshotId: string; patches: ColumnPatch[]; taskId: string; }
export interface TableColumnApplyInput { previewToken: string; acknowledgements: string[]; taskId: string; }
export interface TableColumnReleaseInput { snapshotId?: string; previewToken?: string; }
/** IPC 返回数组投影及独立引用，不能将执行进程内部 Map 当作客户端补丁来源。 */
export interface TableColumnView {
  columnRef: string; name: string; ordinal: number; typeSql: string; nullable: boolean | undefined;
  /** 仅在读取器及能力检查确认可完整表达时提供，界面不能从缺省建议猜测原类型。 */
  editableType?: ColumnTypePatch;
  default: ReadColumnDefault; comment: string | undefined; rawDefinition: string;
  /** null为无自动更新；缺失表示不能可靠投影，不能据此生成移除补丁。 */
  onUpdate?: ColumnOnUpdatePatch;
  /** 有效编码来自实际列目录；access仅为本快照能力，不能替代preview/apply重核。 */
  collation?: { current: TableEncodingPair; access: ColumnAttributeAccess };
  access: Record<ColumnEditableAttribute, ColumnAttributeAccess>;
}
export interface TableColumnGetOutput {
  target: TableColumnPatchTarget; snapshotId: string; ddlHash: string; expiresAt: string;
  columns: TableColumnView[]; warnings: string[];
  /** 只在真实完整目录与合计预算允许时提供；不得截断、猜测或在每列重复。 */
  collationCatalog?: TableEncodingPair[];
  capabilities: { dialect: 'mysql' | 'mariadb'; serverVersion: string; maxDecimalScale: 30 | 38 };
  definitionContext?: { originalSqlMode: string; sqlMode: string; characterSetConnection: 'utf8mb4'; collationConnection: 'utf8mb4_bin'; sqlQuoteShowCreate: true };
}
export interface TableColumnPreviewOutput {
  previewToken: string; expiresAt: string; target: TableColumnPatchTarget; ddlHash: string; sql: string;
  changes: { columnRef?: string; description: string }[]; warnings: string[]; requiredAcknowledgements: string[];
  concurrencyPolicy: 'recheck-before-ddl';
}
export interface TableColumnApplyOutput {
  ddlSubmitted: true; ddlCompleted: true; definitionVerified: boolean; warnings: string[];
  after?: { ddlHash: string; columns: TableColumnView[] }; verificationError?: string;
}
/** 任务事件的结构化证据；缺少完成证据的断线不等价于 DDL 未执行。 */
export interface TableColumnApplyProgress {
  phase: 'connecting' | 'reading' | 'rechecking' | 'executing' | 'verifying' | 'releasing';
  ddlSubmitted: boolean; ddlCompleted: boolean; definitionVerified: boolean;
  outcome: 'not-sent' | 'succeeded' | 'failed' | 'unknown';
}
