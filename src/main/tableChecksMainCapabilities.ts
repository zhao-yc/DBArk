import type { ColumnsInvocation } from './columnsMainCapabilities';
import type { TableCheckProgress, TableCheckTarget } from '../shared/tableChecks';
import { tableCheckMessages as text } from '../shared/tableChecks';

interface Token { purpose: string; connectionId: string; expires: number; kind: 'snapshot' | 'preview'; snapshotId?: string; }
interface Binding { owner: ColumnsInvocation; revision: number; target: TableCheckTarget; parent?: Token; }
export interface TableChecksInvocation {
  readonly owner: ColumnsInvocation; readonly command: string; readonly revision: number; readonly target?: TableCheckTarget;
  readonly parent?: Token; readonly snapshotId?: string; readonly claimed?: Token;
  issued?: { token: string; record: Token }; returned?: { snapshotId?: string; previewToken?: string }; cleanup?: Promise<unknown>;
}
interface Runtime {
  assertOwner(owner?: ColumnsInvocation): void;
  sameOwner(left: ColumnsInvocation, right: ColumnsInvocation): boolean;
  revision(): number; available(connectionId: string): void; closing(): boolean;
  release(input: { snapshotId?: string; previewToken?: string }): Promise<unknown>;
}

/** 仅用于Main尚未收到Engine终态时的兜底；早期running的not-sent不能证明最终未发送。 */
export function tableChecksFailureProgress(dispatchedApply: boolean, previous?: TableCheckProgress): TableCheckProgress {
  const completed = previous?.ddlCompleted === true, submitted = dispatchedApply || previous?.ddlSubmitted === true || completed;
  return { ...previous, phase: previous?.phase ?? 'connecting', ddlSubmitted: submitted, ddlCompleted: completed, definitionVerified: completed && previous?.definitionVerified === true, outcome: completed ? 'succeeded' : submitted ? 'unknown' : 'not-sent' };
}

/** CHECK复用真实IPC来源捕获，另持用途/父对象/二段目标/修订；不接受renderer授予能力。 */
export class TableChecksMainCapabilities {
  private readonly bindings = new WeakMap<Token, Binding>();
  private readonly requests = new WeakSet<TableChecksInvocation>();
  private readonly retired = new Map<string, Token>();
  constructor(private readonly tokens: Map<string, Token>, private readonly runtime: Runtime) {}

