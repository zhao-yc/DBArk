import { useEffect, useRef, useState } from 'react';
import type { QueryFileEncoding } from '../shared/contracts';
import type { QueryFileBom, QueryFileEolPolicy, QueryFileSourceBlocked, QueryFileSourceView } from '../shared/queryFileSources';
import { queryFileSourceHasChanges, sameQueryFileSource } from '../shared/queryFileSources';
import { QueryFileTaskOperation, type QueryFileTaskState } from './queryFileTasks';
import { acquireWorkspaceBusy, flushSettings, useWorkspace, type WorkspaceTab } from './store';
import { invoke, uid } from './lib';
import { QuerySourceLease, querySourceTab } from './querySourceLease';
import { queryFilesZh as text } from './locales/queryFiles.zh-CN';
import type { QueryCloseRequest } from './queryCloseIntent';

export interface QueryFileOptions { encoding: QueryFileEncoding; bom: QueryFileBom; eol: QueryFileEolPolicy; }
export interface QueryFileSaveReceipt { saved: boolean; restored: boolean; applied: boolean; busyUnchanged: boolean; }
const unsuccessful: QueryFileSaveReceipt = { saved: false, restored: false, applied: false, busyUnchanged: false };
export { queryFileSourceSqlDigest as queryFileSqlDigest } from '../shared/queryFileSources';

