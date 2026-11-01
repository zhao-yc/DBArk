import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type { SqliteConnectionProfile } from '../shared/contracts';
import { SqliteDriverError, type SqliteDriverSession } from '../engine/sqlite/session';
import { sqliteExportTextFunction, type SqliteCreateGuard, type SqliteFileIdentity, type SqliteValue } from '../engine/sqlite/protocol';
import { quoteSqliteIdentifier, type SqliteTableBrowseControl } from './sqliteTableBrowse';
import { buildSqliteObjectsPlan, sqliteObjectsInspectionSchema, sqliteObjectsLimits as limits, sqliteObjectsMessages as text, type SqliteObjectsInspectInput, type SqliteObjectsInspectOutput, type SqliteObjectsPreviewInput, type SqliteObjectsPreviewOutput, type SqliteObjectsApplyInput, type SqliteObjectsReleaseInput, type SqliteObjectsFact, type SqliteObjectsOutcome } from '../shared/sqliteObjects';

export interface SqliteObjectsInspectRequest extends SqliteObjectsInspectInput { assertCurrent(): void; }
export interface SqliteObjectsPreviewRequest extends SqliteObjectsPreviewInput { assertCurrent(): void; }
export interface SqliteObjectsApplyRequest extends SqliteObjectsApplyInput { operationId: string; recordObjectsFact(fact: SqliteObjectsFact): void; assertCurrent(): void; }
export interface SqliteObjectsControl extends SqliteTableBrowseControl { beginCommit(): void; }
type Compiled = ReturnType<typeof buildSqliteObjectsPlan> & { steps: { sql: string; createGuard?: Pick<SqliteCreateGuard, 'kind' | 'name'> }[] };
interface ObjectFacts { schemaVersion: string; objects: SqliteObjectsInspectOutput['relatedObjects']; roots: { type: string; name: string; table: string; root: string }[]; eligibleRelations: SqliteObjectsInspectOutput['eligibleRelations']; }
export interface SqliteObjectsSnapshot { target: SqliteObjectsInspectOutput['target']; action: SqliteObjectsInspectInput['action']; profile: SqliteConnectionProfile; identity: SqliteFileIdentity; version: string; sourceSql: string | null; attachedTriggers: SqliteObjectsInspectOutput['attachedTriggers']; facts: ObjectFacts; }
const stale = 'SQLite对象目录、文件或预览已失效，请重新检查并明确预览';
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
function integer(value: SqliteValue | undefined): string { if (!value || typeof value !== 'object' || value.type !== 'integer') throw Error('SQLite对象整数事实无效'); return value.value; }
function exact(column: string): string { return `CASE WHEN typeof(${column})='text' THEN ${sqliteExportTextFunction}(${column},CAST(${column} AS BLOB)) ELSE ${column} END`; }

