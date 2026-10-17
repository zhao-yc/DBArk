import { createHash } from 'node:crypto';
import type { FieldPacket } from 'mysql2';
import type { ManagedConnection } from './connection';
import { qualified } from './sql';
import { resolveCollationEncoding } from './metadata';
import { parseTableColumnDefinition, tableDefinitionTokens } from './tableColumnDefinition';
import { definitionOmittingSqlModes, tableColumnPatchLimits, type TableColumnApplyProgress, type TableColumnPatchTarget, type TableColumnDefinitionDocument, type TableDefinitionContext } from '../shared/tableColumnPatches';

export interface StructureTaskContext { managed: ManagedConnection; checkCancelled(): void; report(): void; commandStarted(): () => void; }
export interface StructureTaskOptions {
  label: string; purpose: 'columns' | 'indexes' | 'foreignKeys' | 'tableComment' | 'tableDrop' | 'tableTruncate' | 'tableDefaultEncoding' | 'tableCreate' | 'databaseCreate' | 'tableCopyData' | 'tableCopyStructure' | 'tableRename' | 'tableAutoIncrement'; progress: TableColumnApplyProgress;
  executionTarget?: { database: string; table: string }; executionTargets?: readonly { database: string; table: string }[];
  /** 仅Engine在任务与取消控制会话严格收尾均已确认后通知；不是动作成功或取消ACK。 */
  onResourcesReleased?: () => void;
}
export interface StructureTaskHost { run<T>(connectionId: string, taskId: string, action: (context: StructureTaskContext) => Promise<T>, options: StructureTaskOptions): Promise<T>; }
export interface StructureColumnEncoding { name: string; charset: string | null; collation: string | null; }
export interface StructureDefinitionRead { source: string; context: TableDefinitionContext; originalMode: string; normalizedMode: string; identity: string; serverVersion: string; nullability: [string, boolean][]; encodings: StructureColumnEncoding[]; tableEncoding: { charset: string; collation: string }; columnExtras?: [string, string][]; }

const hash = (source: string): string => createHash('sha256').update(source).digest('hex');

