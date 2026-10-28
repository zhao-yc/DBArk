import type { QueryParameter, QueryParameterNames } from '../shared/queryParameters';
import { QueryParameterReuseCache, type QueryParameterReuseLease, type QueryParameterReuseScope } from './queryParameterReuse';

export interface QueryParameterReuseCandidateView {
  scope: QueryParameterReuseScope; databaseKey: string; databaseKnown: boolean; formIdentity: object; taskId: string;
}
type Reader = () => QueryParameterReuseCandidateView | null;
const sourceKeys = ['tabId', 'connectionId', 'connectionVersion', 'sessionId', 'editorIdentity', 'modelIdentity', 'modelVersion', 'source', 'rangeIdentity', 'savedSourceIdentity', 'fileSourceIdentity'] as const;
export const queryParameterReuseCandidateTtlMs = 30_000;

/** 原提交候选仅持RAM副本；执行恢复记账不是默认库变更许可，更不是可复用成功回执。 */
export class QueryParameterReuseCandidate {
  private phase: 'captured' | 'bound' | 'ledger' | 'waiting' | 'disposed' = 'captured';
  private taskId = '';
  private deadline: number | null = null;
  private lastTime: number | null = null;
  private constructor(
    private cache: QueryParameterReuseCache | null, private origin: QueryParameterReuseCandidateView | null,
    private info: QueryParameterNames | null, private params: QueryParameter[] | null, private reader: Reader | null, private now: (() => number) | null,
  ) {}

  /** 只消费原显式remember成功后的验证副本；立即精确撤下该lease的可读组，终态前不能复用失败填写。 */
  static capture(cache: QueryParameterReuseCache, lease: QueryParameterReuseLease, info: QueryParameterNames, reader: Reader, now: () => number = () => performance.now()): QueryParameterReuseCandidate | null {
    let candidate: QueryParameterReuseCandidate | null = null;
    try {
      const current = reader(), params = cache.read(lease, info);
      if (!current || !params || !current.scope.sessionId || current.databaseKnown !== true || typeof current.databaseKey !== 'string' || !current.databaseKey || !current.formIdentity || typeof current.formIdentity !== 'object') { cache.setOptIn(lease, false); return null; }
      const copiedInfo: QueryParameterNames = { names: [...info.names], warnings: [], noBackslashEscapes: info.noBackslashEscapes, ansiQuotes: info.ansiQuotes, ...(info.ansiQuotesKnown === undefined ? {} : { ansiQuotesKnown: info.ansiQuotesKnown }), ...(info.noBackslashEscapesKnown === undefined ? {} : { noBackslashEscapesKnown: info.noBackslashEscapesKnown }), maxDecimalScale: info.maxDecimalScale, allowTimeEndpointFraction: info.allowTimeEndpointFraction };
      candidate = new QueryParameterReuseCandidate(cache, { ...current, scope: { ...current.scope } }, copiedInfo, params, reader, now);
      if (!cache.setOptIn(lease, false) || !candidate.observe()) { candidate.dispose(); return null; }
      return candidate;
    } catch { cache.setOptIn(lease, false); candidate?.dispose(); return null; }
  }

  /** 等待期只接受单调有限时钟；回拨及到期即时撤销，observe和publish不能续期。 */
  private withinTime(): boolean {
    if (this.phase !== 'waiting') return true;
    const current = this.now?.();
    if (typeof current !== 'number' || !Number.isFinite(current) || this.lastTime === null || this.deadline === null || current < this.lastTime || current >= this.deadline) return false;
    this.lastTime = current; return true;
  }

  /** 父workspace/模型/有效范围订阅同步调用；首次变化即死，A-B-A不能靠最终值相同复活。 */
  observe(): boolean {
    if (this.phase === 'disposed' || !this.origin || !this.reader) return false;
    try {
      const current = this.reader();
      if (!current || typeof current.databaseKnown !== 'boolean' || typeof current.databaseKey !== 'string' || !this.withinTime() || current.formIdentity !== this.origin.formIdentity || !sourceKeys.every(key => current.scope[key] === this.origin!.scope[key]) || this.phase !== 'captured' && current.taskId !== this.taskId) { this.dispose(); return false; }
      // defaultDatabaseIdentity可因同库恢复记账换对象；只比较已知真实库语义，不能忽略已知B后回A。
      if (current.databaseKnown ? current.databaseKey !== this.origin.databaseKey : this.phase !== 'ledger' && this.phase !== 'waiting') { this.dispose(); return false; }
      return true;
    } catch { this.dispose(); return false; }
  }

  /** runQuery首次await前已签发新taskId；父同步绑定后不能移交另一个任务。 */
  bind(taskId: string): boolean {
    try {
      if (this.phase !== 'captured' || typeof taskId !== 'string' || !taskId || !this.origin || taskId === this.origin.taskId || !this.observe() || this.reader?.()?.taskId !== taskId) { this.dispose(); return false; }
      this.taskId = taskId; this.phase = 'bound'; return true;
    } catch { this.dispose(); return false; }
  }

  /** 仅紧邻原prepareExecutionContext写unknown前调用一次，且原owner/任务/已知库必须仍匹配。 */
  beforeLedger(taskId: string): boolean {
    try {
      if (this.phase !== 'bound' || taskId !== this.taskId || !this.observe() || this.reader?.()?.databaseKnown !== true) { this.dispose(); return false; }
      this.phase = 'ledger'; return true;
    } catch { this.dispose(); return false; }
  }

  /** 只接受原SQL明确成功完整终态；失败立即清引用，30秒窗口仅在此首次起算。 */
  settled(taskId: string, succeeded: boolean): boolean {
    try {
      if (succeeded !== true || this.phase !== 'ledger' || taskId !== this.taskId || !this.observe()) { this.dispose(); return false; }
      const current = this.now?.();
      if (typeof current !== 'number' || !Number.isFinite(current) || current < 0 || !Number.isFinite(current + queryParameterReuseCandidateTtlMs)) { this.dispose(); return false; }
      this.lastTime = current; this.deadline = current + queryParameterReuseCandidateTtlMs; this.phase = 'waiting'; return true;
    } catch { this.dispose(); return false; }
  }

  /** 实际缓存状态再次确认为原库后才重新opt-in发布；所有校验均不投递IPC、SQL或持久化。 */
  publish(taskId: string, actualKnownDatabaseKey: string, cache: QueryParameterReuseCache): boolean {
    let writer: QueryParameterReuseLease | null = null, published = false;
    try {
      if (this.phase !== 'waiting' || cache !== this.cache || taskId !== this.taskId || !this.observe() || !this.origin || !this.info || !this.params) return false;
      const current = this.reader?.();
      if (!current?.databaseKnown || current.databaseKey !== actualKnownDatabaseKey || actualKnownDatabaseKey !== this.origin.databaseKey) return false;
      writer = cache.begin(); if (!writer || !this.observe()) return false;
      writer = cache.setOptIn(writer, true); if (!writer || !this.observe()) return false;
      published = cache.remember(writer, this.info, this.params) && this.observe(); return published;
    } catch { return false; }
    finally {
      // 仅撤销自己的writer；订阅重入若创建了新表单/新组，不可用forget清掉新值。
      if (!published && writer) cache.setOptIn(writer, false);
      this.dispose();
    }
  }

  /** 成功/失败/关闭都释放来源、正文、值、reader及clock引用；dispose不删除其它新表单的缓存。 */
  dispose(): void { this.phase = 'disposed'; this.cache = null; this.origin = null; this.info = null; this.params = null; this.reader = null; this.now = null; this.taskId = ''; this.deadline = null; this.lastTime = null; }
}