/** 目录不足预算必须失败；从不以截断结果宣称无冲突或外键检查完整。 */
async function read(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], maximum: number, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<SqliteValue[][]> {
  control.check(); const rows: SqliteValue[][] = [];
  const result = await driver.execute(sql, { parameters, maxRows: maximum, maxBytes: 16 * 1024 * 1024, onBatch: batch => { control.check(); rows.push(...batch.rows); } });
  control.check(); if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== rows.length) throw Error('SQLite对象目录或外键检查超过完整读取预算'); return rows;
}
/** native路径协议与worker一致；只比较真实dev/ino，不把合法其它数据修改误判成路径替换。 */
async function assertFile(snapshot: Pick<SqliteObjectsSnapshot, 'profile' | 'identity'>, control: Pick<SqliteTableBrowseControl, 'check'>): Promise<void> {
  control.check(); try {
    const path = await realpath(snapshot.profile.sqlite.filePath!); control.check(); const value = await stat(snapshot.profile.sqlite.filePath!, { bigint: true }); control.check();
    if (path !== snapshot.identity.path || !value.isFile() || String(value.dev) !== snapshot.identity.device || String(value.ino) !== snapshot.identity.inode) throw Error(stale);
  } catch { control.check(); throw Error('SQLite对象目标实际文件身份变化或无法确认，拒绝提交'); }
}
/** 同一快照完整读取main目录和原生table_list分类；不SELECT旧view，不让坏定义阻断修复入口。 */
async function readFacts(driver: SqliteDriverSession, control: SqliteTableBrowseControl): Promise<ObjectFacts> {
  const schemaVersion = integer((await read(driver, 'PRAGMA main.schema_version', [], 1, control))[0]?.[0]);
  const rows = await read(driver, 'SELECT ' + ['type', 'name', 'tbl_name', 'sql'].map(exact).join(',') + ',rootpage' + " FROM main.sqlite_schema WHERE type IN ('table','index','view','trigger') ORDER BY type,name COLLATE BINARY LIMIT " + (limits.relatedObjects + 1), [], limits.relatedObjects + 1, control);
  if (rows.length > limits.relatedObjects) throw Error('SQLite对象完整依赖目录超过4096项预算');
  const objects = rows.map(row => ({ type: row[0] as 'table' | 'index' | 'view' | 'trigger', name: row[1] as string, table: row[2] as string, sql: row[3] as string | null }));
  const roots = rows.map(row => ({ type: row[0] as string, name: row[1] as string, table: row[2] as string, root: integer(row[4]) }));
  const relations = await read(driver, "SELECT name,type FROM pragma_table_list WHERE schema='main' AND type IN ('table','view') ORDER BY name COLLATE BINARY LIMIT " + (limits.eligibleRelations + 1), [], limits.eligibleRelations + 1, control);
  if (relations.length > limits.eligibleRelations) throw Error('SQLite对象所属关系目录超过4096项预算');
  const eligibleRelations = relations.filter(row => typeof row[0] === 'string' && !/^sqlite_/i.test(row[0])).map(row => ({ name: row[0] as string, kind: row[1] as 'table' | 'view' }));
  if (eligibleRelations.some(relation => !objects.some(object => object.name === relation.name && object.type === relation.kind))) throw Error('SQLite对象原生所属关系与完整目录矛盾');
  const facts = { schemaVersion, objects, roots, eligibleRelations };
  if (Buffer.byteLength(JSON.stringify(facts)) > limits.ddlBytes) throw Error('SQLite完整对象和依赖目录超过2MiB预算'); return facts;
}
/** create不能覆盖既有名字；其它用途只领取准确kind/name，触发器使用独立的SQLite命名空间。 */
function inspectTarget(facts: ObjectFacts, target: SqliteObjectsSnapshot['target'], action: SqliteObjectsSnapshot['action']): { sourceSql: string | null; attachedTriggers: SqliteObjectsInspectOutput['attachedTriggers'] } {
  if (/^sqlite_/i.test(target.name)) throw Error('SQLite系统对象不能管理定义');
  const object = facts.objects.find(value => value.type === target.kind && value.name === target.name);
  if (action === 'create') {
    const conflict = facts.objects.some(value => fold(value.name) === fold(target.name) && (target.kind === 'trigger' ? value.type === 'trigger' : ['table','view','index'].includes(value.type)));
    if (conflict) throw Error('SQLite准确创建对象名称已被占用'); return { sourceSql: null, attachedTriggers: [] };
  }
  if (!object || typeof object.sql !== 'string' || !object.sql.trim()) throw Error('SQLite准确对象已不存在或原定义不能确认');
  // tbl_name可能保留ON子句的大小写；关联按SQLite的ASCII规则比较，定义原文仍逐字保留。
  const attachedTriggers = target.kind === 'view' ? facts.objects.filter(value => value.type === 'trigger' && fold(value.table) === fold(target.name)).map(value => { if (!value.sql) throw Error('SQLite原view附属触发器定义无法确认'); return { name: value.name, sql: value.sql }; }) : [];
  return { sourceSql: object.sql, attachedTriggers };
}
/** 只读事务始终显式ROLLBACK；准确close和exit由Runtime原资源账本统一确认。 */
async function snapshotRead<T>(driver: SqliteDriverSession, control: SqliteTableBrowseControl, action: () => Promise<T>): Promise<T> {
  let value!: T, failure: unknown, failed = false;
  try { control.check(); await driver.execute('BEGIN'); control.check(); value = await action(); } catch (reason) { failed = true; failure = reason; }
  control.beginCleanup();
  if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); } catch (reason) { control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason], 'SQLite对象只读检查及收尾均失败') : reason; failed = true; }
  else if (!driver.isClosed && driver.transaction !== false) { const reason = Error('SQLite对象原读事务状态未知'); control.cleanupFailed(reason); failure = failed ? new AggregateError([failure, reason]) : reason; failed = true; }
  if (failed) throw failure; control.check(); return value;
}