  /** 只保存有界释放回执；过期能力不会因输入相同ID而复活。 */
  private sweep(): void { for (const [id, token] of this.retired) if (token.expires <= Date.now()) this.retired.delete(id); }
  private retire(id: string, token: Token): void {
    if (this.tokens.get(id) === token) this.tokens.delete(id);
    this.sweep(); if (this.retired.size < 256) this.retired.set(id, token);
  }
  private binding(record: Token, owner: ColumnsInvocation): Binding {
    const binding = this.bindings.get(record);
    if (!binding || !this.runtime.sameOwner(binding.owner, owner)) throw Error(text.stale);
    return binding;
  }
  /** apply在任何等待前领取并退休整组快照；同父的兄弟预览不能连续消费。 */
  begin(command: string, input: any, owner?: ColumnsInvocation): TableChecksInvocation {
    this.runtime.assertOwner(owner); if (!owner) throw Error(text.stale);
    if (!['get', 'preview', 'apply', 'release'].some(op => command === 'schema.tableChecks.' + op)) throw Error(text.invalid);
    this.sweep();
    if (command === 'schema.tableChecks.release') { const request = { owner, command, revision: this.runtime.revision() }; this.requests.add(request); return request; }
    if (this.runtime.closing()) throw Error(text.stale);
    const revision = this.runtime.revision(); let binding: Binding | undefined, record: Token | undefined;
    if (command !== 'schema.tableChecks.get') {
      record = this.tokens.get(command.endsWith('.preview') ? input.snapshotId : input.previewToken);
      if (!record || record.purpose !== 'tableChecks' || record.kind !== (command.endsWith('.preview') ? 'snapshot' : 'preview') || record.expires <= Date.now()) throw Error(text.stale);
      binding = this.binding(record, owner); if (binding.revision !== revision) throw Error(text.stale);
      if (binding.parent && this.tokens.get(record.snapshotId!) !== binding.parent) throw Error(text.stale);
    }
    const target = binding?.target ?? { connectionId: input.connectionId, database: input.database, table: input.table };
    if (![target.connectionId, target.database, target.table].every(value => typeof value === 'string' && value.length)) throw Error(text.invalid);
    this.runtime.available(target.connectionId);
    const request: TableChecksInvocation = { owner, command, revision, target: { ...target }, ...(command.endsWith('.preview') ? { parent: record, snapshotId: input.snapshotId } : {}), ...(command.endsWith('.apply') ? { claimed: record } : {}) };
    this.requests.add(request);
    if (request.claimed) {
      const parent = binding?.parent;
      for (const [id, token] of this.tokens) if (token.purpose === 'tableChecks' && (token === request.claimed || token === parent || parent && this.bindings.get(token)?.parent === parent)) this.retire(id, token);
    }
    return request;
  }
  /** 真正投递前重核原文档、锁、修订和父对象；领取的apply不重新登记。 */
  beforeSend(request: TableChecksInvocation, revision: number): void {
    this.assertCurrent(request); if (revision !== request.revision || request.claimed && request.claimed.expires <= Date.now()) throw Error(text.stale);
  }
  private assertCurrent(request: TableChecksInvocation): void {
    if (!this.requests.has(request)) throw Error(text.stale);
    this.runtime.assertOwner(request.owner);
    if (this.runtime.closing() || request.revision !== this.runtime.revision() || !request.target) throw Error(text.stale);
    this.runtime.available(request.target.connectionId);
    if (request.parent && (this.tokens.get(request.snapshotId!) !== request.parent || request.parent.expires <= Date.now())) throw Error(text.stale);
  }
  /** 返回目标逐段核验，不能只凭connectionId把其它同连接表的能力交给旧窗口。 */
  private assertTarget(request: TableChecksInvocation, result: any): void {
    const target = request.target;
    if (!target || result?.target?.connectionId !== target.connectionId || result.target.database !== target.database || result.target.table !== target.table) throw Error(text.stale);
  }
  publish(request: TableChecksInvocation, result: any): void {
    const kind = request.command === 'schema.tableChecks.get' ? 'snapshot' : 'preview', token = kind === 'snapshot' ? result?.snapshotId : result?.previewToken;
    if (typeof token !== 'string' || !token || this.tokens.has(token) || this.retired.has(token)) throw Error('检查约束引擎未返回新的唯一能力，未覆盖或释放其它能力');
    request.returned = kind === 'snapshot' ? { snapshotId: token } : { previewToken: token };
    this.assertCurrent(request); this.assertTarget(request, result);
    const expires = Date.parse(result.expiresAt);
    if (!Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 120000 || this.tokens.size >= 128) throw Error(text.stale);
    const record: Token = { purpose: 'tableChecks', connectionId: request.target!.connectionId, expires, kind, ...(request.parent ? { snapshotId: request.snapshotId } : {}) };
    this.bindings.set(record, { owner: request.owner, revision: request.revision, target: { ...request.target! }, ...(request.parent ? { parent: request.parent } : {}) });
    this.tokens.set(token, record); request.issued = { token, record };
  }
  /** 原IPC返回前不再await；apply的执行事实不以过期时间倒改为未发送。 */
  assertReply(request: TableChecksInvocation, result?: unknown): void {
    this.assertCurrent(request);
    if (request.command.endsWith('.apply')) { this.assertTarget(request, result); return; }
    if (!request.issued || this.tokens.get(request.issued.token) !== request.issued.record || request.issued.record.expires <= Date.now()) throw Error(text.stale);
  }
  /** 仅可信引擎晚回包可走未发布令牌清理；客户端未知ID不会被转发成释放能力。 */
  async rejectReply(request: TableChecksInvocation, failure: unknown): Promise<never> {
    if (request.issued) this.retire(request.issued.token, request.issued.record);
    let message = failure instanceof Error ? failure.message : text.stale;
    if (request.returned) try { request.cleanup ??= this.runtime.release(request.returned); await request.cleanup; } catch (error) { message += '；检查约束能力释放尚未确认：' + (error instanceof Error ? error.message : '未知错误'); }
    throw Error(message);
  }
  hasUnpublished(request?: TableChecksInvocation): request is TableChecksInvocation { return !!request?.issued && this.tokens.get(request.issued.token) === request.issued.record; }
  /** 全体验证再原子撤销；允许同源重复释放，未知ID只作本地无操作。 */
  async release(request: TableChecksInvocation, input: { snapshotId?: string; previewToken?: string }): Promise<void> {
    if (!this.requests.has(request)) throw Error(text.stale); this.runtime.assertOwner(request.owner); this.sweep();
    const known: { snapshotId?: string; previewToken?: string } = {};
    for (const [id, kind] of [[input.snapshotId, 'snapshot'], [input.previewToken, 'preview']] as const) {
      if (!id) continue; const token = this.tokens.get(id) ?? this.retired.get(id);
      if (!token) continue;
      if (token.purpose !== 'tableChecks' || token.kind !== kind) throw Error(text.stale);
      this.binding(token, request.owner); if (kind === 'snapshot') known.snapshotId = id; else known.previewToken = id;
    }
    const parent = known.snapshotId ? this.tokens.get(known.snapshotId) ?? this.retired.get(known.snapshotId) : undefined;
    for (const [id, token] of this.tokens) if (token.purpose === 'tableChecks' && (token === parent || parent && this.bindings.get(token)?.parent === parent || id === known.previewToken)) this.retire(id, token);
    if (known.snapshotId || known.previewToken) await this.runtime.release(known);
  }
}
