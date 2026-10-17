import { createHash, randomUUID } from 'node:crypto';
import { readColumnOnUpdate, sameColumnOnUpdate } from '../shared/tableColumnPatches';
import { structureTaskQuery as columnTaskQuery, readStructureDefinition as readDefinition, structureDocumentOf as documentOf, assertStructureDefinitionUnchanged as assertSnapshot, sameStructureFragment as sameFragment, type StructureTaskContext as ColumnTaskContext, type StructureColumnEncoding as ColumnEncoding, type StructureDefinitionRead as DefinitionRead } from './structureDefinition';
export { columnTaskQuery };
export type { ColumnTaskContext };
import type { ResultSetHeader } from 'mysql2';
import { StructurePatchCache, structureCacheLimits, type StructureCacheScope } from './structurePatchCache';
import { editableColumnType, tableDefinitionTokens } from './tableColumnDefinition';
import { buildTableColumnPatchSql, type ColumnPatchSqlPlan } from './tableColumnPatchSql';
import { columnPatchAccess, hasUnprovenBinaryDefault, definitionOmittingSqlModes, readControlledTimestampDefault, tableColumnDefaultRisks, tableColumnDefaultRiskMessage, tableColumnPatchLimits, validateColumnPatches, type ColumnPatch, type TableColumnApplyInput, type TableColumnApplyOutput, type TableColumnApplyProgress, type TableColumnDefinitionDocument, type TableColumnGetInput, type TableColumnGetOutput, type TableColumnPatchTarget, type TableColumnPreviewInput, type TableColumnPreviewOutput, type TableColumnView, type TableDefinitionContext } from '../shared/tableColumnPatches';
import type { ColumnDefaultPatch, ColumnTypePatch, ReadColumnDefault, TableColumnDefinition } from '../shared/tableColumnPatches';
import { columnCollationAcknowledgements } from '../shared/tableColumnPatches';
import { readColumnCollationTaskFacts, assertColumnCollationTaskUnchanged, columnCollationTaskCatalog, columnCollationTaskViews, type ColumnCollationTaskFacts } from './tableColumnCollationTaskRead';
import { buildColumnCollationExecutionPlan, verifyColumnCollationExecution, type ColumnCollationExecutionPlan } from './tableColumnCollationExecution';

export const columnTaskLimits = structureCacheLimits;
export interface ColumnTaskOptions { label: string; columnPatch: TableColumnApplyProgress; executionTarget?: { database: string; table: string }; }
export interface ColumnTaskHost { run<T>(connectionId: string, taskId: string, action: (context: ColumnTaskContext) => Promise<T>, options: ColumnTaskOptions): Promise<T>; }
interface Snapshot extends DefinitionRead { id: string; target: TableColumnPatchTarget; revision: number; expires: number; refs: Map<string, string>; bytes: number; collation?: ColumnCollationTaskFacts; }
interface PreviewBase { snapshot: Snapshot; patches: ColumnPatch[]; expires: number; bytes: number; }
interface LegacyPreview extends PreviewBase { kind: 'legacy'; plan: ColumnPatchSqlPlan; }
interface CollationPreview extends PreviewBase { kind: 'collation'; plan: ColumnCollationExecutionPlan; collation: ColumnCollationTaskFacts; }
type Preview = LegacyPreview | CollationPreview;