export async function inspectSqliteObjects(driver: SqliteDriverSession, profile: SqliteConnectionProfile, input: Pick<SqliteObjectsInspectInput, 'kind' | 'name' | 'action'>, control: SqliteTableBrowseControl): Promise<SqliteObjectsSnapshot> {
  if (!driver.readOnly || !driver.identity) throw Error('SQLite对象检查必须独立只读且具备原文件身份');
  const snapshot: SqliteObjectsSnapshot = { target: { connectionId: profile.id, database: 'main', kind: input.kind, name: input.name }, action: input.action, profile: structuredClone(profile), identity: driver.identity, version: driver.version, sourceSql: null, attachedTriggers: [], facts: undefined! };
  await snapshotRead(driver, control, async () => { await assertFile(snapshot, control); snapshot.facts = await readFacts(driver, control); Object.assign(snapshot, inspectTarget(snapshot.facts, snapshot.target, snapshot.action)); await assertFile(snapshot, control); }); return snapshot;
}
/** 原行值可合法变化；目录/schemaVersion/root必须与已显示的完整快照相同。 */
function sameFacts(left: ObjectFacts, right: ObjectFacts): boolean { return equal(left, right); }
/** 每条CREATE均带原生种类/名称/ON关系guard；原view附属触发器逐条用原文恢复。 */
function compile(snapshot: SqliteObjectsSnapshot, sql?: string): Compiled {
  const plan = buildSqliteObjectsPlan(snapshot.target, snapshot.action, sql, snapshot.attachedTriggers);
  const steps: Compiled['steps'] = plan.sql.map(statement => ({ sql: statement }));
  if (snapshot.action !== 'drop') {
    const index = snapshot.action === 'create' ? 0 : 1; steps[index].createGuard = { kind: snapshot.target.kind, name: snapshot.target.name };
    if (snapshot.action === 'replace' && snapshot.target.kind === 'view') for (const [offset, trigger] of snapshot.attachedTriggers.entries()) steps[offset + 2].createGuard = { kind: 'trigger', name: trigger.name };
  }
  return { ...plan, steps };
}
/** 只允许计划目标及原附属trigger变化；其它定义/root必须原样保留，不自动删引用对象。 */
function verifyObjects(snapshot: SqliteObjectsSnapshot, after: ObjectFacts): void {
  const replaced = (object: { type: string; name: string; table: string }) => object.type === snapshot.target.kind && object.name === snapshot.target.name || snapshot.target.kind === 'view' && snapshot.action !== 'create' && object.type === 'trigger' && fold(object.table) === fold(snapshot.target.name);
  const retained = snapshot.facts.objects.filter(object => !replaced(object));
  for (const object of retained) if (!equal(object, after.objects.find(value => value.type === object.type && value.name === object.name))) throw Error('SQLite非目标对象定义发生非计划变化');
  const target = after.objects.find(object => object.type === snapshot.target.kind && object.name === snapshot.target.name), attached = snapshot.target.kind === 'view' ? after.objects.filter(object => object.type === 'trigger' && fold(object.table) === fold(snapshot.target.name)) : [];
  if (snapshot.action === 'drop') { if (target || attached.length) throw Error('SQLite对象删除后准确目标或附属触发器仍存在'); }
  else {
    if (!target || !target.sql || snapshot.target.kind === 'view' && fold(target.table) !== fold(target.name) || snapshot.target.kind === 'trigger' && !after.eligibleRelations.some(relation => fold(relation.name) === fold(target.table))) throw Error('SQLite对象CREATE后准确种类、名称或所属关系无法确认');
    if (snapshot.target.kind === 'view' && snapshot.action === 'replace' && !equal(attached, snapshot.facts.objects.filter(object => object.type === 'trigger' && fold(object.table) === fold(snapshot.target.name)))) throw Error('SQLite原view附属触发器未按原定义恢复');
  }
  const expectedCount = retained.length + (snapshot.action === 'drop' ? 0 : 1) + (snapshot.action === 'replace' && snapshot.target.kind === 'view' ? snapshot.attachedTriggers.length : 0);
  if (after.objects.length !== expectedCount) throw Error('SQLite对象目录出现非计划新增或删除');
  for (const root of snapshot.facts.roots) if (!replaced(root) && !equal(root, after.roots.find(value => value.type === root.type && value.name === root.name))) throw Error('SQLite非目标存储rootpage发生非计划变化');
  if (target && after.roots.find(value => value.type === target.type && value.name === target.name)?.root !== '0') throw Error('SQLite视图或触发器出现异常存储rootpage');
}
export interface SqliteObjectsCatalogue extends SqliteObjectsSnapshot { id: string; expires: number; bytes: number; }
export interface SqliteObjectsClaim { id: string; catalogue: SqliteObjectsCatalogue; compiled: Compiled; sql?: string; expires: number; bytes: number; confirmed: boolean; }

