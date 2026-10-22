import { createHash, randomUUID } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import { StructurePatchCache, structureCacheLimits, type StructureCacheScope } from './structurePatchCache';
import { structureTaskQuery, type StructureTaskContext, type StructureTaskHost } from './structureDefinition';
import { readTableDefaultEncodingCatalog } from './tableDefaultEncodingCatalog';
import { identifier } from './sql';
import { databaseCreateAcknowledgements, databaseCreateSelection, validateDatabaseCreateName, type DatabaseCreateGetInput, type DatabaseCreateGetOutput, type DatabaseCreatePreviewInput, type DatabaseCreatePreviewOutput, type DatabaseCreateApplyInput, type DatabaseCreateApplyOutput, type DatabaseCreateReleaseInput, type DatabaseCreateProgress } from '../shared/databaseCreate';
import type { TableEncodingPair } from '../shared/tableDefaultEncoding';

interface Read { identity: string; catalogDigest: string; candidates: TableEncodingPair[]; reasons: string[]; warnings: string[]; bytes: number; serverVersion: string; }
interface Snapshot extends Read { connectionId: string; revision: number; expires: number; }
interface Preview { snapshotId: string; snapshot: Snapshot; name: string; selection: TableEncodingPair; sql: string; bytes: number; expires: number; }
const progressOf = (): DatabaseCreateProgress => ({ phase: 'connecting', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const warnings = ['本次仅创建一个新数据库，不修改任何已有数据库、表或列。', 'DDL可能隐式提交；取消、断线或服务中断不能证明创建未发生，不会自动重试。', '确认前重核不能消除外部并发窗口；同名已存在时由服务器拒绝，不使用IF NOT EXISTS掩盖结果。'];

/** 不依赖业务表的独立目录读取；身份、模式及实际目录共同绑定预览。 */
async function read(context: StructureTaskContext): Promise<Read> {
  const rows = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,CURRENT_USER() AS currentUser,@@sql_mode AS sqlMode,@@lower_case_table_names AS lowerNames')).rows;
  if (!Array.isArray(rows) || rows.length !== 1 || ['hostname', 'currentUser', 'sqlMode'].some(key => typeof rows[0][key] !== 'string') || ![0, 1, 2, '0', '1', '2'].includes(rows[0].lowerNames as number) || !/^[0-9]+$/.test(String(rows[0].port)) || !/^[0-9]+$/.test(String(rows[0].serverId))) throw Error('无法确认服务器身份、名称映射与会话模式');
  const { version, dialect } = context.managed.status;
  const reasons: string[] = [], known = dialect === 'mysql' ? ['5.7.44', '8.0.46', '8.4.11'] : ['10.11.19', '11.4.13'];
  if (!known.includes(version.replace(/^5\.5\.5-/, '').split(/[-+]/)[0])) reasons.push('该服务器版本的新建库编码能力尚未证明，当前只读');
  let uuid: string | undefined;
  if (dialect === 'mysql') {
    const values = (await structureTaskQuery<{ uuid: string }[]>(context, 'SELECT @@server_uuid AS uuid')).rows;
    if (values.length !== 1 || typeof values[0].uuid !== 'string' || !values[0].uuid) throw Error('无法证明服务器UUID'); uuid = values[0].uuid;
  }
  let candidates: TableEncodingPair[] = [], catalogDigest = '', bytes = 0, notes: string[] = [];
  try { const catalog = await readTableDefaultEncodingCatalog(context); candidates = catalog.candidates; catalogDigest = catalog.digest; bytes = catalog.bytes; notes = catalog.warnings; }
  catch (error) { context.checkCancelled(); reasons.push(error instanceof Error ? error.message : '编码目录不完整，请重新读取'); }
  return { identity: digest([rows[0], uuid, version, dialect]), catalogDigest, candidates, reasons, warnings: notes, bytes: bytes + 8192, serverVersion: version };
}
/** 库名禁止反斜线，单引号双写在当前两种sql_mode下均保持字面量；读目录不切换默认库。 */
async function databaseRows(context: StructureTaskContext, name: string) {
  return (await structureTaskQuery<{ name: string; charset: string; collation: string }[]>(context, `SELECT SCHEMA_NAME AS name,DEFAULT_CHARACTER_SET_NAME AS charset,DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${name.replaceAll("'", "''")}' LIMIT 2`)).rows;
}
/** 新建库独立用途，复用全局结构缓存和短会话；任何等待前消费执行令牌。 */
export class DatabaseCreateTasks {
  private readonly snapshots: StructureCacheScope<Snapshot>;
  private readonly previews: StructureCacheScope<Preview>;
  private readonly executing = new Set<string>();
  constructor(private readonly host: StructureTaskHost, private readonly now = () => Date.now(), private readonly cache = new StructurePatchCache(now)) {
    this.snapshots = cache.scope('databaseCreate', 'snapshot', value => ({ connectionId: value.connectionId, bytes: value.bytes, expires: value.expires }));
    this.previews = cache.scope('databaseCreate', 'preview', value => ({ connectionId: value.snapshot.connectionId, bytes: value.bytes, expires: value.expires }));
  }
  /** 只释放当前用途及依赖预览，不能删除其它结构编辑器的令牌。 */
  releaseTokens(input: DatabaseCreateReleaseInput): void {
    if (input.snapshotId) { this.snapshots.delete(input.snapshotId); for (const [token, preview] of this.previews) if (preview.snapshotId === input.snapshotId) this.previews.delete(token); }
    if (input.previewToken) this.previews.delete(input.previewToken);
  }
  /** 修订只由main注入，renderer不能自行指定。 */
  private revision(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw Error('缺少可信连接修订'); return value as number; }
  /** 目录与身份任一变化即要求重读，不在旧预览上替换候选或目标。 */
  private unchanged(snapshot: Snapshot, current: Read): void {
    if (current.reasons.length || !current.catalogDigest || snapshot.identity !== current.identity || snapshot.catalogDigest !== current.catalogDigest) throw Error('服务器身份、模式或编码目录已变化，请重新读取；未发送DDL');
  }
  /** 关闭真实短连接后才发布目录快照；异常不留下可执行能力。 */
  async get(input: DatabaseCreateGetInput, revision: unknown): Promise<DatabaseCreateGetOutput> {
    const connectionRevision = this.revision(revision), progress = progressOf(), id = randomUUID(); let snapshot!: Snapshot;
    const result = await this.host.run(input.connectionId, input.taskId, async context => {
      progress.phase = 'reading'; context.report(); const actual = await read(context);
      snapshot = { ...actual, connectionId: input.connectionId, revision: connectionRevision, expires: this.now() + structureCacheLimits.ttlMs }; this.cache.capacity(snapshot.bytes, 'snapshot');
      return { target: { connectionId: input.connectionId }, snapshotId: id, expiresAt: new Date(snapshot.expires).toISOString(), catalogDigest: actual.catalogDigest, candidates: actual.candidates.map(pair => ({ ...pair })), writable: !actual.reasons.length && !!actual.catalogDigest, reasons: actual.reasons, warnings: [...warnings, ...actual.warnings], serverVersion: actual.serverVersion };
    }, { label: '读取新建库编码目录', purpose: 'databaseCreate', progress });
    this.snapshots.set(id, snapshot); return result;
  }
  /** 预览只接受名称及真实配对，重核目录和名称不存在，不发送SQL写入。 */
  async preview(input: DatabaseCreatePreviewInput, revision: unknown): Promise<DatabaseCreatePreviewOutput> {
    const snapshot = this.snapshots.get(input.snapshotId);
    if (!snapshot || snapshot.expires <= this.now() || snapshot.revision !== this.revision(revision)) throw Error('目录快照或连接修订已失效，请重新读取');
    if (snapshot.reasons.length || !snapshot.catalogDigest) throw Error('编码能力未证明，请重新读取完整目录');
    const name = validateDatabaseCreateName(input.name), selection = databaseCreateSelection(input, snapshot.candidates);
    const sql = `CREATE DATABASE ${identifier(name)} CHARACTER SET ${identifier(selection.charset)} COLLATE ${identifier(selection.collation)};`, token = randomUUID(), progress = progressOf();
    const preview: Preview = { snapshotId: input.snapshotId, snapshot, name, selection, sql, bytes: snapshot.bytes + Buffer.byteLength(sql) + 1024, expires: snapshot.expires };
    const result = await this.host.run(snapshot.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report(); this.unchanged(snapshot, await read(context));
      if ((await databaseRows(context, name)).length) throw Error('同名数据库已存在，不能执行新建');
      return { target: { connectionId: snapshot.connectionId }, name, selection, previewToken: token, expiresAt: new Date(preview.expires).toISOString(), catalogDigest: snapshot.catalogDigest, sql, warnings: [...warnings, ...snapshot.warnings], requiredAcknowledgements: [...databaseCreateAcknowledgements] };
    }, { label: '预览新建数据库', purpose: 'databaseCreate', progress });
    if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw Error('目录快照已释放或过期，未发布新预览');
    this.previews.set(token, preview); return result;
  }
  /** 消费令牌、同步占用名称，再建立独立会话；断线或取消不自动重放。 */
  async apply(input: DatabaseCreateApplyInput, revision: unknown): Promise<DatabaseCreateApplyOutput> {
    const preview = this.previews.get(input.previewToken); this.previews.delete(input.previewToken);
    if (!preview || preview.expires <= this.now() || preview.snapshot.revision !== this.revision(revision)) throw Error('新建库预览已失效或已使用，未发送DDL');
    if (input.confirmation !== preview.name || !Array.isArray(input.acknowledgements) || input.acknowledgements.length !== databaseCreateAcknowledgements.length || new Set(input.acknowledgements).size !== input.acknowledgements.length || databaseCreateAcknowledgements.some(value => !input.acknowledgements.includes(value))) throw Error('名称或确认项与实际预览不一致；令牌已消费，未发送DDL');
    const snapshot = preview.snapshot, key = JSON.stringify([snapshot.connectionId, preview.name.toLowerCase()]);
    if (this.executing.has(key)) throw Error('同连接同名数据库正在创建，旧预览不能重试'); this.executing.add(key);
    const progress = progressOf();
    try { return await this.host.run(snapshot.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report(); this.unchanged(snapshot, await read(context));
      if ((await databaseRows(context, preview.name)).length) throw Error('同名数据库已出现，请重新读取；未发送DDL');
      if (preview.expires <= this.now() || this.snapshots.get(preview.snapshotId) !== snapshot) throw Error('目录已释放或预览已过期，未发送DDL');
      progress.phase = 'executing'; context.report();
      const result = (await structureTaskQuery<ResultSetHeader>(context, preview.sql, () => { progress.ddlSubmitted = true; progress.outcome = 'unknown'; context.report(); })).rows;
      if (!result || typeof result.affectedRows !== 'number') throw Error('未取得可确认的创建响应；请核对实际数据库，不要重试');
      progress.ddlCompleted = true; progress.outcome = 'succeeded'; progress.phase = 'verifying'; context.report();
      const output: DatabaseCreateApplyOutput = { name: preview.name, ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: result.warningStatus ? ['服务器返回创建警告，请核对新库实际编码。'] : [] };
      try { const actual = await databaseRows(context, preview.name); output.definitionVerified = progress.definitionVerified = actual.length === 1 && actual[0].name === preview.name && actual[0].charset === preview.selection.charset && actual[0].collation === preview.selection.collation; }
      catch { /* 已收到DDL成功响应，后核验失败必须保留完成事实，不能当作未执行。 */ }
      if (!output.definitionVerified) output.warnings.push('创建已收到成功响应，但实际名称或编码未完整核验；请核对数据库，不要重复执行。');
      context.report(); this.releaseTokens({ snapshotId: preview.snapshotId }); return output;
    }, { label: '创建数据库', purpose: 'databaseCreate', progress, executionDatabase: preview.name }); }
    finally { this.executing.delete(key); }
  }
}
