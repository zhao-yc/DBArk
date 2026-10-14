import { createHash, randomUUID } from 'node:crypto';
import type { FieldPacket, ResultSetHeader } from 'mysql2';
import type { ManagedConnection } from './connection';
import { qualified } from './sql';
import { resolveCollationEncoding } from './metadata';
import { editableColumnType, parseTableColumnDefinition, tableDefinitionTokens } from './tableColumnDefinition';
import { buildTableColumnPatchSql, type ColumnPatchSqlPlan } from './tableColumnPatchSql';
import { columnPatchAccess, hasUnprovenBinaryDefault, definitionOmittingSqlModes, readControlledTimestampDefault, tableColumnDefaultRisks, tableColumnDefaultRiskMessage, tableColumnPatchLimits, validateColumnPatches, type ColumnPatch, type TableColumnApplyInput, type TableColumnApplyOutput, type TableColumnApplyProgress, type TableColumnDefinitionDocument, type TableColumnGetInput, type TableColumnGetOutput, type TableColumnPatchTarget, type TableColumnPreviewInput, type TableColumnPreviewOutput, type TableColumnView, type TableDefinitionContext } from '../shared/tableColumnPatches';
import type { ColumnDefaultPatch, ColumnTypePatch, ReadColumnDefault, TableColumnDefinition } from '../shared/tableColumnPatches';

export const columnTaskLimits = { ttlMs: 120000, snapshots: 32, previews: 32, bytes: 16 * 1024 * 1024 } as const;
export interface ColumnTaskContext { managed: ManagedConnection; checkCancelled(): void; report(): void; commandStarted(): () => void; }
export interface ColumnTaskOptions { label: string; columnPatch: TableColumnApplyProgress; }
export interface ColumnTaskHost { run<T>(connectionId: string, taskId: string, action: (context: ColumnTaskContext) => Promise<T>, options: ColumnTaskOptions): Promise<T>; }
interface ColumnEncoding { name: string; charset: string | null; collation: string | null; }
interface DefinitionRead { source: string; context: TableDefinitionContext; originalMode: string; normalizedMode: string; identity: string; serverVersion: string; nullability: [string, boolean][]; encodings: ColumnEncoding[]; tableEncoding: { charset: string; collation: string }; }
interface Snapshot extends DefinitionRead { id: string; target: TableColumnPatchTarget; revision: number; expires: number; refs: Map<string, string>; bytes: number; }
interface Preview { snapshot: Snapshot; plan: ColumnPatchSqlPlan; patches: ColumnPatch[]; expires: number; bytes: number; }

