import type { QueryParameter, QueryParameterNames } from '../shared/queryParameters';
import { QueryParameterReuseCache, type QueryParameterReuseLease, type QueryParameterReuseScope } from './queryParameterReuse';
import { QueryParameterReuseCandidate } from './queryParameterReuseCandidate';
import { QueryParameterReuseScopeReader, type QueryParameterReuseScopeInput } from './queryParameterReuseScope';
import type { QueryParameterReusePort } from './queryParameterReusePort';

export type QueryParameterReuseOwnerInput = Omit<QueryParameterReuseScopeInput, 'formIdentity'>;
const baseKeys = ['tabId', 'connectionId', 'connectionVersion', 'editorIdentity', 'modelIdentity', 'modelVersion', 'source', 'rangeIdentity', 'savedSourceIdentity', 'fileSourceIdentity'] as const;
interface Form {
  port: QueryParameterReusePort; source: string; scope: QueryParameterReuseScope | null;
  valid: boolean; recognized: boolean; staged: boolean; lease: QueryParameterReuseLease | null;
  initialTask: string; session: string | null; database: string | null; listeners: Set<() => void>;
}

/** 一个查询标签的RAM能力组合；所有事件仍由父同步observe，不订阅工作区、不执行或持久化参数。 */
export class QueryParameterReuseOwner {
  private reader: (() => QueryParameterReuseOwnerInput | null) | null;
  private formIdentity: object = Object.freeze({});
  private readonly scope: QueryParameterReuseScopeReader;
  private readonly cache: QueryParameterReuseCache;
  private readonly unsubscribe: () => void;
  private form: Form | null = null;
  private candidate: QueryParameterReuseCandidate | null = null;
  private candidatePort: QueryParameterReusePort | null = null;
  private candidateTask = '';
  private candidatePhase: 'staged' | 'bound' | 'ledger' | 'waiting' | null = null;
  private disposed = false;
  private observing = false;
  constructor(reader: () => QueryParameterReuseOwnerInput | null) {
    this.reader = reader;
    this.scope = new QueryParameterReuseScopeReader(() => { const value = this.reader?.(); return value ? { ...value, formIdentity: this.formIdentity } : null; });
    this.cache = new QueryParameterReuseCache(() => this.scope.read()?.scope ?? null);
    this.unsubscribe = this.cache.subscribe(() => { if (this.form) this.notify(this.form); });
  }

  /** UI通知不携带值；一个订阅异常不能阻止其它订阅或敏感引用清理。 */
  private notify(form: Form): void { for (const listener of [...form.listeners]) { try { listener(); } catch { /* 不让UI异常改变RAM能力终态。 */ } } }
  /** 旧表单撤销后不再持正文/模型及listener，外部旧port只能得到失效结果。 */
  private revoke(form: Form): void {
    form.valid = false; form.lease = null; form.scope = null; form.source = ''; form.initialTask = ''; form.session = null; form.database = null;
    if (this.form === form) this.form = null; this.notify(form); form.listeners.clear();
  }
  /** 仅释放指定旧候选，避免通知重入后清除新任务的候选。 */
  private clearCandidate(expected = this.candidate): void { if (expected !== this.candidate) return; expected?.dispose(); this.candidate = null; this.candidatePort = null; this.candidateTask = ''; this.candidatePhase = null; }

  /** 来源ABA首次差异即撤销；pending只允许初次会话建立和一次实际库确认，不看busy/modal。 */
  observe(): boolean {
    if (this.disposed) return false;
    if (this.observing) return true;
    this.observing = true;
    try {
      const view = this.scope.read(), form = this.form;
      if (form?.valid) {
        let valid = !!view && !!form.scope && view.scope.source === form.source && baseKeys.every(key => view.scope[key] === form.scope![key]);
        if (valid && view) {
          if (form.recognized) valid = view.databaseKnown && view.scope.sessionId === form.session && view.databaseKey === form.database && view.scope.defaultDatabaseIdentity === form.scope!.defaultDatabaseIdentity;
          else {
            if (form.session) valid = view.scope.sessionId === form.session;
            else if (view.scope.sessionId) form.session = view.scope.sessionId;
            if (form.database !== null) valid = valid && view.databaseKnown && view.databaseKey === form.database;
            else if (form.session && view.databaseKnown) form.database = view.databaseKey;
          }
        }
        if (!valid) { if (this.candidatePort === form.port) this.clearCandidate(); this.revoke(form); }
      }
      const candidate = this.candidate; if (candidate && !candidate.observe()) this.clearCandidate(candidate);
      this.cache.observe(); return view !== null;
    } catch { if (this.form) this.revoke(this.form); this.clearCandidate(); this.cache.forget(); return false; }
    finally { this.observing = false; }
  }

  /** current独立于cache内部checkbox lease；同一来源的正常token轮换不误杀UI原操作。 */
  private current(form: Form): boolean { return !this.disposed && this.observe() && this.form === form && form.valid; }
  /** 读取和填写仅限识别完成后的原lease，stage消费后不再暴露候选内的值。 */
  private readable(form: Form): boolean { return this.current(form) && form.recognized && !form.staged && form.lease !== null; }

