import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { realpath } from 'node:fs/promises';
import type { LocalStore } from './storage';
import type { QueryFileEncoding, TaskEvent } from '../shared/contracts';
import type { TaskCancelState } from '../shared/taskCancelState';
import { queryFileSourceOpenSchema, queryFileSourceSaveSchema, queryFileSourceSaveAsSchema, queryFileSourceStatusSchema, queryFileSourceReleaseSchema, queryFileSourceCancelSchema, sameQueryFileSource, type QueryFileSourceRef, type QueryFileSourceOpenInput, type QueryFileSourceOpenResult, type QueryFileSourceSaveInput, type QueryFileSourceSaveAsInput, type QueryFileSourceSaveResult, type QueryFileSourceStatusInput, type QueryFileSourceStatus, type QueryFileSourceReleaseInput, type QueryFileSourceBlocked, type QueryFileSourceCancelInput, type QueryFileSourceProgress } from '../shared/queryFileSources';
import { queryFileSourceView, type PrivateQueryFileSource } from './queryFileSourceRecords';
import { queryRecentFilesSchema, queryRecentFileForgetSchema, type QueryRecentFileView } from '../shared/queryFileSources';
import { queryRecentFileView } from './queryFileRecents';
import { QueryFileSourceFailure, assertQueryFileVersion, encodeBoundQueryFile, decodeSourceSnapshot, queryFileSqlDigest, queryFileBom, queryFileEol, queryFileIsMissing, queryFileTargetAbsent, writeBoundQueryFile, type QueryFileSnapshot } from './queryFileSourceFiles';

import { readReloadableQueryFile as readQueryFileSnapshot, queryFileParent, sameQueryFileParent } from './queryFileReloadFiles';
import { queryFileReloadSchemas, queryFileReloadLimits, queryFileTextDifference, type QueryFileCheckInput, type QueryFileCheckResult, type QueryFileReloadInput, type QueryFileReloadResult, type QueryFileDiscardInput } from '../shared/queryFileReload';
import { queryFileReloadZh as reloadText } from '../shared/queryFileReload.zh-CN';
import { sameQueryFileVersion } from './queryFileSourceFiles';

type SourceStore = Pick<LocalStore, 'queryFileSource' | 'queryFileDocument' | 'queryFileSourceRecords' | 'commitQueryFileSource' | 'releaseQueryFileSource' | 'queryRecentFiles' | 'queryRecentFile' | 'forgetRecentFile'>;
/** scope必须由真实Main IPC文档捕获，不能由renderer或缺省true构造。 */
export interface QueryFileSourceScope { readonly document: object; assertCurrent(): void; }
export interface QueryFileSourceHost {
  store: SourceStore;
  choose(mode: 'open' | 'save', name?: string): Promise<string | undefined>;
  reserve(path: string): Promise<() => void>;
  report(event: TaskEvent): void;
}
interface Active { cancelled: boolean; source?: QueryFileSourceRef; tabId: string; taskId: string; document: object; context?: Context; phase: QueryFileSourceProgress['phase']; done: Promise<void>; finish(): void; }
interface Context { expected?: PrivateQueryFileSource; previousSql: string; connectionId: string; wrote: 'no' | 'yes' | 'unknown'; check(): void; report(phase: QueryFileSourceProgress['phase'], bytes?: number, total?: number): void; }

/** 来源只在Main持久化；每次显式操作重新绑定当前真实文档及原始授权。 */
export class QueryFileSources {
  private readonly reloadPreviews = new Map<string, { id: string; scope: object; token: object; generation: number | undefined; source: QueryFileSourceRef; draft: string; snapshot: Omit<QueryFileSnapshot, 'bytes'>; expires: number }>();
  private readonly active = new Map<string, Active>();
  private readonly runningTasks = new Map<string, Active>();
  constructor(private readonly host: QueryFileSourceHost, private readonly now = Date.now) {}

  /** 导航/崩溃仅撤销当前活动意图，不宽删已保存文档的重启授权。 */
  invalidate(): void { this.reloadPreviews.clear(); for (const state of this.active.values()) state.cancelled = true; }

