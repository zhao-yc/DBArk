import { databaseBackupInspectSchema, databaseBackupKinds, databaseBackupPrepareSchema, type DatabaseBackupBlocker, type DatabaseBackupInspectInput, type DatabaseBackupInspection, type DatabaseBackupKind, type DatabaseBackupObject, type DatabaseBackupPlan, type DatabaseBackupPrepareInput, type DatabaseBackupProof, type DatabaseBackupToolSummary } from '../shared/databaseBackup';

export const databaseBackupLimits = { active: 2, inspections: 8, plans: 8, objects: 10_000, metadataBytes: 2 * 1024 * 1024, reportBytes: 4 * 1024 * 1024, ttlMs: 120_000, maxBytes: 10 * 1024 ** 3, maxWaitMs: 30_000, maxHoldMs: 120_000 } as const;
const kindNames = { database: '数据库', table: '表', view: '视图', trigger: '触发器', procedure: '存储过程', function: '存储函数', event: '事件' };
const permissionNames = { data: '读取全部数据', definitions: '读取完整定义', routines: '读取过程/函数', events: '读取事件', globalReadLock: '获取全局读锁', tablespaces: '读取表空间依赖' };
/** 此证据只由 Root 私有源检查端口提供；不能从 renderer/IPC 直接接收这些证明字段。 */
export interface DatabaseBackupSourceEvidence {
  connectionId: string; database: string; connectionRevision: string; sourceLease: string;
  family: 'mysql' | 'mariadb'; version: string; endpoint: 'direct-pinned' | 'unproven';
  visibility: Record<DatabaseBackupKind, DatabaseBackupProof>; objects: readonly DatabaseBackupObject[];
  permissions: Record<'data' | 'definitions' | 'routines' | 'events' | 'globalReadLock' | 'tablespaces', DatabaseBackupProof>;
  /** 准确版本的锁能力声明，不是声称准备阶段已加锁；run 必须另取真实同 owner 锁租约。 */
  lockCapability: { profileId: string; versionValidated: string; ddlCoverage: Record<DatabaseBackupKind, DatabaseBackupProof> };
  externalDependencies: readonly string[];
}
export interface DatabaseBackupRegisteredTool extends DatabaseBackupToolSummary {
  registration: 'root-controlled'; registryRevision: string; toolLease: string;
  expectedSuiteSha256: string; observedSuiteSha256: string;
}
export interface DatabaseBackupPlanPorts {
  now(): number; token(): string;
  inspectSource(input: DatabaseBackupInspectInput): Promise<DatabaseBackupSourceEvidence>;
  resolveTool(toolId: string): Promise<DatabaseBackupRegisteredTool | null>;
  inspectTarget(fileToken: string): Promise<{ fileToken: string; outputLease: string; revision: string; displayName: string; writable: boolean; format: 'dbark-backup-zip' }>;
  /** 取消属于该任务的私有检查，并且必须提供终态；不能只发请求就当已释放。 */
  cancelled(taskId: string): boolean;
}
export interface DatabaseBackupRunBindings {
  source: DatabaseBackupSourceEvidence; tool: DatabaseBackupRegisteredTool;
  output: Awaited<ReturnType<DatabaseBackupPlanPorts['inspectTarget']>>; plan: DatabaseBackupPlan;
}
/** 纯准备器只调用注入的检查端口；不持锁、不启动进程、不读取凭据、不写文件。 */
export class DatabaseBackupPlanner {
  private readonly inspections = new Map<string, { result: DatabaseBackupInspection; source: DatabaseBackupSourceEvidence; tool: DatabaseBackupRegisteredTool | null }>();
  private readonly plans = new Map<string, DatabaseBackupRunBindings>();
  private readonly active = new Set<string>();
  constructor(private readonly ports: DatabaseBackupPlanPorts, private readonly policy: { lockProfileApproved: boolean; maria11413Validated: boolean }) {}

  /** 删除过期记录但不驱逐有效计划来容纳新请求，避免仍在审查的令牌静默换绑。 */
  private prune(): void {
    const now = this.ports.now();
    for (const [id, item] of this.inspections) if (item.result.expiresAt <= now) this.inspections.delete(id);
    for (const [id, item] of this.plans) if (item.plan.expiresAt <= now) this.plans.delete(id);
  }
  /** 所有异步检查先占容量，重复任务号及取消后的迟到结果均不能创建新令牌。 */
  private begin(taskId: string): () => void {
    if (this.active.size >= databaseBackupLimits.active || this.active.has(taskId)) throw Error('备份准备任务已满或任务号重复');
    this.check(taskId); this.active.add(taskId); return () => this.active.delete(taskId);
  }
  /** 每次跨 await 后重新核对取消，不能将已经撤销的检查登记为可用。 */
  private check(taskId: string): void { if (this.ports.cancelled(taskId)) throw Error('备份准备已取消'); }
  /** 令牌由私有端口生成；拒绝碰撞，不覆盖另一份检查或计划。 */
  private newToken(): string { const id = this.ports.token(); if (!id || id.length > 200 || this.inspections.has(id) || this.plans.has(id)) throw Error('备份准备令牌无效或重复'); return id; }