/** 结构短会话等待真实回调/连接终态；取消负责 KILL 后关闭，不因 AbortSignal 提前假报命令已结束。 */
export function structureTaskQuery<T>(context: StructureTaskContext, sql: string, submitted?: () => void): Promise<{ rows: T; fields: FieldPacket[] }> {
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
export async function readStructureDefinition(context: StructureTaskContext, target: TableColumnPatchTarget, normalize: boolean): Promise<StructureDefinitionRead> {
  const managed = context.managed;
  const before = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SELECT @@SESSION.sql_mode AS sqlMode, @@hostname AS hostname, @@port AS port, @@server_id AS serverId, CURRENT_USER() AS currentUser, CONNECTION_ID() AS connectionId, @@character_set_connection AS characterSetConnection, @@collation_connection AS collationConnection, @@sql_quote_show_create AS quoteShowCreate')).rows[0];
  if (!before || typeof before.sqlMode !== 'string' || Number(before.connectionId) !== managed.connection.threadId) throw new Error('无法确认结构会话身份');
  const originalMode = before.sqlMode;
  if (!/^[A-Z0-9_,]*$/i.test(originalMode)) throw new Error('服务器 SQL 模式无效');
  const omitted = new Set<string>(definitionOmittingSqlModes);
  const normalizedMode = originalMode.split(',').filter(value => !omitted.has(value.toUpperCase())).join(',');
  if (normalize) {
    if (normalizedMode !== originalMode) await structureTaskQuery(context, `SET SESSION sql_mode = '${normalizedMode}'`);
    await structureTaskQuery(context, 'SET SESSION sql_quote_show_create = 1');
    await structureTaskQuery(context, 'SET NAMES utf8mb4 COLLATE utf8mb4_bin');
  }
  const modeRow = (await structureTaskQuery<{ sqlMode: string; quoteShowCreate: number; charset: string; collation: string }[]>(context, 'SELECT @@SESSION.sql_mode AS sqlMode, @@sql_quote_show_create AS quoteShowCreate, @@character_set_connection AS charset, @@collation_connection AS collation')).rows[0];
  if (!modeRow || typeof modeRow.sqlMode !== 'string' || modeRow.sqlMode.split(',').some(value => omitted.has(value.toUpperCase())) || Number(modeRow.quoteShowCreate) !== 1 || modeRow.charset !== 'utf8mb4' || modeRow.collation !== 'utf8mb4_bin') throw new Error('结构会话未能提供完整规范定义，未发送结构变更');
  let uuid: string | undefined;
  if (managed.status.dialect === 'mysql') {
    uuid = (await structureTaskQuery<{ uuid: string }[]>(context, 'SELECT @@server_uuid AS uuid')).rows[0]?.uuid;
    if (typeof uuid !== 'string' || !uuid) throw new Error('无法确认服务器身份');
  }
  const rows = (await structureTaskQuery<Record<string, unknown>[]>(context, `SHOW CREATE TABLE ${qualified(target.database, target.table)}`)).rows;
  if (rows.length !== 1 || typeof rows[0]['Create Table'] !== 'string') throw new Error('对象不是可修改的基本表或无权读取完整定义');
  const source = rows[0]['Create Table'];
  if (Buffer.byteLength(source) > tableColumnPatchLimits.definitionBytes) throw new Error('表定义超过 2 MiB');
  const mode = modeRow.sqlMode.split(',');
  const definitionContext: TableDefinitionContext = { dialect: managed.status.dialect, mode: { noBackslashEscapes: mode.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: mode.includes('ANSI_QUOTES') } };
  const parsed = parseTableColumnDefinition(source, definitionContext);
  if (parsed.table !== target.table || (parsed.database !== undefined && parsed.database !== target.database)) throw new Error('返回的表身份与请求不一致');
  // SHOW CREATE 对普通可空列常省略 NULL；真实目录值覆盖显示，但不能覆盖与原片段矛盾的元数据。
  const db = `CONVERT(X'${Buffer.from(target.database, 'utf8').toString('hex')}' USING utf8mb4)`, table = `CONVERT(X'${Buffer.from(target.table, 'utf8').toString('hex')}' USING utf8mb4)`;
  const tableEncodings = (await structureTaskQuery<{ charset: string | null; collation: string }[]>(context, `SELECT c.CHARACTER_SET_NAME AS charset, t.TABLE_COLLATION AS collation FROM information_schema.TABLES t LEFT JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME = t.TABLE_COLLATION WHERE t.TABLE_SCHEMA = ${db} AND t.TABLE_NAME = ${table} LIMIT 2`)).rows;
  if (tableEncodings.length !== 1 || typeof tableEncodings[0].collation !== 'string' || !tableEncodings[0].collation) throw new Error('无法确认表的默认字符集与排序规则');
  const tableEncoding = typeof tableEncodings[0].charset === 'string' && tableEncodings[0].charset ? { charset: tableEncodings[0].charset, collation: tableEncodings[0].collation } : await resolveCollationEncoding(managed, tableEncodings[0].collation, async sql => (await structureTaskQuery<Record<string, unknown>[]>(context, sql)).rows);
  const metadata = (await structureTaskQuery<{ name: string; nullable: string; extra: string; charset: string | null; collation: string | null }[]>(context, `SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable, EXTRA AS extra, CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ${db} AND TABLE_NAME = ${table} ORDER BY ORDINAL_POSITION LIMIT 4097`)).rows;
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
  // 保留已有EXTRA观测供复制用途交叉核生成属性；不改变通用字段编辑能力或生成器。
  return { source, context: definitionContext, originalMode, normalizedMode: modeRow.sqlMode, identity, serverVersion: managed.status.version, nullability, tableEncoding, encodings: metadata.map(({ name, charset, collation }) => ({ name, charset, collation })), columnExtras: metadata.map(({ name, extra }) => [name, extra]) };
}

/** 同一读取快照中的目录真值与源码一起使用，不将缺省 NULL 误显示为未知或不可空。 */
export function structureDocumentOf(read: StructureDefinitionRead): TableColumnDefinitionDocument {
  const document = parseTableColumnDefinition(read.source, read.context), nullable = new Map(read.nullability);
  for (const column of document.columns) column.nullable = nullable.get(column.name);
  return document;
}

/** 先比较原始身份、真实模式和完整定义，不能把另一个服务器上同名表当作旧预览。 */
export function assertStructureDefinitionUnchanged(snapshot: StructureDefinitionRead, read: StructureDefinitionRead): void {
  if (snapshot.identity !== read.identity) throw new Error('服务器身份已变化，请重新读取和预览；未发送 DDL');
  if (snapshot.originalMode !== read.originalMode || snapshot.normalizedMode !== read.normalizedMode) throw new Error('结构会话 SQL 模式已变化，请重新预览；未发送 DDL');
  if (snapshot.source !== read.source) throw new Error('表定义已变化，请重新读取和预览；未发送 DDL');
  if (JSON.stringify(snapshot.nullability) !== JSON.stringify(read.nullability)) throw new Error('字段目录已变化，请重新读取和预览；未发送 DDL');
  if (JSON.stringify(snapshot.encodings) !== JSON.stringify(read.encodings) || JSON.stringify(snapshot.tableEncoding) !== JSON.stringify(read.tableEncoding)) throw new Error('字段字符集目录已变化，请重新读取和预览；未发送 DDL');
}

/** 规范词法比较用于未修改结构核验，忽略布局空白但不忽略文字量和可执行片段。 */
export function sameStructureFragment(a: string, b: string, context: TableDefinitionContext): boolean {
  const tokens = (text: string) => tableDefinitionTokens(text, context).map(token => [token.kind, token.kind === 'word' ? token.value.toUpperCase() : token.value]);
  return JSON.stringify(tokens(a)) === JSON.stringify(tokens(b));
}
