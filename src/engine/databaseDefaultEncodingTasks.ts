import { createHash, randomUUID } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2';
import { StructurePatchCache, structureCacheLimits, type StructureCacheScope } from './structurePatchCache';
import { structureTaskQuery, type StructureTaskContext, type StructureTaskHost } from './structureDefinition';
import { readTableDefaultEncodingCatalog } from './tableDefaultEncodingCatalog';
import { identifier } from './sql';
import { databaseCreateSelection, validateDatabaseCreateName } from '../shared/databaseCreate';
import { sameTableEncodingPair, type TableEncodingPair } from '../shared/tableDefaultEncoding';
import { databaseDefaultEncodingAcknowledgements as acknowledgements, databaseDefaultEncodingWarnings as warnings, type DatabaseDefaultEncodingTarget, type DatabaseDefaultEncodingGetInput, type DatabaseDefaultEncodingGetOutput, type DatabaseDefaultEncodingPreviewInput, type DatabaseDefaultEncodingPreviewOutput, type DatabaseDefaultEncodingApplyInput, type DatabaseDefaultEncodingApplyOutput, type DatabaseDefaultEncodingReleaseInput, type DatabaseDefaultEncodingProgress } from '../shared/databaseDefaultEncoding';

interface Read { identity: string; source: string; remainder: string; current: TableEncodingPair; catalogDigest: string; candidates: TableEncodingPair[]; reasons: string[]; warnings: string[]; bytes: number; serverVersion: string; }
interface Snapshot extends Read { id: string; target: DatabaseDefaultEncodingTarget; revision: number; expires: number; }
interface Preview { snapshot: Snapshot; selection: TableEncodingPair; sql: string; bytes: number; expires: number; }
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const progressOf = (): DatabaseDefaultEncodingProgress => ({ phase: 'connecting', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' });
const literal = (value: string): string => `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;

/** 只识别实际SHOW CREATE的数据库名称和单个默认编码块；其余属性按原文保留比较。 */
function definition(source: string, name: string): { charset: string; collation?: string; remainder: string } {
  if (Buffer.byteLength(source) > 65536) throw Error('数据库定义超过64 KiB预算');
  const start = /^CREATE DATABASE\s+`((?:``|[^`])+)`\s+/i.exec(source);
  if (!start || start[1].replaceAll('``', '`') !== name) throw Error('SHOW CREATE数据库名称与目标不一致');
  const tail = source.slice(start[0].length);
  const encoding = /^(\/\*!40100\s+)?DEFAULT CHARACTER SET\s+([A-Za-z0-9_]{1,64})(?:\s+COLLATE\s+([A-Za-z0-9_]{1,255}))?\s*(\*\/)?/i.exec(tail);
  if (!encoding || Boolean(encoding[1]) !== Boolean(encoding[4])) throw Error('数据库SHOW CREATE未提供完整可证明的默认编码');
  const rest = tail.slice(encoding[0].length).trim();
  // 已知附加属性不改写；未知可执行片段绝不猜成安全定义。
  if (rest && !/^(?:\/\*!80016\s+DEFAULT ENCRYPTION='[NY]'\s*\*\/|COMMENT\s+'(?:''|[^'\\])*')$/i.test(rest)) throw Error('数据库定义包含尚未验证的附加属性，当前只读');
  return { charset: encoding[2], collation: encoding[3], remainder: source.slice(0, start[0].length).trim() + '\n' + rest };
}

/** 同一短会话交叉核对真实目录、完整定义、身份及sql_mode，不切换默认库。 */
async function read(context: StructureTaskContext, target: DatabaseDefaultEncodingTarget): Promise<Read> {
  const values = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,CURRENT_USER() AS currentUser,@@sql_mode AS sqlMode,@@lower_case_table_names AS lowerNames')).rows;
  if (!Array.isArray(values) || values.length !== 1 || ['hostname', 'currentUser', 'sqlMode'].some(key => typeof values[0][key] !== 'string') || !/^[A-Z0-9_,]*$/i.test(String(values[0].sqlMode)) || ![0, 1, 2, '0', '1', '2'].includes(values[0].lowerNames as number) || !/^\d+$/.test(String(values[0].port)) || !/^\d+$/.test(String(values[0].serverId))) throw Error('无法确认服务器身份、名称映射或SQL模式');
  const { version, dialect } = context.managed.status, reasons: string[] = [];
  const known = dialect === 'mysql' ? ['5.7.44', '8.0.46', '8.4.11'] : dialect === 'mariadb' ? ['10.11.19', '11.4.13'] : [];
  if (!known.includes(version.replace(/^5\.5\.5-/, '').split(/[-+]/)[0])) reasons.push('该服务器版本的数据库默认编码变更尚未验证，当前只读');
  let uuid: string | undefined;
  if (dialect === 'mysql') {
    const rows = (await structureTaskQuery<{ uuid: string }[]>(context, 'SELECT @@server_uuid AS uuid')).rows;
    if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0].uuid !== 'string' || !rows[0].uuid) throw Error('无法确认服务器UUID'); uuid = rows[0].uuid;
  }
  const schemas = (await structureTaskQuery<{ name: string; charset: string; collation: string }[]>(context, `SELECT SCHEMA_NAME AS name,DEFAULT_CHARACTER_SET_NAME AS charset,DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ${literal(target.database)} LIMIT 2`)).rows;
  if (!Array.isArray(schemas) || schemas.length !== 1 || schemas[0].name !== target.database) throw Error('目标数据库不存在、无权查看或真实名称不一致');
  const current = databaseCreateSelection(schemas[0], [schemas[0]]);
  const rows = (await structureTaskQuery<Record<string, unknown>[]>(context, `SHOW CREATE DATABASE ${identifier(target.database)}`)).rows;
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].Database !== target.database || typeof rows[0]['Create Database'] !== 'string') throw Error('无法确认目标数据库完整定义与真实名称');
  const source = rows[0]['Create Database'] as string;
  let remainder = '';
  try {
    const parsed = definition(source, target.database); remainder = parsed.remainder;
    if (parsed.charset !== current.charset || (parsed.collation && parsed.collation !== current.collation)) throw Error('数据库目录与SHOW CREATE默认编码不一致');
    if (!parsed.collation) {
      const defaults = (await structureTaskQuery<{ charset: string; collation: string }[]>(context, `SELECT CHARACTER_SET_NAME AS charset,DEFAULT_COLLATE_NAME AS collation FROM information_schema.CHARACTER_SETS WHERE BINARY CHARACTER_SET_NAME=BINARY ${literal(current.charset)} LIMIT 2`)).rows;
      if (!Array.isArray(defaults) || defaults.length !== 1 || defaults[0].charset !== current.charset || defaults[0].collation !== current.collation) throw Error('SHOW CREATE省略排序规则，但实际字符集默认值无法交叉证明');
    }
  } catch (error) { context.checkCancelled(); reasons.push(error instanceof Error ? error.message : '数据库完整定义无法核对'); }
  let candidates: TableEncodingPair[] = [], catalogDigest = '', bytes = Buffer.byteLength(source) + 8192, notes: string[] = [];
  try { const catalog = await readTableDefaultEncodingCatalog(context); candidates = catalog.candidates; catalogDigest = catalog.digest; bytes += catalog.bytes; notes = catalog.warnings; databaseCreateSelection(current, candidates); }
  catch (error) { context.checkCancelled(); reasons.push(error instanceof Error ? error.message : '编码目录无法完整核对'); }
  return { identity: hash([values[0], uuid, version, dialect]), source, remainder, current, catalogDigest, candidates, reasons, warnings: notes, bytes, serverVersion: version };
}

