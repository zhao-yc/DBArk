import { z } from 'zod';
import type { SqlLexicalMode } from './queryParameters';

export const tableColumnPatchLimits = { definitionBytes: 2 * 1024 * 1024, columns: 4096, tokens: 150000, nesting: 128, patches: 100, patchBytes: 512 * 1024, ddlBytes: 4 * 1024 * 1024 } as const;
/** 这些兼容模式会省略 SHOW CREATE 属性，结构读取可规范化，未经规范化的结构导出必须拒绝。 */
export const definitionOmittingSqlModes = ['NO_FIELD_OPTIONS', 'NO_KEY_OPTIONS', 'NO_TABLE_OPTIONS', 'ANSI', 'DB2', 'MAXDB', 'MSSQL', 'ORACLE', 'POSTGRESQL', 'MYSQL323', 'MYSQL40'] as const;
/** 范围使用 JS 字符串的 UTF-16 偏移，end 不包含在范围内，可直接 source.slice。 */
export interface DefinitionRange { start: number; end: number; }
export interface DefinitionFragment { range: DefinitionRange; raw: string; }
export type ColumnEditableAttribute = 'name' | 'type' | 'nullable' | 'default' | 'comment' | 'position';
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
export function columnPatchAccess(column: TableColumnDefinition, dialect: TableDefinitionContext['dialect']): TableColumnDefinition['access'] {
  const access = Object.fromEntries(Object.entries(column.access).map(([key, value]) => [key, { ...value }])) as TableColumnDefinition['access'];
  const restate = columnRestateAccess(column, dialect);
  if (!restate.editable) for (const key of ['name', 'type', 'nullable', 'comment', 'position'] as const) access[key] = restate;
  return access;
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
export const columnDefaultPatchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(), z.object({ kind: z.literal('null') }).strict(),
  z.object({ kind: z.literal('literal'), valueType: z.enum(['text', 'number', 'boolean', 'binary']), value: z.string() }).strict(),
  z.object({ kind: z.literal('expression'), expression: z.literal('current-timestamp'), precision: z.number().int().min(0).max(6).optional() }).strict(),
]);
export type ColumnDefaultPatch = z.infer<typeof columnDefaultPatchSchema>;
const position = z.discriminatedUnion('kind', [z.object({ kind: z.literal('first') }).strict(), z.object({ kind: z.literal('last') }).strict(), z.object({ kind: z.literal('after'), columnRef: ref }).strict()]);
export const columnPatchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), clientKey: ref, name, type: columnTypePatchSchema, nullable: z.boolean(), default: columnDefaultPatchSchema, comment: z.string(), position }).strict(),
  z.object({ kind: z.literal('drop'), columnRef: ref }).strict(),
  z.object({ kind: z.literal('alter'), columnRef: ref, changes: z.object({ name: name.optional(), type: columnTypePatchSchema.optional(), nullable: z.boolean().optional(), default: columnDefaultPatchSchema.optional(), comment: z.string().optional(), position: position.optional() }).strict() }).strict(),
]);
export type ColumnPatch = z.infer<typeof columnPatchSchema>;

/** 不调用输入的 getter/toJSON：按自有数据描述符递增计量 JSON UTF-8 字节，并只复制已通过预算的值。 */
export function inspectColumnPatchInput(input: unknown): { value: unknown; bytes: number } {
  let bytes = 0, nodes = 0;
  const ancestors = new WeakSet<object>();
  const charge = (size: number): void => { bytes += size; if (bytes > tableColumnPatchLimits.patchBytes) throw new Error('字段补丁超过 512 KiB'); };
  /** JSON 转义开销按字符计算，不先构造巨大转义字符串或 UTF-8 缓冲。 */
  const string = (value: string): void => {
    if (value.length + 2 > tableColumnPatchLimits.patchBytes - bytes) throw new Error('字段补丁超过 512 KiB');
    charge(2);
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('字段补丁含非法 Unicode'); charge(4);
      } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error('字段补丁含非法 Unicode');
      else if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) charge(2);
      else charge(code < 32 ? 6 : code < 128 ? 1 : code < 2048 ? 2 : 3);
    }
  };
  /** 每层和每容器都有独立上限；循环、稀疏数组和非普通对象都不是有效补丁值。 */
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 100000 || depth > 8) throw new Error('字段补丁结构超出预算');
    if (typeof value === 'string') { string(value); return value; }
    if (value === null) { charge(4); return value; }
    if (typeof value === 'boolean') { charge(value ? 4 : 5); return value; }
    if (typeof value === 'number' && Number.isFinite(value)) { charge(String(value).length); return value; }
    if (!value || typeof value !== 'object') throw new Error('字段补丁包含非法值');
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error('字段补丁只接受普通对象和数组');
    if (ancestors.has(value)) throw new Error('字段补丁不接受循环引用');
    ancestors.add(value); charge(2);
    try {
      if (array) {
        const length = Object.getOwnPropertyDescriptor(value, 'length')!.value as number;
        if (length > (depth === 0 ? tableColumnPatchLimits.patches : 65535)) throw new Error('字段补丁数组超出数量范围');
        // 只在长度上限内枚举，拒绝数组上的额外字段、访问器及符号属性。
        const keys = Reflect.ownKeys(value);
        if (keys.length !== length + 1 || keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length))) throw new Error('字段补丁数组必须连续且不能含额外字段');
        const result: unknown[] = [];
        for (let index = 0; index < length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('字段补丁不接受访问器或稀疏数组');
          if (index) charge(1); result.push(visit(descriptor.value, depth + 1));
        }
        return result;
      }
      const result: Record<string, unknown> = Object.create(null); let count = 0;
      for (const key of Reflect.ownKeys(value)) {
        if (++count > 16) throw new Error('字段补丁对象字段过多');
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('字段补丁只接受自有可枚举数据字段');
        if (count > 1) charge(1); string(key); charge(1); result[key] = visit(descriptor.value, depth + 1);
      }
      return result;
    } finally { ancestors.delete(value); }
  };
  if (!Array.isArray(input)) throw new Error('字段补丁必须为数组');
  return { value: visit(input, 0), bytes };
}

/** 只验证纯补丁语法与预算；目标存在性、依赖、位次环和服务器能力由计划器检查。 */
export function validateColumnPatches(input: unknown, maxDecimalScale: 30 | 38 = 30): ColumnPatch[] {
  const checked = inspectColumnPatchInput(input);
  const patches = z.array(columnPatchSchema).min(1).max(tableColumnPatchLimits.patches).parse(checked.value);
  const references = new Set<string>(), added = new Set<string>();
  for (const patch of patches) {
    const seen = patch.kind === 'add' ? added : references, key = patch.kind === 'add' ? patch.clientKey : patch.columnRef;
    if (seen.has(key)) throw new Error('字段补丁引用重复'); seen.add(key);
    if (patch.kind === 'drop') continue;
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
  access: Record<ColumnEditableAttribute, ColumnAttributeAccess>;
}
export interface TableColumnGetOutput {
  target: TableColumnPatchTarget; snapshotId: string; ddlHash: string; expiresAt: string;
  columns: TableColumnView[]; warnings: string[];
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