  /** 每次新表单发新内部form token，丢弃旧候选但保留仍合法的一组已发布RAM值。 */
  begin(source: string): QueryParameterReusePort | null {
    if (this.disposed) return null;
    if (this.form) this.revoke(this.form); this.clearCandidate(); this.formIdentity = Object.freeze({});
    const view = this.scope.read(); this.cache.observe(); if (!view || typeof source !== 'string' || !source.trim() || source !== view.scope.source) return null;
    let form!: Form;
    const port: QueryParameterReusePort = {
      current: () => this.current(form),
      has: info => this.readable(form) && this.cache.has(form.lease!, info),
      read: info => this.readable(form) ? this.cache.read(form.lease!, info) : null,
      setOptIn: enabled => {
        if (!this.readable(form)) return false;
        const lease = this.cache.setOptIn(form.lease!, enabled);
        if (!lease || !this.current(form)) return false;
        form.lease = lease; this.notify(form); return this.current(form);
      },
      forget: () => {
        if (!this.readable(form)) return;
        this.cache.forget();
        if (!this.current(form)) return;
        const lease = this.cache.begin();
        if (lease && this.current(form)) { form.lease = lease; this.notify(form); }
      },
      stage: (info, parameters) => this.stage(form, info, parameters),
      subscribe: listener => { if (!this.current(form)) return () => undefined; form.listeners.add(listener); return () => { form.listeners.delete(listener); }; },
    };
    form = { port, source, scope: { ...view.scope }, valid: true, recognized: false, staged: false, lease: null, initialTask: view.taskId, session: view.scope.sessionId || null, database: view.scope.sessionId && view.databaseKnown ? view.databaseKey : null, listeners: new Set() };
    this.form = form; return port;
  }

  /** ensureSession及实际completionState确认后仅首次begin lease；重识别不能绕过失效来源重发能力。 */
  recognized(port: QueryParameterReusePort): boolean {
    const form = this.form; if (!form || form.port !== port || !this.current(form)) return false;
    const view = this.scope.read(); if (!view?.databaseKnown || !view.scope.sessionId || view.scope.source !== form.source) return false;
    if (form.recognized) return this.current(form);
    const lease = this.cache.begin(); if (!lease || !this.current(form)) return false;
    form.scope = { ...view.scope }; form.session = view.scope.sessionId; form.database = view.databaseKey; form.recognized = true; form.lease = lease; this.notify(form); return this.current(form);
  }

  /** 只有原用户opt-in及整组真实校验通过才创建候选，不生成任务或投递SQL。 */
  private stage(form: Form, info: QueryParameterNames, parameters: readonly QueryParameter[]): boolean {
    if (!this.readable(form) || !this.cache.remember(form.lease!, info, parameters) || !this.current(form)) return false;
    const candidate = QueryParameterReuseCandidate.capture(this.cache, form.lease!, info, () => this.scope.read());
    if (!candidate || !this.current(form)) { candidate?.dispose(); return false; }
    this.clearCandidate(); this.candidate = candidate; this.candidatePort = form.port; this.candidateTask = ''; this.candidatePhase = 'staged'; form.staged = true; form.lease = null; this.notify(form); return this.current(form);
  }

  /** 用户取消只撤当前表单，保留已发布组；运行交接后的旧close不取消候选或清新组。 */
  close(port: QueryParameterReusePort): void { const form = this.form; if (!form || form.port !== port) return; if (this.candidatePort === port) this.clearCandidate(); this.revoke(form); }

  /** runQuery同步签发的新任务交接；未勾选且无候选也允许执行，只撤销原表单能力。 */
  bind(port: QueryParameterReusePort, taskId: string): boolean {
    const form = this.form;
    if (!form || form.port !== port || !form.recognized || !this.current(form)) return false;
    const view = this.scope.read();
    if (typeof taskId !== 'string' || !taskId || taskId === form.initialTask || view?.taskId !== taskId) { if (this.candidatePort === port) this.clearCandidate(); this.revoke(form); return false; }
    if (this.candidatePort === port && this.candidate) { if (!this.candidate.bind(taskId)) { this.clearCandidate(); this.revoke(form); return false; } this.candidateTask = taskId; this.candidatePhase = 'bound'; }
    else if (form.staged) { this.revoke(form); return false; }
    this.revoke(form); return true;
  }
  /** 仅原候选的原任务可允许一次恢复记账unknown，其它迟到任务不影响新候选。 */
  beforeLedger(taskId: string): void { const candidate = this.candidate; if (candidate && this.candidateTask === taskId) { if (candidate.beforeLedger(taskId)) this.candidatePhase = 'ledger'; else this.clearCandidate(candidate); } }
  /** 父提供实际RPC完整成功boolean，失败/取消立即清值；成功等待实际库确认和候选TTL。 */
  settled(taskId: string, success: boolean): boolean {
    const candidate = this.candidate;
    if (!candidate || this.candidateTask !== taskId) return false;
    if (!candidate.settled(taskId, success)) { this.clearCandidate(candidate); return false; }
    this.candidatePhase = 'waiting'; return true;
  }
  /** 已rememberDatabase的真实known库确认后才发布；不能借旧任务确认另一个候选。 */
  confirmed(taskId: string, actualKnownDatabaseKey: string): boolean {
    if (!this.observe() || !this.candidate || this.candidateTask !== taskId || this.candidatePhase !== 'waiting') return false;
    const candidate = this.candidate, result = candidate.publish(taskId, actualKnownDatabaseKey, this.cache); this.clearCandidate(candidate); return result;
  }
  /** 卸载清reader、订阅、表单、候选和全部RAM值，任何迟到port都不能复活。 */
  dispose(): void { if (this.disposed) return; this.disposed = true; if (this.form) this.revoke(this.form); this.clearCandidate(); this.unsubscribe(); this.cache.dispose(); this.scope.dispose(); this.reader = null; }
}