/** 数据库默认值独立双阶段令牌；没有数据库稳定对象ID，不把重核宣传为原子CAS。 */
export class DatabaseDefaultEncodingTasks {
  private readonly snapshots: StructureCacheScope<Snapshot>;
  private readonly previews: StructureCacheScope<Preview>;
  private readonly executing = new Map<string, { connectionId: string }>();
  constructor(private readonly host: StructureTaskHost, private readonly now = () => Date.now(), private readonly cache = new StructurePatchCache(now)) {
    this.snapshots = cache.scope('databaseDefaultEncoding', 'snapshot', value => ({ connectionId: value.target.connectionId, bytes: value.bytes, expires: value.expires }));
    this.previews = cache.scope('databaseDefaultEncoding', 'preview', value => ({ connectionId: value.snapshot.target.connectionId, bytes: value.bytes, expires: value.expires }));
  }
  /** 只释放此用途及对应预览，不影响其他结构任务。 */
  releaseTokens(input: DatabaseDefaultEncodingReleaseInput): void {
    if (input.snapshotId) { const snapshot = this.snapshots.get(input.snapshotId); this.snapshots.delete(input.snapshotId); if (snapshot) for (const [id, preview] of this.previews) if (preview.snapshot === snapshot) this.previews.delete(id); }
    if (input.previewToken) this.previews.delete(input.previewToken);
  }
  /** 仅供Engine确认原任务终态、取消收尾及物理资源恢复成功后调用；撤销旧能力，不重放动作。 */
  releaseConnection(connectionId: string): void {
    for (const [id, snapshot] of this.snapshots) if (snapshot.target.connectionId === connectionId) this.releaseTokens({ snapshotId: id });
    for (const [id, preview] of this.previews) if (preview.snapshot.target.connectionId === connectionId) this.previews.delete(id);
    for (const [key, lease] of this.executing) if (lease.connectionId === connectionId) this.executing.delete(key);
  }
  /** 修订只来自可信main，不接受renderer声明的版本。 */
  private revision(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw Error('缺少可信连接修订'); return value as number; }
  /** 同值重建无法证明身份连续性；可观测身份、定义、目录与默认值必须全部一致。 */
  private unchanged(snapshot: Snapshot, current: Read): void {
    if (current.reasons.length || !current.catalogDigest || current.identity !== snapshot.identity || current.source !== snapshot.source || current.catalogDigest !== snapshot.catalogDigest || !sameTableEncodingPair(current.current, snapshot.current)) throw Error('数据库身份、完整定义、默认编码、会话模式或编码目录已变化；请重新读取，未发送DDL');
  }
  /** 真实短会话正常关闭后发布快照，服务器未知能力保留只读原因。 */
  async get(input: DatabaseDefaultEncodingGetInput, revision: unknown): Promise<DatabaseDefaultEncodingGetOutput> {
    const connectionRevision = this.revision(revision), target = { connectionId: input.connectionId, database: validateDatabaseCreateName(input.database) }, progress = progressOf(); let snapshot!: Snapshot;
    const output = await this.host.run(target.connectionId, input.taskId, async context => {
      progress.phase = 'reading'; context.report(); const actual = await read(context, target); this.cache.capacity(actual.bytes, 'snapshot');
      snapshot = { ...actual, id: randomUUID(), target, revision: connectionRevision, expires: this.now() + structureCacheLimits.ttlMs };
      return { target: { ...target }, snapshotId: snapshot.id, expiresAt: new Date(snapshot.expires).toISOString(), definitionHash: hash(actual.source), catalogDigest: actual.catalogDigest, current: { ...actual.current }, candidates: actual.candidates.map(pair => ({ ...pair })), writable: !actual.reasons.length && !!actual.catalogDigest, reasons: [...actual.reasons], warnings: [...warnings, ...actual.warnings], serverVersion: actual.serverVersion };
    }, { label: '读取数据库默认编码', purpose: 'databaseDefaultEncoding', progress });
    this.snapshots.set(snapshot.id, snapshot); return output;
  }
  /** 重核后只生成单个ALTER DATABASE，不修改已有表列，不允许无变化预览。 */
  async preview(input: DatabaseDefaultEncodingPreviewInput, revision: unknown): Promise<DatabaseDefaultEncodingPreviewOutput> {
    const snapshot = this.snapshots.get(input.snapshotId);
    if (!snapshot || snapshot.expires <= this.now() || snapshot.revision !== this.revision(revision)) throw Error('数据库默认编码快照已失效，请重新读取');
    if (snapshot.reasons.length || !snapshot.catalogDigest) throw Error('数据库默认编码当前只读，请重新读取完整目录');
    const selection = databaseCreateSelection(input, snapshot.candidates);
    if (sameTableEncodingPair(selection, snapshot.current)) throw Error('默认编码没有变化，无需执行');
    const sql = `ALTER DATABASE ${identifier(snapshot.target.database)} DEFAULT CHARACTER SET ${identifier(selection.charset)} COLLATE ${identifier(selection.collation)};`, token = randomUUID(), progress = progressOf();
    const preview = { snapshot, selection, sql, bytes: snapshot.bytes + Buffer.byteLength(sql) + 8192, expires: snapshot.expires };
    const output = await this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report(); this.unchanged(snapshot, await read(context, snapshot.target)); this.cache.capacity(preview.bytes, 'preview');
      return { target: { ...snapshot.target }, before: { ...snapshot.current }, after: { ...selection }, previewToken: token, expiresAt: new Date(preview.expires).toISOString(), definitionHash: hash(snapshot.source), catalogDigest: snapshot.catalogDigest, sql, warnings: [...warnings, ...snapshot.warnings], requiredAcknowledgements: [...acknowledgements] };
    }, { label: '预览数据库默认编码', purpose: 'databaseDefaultEncoding', progress });
    if (this.snapshots.get(input.snapshotId) !== snapshot || snapshot.expires <= this.now()) throw Error('原快照已释放或过期，未发布预览');
    this.previews.set(token, preview); return output;
  }
  /** 同步消费令牌及名称锁；仅真实资源收尾通知可解锁，失败和未知都不重放。 */
  async apply(input: DatabaseDefaultEncodingApplyInput, revision: unknown): Promise<DatabaseDefaultEncodingApplyOutput> {
    const preview = this.previews.get(input.previewToken); this.previews.delete(input.previewToken);
    if (!preview || preview.expires <= this.now() || preview.snapshot.revision !== this.revision(revision)) throw Error('数据库默认编码预览已失效或已使用；未发送DDL');
    const snapshot = preview.snapshot;
    if (input.confirmation !== snapshot.target.database || !Array.isArray(input.acknowledgements) || input.acknowledgements.length !== acknowledgements.length || new Set(input.acknowledgements).size !== acknowledgements.length || acknowledgements.some(value => !input.acknowledgements.includes(value))) throw Error('数据库名称或风险确认项不一致；令牌已消费，未发送DDL');
    const key = JSON.stringify([snapshot.target.connectionId, snapshot.target.database.toLowerCase()]);
    if (this.executing.has(key)) throw Error('同连接同名数据库的默认编码任务尚未完成真实资源收尾；未发送DDL');
    if (this.executing.size >= 32) throw Error('数据库默认编码执行锁已达32项上限；请先显式断开并确认未释放资源，不自动重试');
    const lease = { connectionId: snapshot.target.connectionId }; this.executing.set(key, lease); const progress = progressOf();
    return this.host.run(snapshot.target.connectionId, input.taskId, async context => {
      progress.phase = 'rechecking'; context.report(); this.unchanged(snapshot, await read(context, snapshot.target));
      if (preview.expires <= this.now() || this.snapshots.get(snapshot.id) !== snapshot) throw Error('原快照已释放或预览已过期；未发送DDL');
      context.checkCancelled(); progress.phase = 'executing'; context.report();
      const result = (await structureTaskQuery<ResultSetHeader>(context, preview.sql, () => { this.releaseTokens({ snapshotId: snapshot.id }); progress.ddlSubmitted = true; progress.outcome = 'unknown'; context.report(); })).rows;
      if (!result || ![0, 1].includes(result.affectedRows)) throw Error('未取得可确认的ALTER DATABASE成功响应；请核对真实定义，不会自动重放');
      progress.ddlCompleted = true; progress.outcome = 'succeeded'; progress.phase = 'verifying'; context.report();
      const output: DatabaseDefaultEncodingApplyOutput = { target: { ...snapshot.target }, ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, before: { ...snapshot.current }, after: { ...preview.selection }, warnings: [] };
      // 必须紧随成功响应读取警告；其他SELECT会覆盖诊断区。
      let diagnostics = result.warningStatus === 0;
      if (!Number.isSafeInteger(result.warningStatus) || result.warningStatus < 0 || result.warningStatus > 65535) output.warnings.push('DDL已完成，但警告计数无法确认；不要重复执行。');
      else if (result.warningStatus) {
        output.warnings.push(`服务器返回${result.warningStatus}条警告，不能证明变更完全保真。`);
        try { const rows = (await structureTaskQuery<{ Code: number; Message: string }[]>(context, 'SHOW WARNINGS LIMIT 20')).rows; if (!Array.isArray(rows) || rows.length > 20 || rows.some(row => !Number.isSafeInteger(row.Code) || typeof row.Message !== 'string')) throw Error('警告响应无效'); for (const row of rows) output.warnings.push(`服务器警告${row.Code}：${row.Message.slice(0, 1024)}`); }
        catch { diagnostics = false; output.warnings.push('服务器警告未完整读取；不要重复执行。'); }
      }
      try {
        const after = await read(context, snapshot.target); output.after = { ...after.current };
        output.definitionVerified = progress.definitionVerified = diagnostics && !after.reasons.length && after.identity === snapshot.identity && after.catalogDigest === snapshot.catalogDigest && after.remainder === snapshot.remainder && sameTableEncodingPair(after.current, preview.selection);
      } catch { /* DDL成功事实保留；取消、断线或读失败只能报告未核验，不重放。 */ }
      if (!output.definitionVerified) output.verificationError = 'DDL已收到成功响应，但实际默认编码、其他属性或诊断未全部核验；请人工核对，不要重复执行';
      this.releaseTokens({ snapshotId: snapshot.id }); context.report(); return output;
    }, { label: '修改数据库默认编码', purpose: 'databaseDefaultEncoding', progress, executionDatabase: snapshot.target.database, onResourcesReleased: () => { if (this.executing.get(key) === lease) this.executing.delete(key); } });
  }
}
