import { tableCheckChangeSchema, tableCheckRequiredAcknowledgements, tableCheckTargetSchema, type TableCheckApplyOutput, type TableCheckChange, type TableCheckGetOutput, type TableCheckPreviewOutput, type TableCheckProgress, type TableCheckReleaseInput, type TableCheckTarget } from '../shared/tableChecks';
import { tableChecksZh as text } from './locales/tableChecks.zh-CN';

/** 准确元组不拼接可碰撞分隔符，也不折叠库表大小写。 */
export function tableCheckTargetKey(target: TableCheckTarget): string { return JSON.stringify([target.connectionId, target.database, target.table]); }
/** 无效日期和过期令牌不能因NaN比较而被当成永久有效。 */
export function tableCheckTokenCurrent(expiresAt: string, now = Date.now()): boolean { const deadline = Date.parse(expiresAt); return Number.isFinite(deadline) && deadline > now; }
/** schema仅规范属性顺序，名称和表达式原文不修剪、不重新格式化。 */
export function tableCheckChangeKey(change: unknown): string { return JSON.stringify(tableCheckChangeSchema.parse(change)); }
const acknowledgementLabels = new Map<string, string>([['ddl-implicit-commit', text.ackImplicit], ['external-ddl-window', text.ackWindow], ['check-existing-rows', text.ackRows], ['check-removal', text.ackRemoval], ['check-disabled', text.ackDisabled]]);
/** 只映射明确的风险ID，不从普通对象原型继承确认权限。 */
export function tableCheckAcknowledgementLabel(id: string): string | undefined { return acknowledgementLabels.get(id); }
/** 服务器确认集必须与本次结构化变更完全相符，未知/重复/额外项不授权。 */
export function tableCheckAcksComplete(required: readonly string[], selected: ReadonlySet<string>, change: TableCheckChange): boolean {
  const expected = tableCheckRequiredAcknowledgements(change); return required.length === expected.length && new Set(required).size === required.length && selected.size === required.length && required.every(id => expected.includes(id as typeof expected[number]) && selected.has(id) && acknowledgementLabels.has(id));
}
/** 快照必须对应原库表且仍在有效期，不借活动标签补充目标。 */
export function assertTableCheckSnapshot(snapshot: TableCheckGetOutput, target: TableCheckTarget): void { if (tableCheckTargetKey(snapshot.target) !== tableCheckTargetKey(target)) throw Error(text.mismatch); if (!tableCheckTokenCurrent(snapshot.expiresAt)) throw Error(text.expired); }
/** 原快照、草稿和opaque预览必须共同匹配，旧显示名不能定位替代约束。 */
export function assertTableCheckPreview(preview: TableCheckPreviewOutput, snapshot: TableCheckGetOutput, change: TableCheckChange): void {
  assertTableCheckSnapshot(snapshot, preview.target);
  if (!tableCheckTokenCurrent(preview.expiresAt)) throw Error(text.expired);
  if (preview.ddlHash !== snapshot.ddlHash || tableCheckChangeKey(preview.change) !== tableCheckChangeKey(change) || !tableCheckAcksComplete(preview.requiredAcknowledgements, new Set(preview.requiredAcknowledgements), change) || change.op !== 'add' && preview.before?.checkRef !== change.checkRef) throw Error(text.mismatch);
}
export type TableCheckStatus = 'notSent' | 'unknownOutcome' | 'completed' | 'unverified' | 'verified';
/** 只有完整成功回包能自动刷新；异常不等于没执行，资源未确认也不得声称完整成功。 */
export function tableCheckExecutionState(attempted: boolean, progress: TableCheckProgress | null, result?: TableCheckApplyOutput, terminal = false): { status: TableCheckStatus; changed: boolean; verified: boolean } {
  if (result) { const verified = result.ddlSubmitted === true && result.ddlCompleted === true && result.resourcesReleased === true && result.definitionVerified === true; return { status: verified ? 'verified' : result.ddlCompleted ? result.definitionVerified ? 'completed' : 'unverified' : 'unknownOutcome', changed: true, verified }; }
  // connecting/rechecking的running也可暂时not-sent，丢失后续回包时不能据此推断没执行。
  if (!attempted || terminal && progress?.outcome === 'not-sent' && !progress.ddlSubmitted && !progress.ddlCompleted) return { status: 'notSent', changed: false, verified: false };
  return { status: progress?.ddlCompleted ? progress.definitionVerified ? 'completed' : 'unverified' : 'unknownOutcome', changed: true, verified: false };
}