/** TTL仅阻新领取；在途RO pin继续计预算，显式release能命中已从领取Map过期的准确对象。 */
export class SqliteObjects {
  private readonly catalogues = new Map<string, SqliteObjectsCatalogue>(); private readonly previews = new Map<string, SqliteObjectsClaim>();
  private readonly pins = new Map<SqliteObjectsCatalogue, number>(); private readonly revoked = new WeakSet<SqliteObjectsCatalogue>(); private catalogueBytes = 0; private previewBytes = 0;
  private dropPreview(id: string): void { const value = this.previews.get(id); if (value) { this.previewBytes -= value.bytes; this.previews.delete(id); } }
  private dropCatalogue(id: string, revoke: boolean): void {
    const value = this.catalogues.get(id);
    if (revoke) { if (value) this.revoked.add(value); for (const pin of this.pins.keys()) if (pin.id === id) this.revoked.add(pin); for (const preview of this.previews.values()) if (preview.catalogue.id === id) this.dropPreview(preview.id); }
    if (value) { if (!this.pins.has(value)) this.catalogueBytes -= value.bytes; this.catalogues.delete(id); }
  }
  private prune(): void { for (const value of this.previews.values()) if (value.expires <= Date.now()) this.dropPreview(value.id); for (const value of this.catalogues.values()) if (value.expires <= Date.now()) this.dropCatalogue(value.id, false); }
  private count(): number { let count = this.catalogues.size; for (const pin of this.pins.keys()) if (this.catalogues.get(pin.id) !== pin) count++; return count; }
  /** 公共目录只复制真实展示对象，私有依赖及文件身份不传到Renderer。 */
  publish(snapshot: SqliteObjectsSnapshot): SqliteObjectsInspectOutput {
    this.prune(); const bytes = Buffer.byteLength(JSON.stringify(snapshot)); if (this.count() >= limits.catalogues || this.catalogueBytes + bytes > limits.catalogueBytes) throw Error('SQLite对象目录能力预算已满');
    const value: SqliteObjectsCatalogue = { ...snapshot, id: randomUUID(), expires: Date.now() + limits.catalogueLifetimeMs, bytes };
    const output = sqliteObjectsInspectionSchema.parse({ catalogueId: value.id, target: { ...value.target }, action: value.action, exists: value.sourceSql !== null, sourceSql: value.sourceSql, relatedObjects: structuredClone(value.facts.objects), attachedTriggers: structuredClone(value.attachedTriggers), eligibleRelations: structuredClone(value.facts.eligibleRelations), readOnly: value.profile.sqlite.readOnly, expiresAt: new Date(value.expires).toISOString() });
    this.catalogues.set(value.id, value); this.catalogueBytes += bytes; return output;
  }
  /** TTL仅控制新领取；不把过期自动当作对原任务的取消授权。 */
  catalogue(id: string): SqliteObjectsCatalogue { this.prune(); const value = this.catalogues.get(id); if (!value) throw Error(stale); return value; }
  /** 在途只读对象继续占用原数量/字节预算，最后一个原任务settle才归还。 */
  pin(value: SqliteObjectsCatalogue): { check(): void; release(): void } {
    if (this.revoked.has(value)) throw Error(stale); this.pins.set(value, (this.pins.get(value) ?? 0) + 1); let released = false;
    return { check: () => { if (released || this.revoked.has(value)) throw Error(stale); }, release: () => { if (released) return; released = true; const count = this.pins.get(value)!; if (count > 1) this.pins.set(value, count - 1); else { this.pins.delete(value); if (this.catalogues.get(value.id) !== value) this.catalogueBytes -= value.bytes; } } };
  }
  /** 编译计划不执行用户表达式；预览与父目录各有独立期限。 */
  preview(catalogue: SqliteObjectsCatalogue, sql?: string): SqliteObjectsPreviewOutput {
    if (this.revoked.has(catalogue)) throw Error(stale); const compiled = compile(catalogue, sql); this.prune(); const bytes = Buffer.byteLength(JSON.stringify({ catalogue, compiled, sql })); if (this.previews.size >= limits.previews || this.previewBytes + bytes > limits.previewBytes) throw Error('SQLite对象预览能力预算已满');
    const value: SqliteObjectsClaim = { id: randomUUID(), catalogue, compiled, sql, expires: Date.now() + limits.previewLifetimeMs, bytes, confirmed: false }; this.previews.set(value.id, value); this.previewBytes += bytes;
    return { previewId: value.id, catalogueId: catalogue.id, target: { ...catalogue.target }, sql: [...compiled.sql], confirmation: 'main.' + catalogue.target.name, action: catalogue.action, requiredAcknowledgements: [...compiled.requiredAcknowledgements], attachedTriggerCount: compiled.attachedTriggerCount, expiresAt: new Date(value.expires).toISOString() };
  }
  /** 确认错误也消费准确编号，防止同一次明确操作被自动重放。 */
  claim(input: SqliteObjectsApplyInput): SqliteObjectsClaim { this.prune(); const value = this.previews.get(input.previewId); if (!value) throw Error(stale); this.dropPreview(value.id); return { ...value, confirmed: input.confirmation === 'main.' + value.catalogue.target.name && input.acknowledgements.length === value.compiled.requiredAcknowledgements.length && value.compiled.requiredAcknowledgements.every(item => input.acknowledgements.includes(item)) }; }
  release(input: SqliteObjectsReleaseInput): void { if (input.previewId) this.dropPreview(input.previewId); if (input.catalogueId) this.dropCatalogue(input.catalogueId, true); }
  releaseConnection(id: string): void { for (const value of new Set([...this.catalogues.values(), ...this.pins.keys()])) if (value.target.connectionId === id) this.dropCatalogue(value.id, true); for (const value of this.previews.values()) if (value.catalogue.target.connectionId === id) this.dropPreview(value.id); }
  settle(claim: SqliteObjectsClaim, outcome: SqliteObjectsOutcome['outcome']): void { if (outcome === 'committed' || outcome === 'unknown') this.dropCatalogue(claim.catalogue.id, true); }
}