  /** 固定中文状态不泄漏原始文件错误；文件已写和未写不能混淆。 */
  private failure(error: unknown, wrote: Context['wrote'], readPermission = false): QueryFileSourceBlocked {
    if (error instanceof QueryFileSourceFailure) return { state: 'blocked', reason: error.reason, message: error.message, wrote };
    // 新检查/重载细分读权限错误；既有保存/chmod失败的io合同保持，不能扩大为新的错误类别。
    const permission = readPermission && !!error && typeof error === 'object' && 'code' in error && (error.code === 'EACCES' || error.code === 'EPERM'), missing = queryFileIsMissing(error);
    return { state: 'blocked', reason: wrote !== 'no' ? 'uncertain' : missing ? 'missing' : permission ? 'permission' : 'io', message: wrote !== 'no' ? '文件可能已经写入，后续核对未完成；请核对文件，不要自动重试' : missing ? reloadText.missing : permission ? reloadText.permission : reloadText.io, wrote };
  }
  /** 存储错误与文件IO分开，坏私有记录不允许推断为不存在。 */
  private source(tabId: string): PrivateQueryFileSource | undefined {
    try { return this.host.store.queryFileSource(tabId); }
    catch { throw new QueryFileSourceFailure('storage', '私有文件来源不可读，查询正文保持，未开始文件操作'); }
  }
  /** 关闭或重建的tab是文档失效，不能伪装成文件IO故障。 */
  private document(tabId: string) {
    try { return this.host.store.queryFileDocument(tabId); }
    catch { throw new QueryFileSourceFailure('document-changed', '原查询文档已关闭或身份不唯一，旧操作不再有效'); }
  }
  /** 每个tab只允许一个在途操作，所有await复核原文档、来源及取消状态。 */
  private async run<T extends QueryFileSourceOpenResult | QueryFileSourceSaveResult | QueryFileCheckResult | QueryFileReloadResult>(tabId: string, taskId: string, operation: QueryFileSourceProgress['operation'], ref: QueryFileSourceRef | undefined, requireRef: boolean, scope: QueryFileSourceScope, action: (context: Context) => Promise<T>): Promise<T | QueryFileSourceBlocked> {
    if (this.runningTasks.has(taskId)) throw Error('文件任务编号已在使用，未取消或改变原任务');
    let finish!: () => void; const state: Active = { cancelled: false, source: undefined, tabId, taskId, document: scope.document, phase: 'checking', done: new Promise<void>(resolve => { finish = resolve; }), finish: () => finish() };
    let context: Context | undefined, outcome: T | QueryFileSourceBlocked | undefined, lastProgress = 0;
    const report = (phase: QueryFileSourceProgress['phase'], bytes = 0, total?: number, status: TaskEvent['status'] = 'running', message = '正在处理SQL文件；正文与路径不进入任务概要') => {
      state.phase = phase;
      const starts = { choosing: 0, reading: 5, checking: 80, staging: 45, replacing: 90, verifying: 94, recording: 99, terminal: 100 };
      const span = phase === 'reading' || phase === 'staging' ? 30 : phase === 'checking' ? 5 : phase === 'verifying' ? 4 : 0;
      lastProgress = status === 'completed' ? 100 : Math.max(lastProgress, phase === 'terminal' ? lastProgress : starts[phase] + (total ? span * Math.min(bytes / total, 1) : 0));
      // 进度失败不能把已写文件改称未写；文档/取消检查独立执行。
      try { this.host.report({ taskId, status, progress: Math.floor(lastProgress), message, queryFileSource: { tabId, operation, phase, bytesProcessed: bytes, ...(total === undefined ? {} : { totalBytes: total }), wrote: context?.wrote ?? 'no', cancellable: status === 'running' && !state.cancelled && (context?.wrote ?? 'no') === 'no' && !['replacing', 'verifying', 'recording', 'terminal'].includes(phase) } }); } catch { /* 仅任务投影失败，不改变文件提交事实。 */ }
    };
    try {
      scope.assertCurrent();
      if (this.active.has(tabId)) throw new QueryFileSourceFailure('busy', '此查询的文件操作尚未收尾，请等待');
      const document = this.document(tabId), expected = this.source(tabId);
      if (requireRef && !sameQueryFileSource(expected?.ref, ref)) throw new QueryFileSourceFailure('stale-source', '文件来源已变化，请重新读取来源状态');
      if (expected && expected.connectionId !== document.tab.connectionId) throw new QueryFileSourceFailure('document-changed', '来源不再属于当前查询文档');
      state.source = expected?.ref; this.active.set(tabId, state); this.runningTasks.set(taskId, state);
      context = {
        expected, previousSql: document.tab.sql ?? '', connectionId: document.tab.connectionId, wrote: 'no', report,
        check: () => {
          try { scope.assertCurrent(); } catch { state.cancelled = true; throw new QueryFileSourceFailure('document-changed', '原窗口或文档已失效，未授权后续文件操作'); }
          if (state.cancelled) throw new QueryFileSourceFailure('document-changed', '文件操作已取消，不能继续使用旧授权');
          let current: ReturnType<QueryFileSources['document']>;
          try { current = this.document(tabId); } catch (error) { state.cancelled = true; throw error; }
          if (current.token !== document.token || current.tab.connectionId !== document.tab.connectionId || !sameQueryFileSource(this.source(tabId)?.ref, context!.expected?.ref)) { state.cancelled = true; throw new QueryFileSourceFailure('document-changed', '查询或文件来源已变化，旧操作不再有效'); }
        }
      };
      state.context = context; context.check(); report(operation === 'save' ? 'reading' : 'choosing'); context.check(); outcome = await action(context); context.check(); return outcome;
    } catch (error) { outcome = this.failure(error, context?.wrote ?? 'no', operation === 'check' || operation === 'reload'); return outcome; }
    finally {
      if (this.active.get(tabId) === state) this.active.delete(tabId);
      if (this.runningTasks.get(taskId) === state) this.runningTasks.delete(taskId);
      const status = outcome?.state === 'saved' || outcome?.state === 'opened' || outcome?.state === 'preview' || outcome?.state === 'reloaded' ? 'completed' : outcome?.state === 'cancelled' || state.cancelled && (context?.wrote ?? 'no') === 'no' ? 'cancelled' : 'failed';
      report('terminal', 0, undefined, status, outcome?.state === 'blocked' ? outcome.message : status === 'completed' ? 'SQL文件任务已完成；正文与路径未写入任务概要' : 'SQL文件任务已取消，原输入保持'); state.finish();
    }
  }
  /** 本地来源提交与文件写入分阶段；文件已写时配置失败必须明确报告，不能自动重放。 */
  private commit(tabId: string, context: Context, snapshot: QueryFileSnapshot, encoding: QueryFileEncoding, sql: string, opened: boolean, adoptSql = opened): PrivateQueryFileSource {
    context.check(); context.report('recording'); context.check();
    if (opened && (this.document(tabId).tab.sql ?? '') !== context.previousSql) throw new QueryFileSourceFailure('document-changed', '读取期间查询正文已编辑，保留当前输入');
    const decoded = decodeSourceSnapshot(snapshot, encoding), previous = context.expected;
    const revision = previous ? previous.ref.revision + 1 : 1;
    if (!Number.isSafeInteger(revision)) throw new QueryFileSourceFailure('storage', '文件来源修订已耗尽，请明确解除关联后重试');
    const source: PrivateQueryFileSource = { version: 1, tabId, connectionId: context.connectionId, ref: { id: previous?.ref.id ?? randomUUID(), revision }, path: snapshot.path, ...(snapshot.parent ? { parent: snapshot.parent } : previous?.parent && previous.path === snapshot.path ? { parent: previous.parent } : {}), identity: snapshot.identity, fileDigest: snapshot.digest, savedSqlDigest: queryFileSqlDigest(sql), encoding: decoded.encoding, bom: queryFileBom(snapshot.bytes), eol: queryFileEol(decoded.sql) };
    try { this.host.store.commitQueryFileSource(source, previous?.ref, opened ? { previousSql: context.previousSql, ...(adoptSql ? { sql } : {}) } : undefined); }
    catch { throw new QueryFileSourceFailure('storage', context.wrote === 'no' ? '来源记录未保存，查询正文保持' : '文件已写入，但本地来源记录未保存；请核对文件并重新读取，不能自动重试'); }
    context.expected = source; return source;
  }
  /** 明确打开或重读才访问文件，读取期间的新输入阻止旧文件内容接管文档。 */
  async open(raw: QueryFileSourceOpenInput, scope: QueryFileSourceScope): Promise<QueryFileSourceOpenResult> {
    const input = queryFileSourceOpenSchema.parse(raw);
    return this.run(input.tabId, input.taskId, 'open', input.source, !!input.source, scope, async context => {
      context.report('choosing'); context.check();
      const recent = input.recentId ? this.host.store.queryRecentFile(input.recentId) : undefined;
      if (input.recentId && !recent) throw new QueryFileSourceFailure('missing', '最近文件记录已移除，请重新选择SQL文件；原查询输入保持');
      const chosen = input.source ? context.expected?.path : recent ? recent.path : await this.host.choose('open'); context.check();
      if (chosen && !isAbsolute(chosen)) throw new QueryFileSourceFailure('io', '原生文件选择没有返回绝对目标');
      const path = chosen && !input.source ? await realpath(chosen) : chosen; context.check();
      if (!path) return { state: 'cancelled' };
      if (!isAbsolute(path)) throw new QueryFileSourceFailure('io', '原生文件选择没有返回绝对目标');
      const snapshot = await readQueryFileSnapshot(path, context.check, context.report); context.check();
      if ((this.document(input.tabId).tab.sql ?? '') !== context.previousSql) throw new QueryFileSourceFailure('document-changed', '打开期间查询正文已编辑，保留当前输入');
      // 重读只推进原标签的文件基线；返回正文供UI新草稿使用，不能先改写原标签SQL。
      const decoded = decodeSourceSnapshot(snapshot, input.encoding), source = this.commit(input.tabId, context, snapshot, decoded.encoding, decoded.sql, true, !input.source);
      return { state: 'opened', binding: queryFileSourceView(source), sql: decoded.sql };
    });
  }
  /** 用户打开最近列表时只投影Main元数据，不探测文件存在、不读取正文或建立连接。 */
  recent(raw: { tabId: string }, scope: QueryFileSourceScope): QueryRecentFileView[] {
    const input = queryRecentFilesSchema.parse(raw); scope.assertCurrent(); this.document(input.tabId);
    const result = this.host.store.queryRecentFiles().map(queryRecentFileView); scope.assertCurrent(); return result;
  }
  /** 明确移除只改变有界历史；当前来源和磁盘文件保持。 */
  forgetRecent(raw: { tabId: string; recentId: string }, scope: QueryFileSourceScope): { removed: boolean } {
    const input = queryRecentFileForgetSchema.parse(raw); scope.assertCurrent(); this.document(input.tabId);
    const removed = this.host.store.forgetRecentFile(input.recentId); scope.assertCurrent(); return { removed };
  }
  /** 关联保存只持有原授权路径，保存快照与当前编辑正文各自独立。 */
  async save(raw: QueryFileSourceSaveInput, scope: QueryFileSourceScope): Promise<QueryFileSourceSaveResult> {
    const input = queryFileSourceSaveSchema.parse(raw);
    return this.run(input.tabId, input.taskId, 'save', input.source, true, scope, async context => {
      const source = context.expected; if (!source) throw new QueryFileSourceFailure('not-bound', '此查询尚未关联SQL文件');
      const release = await this.host.reserve(source.path);
      try {
        context.check(); const snapshot = await readQueryFileSnapshot(source.path, context.check, context.report); context.check(); assertQueryFileVersion(snapshot, source);
        if (queryFileSqlDigest(input.sql) === source.savedSqlDigest && (input.eol ?? 'preserve') === 'preserve') return { state: 'saved', binding: queryFileSourceView(source), savedSqlDigest: source.savedSqlDigest, unchanged: true };
        const bytes = encodeBoundQueryFile(input.sql, source.encoding, source.bom, source.eol, input.eol ?? 'preserve');
        const written = await writeBoundQueryFile(source.path, bytes, snapshot, context.check, state => { context.wrote = state; }, context.report); context.check();
        if (!sameQueryFileParent(snapshot.parent, await queryFileParent(source.path, context.check))) throw new QueryFileSourceFailure('identity-changed', reloadText.identity); written.parent = snapshot.parent;
        const next = this.commit(input.tabId, context, written, source.encoding, input.sql, false);
        return { state: 'saved', binding: queryFileSourceView(next), savedSqlDigest: next.savedSqlDigest, unchanged: false };
      } finally { release(); }
    });
  }
  /** 另存先取原生授权，目标属于其他已关联tab时拒绝覆盖，所有权在收尾后精确释放。 */
  async saveAs(raw: QueryFileSourceSaveAsInput, scope: QueryFileSourceScope): Promise<QueryFileSourceSaveResult> {
    const input = queryFileSourceSaveAsSchema.parse(raw);
    return this.run(input.tabId, input.taskId, 'saveAs', input.source, true, scope, async context => {
      context.report('choosing'); context.check();
      const selected = await this.host.choose('save', context.expected ? basename(context.expected.path) : undefined); context.check();
      if (!selected) return { state: 'cancelled' };
      if (!isAbsolute(selected)) throw new QueryFileSourceFailure('io', '原生文件选择没有返回绝对目标');
      const parent = await realpath(dirname(selected)); context.check(); const path = join(parent, basename(selected));
      const release = await this.host.reserve(path);
      try {
        context.check();
        const samePath = (other: string) => process.platform === 'win32' ? other.toLowerCase() === path.toLowerCase() : other === path;
        let sources: PrivateQueryFileSource[];
        try { sources = this.host.store.queryFileSourceRecords(); } catch { throw new QueryFileSourceFailure('storage', '来源目录不完整，未写入另存文件'); }
        if (sources.some(source => source.tabId !== input.tabId && samePath(source.path))) throw new QueryFileSourceFailure('external-change', '目标已关联到另一个查询，请选择其他文件');
        const absent = await queryFileTargetAbsent(path, context.check); context.check();
        const expected = absent ? undefined : await readQueryFileSnapshot(path, context.check, context.report); context.check();
        if (context.expected && samePath(context.expected.path)) {
          if (!expected) throw new QueryFileSourceFailure('missing', '原关联文件已删除，请选择不同文件另存');
          assertQueryFileVersion(expected, context.expected);
        }
        const previousEol = context.expected?.eol ?? queryFileEol(input.sql);
        const bytes = encodeBoundQueryFile(input.sql, input.encoding, input.bom, previousEol, input.eol);
        const parent = await queryFileParent(path, context.check); context.check();
        const written = await writeBoundQueryFile(path, bytes, expected, context.check, state => { context.wrote = state; }, context.report); context.check();
        if (!sameQueryFileParent(parent, await queryFileParent(path, context.check))) throw new QueryFileSourceFailure('identity-changed', reloadText.identity); written.parent = parent;
        const next = this.commit(input.tabId, context, written, input.encoding, input.sql, false);
        return { state: 'saved', binding: queryFileSourceView(next), savedSqlDigest: next.savedSqlDigest, unchanged: false };
      } finally { release(); }
    });
  }
  /** 状态不读取/探测外部文件，重启授权只从私有表重新绑定当前文档。 */
  async checkExternal(raw: QueryFileCheckInput, scope: QueryFileSourceScope): Promise<QueryFileCheckResult> {
    const input = queryFileReloadSchemas['queryFileSources.checkExternal'].parse(raw);
    return this.run(input.tabId, input.taskId, 'check', input.source, true, scope, async context => {
      const source = context.expected, document = this.document(input.tabId);
      if (!source) throw new QueryFileSourceFailure('not-bound', reloadText.changed);
      if (!source.parent) throw new QueryFileSourceFailure('identity-changed', reloadText.legacy);
      const check = () => { context.check(); const current = this.document(input.tabId); if (current.token !== document.token || current.generation !== document.generation || (current.tab.sql ?? '') !== context.previousSql) throw new QueryFileSourceFailure('document-changed', reloadText.changed); };
      check(); if (queryFileSqlDigest(context.previousSql) !== input.draftDigest) throw new QueryFileSourceFailure('document-changed', reloadText.changed);
      this.reloadPreviews.delete(input.tabId);
      const snapshot = await readQueryFileSnapshot(source.path, check, context.report); check();
      if (!sameQueryFileParent(source.parent, snapshot.parent) || snapshot.identity.dev !== source.identity.dev) throw new QueryFileSourceFailure('identity-changed', reloadText.identity);
      const decoded = decodeSourceSnapshot(snapshot, source.encoding), { bytes: _bytes, ...version } = snapshot;
      for (const [id, value] of this.reloadPreviews) if (value.expires <= this.now()) this.reloadPreviews.delete(id);
      if (this.reloadPreviews.size >= queryFileReloadLimits.previews) throw new QueryFileSourceFailure('busy', reloadText.expired);
      const id = randomUUID(), expires = this.now() + queryFileReloadLimits.lifetime;
      this.reloadPreviews.set(input.tabId, { id, scope: scope.document, token: document.token, generation: document.generation, source: { ...source.ref }, draft: input.draftDigest, snapshot: version, expires });
      const binding = { ...queryFileSourceView(source), encoding: decoded.encoding, bom: queryFileBom(snapshot.bytes), eol: queryFileEol(decoded.sql), savedSqlDigest: queryFileSqlDigest(decoded.sql) };
      const change = snapshot.identity.ino !== source.identity.ino ? 'replaced' : snapshot.digest !== source.fileDigest || !sameQueryFileVersion(snapshot.identity, source.identity) ? 'modified' : 'same';
      return { state: 'preview', previewId: id, expiresAt: expires, change, dirty: input.draftDigest !== source.savedSqlDigest, binding, difference: queryFileTextDifference(context.previousSql, decoded.sql) };
    });
  }
  /** 只消费Main原版本；确认前重新读原授权路径，任何漂移失败都不推进来源或SQL。 */
  async reload(raw: QueryFileReloadInput, scope: QueryFileSourceScope): Promise<QueryFileReloadResult> {
    const input = queryFileReloadSchemas['queryFileSources.reload'].parse(raw), candidate = this.reloadPreviews.get(input.tabId);
    const preview = candidate?.scope === scope.document && candidate.id === input.previewId && sameQueryFileSource(candidate.source, input.source) ? candidate : undefined;
    if (preview) this.reloadPreviews.delete(input.tabId);
    return this.run(input.tabId, input.taskId, 'reload', input.source, true, scope, async context => {
      const document = this.document(input.tabId);
      const check = () => {
        context.check(); const current = this.document(input.tabId);
        if (!preview || preview.id !== input.previewId || preview.scope !== scope.document || preview.expires <= this.now() || preview.token !== current.token || preview.generation !== current.generation || preview.draft !== input.draftDigest || !sameQueryFileSource(preview.source, input.source) || (current.tab.sql ?? '') !== context.previousSql || current.token !== document.token) throw new QueryFileSourceFailure('document-changed', reloadText.expired);
      };
      check(); if (queryFileSqlDigest(context.previousSql) !== input.draftDigest) throw new QueryFileSourceFailure('document-changed', reloadText.changed);
      const source = context.expected; if (!source?.parent) throw new QueryFileSourceFailure('identity-changed', reloadText.legacy);
      const snapshot = await readQueryFileSnapshot(source.path, check, context.report); check();
      if (!sameQueryFileParent(source.parent, snapshot.parent) || !sameQueryFileParent(preview!.snapshot.parent!, snapshot.parent) || snapshot.digest !== preview!.snapshot.digest || !sameQueryFileVersion(snapshot.identity, preview!.snapshot.identity)) throw new QueryFileSourceFailure('external-change', reloadText.expired);
      const decoded = decodeSourceSnapshot(snapshot, source.encoding); check();
      // 回包可能丢失、模型可能失效；Main只推进来源基线，renderer接纳之前保留用户唯一持久草稿。
      const next = this.commit(input.tabId, context, snapshot, decoded.encoding, decoded.sql, true, false);
      return { state: 'reloaded', sql: decoded.sql, binding: queryFileSourceView(next) };
    });
  }
  /** 放弃只删除同文档、同来源、同令牌的预览，不释放持久化路径授权。 */
  discardReload(raw: QueryFileDiscardInput, scope: QueryFileSourceScope): { discarded: boolean } {
    const input = queryFileReloadSchemas['queryFileSources.discardReload'].parse(raw); scope.assertCurrent(); const preview = this.reloadPreviews.get(input.tabId);
    if (!preview || preview.id !== input.previewId || preview.scope !== scope.document || !sameQueryFileSource(preview.source, input.source)) return { discarded: false };
    this.reloadPreviews.delete(input.tabId); return { discarded: true };
  }
  /** 状态本身仍不读取外部文件。 */
  status(raw: QueryFileSourceStatusInput, scope: QueryFileSourceScope): QueryFileSourceStatus {
    const input = queryFileSourceStatusSchema.parse(raw);
    try {
      scope.assertCurrent(); const document = this.document(input.tabId), source = this.source(input.tabId);
      if (!source) return { state: 'unbound' };
      if (source.connectionId !== document.tab.connectionId || input.source && !sameQueryFileSource(source.ref, input.source)) throw new QueryFileSourceFailure('stale-source', '文件来源已变化，请重新获取状态');
      return { state: 'bound', binding: queryFileSourceView(source) };
    } catch (error) { return this.failure(error, 'no'); }
  }
  /** 仅取消同一原文档的精确任务，替换提交点之后不承诺可撤销；等待物理资源收尾。 */
  async cancel(raw: QueryFileSourceCancelInput, scope: QueryFileSourceScope): Promise<{ cancelled: boolean }> {
    const input = queryFileSourceCancelSchema.parse(raw); scope.assertCurrent();
    const active = this.runningTasks.get(input.taskId);
    if (!active || active.tabId !== input.tabId || active.document !== scope.document || !active.context || active.context.wrote !== 'no' || ['replacing', 'verifying', 'recording', 'terminal'].includes(active.phase)) return { cancelled: false };
    active.cancelled = true; await active.done; scope.assertCurrent(); return { cancelled: true };
  }
  /** 既有任务中心通过已登记的本地任务映射取消，不伪造数据库连接或转发broker。 */
  async cancelTask(taskId: string, scope: QueryFileSourceScope): Promise<{ cancelled: boolean }> {
    scope.assertCurrent(); const active = this.runningTasks.get(taskId);
    return active ? this.cancel({ taskId, tabId: active.tabId }, scope) : { cancelled: false };
  }
  /** 取消权限只来自当前活动对象，提交点之后任务中心显示确认中而非可取消。 */
  cancelState(taskId: string): TaskCancelState {
    const active = this.runningTasks.get(taskId);
    return !active ? 'finished' : active.cancelled ? 'checking' : active.context?.wrote !== 'no' || ['replacing', 'verifying', 'recording', 'terminal'].includes(active.phase) ? 'confirming' : 'allowed';
  }
  /** 释放等待本tab原操作结算，随后只删除仍精确匹配的旧引用；不会宽删新来源。 */
  async release(raw: QueryFileSourceReleaseInput, scope: QueryFileSourceScope): Promise<{ released: boolean }> {
    const input = queryFileSourceReleaseSchema.parse(raw); scope.assertCurrent();
    const current = this.source(input.tabId); if (!current || !sameQueryFileSource(current.ref, input.source)) return { released: false };
    this.reloadPreviews.delete(input.tabId);
    const active = this.active.get(input.tabId);
    if (active && sameQueryFileSource(active.source, input.source)) { active.cancelled = true; await active.done; scope.assertCurrent(); }
    try { return { released: this.host.store.releaseQueryFileSource(input.tabId, input.source) }; }
    catch { throw Error('文件来源释放记录未保存，请重新读取状态；未删除其他来源'); }
  }
}