  /** 首次清单是预检事实；执行器仍须在已确认的全对象锁内重新采集，不能用预检冒充一致性。 */
  async inspect(raw: DatabaseBackupInspectInput): Promise<DatabaseBackupInspection> {
    const input = databaseBackupInspectSchema.parse(raw), done = this.begin(input.taskId);
    try {
      this.prune(); if (this.inspections.size >= databaseBackupLimits.inspections) throw Error('备份检查已满，请等待旧检查过期');
      const source = structuredClone(await this.ports.inspectSource(input)); this.check(input.taskId);
      const tool = structuredClone(await this.ports.resolveTool(input.toolId)); this.check(input.taskId);
      const blockers: DatabaseBackupBlocker[] = [], block = (code: string, message: string) => blockers.push({ code, message });
      if (source.connectionId !== input.connectionId || source.database !== input.database || !source.connectionRevision || !source.sourceLease) throw Error('备份源检查归属无效');
      if (source.objects.length > databaseBackupLimits.objects || Buffer.byteLength(JSON.stringify(source), 'utf8') > databaseBackupLimits.metadataBytes) throw Error('完整对象清单超出备份准备预算，未截断或降级为部分备份');
      // UI 只得到固定字段；即使私有检查端口带有额外字段，也不把原始定义或路径透传出去。
      source.objects = source.objects.map(({ kind, name, definitionSha256, engine }) => ({ kind, name, definitionSha256, ...(engine === undefined ? {} : { engine }) }));
      if (/^(mysql|sys|performance_schema|information_schema)$/i.test(input.database)) block('system-database', '首阶段不支持系统库备份');
      if (input.database.startsWith('-')) block('unsupported-name', '该数据库名尚未完成原生工具参数边界验证，不能继续');
      if (!((source.family === 'mysql' && source.version === '8.4.11') || (source.family === 'mariadb' && source.version === '11.4.13'))) block('unsupported-version', '该版本尚未列入首阶段准确组合；MySQL 5.7/8.0 与 MariaDB 10.11 留待后续验证');
      if (source.family === 'mariadb' && !this.policy.maria11413Validated) block('mariadb-validation-pending', 'MariaDB 11.4.13 属于同一首阶段待验证组合，尚未开放执行准备');
      if (source.endpoint !== 'direct-pinned') block('endpoint-unproven', '数据库端点身份尚未固定，不能证明工具与检查连接属于同一实例');
      const counts = Object.fromEntries(databaseBackupKinds.map(kind => [kind, 0])) as Record<DatabaseBackupKind, number>, seen = new Set<string>();
      for (const object of source.objects) {
        if (!databaseBackupKinds.includes(object.kind) || !object.name || [...object.name].length > 64 || object.name.includes('\0')) throw Error('完整对象清单存在未知类型或无效对象名');
        if (typeof object.definitionSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(object.definitionSha256)) block('definition-missing', `${kindNames[object.kind]} ${JSON.stringify(object.name)} 的定义缺失或摘要无效`);
        const id = JSON.stringify([object.kind, object.name]); if (seen.has(id)) throw Error('完整对象清单存在重复身份'); seen.add(id); counts[object.kind]++;
        if (object.kind === 'table' && !['InnoDB', 'MyISAM', 'MEMORY'].includes(object.engine ?? '')) block('engine-unproven', `表 ${JSON.stringify(object.name)} 的存储引擎尚未验证`);
      }
      if (counts.database !== 1 || !source.objects.some(item => item.kind === 'database' && item.name === input.database)) block('database-definition', '必须包含所选数据库的唯一定义');
      for (const kind of databaseBackupKinds) {
        if (source.visibility[kind] !== 'proven') block(`visibility-${kind}`, `${kindNames[kind]}的完整可见性尚未证明，不能把可见子集称为整库`);
        if (source.lockCapability.ddlCoverage[kind] !== 'proven') block(`ddl-${kind}`, `${kindNames[kind]}的准确版本 DDL 冻结能力尚未证明`);
      }
      for (const permission of ['data', 'definitions', 'routines', 'events', 'globalReadLock', 'tablespaces'] as const) if (source.permissions[permission] !== 'proven') block(`permission-${permission}`, `${permissionNames[permission]}所需权限不足或未知；不会自动授权或降低范围`);
      if (source.externalDependencies.length) block('external-dependencies', '存在跨库、账号或其它外部依赖，首阶段不能证明独立恢复');
      if (!tool) block('tool-missing', '尚未配置经管理员验证的原生备份工具，请联系管理员配置');
      else if (tool.id !== input.toolId || tool.registration !== 'root-controlled' || !tool.registryRevision || !tool.toolLease || tool.family !== source.family || tool.version !== source.version || !/^[a-f0-9]{64}$/i.test(tool.expectedSuiteSha256) || tool.expectedSuiteSha256.toLowerCase() !== tool.observedSuiteSha256.toLowerCase()) block('tool-untrusted', '原生工具注册、版本或完整套件 SHA256 身份未通过，不能仅凭版本输出信任可执行文件');
      if (!this.policy.lockProfileApproved) block('lock-policy-pending', '全对象一致性锁路线尚未启用，请联系管理员确认');
      const lockProfileId = source.family === 'mysql' ? 'mysql-8.4-global-read-lock-v1' : 'mariadb-11.4-global-read-lock-v1';
      if (source.lockCapability.profileId !== lockProfileId || source.lockCapability.versionValidated !== source.version) block('lock-capability-mismatch', '锁能力声明与当前家族或准确版本不一致');
      this.prune(); if (this.inspections.size >= databaseBackupLimits.inspections) throw Error('备份检查容量已满');
      const result: DatabaseBackupInspection = { inspectionToken: this.newToken(), expiresAt: this.ports.now() + databaseBackupLimits.ttlMs,
        connectionId: input.connectionId, database: input.database, serverFamily: source.family, serverVersion: source.version,
        tool: tool ? { id: tool.id, label: tool.label, family: tool.family, version: tool.version } : null,
        scope: { objects: source.objects, counts, complete: !blockers.some(item => item.code.startsWith('visibility-') || ['database-definition', 'definition-missing'].includes(item.code)), phase: 'preflight' },
        lock: { profileId: lockProfileId, phase: 'capability-only', actualLockHeld: false, affectsWholeInstance: true, maxWaitMs: databaseBackupLimits.maxWaitMs, maxHoldMs: databaseBackupLimits.maxHoldMs }, blockers, backupExecuted: false };
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > databaseBackupLimits.reportBytes) throw Error('完整准备报告超出预算，未截断对象或阻断原因');
      this.inspections.set(result.inspectionToken, { result: structuredClone(result), source, tool }); return structuredClone(result);
    } finally { done(); }
  }
  /** 输出令牌经私有端口校验；准备仍不创建文件，不提前占用数据库锁或启动原生工具。 */
  async prepare(raw: DatabaseBackupPrepareInput): Promise<DatabaseBackupPlan> {
    const input = databaseBackupPrepareSchema.parse(raw), done = this.begin(input.taskId);
    try {
      this.prune(); if (this.plans.size >= databaseBackupLimits.plans) throw Error('备份计划已满');
      const inspection = this.inspections.get(input.inspectionToken);
      if (!inspection || inspection.result.blockers.length || !inspection.tool) throw Error('备份检查已过期或存在阻断项，请重新检查');
      const output = structuredClone(await this.ports.inspectTarget(input.fileToken)); this.check(input.taskId);
      this.prune(); if (this.inspections.get(input.inspectionToken) !== inspection) throw Error('文件选择期间备份检查已过期');
      if (!output.writable || output.fileToken !== input.fileToken || !output.outputLease || !output.revision || !output.displayName || output.displayName.length > 300 || output.format !== 'dbark-backup-zip' || !output.displayName.toLowerCase().endsWith('.dbark-backup.zip')) throw Error('备份输出令牌、归档格式或写入授权无效');
      if (this.plans.size >= databaseBackupLimits.plans) throw Error('备份计划容量已满');
      const plan: DatabaseBackupPlan = { planToken: this.newToken(), inspectionToken: input.inspectionToken, expiresAt: Math.min(inspection.result.expiresAt, this.ports.now() + databaseBackupLimits.ttlMs), connectionId: inspection.result.connectionId, database: inspection.result.database,
        serverVersion: inspection.source.version, tool: inspection.result.tool!, counts: inspection.result.scope.counts, outputName: output.displayName, format: 'dbark-backup-zip-store-v1', maxBytes: databaseBackupLimits.maxBytes, lock: inspection.result.lock, mustRevalidateUnderLock: true, backupExecuted: false };
      this.plans.set(plan.planToken, { source: inspection.source, tool: inspection.tool, output, plan: structuredClone(plan) }); return structuredClone(plan);
    } finally { done(); }
  }
  /** 仅后续私有执行器取用，不经渲染 IPC 暴露租约、注册摘要或可执行路径。 */
  bindings(planToken: string): DatabaseBackupRunBindings { this.prune(); const item = this.plans.get(planToken); if (!item) throw Error('备份计划不存在或已过期'); return structuredClone(item); }
}