/** 每次预览重新取独立RO快照，原目录变化不能仍签发旧计划。 */
export async function verifySqliteObjects(driver: SqliteDriverSession, snapshot: SqliteObjectsSnapshot, control: SqliteTableBrowseControl): Promise<void> {
  if (!driver.readOnly || !equal(driver.identity, snapshot.identity) || driver.version !== snapshot.version) throw Error(stale);
  await snapshotRead(driver, control, async () => { await assertFile(snapshot, control); if (!sameFacts(snapshot.facts, await readFacts(driver, control))) throw Error(stale); await assertFile(snapshot, control); });
}
/** 写操作尚未发送时也给准确结构化事实，不借错误回包猜测已执行DDL。 */
export function sqliteObjectsNotSent(claim: SqliteObjectsClaim, input: SqliteObjectsApplyRequest): SqliteObjectsOutcome {
  const fact: SqliteObjectsFact = { operationId: input.operationId, target: { ...claim.catalogue.target }, action: claim.catalogue.action, phase: 'not-sent', requestedStatements: claim.compiled.sql.length, completedStatements: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false }; let warning = false;
  try { const result: unknown = input.recordObjectsFact(fact); if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('SQLite对象事实必须同步持久化'); } catch { warning = true; }
  return { operationId: input.operationId, target: { ...fact.target }, action: claim.catalogue.action, outcome: 'not-sent', fact, definitionVerified: false, message: text.notSent, ...(warning ? { cleanupWarning: true } : {}) };
}