/** 只绑定固定目标、准确profile及配置修订；任何一次离开后都不能ABA复活。 */
export class TableCheckIntent {
  readonly target: TableCheckTarget; private readonly key: string; private readonly profile: object | undefined; private readonly version: number; private dead = false; private readonly listeners = new Set<() => void>();
  constructor(target: TableCheckTarget, private readonly read: () => { profile: object | undefined; version: number }) { this.target = Object.freeze(tableCheckTargetSchema.parse(target)); this.key = tableCheckTargetKey(this.target); const initial = read(); this.profile = initial.profile; this.version = initial.version; }
  /** render中也即时记住目标离开，恢复同名值不能复活。 */
  observe(target: TableCheckTarget): void { if (tableCheckTargetKey(target) !== this.key) this.invalidate(); }
  /** 每次真实store变化核对原profile引用及配置修订。 */
  current(): boolean { if (!this.dead) { try { const state = this.read(); if (!this.profile || state.profile !== this.profile || state.version !== this.version) this.invalidate(); } catch { this.invalidate(); } } return !this.dead; }
  /** 权限同步撤销，通知延后以免在父render期间更新组件。 */
  invalidate(): void { if (this.dead) return; this.dead = true; queueMicrotask(() => { for (const listener of this.listeners) listener(); }); }
  /** 订阅只属于当前挂载，不使constructor产生外部副作用。 */
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
}

type ResourceKind = 'snapshotId' | 'previewToken';
/** 资源先登记再判断回包是否迟到，失败保留责任，并发释放同一令牌只发一次真实请求。 */
export class TableCheckResourceLedger {
  private readonly pending = new Map<string, { kind: ResourceKind; id: string }>(); private readonly inFlight = new Map<string, Promise<void>>();
  constructor(private readonly send: (input: TableCheckReleaseInput) => Promise<void>) {}
  get size(): number { return this.pending.size; }
  /** 先登记收尾责任，错误目标或迟到回包也不能直接丢弃令牌。 */
  track(kind: ResourceKind, id: string): void { if (typeof id !== 'string' || !id.length || id.length > 200) throw Error(text.mismatch); this.pending.set(JSON.stringify([kind, id]), { kind, id }); }
  /** 只在真实release成功后清责任，同令牌并发请求共用原promise。 */
  async release(kind: ResourceKind, id: string): Promise<void> {
    this.track(kind, id); const key = JSON.stringify([kind, id]); let promise = this.inFlight.get(key);
    if (!promise) { promise = Promise.resolve().then(() => this.send({ [kind]: id })).then(() => { this.pending.delete(key); }); this.inFlight.set(key, promise); }
    try { await promise; } finally { if (this.inFlight.get(key) === promise) this.inFlight.delete(key); }
  }
  /** 先释放预览后快照，任一失败不跳过其它资源且保留失败项。 */
  async releaseAll(previewsOnly = false): Promise<void> {
    const failures: string[] = [], resources = [...this.pending.values()].sort((left, right) => left.kind === right.kind ? 0 : left.kind === 'previewToken' ? -1 : 1); for (const { kind, id } of resources) if (!previewsOnly || kind === 'previewToken') try { await this.release(kind, id); } catch (reason) { failures.push(reason instanceof Error ? reason.message : String(reason)); }
    if (failures.length) throw Error(failures.join('\n'));
  }
}
