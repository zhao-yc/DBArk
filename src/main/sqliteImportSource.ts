import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type { SqliteConnectionProfile } from '../shared/contracts';
import type { SqliteFileIdentity } from '../engine/sqlite/protocol';
import { sqliteImportSourceLimits as limits, sqliteImportSourceMessages as text, sqliteImportSourceOptionsKey, type SqliteImportSourceInspectInput, type SqliteImportSourceInspectOutput } from '../shared/sqliteImportSource';
import { assertSqliteImportSource, inspectSqliteImportRecords, type SqliteImportFileIdentity, type SqliteImportFileScan, type SqliteImportInspection, type SqliteTableImportControl, type SqliteTableImportInspectRequest } from './sqliteTableImport';

export interface SqliteImportSourceRequest extends SqliteImportSourceInspectInput { filePath: string; assertCurrent(): void; }
interface Source extends SqliteImportFileScan {
  id: string; expires: number; bytes: number; profile: SqliteConnectionProfile; identity: SqliteFileIdentity;
  input: Omit<SqliteImportSourceRequest, 'assertCurrent'>; fileIdentity: SqliteImportFileIdentity;
}
interface Entry { source: Source; claim?: symbol; table?: string; }
export interface SqliteImportSourceClaim { readonly source: Source; readonly token: symbol; readonly table: string; }
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const sameProfile = (left: SqliteConnectionProfile, right: SqliteConnectionProfile) => left.id === right.id && left.dialect === right.dialect && left.sqlite.filePath === right.sqlite.filePath && left.sqlite.readOnly === right.sqlite.readOnly && left.sqlite.busyTimeoutMs === right.sqlite.busyTimeoutMs;

/** 来源扫描不启动utility；native真实路径与dev/ino沿worker身份协议，不绑定会随DDL改变的时间或schema。 */
async function databaseIdentity(profile: SqliteConnectionProfile, control: Pick<SqliteTableImportControl, 'check'>): Promise<SqliteFileIdentity> {
  control.check();
  try {
    const path = await realpath(profile.sqlite.filePath!); control.check(); const value = await stat(profile.sqlite.filePath!, { bigint: true }); control.check(); const again = await realpath(profile.sqlite.filePath!); control.check();
    if (!value.isFile() || path !== again) throw Error(text.stale); return { path, device: String(value.dev), inode: String(value.ino) };
  } catch { control.check(); throw Error(text.stale); }
}
/** 原始来源能力只覆盖文件解释和准确连接，DDL前后不借用或创建用户查询会话。 */
export async function inspectSqliteImportSource(input: SqliteImportSourceRequest, profile: SqliteConnectionProfile, control: SqliteTableImportControl): Promise<Omit<Source, 'id' | 'expires' | 'bytes'>> {
  const identity = await databaseIdentity(profile, control), fileIdentity = await assertSqliteImportSource(input.filePath, profile, control);
  const scanned = await inspectSqliteImportRecords(input, profile, fileIdentity, control);
  if (!equal(identity, await databaseIdentity(profile, control))) throw Error(text.stale);
  const { assertCurrent: _owner, ...file } = input;
  return { ...scanned, profile: structuredClone(profile), identity, fileIdentity, input: structuredClone(file) };
}

/** 来源预算独立于目标检查；首次成功后固定目标，30分钟内只允许同表显式重新检查。 */
export class SqliteImportSources {
  private readonly sources = new Map<string, Entry>();
  private bytes = 0;
  private remove(id: string): void { const entry = this.sources.get(id); if (entry) { this.bytes -= entry.source.bytes; this.sources.delete(id); } }
  private prune(): void { for (const [id, entry] of this.sources) if (!entry.claim && entry.source.expires <= Date.now()) this.remove(id); }
  publish(value: Awaited<ReturnType<typeof inspectSqliteImportSource>>): SqliteImportSourceInspectOutput {
    this.prune(); const bytes = Buffer.byteLength(JSON.stringify(value)); if (this.sources.size >= limits.sources || this.bytes + bytes > limits.sourceBytes) throw Error('SQLite来源能力预算已满，请释放原来源');
    const source: Source = { ...value, id: randomUUID(), expires: Date.now() + limits.sourceLifetimeMs, bytes }; this.sources.set(source.id, { source }); this.bytes += bytes;
    return { sourceId: source.id, connectionId: source.profile.id, database: 'main', source: { ...source.source }, sourceColumns: [...source.sourceColumns], sample: structuredClone(source.sample), records: source.records, sampleOmitted: source.sampleOmitted, expiresAt: new Date(source.expires).toISOString() };
  }
  /** 解释设置使用共享有效CSV默认值；连接、令牌和准确路径仍须属于同一来源。 */
  claim(input: SqliteTableImportInspectRequest, profile: SqliteConnectionProfile): SqliteImportSourceClaim {
    this.prune(); const entry = input.sourceId ? this.sources.get(input.sourceId) : undefined;
    if (!entry || entry.claim || entry.source.expires <= Date.now() || !sameProfile(entry.source.profile, profile) || entry.table !== undefined && entry.table !== input.table) throw Error(text.stale);
    const fields = ['connectionId', 'database', 'filePath'] as const;
    if (fields.some(key => input[key] !== entry.source.input[key]) || sqliteImportSourceOptionsKey(input) !== sqliteImportSourceOptionsKey(entry.source.input)) throw Error(text.stale);
    const token = Symbol('SQLite原来源独占领取'); entry.claim = token; return { source: entry.source, token, table: input.table };
  }
  /** 领取后的长扫描不按TTL中断；显式release/connection close仍立即撤销准确能力。 */
  assertClaim(claim: SqliteImportSourceClaim): void { if (this.sources.get(claim.source.id)?.claim !== claim.token) throw Error(text.stale); }
  async verify(claim: SqliteImportSourceClaim, control: SqliteTableImportControl, inspection?: SqliteImportInspection | Omit<SqliteImportInspection, 'id' | 'expires' | 'bytes'>): Promise<void> {
    this.assertClaim(claim); const source = claim.source;
    if (!equal(source.identity, await databaseIdentity(source.profile, control))) throw Error(text.stale);
    await assertSqliteImportSource(source.input.filePath, source.profile, control, source.fileIdentity); control.check(); this.assertClaim(claim);
    if (inspection && (!equal(source.identity, inspection.identity) || !equal(source.fileIdentity, inspection.fileIdentity) || !equal(source.source, inspection.source) || source.records !== inspection.records || !equal(source.sourceColumns, inspection.sourceColumns))) throw Error(text.stale);
  }
  finish(claim: SqliteImportSourceClaim, verified: boolean): void { const entry = this.sources.get(claim.source.id); if (entry?.claim === claim.token) { if (verified) entry.table ??= claim.table; entry.claim = undefined; } }
  /** 真实写批提交或未知即撤原来源，不允许拿同一来源隐式重复导入。 */
  complete(id: string, outcome: string): void { if (outcome === 'committed' || outcome === 'unknown') this.remove(id); }
  release(id: string): void { this.remove(id); }
  releaseConnection(id: string): void { for (const [key, entry] of this.sources) if (entry.source.profile.id === id) this.remove(key); }
}