/** 全部DDL在独立事务内；view只prepare LIMIT0，trigger从不试触发，后验目录通过才发送唯一COMMIT。 */
export async function applySqliteObjects(driver: SqliteDriverSession, claim: SqliteObjectsClaim, input: SqliteObjectsApplyRequest, control: SqliteObjectsControl): Promise<SqliteObjectsOutcome> {
  const snapshot = claim.catalogue; let begun = false, sent = false, committed = false, rollback = false, verified = false, completedStatements = 0, warning = false, rollbackMessage: string = text.rolledBack;
  const fact = (phase: SqliteObjectsFact['phase']): SqliteObjectsFact => ({ operationId: input.operationId, target: { ...snapshot.target }, action: snapshot.action, phase, requestedStatements: claim.compiled.sql.length, completedStatements, commitMayHaveBeenSent: sent || phase === 'commit-pending', commitAcknowledged: committed, rollbackAcknowledged: rollback });
  const record = (phase: SqliteObjectsFact['phase']) => { const result: unknown = input.recordObjectsFact(fact(phase)); if (result && typeof (result as { then?: unknown }).then === 'function') throw Error('SQLite对象事实必须同步持久化'); };
  try {
    control.check(); if (!claim.confirmed || driver.readOnly || !equal(driver.identity, snapshot.identity) || driver.version !== snapshot.version) throw Error(stale); await assertFile(snapshot, control); record('not-sent');
    try { await driver.execute('BEGIN IMMEDIATE'); begun = true; } catch (reason) { if (reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults[0]?.transaction === true) begun = true; throw reason; }
    control.check(); await assertFile(snapshot, control); const before = await readFacts(driver, control); if (!sameFacts(snapshot.facts, before) || !equal(compile(snapshot, claim.sql), claim.compiled)) throw Error(stale); record('writing');
    // 关系白名单按批次只保存一份；不能为每条附属trigger复制4096项而放大目录预算。
    const allowedRelations = snapshot.facts.eligibleRelations.map(relation => relation.name);
    if (snapshot.target.kind === 'view' && snapshot.action === 'replace' && !allowedRelations.some(name => fold(name) === fold(snapshot.target.name))) allowedRelations.push(snapshot.target.name);
    for (const step of claim.compiled.steps) {
      control.check();
      try { const result = await driver.execute(step.sql, { parameters: [], ...(step.createGuard ? { createGuard: { ...step.createGuard, allowedRelations } } : {}) }); if (result.statements.length !== 1 || result.statements[0].truncated || result.statements[0].rows !== 0) throw Error('SQLite原对象DDL缺少完整回执'); completedStatements++; }
      catch (reason) { if (reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults.length === 1 && reason.completedResults[0].index === 0 && reason.completedResults[0].rows === 0 && !reason.completedResults[0].truncated) completedStatements++; throw reason; }
      record('writing'); control.check();
    }
    const after = await readFacts(driver, control); verifyObjects(snapshot, after);
    if (snapshot.action !== 'drop' && snapshot.target.kind === 'view') {
      const rows = await read(driver, 'SELECT * FROM main.' + quoteSqliteIdentifier(snapshot.target.name) + ' LIMIT 0', [], 1, control); if (rows.length !== 0) throw Error('SQLite新视图LIMIT 0验证出现非计划数据');
    }
    verified = true; await assertFile(snapshot, control); record('commit-pending'); control.check(); control.beginCommit(); sent = true; await driver.execute('COMMIT'); committed = true; try { record('committed'); } catch { warning = true; }
  } catch (reason) {
    if (sent && reason instanceof SqliteDriverError && reason.completedStatements === 1 && reason.completedResults.length === 1 && reason.completedResults[0].index === 0 && reason.completedResults[0].rows === 0 && !reason.completedResults[0].truncated && reason.completedResults[0].transaction === false) { committed = true; warning = true; try { record('committed'); } catch { /* 原COMMIT ACK不能被末回包/通知失败抹去。 */ } }

    else if (reason instanceof SqliteDriverError && /^SQLITE_NATIVE_\d+$/.test(reason.code) && Number(reason.code.slice('SQLITE_NATIVE_'.length)) % 256 === 19) rollbackMessage = 'SQLite原生对象约束拒绝本批修改，原整批事务已确认回滚。';
  }
  if (!committed) { control.beginCleanup(); if (driver.isUsable && driver.transaction === true) try { await driver.execute('ROLLBACK'); rollback = true; } catch (reason) { control.cleanupFailed(reason); } else if (begun) control.cleanupFailed(Error('SQLite对象原写事务回滚未确认')); }
  const outcome: SqliteObjectsOutcome['outcome'] = committed ? 'committed' : rollback ? 'rolled-back' : begun || sent ? 'unknown' : 'not-sent'; if (!committed) try { record(outcome); } catch { warning = true; }
  return { operationId: input.operationId, target: { ...snapshot.target }, action: snapshot.action, outcome, fact: fact(outcome), definitionVerified: committed && verified, message: committed ? text.committed : outcome === 'unknown' ? text.unknown : outcome === 'rolled-back' ? rollbackMessage : text.notSent, ...(warning ? { cleanupWarning: true } : {}) };
}