/** SHA 仅用于定义及身份相等校验，不持久化 SQL 或服务器凭据。 */
const hash = (source: string): string => createHash('sha256').update(source).digest('hex');
/** 私有计划含真实Map证据，计量和比较不能由JSON默认行为丢失条目。 */
const evidenceJson = (value: unknown): string => JSON.stringify(value, (_key, item) => item instanceof Map ? [...item] : item);
/** 所有准备与终态共享一份证据，释放失败不能把已收到的 DDL OK 改成未提交。 */
const initialProgress = (): TableColumnApplyProgress => ({ phase: 'connecting', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' });

/** 投影使用服务端快照引用及共享能力，不把名称对象当字典，也不泄露物理连接编号。 */
function views(document: TableColumnDefinitionDocument, refs: Map<string, string>, serverVersion: string, unreliable = new Set<string>()): TableColumnView[] {
  const byName = new Map([...refs].map(([ref, name]) => [name, ref]));
  return document.columns.map(column => ({ columnRef: byName.get(column.name) ?? randomUUID(), name: column.name, ordinal: column.ordinal, typeSql: column.type.raw, editableType: editableColumnType(column, document.context), nullable: column.nullable,
    // 只改变显示投影，不把损失字节的文本伪装成原值；内部可定位 DEFAULT 仍允许显式专用覆盖。
    default: hasUnprovenBinaryDefault(column) ? { kind: 'opaque' as const, sql: column.attributes.find(attribute => attribute.kind === 'default')!.raw, reason: '二进制默认值的原始字节不可证明，请显式选择新默认值或删除默认值' } : column.default,
    comment: column.comment, rawDefinition: column.raw, ...(readColumnOnUpdate(column) === undefined ? {} : { onUpdate: readColumnOnUpdate(column) }), access: { ...columnPatchAccess(column, document.context.dialect, serverVersion), ...(unreliable.has(column.name) ? { onUpdate: { editable: false, reason: '自动更新时间目录与原定义不一致，不能修改该属性' } } : {}) } }));
}

/** 只在字段流程核对EXTRA；不修改共用结构读取器或把目录缺失当作无自动更新。 */
async function onUpdateCatalog(context: ColumnTaskContext, target: TableColumnPatchTarget, document: TableColumnDefinitionDocument): Promise<Set<string>> {
  const temporal = document.columns.filter(column => /^(?:DATETIME|TIMESTAMP)\b/i.test(column.type.raw));
  const bad = new Set<string>(); if (!temporal.length) return bad;
  const literal = (value: string) => `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;
  const rows = (await columnTaskQuery<{ name: string; extra: string }[]>(context, `SELECT COLUMN_NAME AS name, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ${literal(target.database)} AND TABLE_NAME = ${literal(target.table)} ORDER BY ORDINAL_POSITION LIMIT 4097`)).rows;
  if (rows.length !== document.columns.length || rows.some((row, index) => row.name !== document.columns[index].name)) return new Set(temporal.map(column => column.name));
  for (const column of temporal) {
    const extra = rows.find(row => row.name === column.name)?.extra;
    if (typeof extra !== 'string') { bad.add(column.name); continue; }
    const raw = extra.replace(/\bDEFAULT_GENERATED\b/ig, '').trim(), expression = /^on\s+update\s+(.+)$/is.exec(raw)?.[1];
    const timestamp = expression && readControlledTimestampDefault(expression);
    const actual = raw === '' ? null : timestamp ? { kind: 'expression' as const, expression: 'current-timestamp' as const, precision: timestamp.precision } : undefined;
    if (!sameColumnOnUpdate(readColumnOnUpdate(column), actual, column.type.raw)) bad.add(column.name);
  }
  return bad;
}

/** 预览和投递前分别核目录，不允许调用者绕过get的只读属性。 */
function assertOnUpdateCatalog(patches: readonly ColumnPatch[], refs: Map<string, string>, unreliable: Set<string>): void {
  for (const patch of patches) if (patch.kind === 'alter' && Object.hasOwn(patch.changes, 'onUpdate') && unreliable.has(refs.get(patch.columnRef)!)) throw new Error('自动更新时间目录与原定义不一致，未发送结构修改');
}

/** 精确十进制规范化只操作字符串和有界指数，不经过 JS 浮点。 */
function exactNumber(value: string): string | undefined {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d{1,5}))?$/.exec(value);
  if (!match || !(match[2] || match[3])) return undefined;
  let digits = (match[2] + (match[3] ?? '')).replace(/^0+/, '');
  if (!digits) return '0';
  let exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  const zeros = /0+$/.exec(digits)?.[0].length ?? 0; digits = digits.slice(0, digits.length - zeros); exponent += zeros;
  return (match[1] === '-' ? '-' : '') + digits + 'e' + exponent;
}
/** 只核验受控默认值；陌生表达式规范化保持未核验，不能猜等价或执行 INSERT 探测。 */
function defaultMatches(request: ColumnDefaultPatch, column: TableColumnDefinition, context: TableDefinitionContext, encoding?: ColumnEncoding): boolean {
  let actual: ReadColumnDefault = column.default;
  if (actual.kind === 'expression') {
    let tokens = tableDefinitionTokens(actual.sql, context);
    // 只解包完整单文字量的规范外括号；剩余任何运算、未知引导器、函数或执行注释都不匹配。
    while (tokens[0]?.kind === 'symbol' && tokens[0].value === '(' && tokens.at(-1)?.kind === 'symbol' && tokens.at(-1)?.value === ')') tokens = tokens.slice(1, -1);
    const first = tokens[0];
    if (tokens.length === 1 && first.kind === 'string') actual = { kind: 'literal', valueType: 'text', value: first.value };
    else if (tokens.length === 1 && first.kind === 'number' && /^0x[0-9a-f]+$/i.test(first.value)) actual = { kind: 'literal', valueType: 'binary', value: first.value.slice(2), encoding: 'hex' };
    else if (tokens.length === 1 && first.kind === 'number' && /^0b[01]+$/i.test(first.value)) actual = { kind: 'literal', valueType: 'binary', value: first.value.slice(2), encoding: 'bits' };
    else if (tokens.length === 1 && first.kind === 'number' && /^[0-9]+(?:\.[0-9]*)?(?:e[+-]?[0-9]+)?$/i.test(first.value)) actual = { kind: 'literal', valueType: 'number', value: first.value };
    else if (tokens.length === 2 && first.kind === 'word' && tokens[1].kind === 'string') {
      if (first.value.toUpperCase() === 'X' && /^(?:[0-9a-f]{2})*$/i.test(tokens[1].value)) actual = { kind: 'literal', valueType: 'binary', value: tokens[1].value, encoding: 'hex' };
      else if (first.value.toUpperCase() === 'B' && /^[01]+$/.test(tokens[1].value)) actual = { kind: 'literal', valueType: 'binary', value: tokens[1].value, encoding: 'bits' };
      // MySQL 8 的 TEXT DEFAULT 会规范为 (_utf8mb4'...')；只有真实列目录确认同字符集才核对 UTF-8 值。
      else if (context.dialect === 'mysql' && first.value.toLowerCase() === '_utf8mb4' && encoding?.charset === 'utf8mb4' && encoding.collation?.startsWith('utf8mb4_')) actual = { kind: 'literal', valueType: 'text', value: tokens[1].value };
    }
  }
  // 直接文字量与括号规范形态遵循相同引导器限制，不能因解析分支不同绕过字符集核验。
  if (actual.kind === 'literal' && actual.valueType === 'text' && actual.introducer !== undefined && !(context.dialect === 'mysql' && actual.introducer.toLowerCase() === '_utf8mb4' && encoding?.charset === 'utf8mb4' && encoding.collation?.startsWith('utf8mb4_'))) return false;
  if (request.kind === 'none') return actual.kind === 'none' || (actual.kind === 'null' && column.nullable !== false);
  if (request.kind === 'null') return actual.kind === 'null';
  if (request.kind === 'expression') {
    const parsed = actual.kind === 'expression' ? readControlledTimestampDefault(actual.sql) : undefined;
    return Boolean(parsed && parsed.precision === (request.precision ?? Number(/\((\d+)\)/.exec(column.type.raw)?.[1] ?? 0)));
  }
  if (actual.kind !== 'literal') return false;
  if (request.valueType === 'binary') {
    if (actual.valueType !== 'binary') return false;
    if (/^BIT\b/i.test(column.type.raw)) return BigInt('0x' + (request.value || '0')) === BigInt((actual.encoding === 'bits' ? '0b' : '0x') + (actual.value || '0'));
    const hex = actual.encoding === 'bits' ? BigInt('0b' + (actual.value || '0')).toString(16).padStart(Math.ceil(actual.value.length / 8) * 2, '0') : actual.value.padStart(Math.ceil(actual.value.length / 2) * 2, '0');
    return hex.toLowerCase() === request.value.toLowerCase();
  }
  if (request.valueType === 'text') return actual.valueType === 'text' && actual.value === request.value && Buffer.from(actual.value, 'utf8').toString('utf8') === actual.value;
  const requested = request.valueType === 'boolean' ? request.value === 'true' ? '1' : '0' : request.value;
  const observed = actual.valueType === 'boolean' ? actual.value === 'true' ? '1' : '0' : actual.value;
  if (/^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|BOOL|BOOLEAN)\b/i.test(column.type.raw)) return exactNumber(requested) !== undefined && exactNumber(requested) === exactNumber(observed);
  return requested === observed;
}
/** 受控类型比较容忍服务器省略零小数秒；不忽略 unsigned、枚举大小写或数值精度。 */
function typeMatches(request: ColumnTypePatch, column: TableColumnDefinition, context: TableDefinitionContext): boolean {
  const actual = editableColumnType(column, context); if (!actual) return false;
  const normalize = (value: ColumnTypePatch) => value.kind === 'temporal' && !['DATE', 'YEAR'].includes(value.type) ? { ...value, precision: value.precision ?? 0 } : value;
  return JSON.stringify(normalize(request)) === JSON.stringify(normalize(actual));
}

/** 首批后核验只在全部字段名/位次及未动定义均得到证据时成立；无法证明时返回已完成但需人工核对。 */
function verifyAfter(preview: LegacyPreview, document: TableColumnDefinitionDocument, read: DefinitionRead): boolean {
  // SHOW CREATE 文本相同不证明危险表达式求值未变，任何存续风险都不能报告完整核验。
  if (tableColumnDefaultRisks(document).length || document.columns.some(hasUnprovenBinaryDefault)) return false;
  if (JSON.stringify(document.columns.map(column => column.name)) !== JSON.stringify(preview.plan.finalColumns.map(column => column.name))) return false;
  const original = documentOf(preview.snapshot);
  const constraints = document.items.filter(item => item.kind === 'constraint').map(item => item.raw);
  if (constraints.length !== preview.plan.preserved.constraints.length || constraints.some((value, index) => !sameFragment(value, preview.plan.preserved.constraints[index], document.context))) return false;
  if (!sameFragment(document.tail.raw, original.tail.raw, document.context)) return false;
  const changed = new Set(preview.patches.filter(patch => patch.kind !== 'add').map(patch => (patch as Exclude<ColumnPatch, { kind: 'add' }>).columnRef));
  for (const [ref, name] of preview.snapshot.refs) if (!changed.has(ref)) {
    const before = original.columnsByName.get(name), after = document.columnsByName.get(name);
    if (!before || !after || !sameFragment(before.raw, after.raw, document.context)) return false;
  }
  // 目标列的语义核验交给下面的独立受控投影；无法比较的服务器规范化不伪报成功核验。
  for (const patch of preview.patches) {
    if (patch.kind === 'drop') continue;
    const changes = patch.kind === 'add' ? patch : patch.changes;
    const beforeName = patch.kind === 'add' ? undefined : preview.snapshot.refs.get(patch.columnRef);
    const name = patch.kind === 'add' ? patch.name : patch.changes.name ?? beforeName!;
    const after = document.columnsByName.get(name); if (!after) return false;
    const before = beforeName ? original.columnsByName.get(beforeName) : undefined;
    const beforeEncoding = preview.snapshot.encodings.find(column => column.name === beforeName);
    const afterEncoding = read.encodings.find(column => column.name === name);
    // 字符串类型的继承属性以真实目录为证；不能仅因为服务器补 COLLATE 就忽略实际排序规则改变。
    const expectedEncoding = beforeEncoding?.charset ? beforeEncoding : preview.snapshot.tableEncoding;
    const inheritedEncoding = afterEncoding?.charset === expectedEncoding.charset && afterEncoding?.collation === expectedEncoding.collation;
    const addedEncodingAttribute = (kind: string): boolean => ['charset', 'collation'].includes(kind) && inheritedEncoding && !before?.attributes.some(attribute => attribute.kind === kind);
    // 跨族类型转换可把未改数字默认值 7 规范为字符串 '7'；仅已知默认语义可比较，不放宽复杂表达式。
    const priorDefault = before?.default;
    const defaultCanonicalized = Boolean(changes.type && priorDefault && (priorDefault.kind === 'none' || priorDefault.kind === 'null' || (priorDefault.kind === 'literal' && priorDefault.introducer === undefined && priorDefault.valueType !== 'binary')) && defaultMatches(priorDefault as ColumnDefaultPatch, after, document.context, afterEncoding));
    // 新增字段没有旧片段可作证据；出现未请求的生成、自增或其它属性时不能报完整核验成功。
    if (patch.kind === 'add' && after.attributes.some(attribute => !['nullable', 'default', 'comment'].includes(attribute.kind) && !(attribute.kind === 'on-update' && patch.onUpdate != null) && !addedEncodingAttribute(attribute.kind))) return false;
    if (patch.kind === 'add' && !sameColumnOnUpdate(readColumnOnUpdate(after), patch.onUpdate ?? null, after.type.raw)) return false;
    if (afterEncoding?.charset && !inheritedEncoding) return false;
    if (changes.nullable !== undefined && after.nullable !== changes.nullable) return false;
    if (changes.comment !== undefined && (after.comment ?? '') !== changes.comment) return false;
    // 原字段的未改属性逐项相等；专用改名不会要求重述危险表达式。
    if (beforeName) {
      const before = original.columnsByName.get(beforeName)!;
      const changedAttribute = (kind: string) => (['nullable', 'default', 'comment'].includes(kind) && Object.hasOwn(changes, kind)) || (kind === 'on-update' && Object.hasOwn(changes, 'onUpdate'));
      const retained = (column: TableColumnDefinition) => column.attributes.filter(attribute => !changedAttribute(attribute.kind) && !(attribute.kind === 'default' && defaultCanonicalized) && !(column === after && addedEncodingAttribute(attribute.kind)));
      if (retained(before).length !== retained(after).length) return false;
      for (const attribute of before.attributes) {
        if (changedAttribute(attribute.kind)) continue;
        if (attribute.kind === 'default' && defaultCanonicalized) continue;
        const current = after.attributes.find(item => item.kind === attribute.kind);
        if (!current || !sameFragment(attribute.raw, current.raw, document.context)) return false;
      }
      if (!changes.type && !sameFragment(before.type.raw, after.type.raw, document.context)) return false;
    }
    if (changes.type && !typeMatches(changes.type, after, document.context)) return false;
    if (changes.default && !defaultMatches(changes.default, after, document.context, afterEncoding)) return false;
    if (patch.kind === 'alter' && Object.hasOwn(patch.changes, 'onUpdate') && !sameColumnOnUpdate(readColumnOnUpdate(after), patch.changes.onUpdate, after.type.raw)) return false;
  }
  return true;
}

/** 快照和一次性预览只保留内存；任何失败都不自动重放 DDL，也不持有预览连接。 */
export class TableColumnPatchTasks {
  private readonly snapshots: StructureCacheScope<Snapshot>;
  private readonly previews: StructureCacheScope<Preview>;
  /** 仅持有在途get；连接释放后，关闭阶段的晚回包不能重新登记能力。 */
  private readonly pendingReads = new Set<{ connectionId: string }>();
  constructor(private readonly host: ColumnTaskHost, private readonly now: () => number = () => Date.now(), private readonly cache = new StructurePatchCache(now)) {
    this.snapshots = cache.scope('columns', 'snapshot', value => ({ connectionId: value.target.connectionId, expires: value.expires, bytes: value.bytes }));
    this.previews = cache.scope('columns', 'preview', value => ({ connectionId: value.snapshot.target.connectionId, expires: value.expires, bytes: value.bytes }));
  }

  /** 关闭或连接重配后销毁对应能力令牌，不影响任何用户 SQL 会话。 */
  release(connectionId?: string): void {
    for (const pending of this.pendingReads) if (!connectionId || pending.connectionId === connectionId) this.pendingReads.delete(pending);
    for (const [id, snapshot] of this.snapshots) if (!connectionId || snapshot.target.connectionId === connectionId) this.snapshots.delete(id);
    for (const [id, preview] of this.previews) if (!connectionId || preview.snapshot.target.connectionId === connectionId) this.previews.delete(id);
  }
  /** 显式释放只销毁所给能力令牌；不接受客户端连接目标扩大清理范围。 */
  releaseTokens(input: { snapshotId?: string; previewToken?: string }): void {
    if (input.snapshotId) {
      const snapshot = this.snapshots.get(input.snapshotId); this.snapshots.delete(input.snapshotId);
      if (snapshot) for (const [token, value] of this.previews) if (value.snapshot === snapshot) this.previews.delete(token);
    }
    if (input.previewToken) this.previews.delete(input.previewToken);
  }
  /** 到期清理后执行整体容量检查，不静默驱逐仍有效的预览。 */
  private capacity(bytes: number, kind: 'snapshot' | 'preview'): void {
    this.cache.capacity(bytes, kind);
  }
  /** 基础容量失败仍抛出；只有同步检查中的附加数据超额可关闭新能力，不吞任何reader错误。 */
  private fitsAdditional(baseBytes: number, additionalBytes: number): boolean {
    if (!Number.isSafeInteger(additionalBytes) || additionalBytes < 0) throw new Error('列排序规则附加缓存计量无效');
    this.capacity(baseBytes, 'snapshot');
    try { this.capacity(baseBytes + additionalBytes, 'snapshot'); return true; } catch { return false; }
  }
  /** 主进程配置修订必须是可信非负整数；客户端无此公开字段。 */
  private revision(revision: unknown): number {
    if (!Number.isSafeInteger(revision) || Number(revision) < 0) throw new Error('缺少可信连接配置修订');
    return revision as number;
  }
  /** 读取完成后立即关闭结构连接，返回的快照不拥有网络资源。 */
  async get(input: TableColumnGetInput, revision: unknown): Promise<TableColumnGetOutput> {
    const currentRevision = this.revision(revision), progress = initialProgress();
    const pending = { connectionId: input.connectionId }; this.pendingReads.add(pending);
    let snapshot!: Snapshot;
    let baseBytes = 0, baseColumns: TableColumnView[] = [];
    try {
      const output = await this.host.run(input.connectionId, input.taskId, async context => {
        progress.phase = 'reading'; context.report();
        const target = { connectionId: input.connectionId, database: input.database, table: input.table };
        const read = await readDefinition(context, target, true), document = documentOf(read), risks = tableColumnDefaultRisks(document);
        const refs = new Map(document.columns.map(column => [randomUUID(), column.name]));
        const unreliable = await onUpdateCatalog(context, target, document);
        const bytes = Buffer.byteLength(read.source) + Buffer.byteLength(JSON.stringify([...refs])) + Buffer.byteLength(JSON.stringify(read.nullability)) + Buffer.byteLength(JSON.stringify(read.encodings)) + 2048;
        this.capacity(bytes, 'snapshot');
        baseBytes = bytes; baseColumns = views(document, refs, read.serverVersion, unreliable);
        const collationRead = await readColumnCollationTaskFacts(context, target, read, { columns: refs, indexes: new Map() });
        let collation = collationRead.kind === 'ready' ? collationRead.value : undefined;
        let columns = baseColumns, catalog: TableColumnGetOutput['collationCatalog'];
        let additional = 0;
        if (collation) {
          columns = await columnCollationTaskViews(baseColumns, read, collation, context); catalog = columnCollationTaskCatalog(collation);
          additional = collation.bytes + Buffer.byteLength(JSON.stringify(catalog)) + Buffer.byteLength(JSON.stringify(columns.map(column => column.collation ?? null)));
          if (!this.fitsAdditional(baseBytes, additional)) { collation = undefined; columns = baseColumns; catalog = undefined; additional = 0; }
        }
        context.checkCancelled();
        if (!this.pendingReads.has(pending)) throw new Error('字段读取期间连接已释放或修订变化；未登记快照');
        snapshot = { ...read, id: randomUUID(), target, revision: currentRevision, expires: this.now() + columnTaskLimits.ttlMs, refs, bytes: baseBytes + additional, ...(collation ? { collation } : {}) };
        return { target, snapshotId: snapshot.id, ddlHash: hash(read.source), expiresAt: new Date(snapshot.expires).toISOString(), columns, ...(catalog ? { collationCatalog: catalog } : {}), warnings: [...(risks.length ? [tableColumnDefaultRiskMessage(risks)] : []), ...(document.columns.some(hasUnprovenBinaryDefault) ? ['二进制文本默认值不能证明原始字节（字段：' + document.columns.filter(hasUnprovenBinaryDefault).map(column => JSON.stringify(column.name)).join('、') + '），目标列不能重述或导出结构；旁列及专用默认值操作仍可预览，成功后完整定义需人工核对。'] : []), read.originalMode === read.normalizedMode ? '结构读取使用独立短会话，未修改查询标签。' : '专用结构会话已去除隐藏定义的兼容模式；原查询标签模式未变。', '执行前重核仍存在外部 DDL 并发窗口，请在维护时段暂停并行结构修改。'], capabilities: { dialect: read.context.dialect, serverVersion: read.serverVersion, maxDecimalScale: read.context.dialect === 'mariadb' ? 38 as const : 30 as const } };
      }, { label: '读取字段定义', columnPatch: progress });
      if (!this.pendingReads.has(pending) || snapshot.expires <= this.now()) throw new Error('字段快照已释放或过期，未登记能力令牌');
      // 严格关闭期间其它任务可能占用容量；仅新附加事实放弃，原基础快照仍须真实通过容量检查。
      if (snapshot.collation && !this.fitsAdditional(baseBytes, snapshot.bytes - baseBytes)) {
        delete snapshot.collation; snapshot.bytes = baseBytes; output.columns = baseColumns; delete output.collationCatalog;
      }
      this.capacity(snapshot.bytes, 'snapshot'); this.snapshots.set(snapshot.id, snapshot);
      output.target = { ...snapshot.target };
      Object.assign(output, { definitionContext: { originalSqlMode: snapshot.originalMode, sqlMode: snapshot.normalizedMode, characterSetConnection: 'utf8mb4', collationConnection: 'utf8mb4_bin', sqlQuoteShowCreate: true } });
      return output;
    } finally { this.pendingReads.delete(pending); }
  }
  /** 预览基于当前真实定义生成有界 SQL；令牌不包含客户端 SQL，也不保留连接。 */
  async preview(input: TableColumnPreviewInput, revision: unknown): Promise<TableColumnPreviewOutput> {
    const snapshot = this.snapshots.get(input.snapshotId);
    if (!snapshot || snapshot.expires <= this.now()) throw new Error('字段快照已失效，请重新读取');
    if (snapshot.revision !== this.revision(revision)) throw new Error('连接配置已变化，请重新读取字段定义');
    const patches = validateColumnPatches(input.patches, snapshot.context.dialect === 'mariadb' ? 38 : 30), progress = initialProgress();
    let value!: Preview; const token = randomUUID();
    const output = await this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report();
      const read = await readDefinition(context, snapshot.target, true); assertSnapshot(snapshot, read);
      if (patches.some(patch => patch.kind === 'alter' && Object.hasOwn(patch.changes, 'onUpdate'))) assertOnUpdateCatalog(patches, snapshot.refs, await onUpdateCatalog(context, snapshot.target, documentOf(read)));
      if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('字段快照已释放或过期，未创建新预览');
      const collationPatch = patches.find(patch => patch.kind === 'alter' && Object.hasOwn(patch.changes, 'collation'));
      if (collationPatch?.kind === 'alter') {
        if (!snapshot.collation || !collationPatch.changes.collation) throw new Error('原快照没有完整列排序规则能力，请重新读取');
        const fresh = await readColumnCollationTaskFacts(context, snapshot.target, read, snapshot.collation.facts.references);
        if (fresh.kind !== 'ready') throw new Error('列排序规则能力已不可用，请重新读取；未发送DDL');
        assertColumnCollationTaskUnchanged(snapshot.collation, fresh.value);
        const plan = buildColumnCollationExecutionPlan(fresh.value.facts, fresh.value.physical, collationPatch.columnRef, collationPatch.changes.collation);
        if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('字段快照已释放或过期，未创建新预览');
        const bytes = snapshot.bytes + fresh.value.bytes + Buffer.byteLength(evidenceJson([plan, patches])) + 2048;
        this.capacity(bytes, 'preview');
        value = { kind: 'collation', snapshot, plan, patches, collation: fresh.value, expires: Math.min(snapshot.expires, this.now() + columnTaskLimits.ttlMs), bytes };
        return { previewToken: token, expiresAt: new Date(value.expires).toISOString(), target: { ...snapshot.target }, ddlHash: hash(snapshot.source), sql: plan.sql, changes: [{ columnRef: collationPatch.columnRef, description: '仅修改指定列的排序规则' }], warnings: [...plan.warnings, '相关查询、视图、程序和应用的比较、排序、分组及连接结果可能改变或冲突；未穷尽分析全部外部依赖。', '服务器可能重建或复制表、等待或持有锁、消耗时间及磁盘并影响读写；不承诺无锁、在线或物理表编号不变。'], requiredAcknowledgements: [...new Set(['ddl-implicit-commit', 'external-ddl-window', ...columnCollationAcknowledgements, ...plan.requiredAcknowledgements])], concurrencyPolicy: 'recheck-before-ddl' as const };
      }
      const plan = buildTableColumnPatchSql(documentOf(snapshot), patches, { database: snapshot.target.database, serverVersion: snapshot.serverVersion, columnRefs: snapshot.refs });
      const bytes = snapshot.bytes + Buffer.byteLength(plan.sql) + Buffer.byteLength(JSON.stringify(patches)) + 2048;
      this.capacity(bytes, 'preview'); value = { kind: 'legacy', snapshot, plan, patches, expires: this.now() + columnTaskLimits.ttlMs, bytes };
      return { previewToken: token, expiresAt: new Date(value.expires).toISOString(), target: { ...snapshot.target }, ddlHash: hash(snapshot.source), sql: plan.sql, changes: patches.map(patch => ({ ...(patch.kind !== 'add' ? { columnRef: patch.columnRef } : {}), description: patch.kind === 'add' ? '新增字段' : patch.kind === 'drop' ? '删除字段及其数据' : '修改指定字段属性' })), warnings: plan.warnings, requiredAcknowledgements: ['ddl-implicit-commit', 'external-ddl-window', ...plan.requiredAcknowledgements], concurrencyPolicy: 'recheck-before-ddl' as const };
    }, { label: '预览字段变更', columnPatch: progress });
    if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now() || value.expires <= this.now()) throw new Error('字段快照已释放或过期，未创建新预览');
    this.capacity(value.bytes, 'preview'); this.previews.set(token, value); return output;
  }
  /** 应用先消费令牌；同一短会话完成重核和唯一一次 ALTER，失败后只能由用户重新读取确认。 */
  async apply(input: TableColumnApplyInput, revision: unknown): Promise<TableColumnApplyOutput> {
    const preview = this.previews.get(input.previewToken); this.previews.delete(input.previewToken);
    if (!preview || preview.expires <= this.now()) throw new Error('字段预览已失效或已使用，请重新预览；未发送 DDL');
    const snapshot = preview.snapshot;
    if (snapshot.revision !== this.revision(revision)) throw new Error('连接配置已变化，请重新读取并预览；未发送 DDL');
    if (['ddl-implicit-commit', 'external-ddl-window', ...(preview.kind === 'collation' ? columnCollationAcknowledgements : []), ...preview.plan.requiredAcknowledgements].some(value => !input.acknowledgements.includes(value))) throw new Error('尚未确认结构变更后果；预览已消费，未发送 DDL');
    const progress = initialProgress();
    return this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report();
      const current = await readDefinition(context, snapshot.target, true); assertSnapshot(snapshot, current);
      let collationBefore: ColumnCollationTaskFacts | undefined;
      if (preview.kind === 'collation') {
        const fresh = await readColumnCollationTaskFacts(context, snapshot.target, current, preview.collation.facts.references);
        if (fresh.kind !== 'ready') throw new Error('列排序规则能力已不可用；未发送DDL');
        assertColumnCollationTaskUnchanged(preview.collation, fresh.value);
        const patch = preview.patches[0];
        if (patch.kind !== 'alter' || !patch.changes.collation) throw new Error('列排序规则私有预览类型无效；未发送DDL');
        const expected = buildColumnCollationExecutionPlan(fresh.value.facts, fresh.value.physical, patch.columnRef, patch.changes.collation);
        if (evidenceJson(expected) !== evidenceJson(preview.plan)) throw new Error('列排序规则计划或依据已变化；未发送DDL');
        collationBefore = fresh.value;
      }
      if (preview.patches.some(patch => patch.kind === 'alter' && Object.hasOwn(patch.changes, 'onUpdate'))) assertOnUpdateCatalog(preview.patches, snapshot.refs, await onUpdateCatalog(context, snapshot.target, documentOf(current)));
      if (preview.expires <= this.now()) throw new Error('预览在准备期间已过期，请重新预览；未发送 DDL');
      context.checkCancelled(); progress.phase = 'executing'; context.report();
      let result: ResultSetHeader;
      try {
        result = (await columnTaskQuery<ResultSetHeader>(context, preview.plan.sql, () => { progress.ddlSubmitted = true; progress.outcome = 'unknown'; context.report(); })).rows;
      } catch (error) {
        // 明确 ERR 仍不能证明非原子 DDL 的所有引擎均未改动；保守未知且绝不自动重放。
        progress.outcome = progress.ddlSubmitted ? 'unknown' : 'not-sent'; context.report(); throw error;
      }
      if (!result || typeof result.affectedRows !== 'number') throw new Error('结构命令未返回可确认的 OK 包，请核对实际定义');
      progress.ddlCompleted = true; progress.outcome = 'succeeded'; progress.phase = 'verifying'; context.report();
      const output: TableColumnApplyOutput = { ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: result.warningStatus ? [`服务器返回 ${result.warningStatus} 条结构变更警告，请核对数据转换结果。`] : [] };
      // SHOW WARNINGS 必须紧跟此 ALTER 的 OK，在任何身份/定义 SELECT 覆盖诊断之前读取。
      if (result.warningStatus) {
        try {
          const warnings = (await columnTaskQuery<{ Level: string; Code: number; Message: string }[]>(context, 'SHOW WARNINGS LIMIT 20')).rows;
          let budget = 32 * 1024;
          for (const warning of warnings.slice(0, 20)) {
            if (typeof warning.Message !== 'string' || !Number.isSafeInteger(warning.Code)) throw new Error('服务器警告格式无法识别');
            let message = warning.Message.slice(0, 2048);
            while (Buffer.byteLength(message) > budget && message.length) message = message.slice(0, Math.floor(message.length / 2));
            if (!message) break;
            budget -= Buffer.byteLength(message); output.warnings.push(`服务器警告 ${warning.Code}：${message}${message.length < warning.Message.length ? '（已截断）' : ''}`);
          }
          if (result.warningStatus > warnings.length) output.warnings.push('仅显示前 20 条警告，后续警告未全部返回。');
        } catch { output.warnings.push('DDL 已完成，但警告读取失败或被取消，不能证明没有其他数据转换后果；请人工核对。'); }
      }
      try {
        const after = await readDefinition(context, snapshot.target, false), document = documentOf(after);
        if (preview.kind === 'collation') {
          if (!collationBefore) throw new Error('缺少执行前真实列排序规则事实');
          const fresh = await readColumnCollationTaskFacts(context, snapshot.target, after, collationBefore.facts.references);
          if (fresh.kind !== 'ready') throw new Error('列排序规则后核目录不可用');
          const verified = verifyColumnCollationExecution(collationBefore.facts, fresh.value.facts, collationBefore.physical, fresh.value.physical, preview.plan);
          const columns = await columnCollationTaskViews(views(document, snapshot.refs, after.serverVersion), after, fresh.value, context);
          // Promise完成与await恢复之间仍可能取消；发布后核结果前重查原任务，不能撤销已收到的OK。
          context.checkCancelled();
          if (context.managed.signal?.aborted) throw context.managed.signal.reason ?? new Error('列排序规则后核已取消');
          if (context.managed.broken) throw new Error('列排序规则后核的结构连接已断开');
          output.after = { ddlHash: hash(after.source), columns };
          output.definitionVerified = progress.definitionVerified = verified.definitionVerified;
          if (verified.tableIdChanged) output.warnings.push('服务器操作后物理表编号已变化；定义核验不据此判断执行算法。');
          if (!verified.definitionVerified) output.verificationError = 'DDL 已完成，但列排序规则专用后核未通过；请核对最新定义，不要重复执行。' + verified.reasons.slice(0, 8).join('；').slice(0, 2048);
        } else {
          const unreliable = await onUpdateCatalog(context, snapshot.target, document);
          const unreliableRequestedTime = preview.patches.some(patch => patch.kind === 'add' ? unreliable.has(patch.name) : patch.kind === 'alter' && Object.hasOwn(patch.changes, 'onUpdate') && unreliable.has(snapshot.refs.get(patch.columnRef)!));
          output.definitionVerified = progress.definitionVerified = after.identity === current.identity && after.normalizedMode === current.normalizedMode && verifyAfter(preview, document, after) && !unreliableRequestedTime;
          output.after = { ddlHash: hash(after.source), columns: views(document, new Map(preview.plan.finalColumns.map(column => [column.columnRef, column.name])), after.serverVersion, unreliable) };
          if (document.columns.some(hasUnprovenBinaryDefault)) output.warnings.push('二进制默认值仍以不能证明原始字节的文本显示；DDL 已完成，但这些字段的默认值未核验，不能据此自动重建或重复执行。');
          if (!output.definitionVerified) output.verificationError = 'DDL 已完成，但定义变更及未改属性尚未全部核验一致，请核对最新定义；不要重复执行';
        }
      } catch { output.verificationError = 'DDL 已收到成功响应，但取消、断线或读取失败使后续定义未能核验；不要重复执行'; }
      context.report(); this.cache.release(snapshot.target.connectionId); return output;
    }, { label: '执行字段变更', columnPatch: progress, executionTarget: snapshot.target });
  }
}