/** 文件来源仅使用不透明引用；status不读外部文件，重读与写入均须用户显式触发。 */
export function useQueryFileSource(tab: WorkspaceTab, capture: () => Readonly<WorkspaceTab>, ownsView: () => boolean, publishBusy: (value: boolean) => void) {
  const [view, setView] = useState<QueryFileSourceView>();
  const [problem, setProblem] = useState<QueryFileSourceBlocked>();
  const [busy, setBusy] = useState(false), active = useRef(false);
  const [checked, setChecked] = useState<{ sql: string; baseline: string; dirty: boolean }>();
  const [task, setTask] = useState<QueryFileTaskState>();
  const operations = useRef(new Set<QueryFileTaskOperation>());
  const current = () => useWorkspace.getState().settings.tabs.find(item => item.id === tab.id);
  const source = tab.fileSourceBinding;
  const metadata = view && sameQueryFileSource(view.ref, source) ? view : undefined;
  const dirty = !!source && (!metadata || checked?.sql !== (tab.sql ?? '') || checked.baseline !== metadata.savedSqlDigest || checked.dirty);
  /** 文档卸载只取消自己发出的精确任务，不能释放新来源或清除新编辑。 */
  useEffect(() => () => { for (const owner of operations.current) { owner.documentCurrent(); void owner.cancel(true); } }, []);
  /** 每次调用新建UUID并先订阅，再向Main发送任务；任务中心只看到无路径/SQL的结构化进度。 */
  function beginTask(snapshot: Readonly<WorkspaceTab>, operation: QueryFileTaskState['operation']) {
    const taskId = uid(), owner = new QueryFileTaskOperation(snapshot, taskId, operation, {
      read: () => useWorkspace.getState().settings.tabs.find(item => item.id === snapshot.id), ownsView,
      subscribeDocument: changed => useWorkspace.subscribe(changed), subscribeTask: changed => window.dbark?.onTask(changed) ?? (() => {}),
      cancel: input => invoke('queryFileSources.cancel', input),
      publish: value => { useWorkspace.getState().setQueryFileTask(value); if (ownsView()) setTask(value); }
    });
    operations.current.add(owner);
    return { taskId, owner, finish(result: Parameters<QueryFileTaskOperation['finish']>[0]) { const wrote = owner.finish(result); operations.current.delete(owner); return wrote; } };
  }

  useEffect(() => {
    let alive = true;
    if (!source) { setView(undefined); return; }
    void invoke('queryFileSources.status', { tabId: tab.id, source }).then(result => {
      if (!alive || !ownsView() || !sameQueryFileSource(current()?.fileSourceBinding, source)) return;
      if (result.state === 'bound' && sameQueryFileSource(result.binding.ref, source)) setView(result.binding);
      else { setView(undefined); if (result.state === 'blocked') setProblem(result); }
    }).catch(() => { if (alive && ownsView()) setView(undefined); });
    return () => { alive = false; };
  }, [tab.id, source?.id, source?.revision]);
  useEffect(() => {
    let alive = true;
    if (!metadata) { setChecked(undefined); return; }
    const sql = tab.sql ?? '', timer = setTimeout(() => { void queryFileSourceHasChanges(sql, metadata).then(dirty => { if (alive) setChecked({ sql, baseline: metadata.savedSqlDigest, dirty }); }).catch(() => { if (alive) setChecked(undefined); }); }, 100);
    return () => { alive = false; clearTimeout(timer); };
  }, [tab.sql, source?.id, source?.revision, metadata?.savedSqlDigest]);
  useEffect(() => { useWorkspace.getState().setQueryFileDirty(tab.id, dirty, tab); }, [tab.id, tab.sql, source?.id, source?.revision, dirty]);

  /** 来源更新只合并当前标签，永不将点击快照的旧sql写回工作区。 */
  function applyBinding(lease: QuerySourceLease, binding: QueryFileSourceView, request?: QueryCloseRequest, closeCurrent?: () => boolean, adoptCloseTitle?: (title: string) => void): boolean {
    return lease.apply((before, adoptTitle) => {
      const workspace = useWorkspace.getState(), patch = { fileSourceBinding: binding.ref, ...(adoptTitle ? { title: binding.name } : {}) };
      const update = () => workspace.updateSettings({ tabs: workspace.settings.tabs.map(item => item.id === tab.id ? querySourceTab(item, patch, 'file') : item) });
      if (closeCurrent?.()) {
        adoptCloseTitle?.(adoptTitle ? binding.name : before.title);
        if (request?.mutate && !before.sourceBinding) request.mutate(before, patch, update); else update();
      } else update();
      setView(binding);
    });
  }
  /** IPC拒绝不等同于未写；结果不确定时只给恢复选择，不重发写入。 */
  function uncertain(_reason: unknown) { setProblem({ state: 'blocked', reason: 'uncertain', message: text.uncertain, wrote: 'unknown' }); }

  /** 保存固定快照；写入后新SQL仍dirty，标题或来源的新世代不会被旧回包覆盖。 */
  async function save(options?: QueryFileOptions, request?: QueryCloseRequest, closeCurrent?: () => boolean, adoptCloseTitle?: (title: string) => void): Promise<QueryFileSaveReceipt> {
    if (active.current || !ownsView()) return unsuccessful;
    let lease: QuerySourceLease | undefined, job: ReturnType<typeof acquireWorkspaceBusy> | undefined, sent = false, work: ReturnType<typeof beginTask> | undefined;
    active.current = true; setBusy(true); setProblem(undefined);
    try {
      const snapshot = capture();
      if (!options && !snapshot.fileSourceBinding) throw Error(text.unbound);
      lease = new QuerySourceLease(snapshot, current, changed => useWorkspace.subscribe(changed), ownsView);
      job = acquireWorkspaceBusy(tab.id);
      publishBusy(true);
      await flushSettings();
      if (!lease.current() || !job.owns()) throw Error(text.changed);
      work = beginTask(snapshot, options ? 'saveAs' : 'save');
      sent = true;
      const result = options ? await invoke('queryFileSources.saveAs', { tabId: tab.id, taskId: work.taskId, ...(snapshot.fileSourceBinding ? { source: snapshot.fileSourceBinding } : {}), sql: snapshot.sql ?? '', ...options })
        : await invoke('queryFileSources.save', { tabId: tab.id, taskId: work.taskId, source: snapshot.fileSourceBinding!, sql: snapshot.sql ?? '' });
      const wrote = work.finish(result);
      if (result.state === 'blocked') { if (ownsView()) setProblem(result); request?.failed?.(); return unsuccessful; }
      if (result.state === 'cancelled') { if (ownsView() && wrote !== 'no') setProblem({ state: 'blocked', reason: 'uncertain', message: wrote === 'yes' ? text.wroteYes : text.wroteUnknown, wrote }); return unsuccessful; }
      const applied = work.owner.documentCurrent() && applyBinding(lease, result.binding, request, closeCurrent, adoptCloseTitle);
      let restored = false;
      if (applied) {
        // 回包摘要描述所存快照；不能用当前正文重新生成基线来清除新编辑。
        try { await flushSettings(); restored = true; } catch { setProblem({ state: 'blocked', reason: 'storage', message: text.restoreFailed, wrote: 'yes' }); }
      }
      if (ownsView()) useWorkspace.getState().notify(applied && restored ? text.saved.replace('{0}', result.binding.name) : text.retained, !applied || !restored);
      return { saved: true, applied, restored, busyUnchanged: job.owns() };
    } catch (reason) { work?.finish({ state: 'blocked', message: text.uncertain, wrote: 'unknown' }); if (ownsView()) { if (sent) uncertain(reason); else setProblem({ state: 'blocked', reason: 'document-changed', message: text.unavailable, wrote: 'no' }); } request?.failed?.(); return unsuccessful; }
    finally {
      // 只有本操作实际持有的共享占用才能释放；获取失败不能清掉正在执行的查询或后来接替的作业。
      lease?.dispose(); const released = job?.release(); active.current = false;
      if (ownsView()) { setBusy(false); if (released && !useWorkspace.getState().activeJobs[tab.id]) publishBusy(false); }
    }
  }

  /** 打开前注册独立空文档且保存身份；失败只移除未改动的占位文档，不动原查询。 */
  async function open(encoding: QueryFileEncoding, recentId?: string): Promise<boolean> {
    if (active.current || !ownsView()) return false;
    active.current = true; setBusy(true); setProblem(undefined);
    const original = current();
    if (!original) { active.current = false; setBusy(false); return false; }
    const target: WorkspaceTab = { id: uid(), kind: 'query', connectionId: original.connectionId, title: text.opening, sql: '', ...(original.database === undefined ? {} : { database: original.database }), ...(original.databaseContext === undefined ? {} : { databaseContext: original.databaseContext }) };
    let originalJob: ReturnType<typeof acquireWorkspaceBusy> | undefined, targetJob: ReturnType<typeof acquireWorkspaceBusy> | undefined, opened = false, work: ReturnType<typeof beginTask> | undefined;
    try {
      capture();
      originalJob = acquireWorkspaceBusy(tab.id);
      publishBusy(true);
      const latest = useWorkspace.getState(); latest.updateSettings({ tabs: [...latest.settings.tabs, target] }); targetJob = acquireWorkspaceBusy(target.id);
      await flushSettings();
      if (!originalJob.owns() || !targetJob.owns()) throw Error(text.changed);
      work = beginTask({ ...target }, 'open');
      const result = await invoke('queryFileSources.open', { tabId: target.id, taskId: work.taskId, encoding, ...(recentId ? { recentId } : {}) }); work.finish(result);
      if (result.state === 'blocked') { if (ownsView()) setProblem(result); return false; }
      if (result.state === 'cancelled' || !work.owner.documentCurrent()) return false;
      const state = useWorkspace.getState(), existing = state.settings.tabs.find(item => item.id === target.id);
      if (!originalJob.owns() || !targetJob.owns() || !existing || existing.kind !== 'query' || existing.connectionId !== target.connectionId || existing.fileSourceBinding || existing.sourceBinding) return false;
      state.updateSettings({ tabs: state.settings.tabs.map(item => item.id === target.id ? { ...item, ...(item.title === target.title ? { title: result.binding.name } : {}), ...(item.sql === '' ? { sql: result.sql } : {}), fileSourceBinding: result.binding.ref } : item), activeTabId: target.id });
      opened = true; await flushSettings(); return true;
    } catch (reason) { work?.finish({ state: 'blocked', message: text.uncertain, wrote: 'unknown' }); if (ownsView()) uncertain(reason); return false; }
    finally {
      const state = useWorkspace.getState(), remove = !opened && targetJob?.owns() && state.settings.tabs.find(item => item.id === target.id) === target;
      targetJob?.release(); const released = originalJob?.release(); if (remove) state.closeTab(target.id);
      active.current = false; if (ownsView()) { setBusy(false); if (released && !useWorkspace.getState().activeJobs[tab.id]) publishBusy(false); }
    }
  }

  /** 显式重读先核对Main当前私有来源；结果作为未关联新草稿展示，原标签只推进来源基线并保留全部正文。 */
  async function reread(): Promise<boolean> {
    if (active.current || !ownsView()) return false;
    const before = current(); if (!before?.fileSourceBinding) return false;
    active.current = true; setBusy(true);
    let lease: QuerySourceLease | undefined;
    let job: ReturnType<typeof acquireWorkspaceBusy> | undefined, work: ReturnType<typeof beginTask> | undefined;
    try {
      const snapshot = capture(); lease = new QuerySourceLease(snapshot, current, changed => useWorkspace.subscribe(changed), ownsView);
      job = acquireWorkspaceBusy(tab.id); publishBusy(true); await flushSettings();
      const status = await invoke('queryFileSources.status', { tabId: tab.id });
      if (!lease.current() || !job.owns()) throw Error(text.changed);
      if (status.state !== 'bound') { if (status.state === 'blocked') setProblem(status); else setProblem({ state: 'blocked', reason: 'not-bound', message: text.unbound, wrote: 'no' }); return false; }
      work = beginTask(snapshot, 'open');
      const result = await invoke('queryFileSources.open', { tabId: tab.id, taskId: work.taskId, source: status.binding.ref, encoding: status.binding.encoding }); work.finish(result);
      if (result.state === 'blocked') { if (ownsView()) setProblem(result); return false; }
      if (result.state === 'cancelled' || !work.owner.documentCurrent() || !lease.current()) return false;
      const applied = lease.apply(() => {
        const state = useWorkspace.getState(); state.updateTab(tab.id, { fileSourceBinding: result.binding.ref }); setView(result.binding);
        state.openTab({ kind: 'query', connectionId: before.connectionId, ...(before.database === undefined ? {} : { database: before.database }), ...(before.databaseContext === undefined ? {} : { databaseContext: before.databaseContext }), title: (result.binding.name + text.rereadSuffix).slice(0, 256), sql: result.sql });
      });
      if (applied) { await flushSettings(); setProblem(undefined); }
      return applied;
    } catch (reason) { work?.finish({ state: 'blocked', message: text.uncertain, wrote: 'unknown' }); if (ownsView()) uncertain(reason); return false; }
    finally { lease?.dispose(); const released = job?.release(); active.current = false; if (ownsView()) { setBusy(false); if (released && !useWorkspace.getState().activeJobs[tab.id]) publishBusy(false); } }
  }
  /** 列表与移除只走Main的元数据接口，路径留在展示状态，不写入settings或localStorage。 */
  async function recent() { await flushSettings(); if (!ownsView() || !current()) throw Error(text.changed); return invoke('queryFileSources.recent', { tabId: tab.id }); }
  /** 明确移除历史不释放当前文件来源，不读取或删除实际文件。 */
  async function forgetRecent(recentId: string) { await flushSettings(); if (!ownsView() || !current()) throw Error(text.changed); return invoke('queryFileSources.forgetRecent', { tabId: tab.id, recentId }); }
  return { view: metadata, dirty, busy, task, problem, save, open, recent, forgetRecent, reread, dismiss: () => setProblem(undefined), isBusy: () => active.current };
}
export type QueryFileSourceController = ReturnType<typeof useQueryFileSource>;
