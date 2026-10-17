import { databaseBackupKinds, type DatabaseBackupBlocker, type DatabaseBackupManifest, type DatabaseBackupProof } from '../shared/databaseBackup';
import { databaseBackupRestoreManifestSchema } from './databaseBackupRestoreManifest';

export interface DatabaseBackupRestoreOwner { readonly fileToken: string; readonly targetConnectionId: string; readonly taskId: string; }
/** 严格归档模块只证明容器与字节；语义、来源、DEFINER 和目标隔离必须另取证据。 */
export interface DatabaseBackupRestoreArchive {
  owner: DatabaseBackupRestoreOwner; integrity: 'valid' | 'invalid' | 'unknown'; compatibility: 'supported' | 'unsupported' | 'unknown';
  archiveIdentity: string; fileRevision: string; manifest: DatabaseBackupManifest | null; restoreVerified: false;
}
export interface DatabaseBackupRestoreSqlEvidence {
  owner: DatabaseBackupRestoreOwner; archiveIdentity: string; fileRevision: string;
  rawUnchanged: true; completeAnalysis: DatabaseBackupProof; objectsMatchManifest: DatabaseBackupProof;
  databaseNames: readonly string[]; definers: readonly string[]; externalDependencies: readonly string[];
}
export interface DatabaseBackupRestoreTarget {
  owner: DatabaseBackupRestoreOwner; targetLease: string; targetRevision: string;
  family: 'mysql' | 'mariadb'; version: string; database: string;
  databaseState: 'absent' | 'empty' | 'nonempty' | 'unknown'; isolated: DatabaseBackupProof; sourceInstanceExcluded: DatabaseBackupProof;
  statementPrivileges: DatabaseBackupProof; availableDefiners: readonly string[];
  clientSuite: { registration: 'root-controlled'; toolId: string; family: 'mysql' | 'mariadb'; version: string; suiteSha256: string; registryRevision: string; clientLease: string };
  eventScheduler: 'disabled' | 'enabled' | 'unknown';
}
export interface DatabaseBackupRestorePorts {
  now(): number; token(): string;
  inspectArchive(owner: DatabaseBackupRestoreOwner): Promise<DatabaseBackupRestoreArchive>;
  inspectSql(owner: DatabaseBackupRestoreOwner, archive: DatabaseBackupRestoreArchive): Promise<DatabaseBackupRestoreSqlEvidence>;
  inspectTarget(owner: DatabaseBackupRestoreOwner, archive: DatabaseBackupRestoreArchive): Promise<DatabaseBackupRestoreTarget>;
  cancelled(taskId: string): boolean;
}
interface RestoreRecord {
  token: string; expiresAt: number; owner: DatabaseBackupRestoreOwner; archive: DatabaseBackupRestoreArchive;
  sql?: DatabaseBackupRestoreSqlEvidence; target?: DatabaseBackupRestoreTarget; blockers: DatabaseBackupBlocker[];
  restoreVerified: false;
}
/** 只做零写入恢复预检；没有 DROP、CREATE、重命名、删头或执行 dump 的旁路。 */
export class DatabaseBackupRestorePreflight {
  private readonly records = new Map<string, RestoreRecord>();
  private readonly active = new Set<string>();
  private readonly pending = new Map<string, Set<object>>();
  private readonly ended = new Set<string>();
  constructor(private readonly ports: DatabaseBackupRestorePorts, private readonly budgetMs = 30_000) { if (!(budgetMs > 0 && budgetMs <= 30_000)) throw Error('恢复预检预算无效'); }
  /** 过期只撤销预检令牌，本模块从不持有目标写入资源。 */
  private prune(): void { for (const [token, record] of this.records) if (record.expiresAt <= this.ports.now()) this.records.delete(token); }
  /** 端口必须自身有界且归属登记在 Root；超时只撤销接纳，不宣称私有检查资源已释放。 */
  private async wait<T>(owner: DatabaseBackupRestoreOwner, value: Promise<T>): Promise<T> {
    const marker = {}, pending = this.pending.get(owner.taskId)!; pending.add(marker);
    const finish = () => { pending.delete(marker); if (!pending.size && this.ended.delete(owner.taskId)) { this.active.delete(owner.taskId); this.pending.delete(owner.taskId); } };
    const work = Promise.resolve(value).then(result => { finish(); return result; }, error => { finish(); throw error; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('恢复预检超出等待预算')), this.budgetMs); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
  /** 每轮等待后核任务与同一 owner，不能用另一份归档或另一个目标的证据补齐本次计划。 */
  private check(owner: DatabaseBackupRestoreOwner, evidence: { owner: DatabaseBackupRestoreOwner }): void { if (this.ports.cancelled(owner.taskId)) throw Error('恢复预检已取消'); if (evidence.owner !== owner) throw Error('恢复证据 owner 不匹配'); }
  /** 容器合法不等于内容可信；验证源范围声明时仍要求后续 SQL 语义交叉核对。 */
  private manifestProblems(manifest: DatabaseBackupManifest): string[] {
    if (!databaseBackupRestoreManifestSchema.safeParse(manifest).success) return ['归档清单字段类型、格式、时间或预算不合法'];
    const problems: string[] = [];
    if (manifest.format !== 'dbark-backup-zip-store-v1' || manifest.schemaVersion !== 1 || manifest.restoreVerified !== false || manifest.resourcesConfirmed !== true || manifest.consistency.allObjectsFrozen !== true) problems.push('归档版本、一致性或资源声明不完整');
    if (!((manifest.family === 'mysql' && manifest.serverVersion === '8.4.11') || (manifest.family === 'mariadb' && manifest.serverVersion === '11.4.13')) || manifest.toolVersion !== manifest.serverVersion) problems.push('归档不是首阶段准确家族/版本组合');
    if (!manifest.database || [...manifest.database].length > 64 || /^(mysql|sys|performance_schema|information_schema)$/i.test(manifest.database) || manifest.database.includes('\0')) problems.push('源数据库名称无效或属于系统库');
    if (manifest.dump.entry !== 'dump.sql' || !/^[1-9]\d*$/.test(manifest.dump.bytes) || !/^[a-f0-9]{64}$/i.test(manifest.dump.sha256) || !/^[a-f0-9]{64}$/i.test(manifest.toolSuiteSha256) || !manifest.toolRegistryRevision) problems.push('原始 dump 或工具套件声明无效');
    if (manifest.objects.length > 10_000) return ['归档对象超出预算'];
    if (manifest.externalDependencies.length) problems.push('归档含未支持的外部依赖');
    const names = new Set<string>(); let databases = 0;
    for (const object of manifest.objects) {
      const id = JSON.stringify([object.kind, object.name]);
      if (!databaseBackupKinds.includes(object.kind) || !object.name || [...object.name].length > 64 || !object.definitionSha256 || !/^[a-f0-9]{64}$/i.test(object.definitionSha256) || names.has(id)) problems.push('归档存在未知、重复或缺失定义的对象');
      names.add(id); if (object.kind === 'database' && object.name === manifest.database) databases++;
    }
    if (databases !== 1 || manifest.objects.filter(object => object.kind === 'database').length !== 1) problems.push('必须包含源数据库的唯一定义');
    return [...new Set(problems)];
  }
  /** 预检结果可以带阻断令牌供查看，但 bindings 拒绝将其交给实际恢复执行器。 */
  async prepareRestore(input: { fileToken: string; targetConnectionId: string; taskId: string }): Promise<{ restorePlanToken: string; blockers: readonly DatabaseBackupBlocker[] }> {
    if (Object.keys(input).sort().join(',') !== 'fileToken,targetConnectionId,taskId' || Object.values(input).some(value => typeof value !== 'string' || !value || value.length > 200 || value.includes('\0'))) throw Error('恢复预检只接受文件令牌、目标连接和任务号');
    this.prune(); if (this.active.size >= 2 || this.active.has(input.taskId) || this.records.size >= 8) throw Error('恢复预检容量已满或任务号重复');
    const owner = Object.freeze({ ...input }); this.active.add(input.taskId); this.pending.set(input.taskId, new Set());
    try {
      const archive = await this.wait(owner, this.ports.inspectArchive(owner)); this.check(owner, archive);
      const blockers: DatabaseBackupBlocker[] = [], block = (code: string, message: string) => blockers.push({ code, message });
      if (archive.integrity !== 'valid' || archive.compatibility !== 'supported' || archive.restoreVerified !== false || !archive.archiveIdentity || !archive.fileRevision || !archive.manifest) block('archive-unproven', '归档完整性或兼容性尚未通过严格检查');
      let sql: DatabaseBackupRestoreSqlEvidence | undefined, target: DatabaseBackupRestoreTarget | undefined;
      if (archive.manifest && !blockers.length) {
        for (const problem of this.manifestProblems(archive.manifest)) block('manifest-invalid', problem);
        if (!blockers.length) {
          sql = await this.wait(owner, this.ports.inspectSql(owner, archive)); this.check(owner, sql);
          if (sql.archiveIdentity !== archive.archiveIdentity || sql.fileRevision !== archive.fileRevision || sql.rawUnchanged !== true || sql.completeAnalysis !== 'proven' || sql.objectsMatchManifest !== 'proven' || sql.databaseNames.length !== 1 || sql.databaseNames[0] !== archive.manifest.database || sql.externalDependencies.length) block('sql-scope-unproven', '原始 SQL 的数据库、完整对象或跨库范围未获证明；不会改写 SQL 绕过');
          if (!blockers.length) {
            target = await this.wait(owner, this.ports.inspectTarget(owner, archive)); this.check(owner, target);
            if (!target.targetLease || !target.targetRevision || target.database !== archive.manifest.database || target.family !== archive.manifest.family || target.version !== archive.manifest.serverVersion) block('target-mismatch', '目标必须是同家族同准确版本、同名数据库');
            if (!['absent', 'empty'].includes(target.databaseState) || target.isolated !== 'proven' || target.sourceInstanceExcluded !== 'proven') block('target-not-isolated', '必须证明目标为新建隔离实例中的空/不存在库，并排除原实例');
            if (target.statementPrivileges !== 'proven' || target.clientSuite?.registration !== 'root-controlled' || !target.clientSuite.toolId || target.clientSuite.family !== archive.manifest.family || target.clientSuite.version !== archive.manifest.serverVersion || !/^[a-f0-9]{64}$/i.test(target.clientSuite.suiteSha256) || !target.clientSuite.registryRevision || !target.clientSuite.clientLease) block('target-permission', '恢复语句权限或原生客户端完整套件可信身份不足或未知');
            if (sql.definers.some(definer => !target!.availableDefiners.includes(definer))) block('definer-missing', '目标缺少原始 SQL 所需的 DEFINER；不会自动创建账号或改写定义');
            if (archive.manifest.objects.some(object => object.kind === 'event') && target.eventScheduler !== 'disabled') block('events-not-contained', '隔离目标须先确认事件调度关闭；预检不会修改服务器设置');
          }
        }
      }
      this.prune(); if (this.records.size >= 8) throw Error('恢复预检容量已满');
      const token = this.ports.token(); if (!token || token.length > 200 || this.records.has(token)) throw Error('恢复预检令牌无效或重复');
      this.records.set(token, { token, expiresAt: this.ports.now() + 120_000, owner, archive: { ...structuredClone(archive), owner }, ...(sql ? { sql: { ...structuredClone(sql), owner } } : {}), ...(target ? { target: { ...structuredClone(target), owner } } : {}), blockers: structuredClone(blockers), restoreVerified: false });
      return { restorePlanToken: token, blockers: structuredClone(blockers) };
    } finally { if (this.pending.get(input.taskId)?.size) this.ended.add(input.taskId); else { this.active.delete(input.taskId); this.pending.delete(input.taskId); } }
  }
  /** 实际恢复还需独立明确执行并重新核所有租约；此方法不生成或运行任何 SQL。 */
  bindings(token: string) { this.prune(); const record = this.records.get(token); if (!record || record.blockers.length || !record.sql || !record.target) throw Error('恢复预检过期、阻断或不完整'); return structuredClone(record); }
}