/** SHA 仅用于定义及身份相等校验，不持久化 SQL 或服务器凭据。 */
const hash = (source: string): string => createHash('sha256').update(source).digest('hex');
/** 所有准备与终态共享一份证据，释放失败不能把已收到的 DDL OK 改成未提交。 */
const initialProgress = (): TableColumnApplyProgress => ({ phase: 'connecting', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' });

/** 结构短会话等待真实回调/连接终态；取消负责 KILL 后关闭，不因 AbortSignal 提前假报命令已结束。 */
export function columnTaskQuery<T>(context: ColumnTaskContext, sql: string, submitted?: () => void): Promise<{ rows: T; fields: FieldPacket[] }> {
  context.checkCancelled();
  const managed = context.managed;
  if (managed.broken) return Promise.reject(new Error('结构连接已断开；操作未自动重放'));
  return new Promise((resolve, reject) => {
    const commandFinished = context.commandStarted();
    let settled = false;
    const cleanup = (): void => { managed.connection.removeListener('error', fail); managed.connection.removeListener('end', ended); managed.signal?.removeEventListener('abort', aborted); commandFinished(); };
    const fail = (error: Error): void => { if (!settled) { settled = true; cleanup(); reject(error); } };
    const ended = (): void => fail(new Error('结构连接在命令完成前断开，必须核对服务器定义；未自动重放'));
    // mysql2 主动 destroy 设置 _closing 后可能只发底层 close，没有 connection.end/error。
    // 成功 KILL 的路径在原命令终态之后才 abort；只有控制失败才依靠此本地破坏终态退出，并保留结果未知。
    const aborted = (): void => fail(new Error('本地结构连接已中止，不能据此确认服务器 DDL 是否结束；请核对实际定义'));
    managed.connection.once('error', fail); managed.connection.once('end', ended);
    managed.signal?.addEventListener('abort', aborted, { once: true });
    try {
      // submitted 与同步发送之间不插入 await；发送异常仍保守视为结果未知。
      submitted?.();
      managed.connection.query(sql, (error, rows, fields) => {
        if (error) { fail(error); return; }
        if (!settled) { settled = true; cleanup(); resolve({ rows: rows as T, fields: fields as FieldPacket[] }); }
      });
    } catch (error) { fail(error as Error); }
  });
}

/** 只在新的结构会话规范 SHOW CREATE；不修改任何已有查询标签的模式或诊断状态。 */
async function readDefinition(context: ColumnTaskContext, target: TableColumnPatchTarget, normalize: boolean): Promise<DefinitionRead> {
  const managed = context.managed;
  const before = (await columnTaskQuery<Record<string, unknown>[]>(context, 'SELECT @@SESSION.sql_mode AS sqlMode, @@hostname AS hostname, @@port AS port, @@server_id AS serverId, CURRENT_USER() AS currentUser, CONNECTION_ID() AS connectionId, @@character_set_connection AS characterSetConnection, @@collation_connection AS collationConnection, @@sql_quote_show_create AS quoteShowCreate')).rows[0];
  if (!before || typeof before.sqlMode !== 'string' || Number(before.connectionId) !== managed.connection.threadId) throw new Error('无法确认结构会话身份');
  const originalMode = before.sqlMode;
  if (!/^[A-Z0-9_,]*$/i.test(originalMode)) throw new Error('服务器 SQL 模式无效');
  const omitted = new Set<string>(definitionOmittingSqlModes);
  const normalizedMode = originalMode.split(',').filter(value => !omitted.has(value.toUpperCase())).join(',');
  if (normalize) {
    if (normalizedMode !== originalMode) await columnTaskQuery(context, `SET SESSION sql_mode = '${normalizedMode}'`);
    await columnTaskQuery(context, 'SET SESSION sql_quote_show_create = 1');
    await columnTaskQuery(context, 'SET NAMES utf8mb4 COLLATE utf8mb4_bin');
  }
  const modeRow = (await columnTaskQuery<{ sqlMode: string; quoteShowCreate: number; charset: string; collation: string }[]>(context, 'SELECT @@SESSION.sql_mode AS sqlMode, @@sql_quote_show_create AS quoteShowCreate, @@character_set_connection AS charset, @@collation_connection AS collation')).rows[0];
  if (!modeRow || typeof modeRow.sqlMode !== 'string' || modeRow.sqlMode.split(',').some(value => omitted.has(value.toUpperCase())) || Number(modeRow.quoteShowCreate) !== 1 || modeRow.charset !== 'utf8mb4' || modeRow.collation !== 'utf8mb4_bin') throw new Error('结构会话未能提供完整规范定义，未发送结构变更');
  let uuid: string | undefined;
  if (managed.status.dialect === 'mysql') {
    uuid = (await columnTaskQuery<{ uuid: string }[]>(context, 'SELECT @@server_uuid AS uuid')).rows[0]?.uuid;
    if (typeof uuid !== 'string' || !uuid) throw new Error('无法确认服务器身份');
  }
  const rows = (await columnTaskQuery<Record<string, unknown>[]>(context, `SHOW CREATE TABLE ${qualified(target.database, target.table)}`)).rows;
  if (rows.length !== 1 || typeof rows[0]['Create Table'] !== 'string') throw new Error('对象不是可修改的基本表或无权读取完整定义');
  const source = rows[0]['Create Table'];
  if (Buffer.byteLength(source) > tableColumnPatchLimits.definitionBytes) throw new Error('表定义超过 2 MiB');
  const mode = modeRow.sqlMode.split(',');
  const definitionContext: TableDefinitionContext = { dialect: managed.status.dialect, mode: { noBackslashEscapes: mode.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: mode.includes('ANSI_QUOTES') } };
  const parsed = parseTableColumnDefinition(source, definitionContext);
  if (parsed.table !== target.table || (parsed.database !== undefined && parsed.database !== target.database)) throw new Error('返回的表身份与请求不一致');
  // SHOW CREATE 对普通可空列常省略 NULL；真实目录值覆盖显示，但不能覆盖与原片段矛盾的元数据。
  const db = `CONVERT(X'${Buffer.from(target.database, 'utf8').toString('hex')}' USING utf8mb4)`, table = `CONVERT(X'${Buffer.from(target.table, 'utf8').toString('hex')}' USING utf8mb4)`;
  const tableEncodings = (await columnTaskQuery<{ charset: string | null; collation: string }[]>(context, `SELECT c.CHARACTER_SET_NAME AS charset, t.TABLE_COLLATION AS collation FROM information_schema.TABLES t LEFT JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME = t.TABLE_COLLATION WHERE t.TABLE_SCHEMA = ${db} AND t.TABLE_NAME = ${table}`)).rows;
  if (tableEncodings.length !== 1 || typeof tableEncodings[0].collation !== 'string' || !tableEncodings[0].collation) throw new Error('无法确认表的默认字符集与排序规则');
  const tableEncoding = typeof tableEncodings[0].charset === 'string' && tableEncodings[0].charset ? { charset: tableEncodings[0].charset, collation: tableEncodings[0].collation } : await resolveCollationEncoding(managed, tableEncodings[0].collation, async sql => (await columnTaskQuery<Record<string, unknown>[]>(context, sql)).rows);
  const metadata = (await columnTaskQuery<{ name: string; nullable: string; extra: string; charset: string | null; collation: string | null }[]>(context, `SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable, EXTRA AS extra, CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ${db} AND TABLE_NAME = ${table} ORDER BY ORDINAL_POSITION`)).rows;
  if (metadata.length !== parsed.columns.length || metadata.some((column, index) => column.name !== parsed.columns[index].name || !['YES', 'NO'].includes(column.nullable))) throw new Error('字段目录与完整定义不一致，请重新读取');
  const nullability: [string, boolean][] = [];
  for (const [index, column] of metadata.entries()) {
    const raw = parsed.columns[index];
    if (raw.nullable !== undefined && raw.nullable !== (column.nullable === 'YES')) throw new Error('字段可空性目录与定义矛盾');
    if (/\bauto_increment\b/i.test(column.extra) !== raw.attributes.some(attribute => attribute.kind === 'auto-increment')) throw new Error('SHOW CREATE 隐藏了真实自增属性，不能生成字段修改');
    if (!((column.charset === null && column.collation === null) || (typeof column.charset === 'string' && typeof column.collation === 'string'))) throw new Error('字段字符集目录无效');
    nullability.push([column.name, column.nullable === 'YES']);
  }
  const identity = hash(JSON.stringify({ hostname: before.hostname, port: before.port, serverId: before.serverId, currentUser: before.currentUser, uuid, dialect: managed.status.dialect, version: managed.status.version }));
  return { source, context: definitionContext, originalMode, normalizedMode: modeRow.sqlMode, identity, serverVersion: managed.status.version, nullability, tableEncoding, encodings: metadata.map(({ name, charset, collation }) => ({ name, charset, collation })) };
}

/** 同一读取快照中的目录真值与源码一起使用，不将缺省 NULL 误显示为未知或不可空。 */
function documentOf(read: DefinitionRead): TableColumnDefinitionDocument {
  const document = parseTableColumnDefinition(read.source, read.context), nullable = new Map(read.nullability);
  for (const column of document.columns) column.nullable = nullable.get(column.name);
  return document;
}

/** 投影使用服务端快照引用及共享能力，不把名称对象当字典，也不泄露物理连接编号。 */
function views(document: TableColumnDefinitionDocument, refs: Map<string, string>): TableColumnView[] {
  const byName = new Map([...refs].map(([ref, name]) => [name, ref]));
  return document.columns.map(column => ({ columnRef: byName.get(column.name) ?? randomUUID(), name: column.name, ordinal: column.ordinal, typeSql: column.type.raw, editableType: editableColumnType(column, document.context), nullable: column.nullable,
    // 只改变显示投影，不把损失字节的文本伪装成原值；内部可定位 DEFAULT 仍允许显式专用覆盖。
    default: hasUnprovenBinaryDefault(column) ? { kind: 'opaque' as const, sql: column.attributes.find(attribute => attribute.kind === 'default')!.raw, reason: '二进制默认值的原始字节不可证明，请显式选择新默认值或删除默认值' } : column.default,
    comment: column.comment, rawDefinition: column.raw, access: columnPatchAccess(column, document.context.dialect) }));
}

/** 先比较原始身份、真实模式和完整定义，不能把另一个服务器上同名表当作旧预览。 */
function assertSnapshot(snapshot: Snapshot, read: DefinitionRead): void {
  if (snapshot.identity !== read.identity) throw new Error('服务器身份已变化，请重新读取和预览；未发送 DDL');
  if (snapshot.originalMode !== read.originalMode || snapshot.normalizedMode !== read.normalizedMode) throw new Error('结构会话 SQL 模式已变化，请重新预览；未发送 DDL');
  if (snapshot.source !== read.source) throw new Error('表定义已变化，请重新读取和预览；未发送 DDL');
  if (JSON.stringify(snapshot.nullability) !== JSON.stringify(read.nullability)) throw new Error('字段目录已变化，请重新读取和预览；未发送 DDL');
  if (JSON.stringify(snapshot.encodings) !== JSON.stringify(read.encodings) || JSON.stringify(snapshot.tableEncoding) !== JSON.stringify(read.tableEncoding)) throw new Error('字段字符集目录已变化，请重新读取和预览；未发送 DDL');
}

/** 规范词法比较用于未修改结构核验，忽略布局空白但不忽略文字量和可执行片段。 */
function sameFragment(a: string, b: string, context: TableDefinitionContext): boolean {
  const tokens = (text: string) => tableDefinitionTokens(text, context).map(token => [token.kind, token.kind === 'word' ? token.value.toUpperCase() : token.value]);
  return JSON.stringify(tokens(a)) === JSON.stringify(tokens(b));
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
function verifyAfter(preview: Preview, document: TableColumnDefinitionDocument, read: DefinitionRead): boolean {
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
    if (patch.kind === 'add' && after.attributes.some(attribute => !['nullable', 'default', 'comment'].includes(attribute.kind) && !addedEncodingAttribute(attribute.kind))) return false;
    if (afterEncoding?.charset && !inheritedEncoding) return false;
    if (changes.nullable !== undefined && after.nullable !== changes.nullable) return false;
    if (changes.comment !== undefined && (after.comment ?? '') !== changes.comment) return false;
    // 原字段的未改属性逐项相等；专用改名不会要求重述危险表达式。
    if (beforeName) {
      const before = original.columnsByName.get(beforeName)!;
      const retained = (column: TableColumnDefinition) => column.attributes.filter(attribute => !(['nullable', 'default', 'comment'].includes(attribute.kind) && Object.hasOwn(changes, attribute.kind)) && !(attribute.kind === 'default' && defaultCanonicalized) && !(column === after && addedEncodingAttribute(attribute.kind)));
      if (retained(before).length !== retained(after).length) return false;
      for (const attribute of before.attributes) {
        if (['nullable', 'default', 'comment'].includes(attribute.kind) && Object.hasOwn(changes, attribute.kind)) continue;
        if (attribute.kind === 'default' && defaultCanonicalized) continue;
        const current = after.attributes.find(item => item.kind === attribute.kind);
        if (!current || !sameFragment(attribute.raw, current.raw, document.context)) return false;
      }
      if (!changes.type && !sameFragment(before.type.raw, after.type.raw, document.context)) return false;
    }
    if (changes.type && !typeMatches(changes.type, after, document.context)) return false;
    if (changes.default && !defaultMatches(changes.default, after, document.context, afterEncoding)) return false;
  }
  return true;
}

/** 快照和一次性预览只保留内存；任何失败都不自动重放 DDL，也不持有预览连接。 */
export class TableColumnPatchTasks {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly previews = new Map<string, Preview>();
  constructor(private readonly host: ColumnTaskHost, private readonly now: () => number = () => Date.now()) {}

  /** 关闭或连接重配后销毁对应能力令牌，不影响任何用户 SQL 会话。 */
  release(connectionId?: string): void {
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
    for (const [id, value] of this.snapshots) if (value.expires <= this.now()) this.snapshots.delete(id);
    for (const [id, value] of this.previews) if (value.expires <= this.now()) this.previews.delete(id);
    const used = [...this.snapshots.values(), ...this.previews.values()].reduce((sum, value) => sum + value.bytes, 0);
    if (bytes + used > columnTaskLimits.bytes || (kind === 'snapshot' ? this.snapshots.size >= columnTaskLimits.snapshots : this.previews.size >= columnTaskLimits.previews)) throw new Error('结构预览缓存已达上限，请关闭旧预览或等待两分钟后重试');
  }
  /** 主进程配置修订必须是可信非负整数；客户端无此公开字段。 */
  private revision(revision: unknown): number {
    if (!Number.isSafeInteger(revision) || Number(revision) < 0) throw new Error('缺少可信连接配置修订');
    return revision as number;
  }
  /** 读取完成后立即关闭结构连接，返回的快照不拥有网络资源。 */
  async get(input: TableColumnGetInput, revision: unknown): Promise<TableColumnGetOutput> {
    const currentRevision = this.revision(revision), progress = initialProgress();
    let snapshot!: Snapshot;
    const output = await this.host.run(input.connectionId, input.taskId, async context => {
      progress.phase = 'reading'; context.report();
      const target = { connectionId: input.connectionId, database: input.database, table: input.table };
      const read = await readDefinition(context, target, true), document = documentOf(read), risks = tableColumnDefaultRisks(document);
      const refs = new Map(document.columns.map(column => [randomUUID(), column.name]));
      const bytes = Buffer.byteLength(read.source) + Buffer.byteLength(JSON.stringify([...refs])) + Buffer.byteLength(JSON.stringify(read.nullability)) + Buffer.byteLength(JSON.stringify(read.encodings)) + 2048;
      this.capacity(bytes, 'snapshot');
      snapshot = { ...read, id: randomUUID(), target, revision: currentRevision, expires: this.now() + columnTaskLimits.ttlMs, refs, bytes };
      return { target, snapshotId: snapshot.id, ddlHash: hash(read.source), expiresAt: new Date(snapshot.expires).toISOString(), columns: views(document, refs), warnings: [...(risks.length ? [tableColumnDefaultRiskMessage(risks)] : []), ...(document.columns.some(hasUnprovenBinaryDefault) ? ['二进制文本默认值不能证明原始字节（字段：' + document.columns.filter(hasUnprovenBinaryDefault).map(column => JSON.stringify(column.name)).join('、') + '），目标列不能重述或导出结构；旁列及专用默认值操作仍可预览，成功后完整定义需人工核对。'] : []), read.originalMode === read.normalizedMode ? '结构读取使用独立短会话，未修改查询标签。' : '专用结构会话已去除隐藏定义的兼容模式；原查询标签模式未变。', '执行前重核仍存在外部 DDL 并发窗口，请在维护时段暂停并行结构修改。'], capabilities: { dialect: read.context.dialect, serverVersion: read.serverVersion, maxDecimalScale: read.context.dialect === 'mariadb' ? 38 as const : 30 as const } };
    }, { label: '读取字段定义', columnPatch: progress });
    this.capacity(snapshot.bytes, 'snapshot'); this.snapshots.set(snapshot.id, snapshot);
    output.target = { ...snapshot.target };
    Object.assign(output, { definitionContext: { originalSqlMode: snapshot.originalMode, sqlMode: snapshot.normalizedMode, characterSetConnection: 'utf8mb4', collationConnection: 'utf8mb4_bin', sqlQuoteShowCreate: true } });
    return output;
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
      if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('字段快照已释放或过期，未创建新预览');
      const plan = buildTableColumnPatchSql(documentOf(snapshot), patches, { database: snapshot.target.database, serverVersion: snapshot.serverVersion, columnRefs: snapshot.refs });
      const bytes = snapshot.bytes + Buffer.byteLength(plan.sql) + Buffer.byteLength(JSON.stringify(patches)) + 2048;
      this.capacity(bytes, 'preview'); value = { snapshot, plan, patches, expires: this.now() + columnTaskLimits.ttlMs, bytes };
      return { previewToken: token, expiresAt: new Date(value.expires).toISOString(), target: { ...snapshot.target }, ddlHash: hash(snapshot.source), sql: plan.sql, changes: patches.map(patch => ({ ...(patch.kind !== 'add' ? { columnRef: patch.columnRef } : {}), description: patch.kind === 'add' ? '新增字段' : patch.kind === 'drop' ? '删除字段及其数据' : '修改指定字段属性' })), warnings: plan.warnings, requiredAcknowledgements: ['ddl-implicit-commit', 'external-ddl-window', ...plan.requiredAcknowledgements], concurrencyPolicy: 'recheck-before-ddl' as const };
    }, { label: '预览字段变更', columnPatch: progress });
    if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw new Error('字段快照已释放或过期，未创建新预览');
    this.capacity(value.bytes, 'preview'); this.previews.set(token, value); return output;
  }
  /** 应用先消费令牌；同一短会话完成重核和唯一一次 ALTER，失败后只能由用户重新读取确认。 */
  async apply(input: TableColumnApplyInput, revision: unknown): Promise<TableColumnApplyOutput> {
    const preview = this.previews.get(input.previewToken); this.previews.delete(input.previewToken);
    if (!preview || preview.expires <= this.now()) throw new Error('字段预览已失效或已使用，请重新预览；未发送 DDL');
    const snapshot = preview.snapshot;
    if (snapshot.revision !== this.revision(revision)) throw new Error('连接配置已变化，请重新读取并预览；未发送 DDL');
    if (['ddl-implicit-commit', 'external-ddl-window', ...preview.plan.requiredAcknowledgements].some(value => !input.acknowledgements.includes(value))) throw new Error('尚未确认结构变更后果；预览已消费，未发送 DDL');
    const progress = initialProgress();
    return this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report();
      const current = await readDefinition(context, snapshot.target, true); assertSnapshot(snapshot, current);
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
        output.definitionVerified = progress.definitionVerified = after.identity === current.identity && after.normalizedMode === current.normalizedMode && verifyAfter(preview, document, after);
        output.after = { ddlHash: hash(after.source), columns: views(document, new Map(preview.plan.finalColumns.map(column => [column.columnRef, column.name]))) };
        if (document.columns.some(hasUnprovenBinaryDefault)) output.warnings.push('二进制默认值仍以不能证明原始字节的文本显示；DDL 已完成，但这些字段的默认值未核验，不能据此自动重建或重复执行。');
        if (!output.definitionVerified) output.verificationError = 'DDL 已完成，但定义变更及未改属性尚未全部核验一致，请核对最新定义；不要重复执行';
      } catch { output.verificationError = 'DDL 已收到成功响应，但取消、断线或读取失败使后续定义未能核验；不要重复执行'; }
      context.report(); this.release(snapshot.target.connectionId); return output;
    }, { label: '执行字段变更', columnPatch: progress });
  }
}
