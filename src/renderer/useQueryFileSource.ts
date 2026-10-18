import { useEffect, useRef, useState } from 'react';
import type { QueryFileEncoding } from '../shared/contracts';
import type { QueryFileBom, QueryFileEolPolicy, QueryFileSourceBlocked, QueryFileSourceView } from '../shared/queryFileSources';
import { sameQueryFileSource } from '../shared/queryFileSources';
import { acquireWorkspaceBusy, flushSettings, useWorkspace, type WorkspaceTab } from './store';
import { invoke, uid } from './lib';
import { QuerySourceLease, querySourceTab } from './querySourceLease';
import { queryFilesZh as text } from './locales/queryFiles.zh-CN';
import type { QueryCloseRequest } from './queryCloseIntent';

export interface QueryFileOptions { encoding: QueryFileEncoding; bom: QueryFileBom; eol: QueryFileEolPolicy; }
export interface QueryFileSaveReceipt { saved: boolean; restored: boolean; applied: boolean; busyUnchanged: boolean; }
const unsuccessful: QueryFileSaveReceipt = { saved: false, restored: false, applied: false, busyUnchanged: false };
/** 摘要使用原始JS正文的UTF-8，与Main保存基线一致；失败时维持未知/dirty，不能假报已保存。 */
export async function queryFileSqlDigest(sql: string): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(sql));
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}

/** 文件来源仅使用不透明引用；status不读外部文件，重读与写入均须用户显式触发。 */
export function useQueryFileSource(tab: WorkspaceTab, capture: () => Readonly<WorkspaceTab>, ownsView: () => boolean, publishBusy: (value: boolean) => void) {
  const [view, setView] = useState<QueryFileSourceView>();
  const [problem, setProblem] = useState<QueryFileSourceBlocked>();
  const [busy, setBusy] = useState(false), active = useRef(false);
  /** 同步共享QueryTab原busy门，文件等待期间原执行和事务入口仍保持互斥。 */
  const operationBusy = (value: boolean) => { setBusy(value); publishBusy(value); };
  const [digest, setDigest] = useState<{ sql: string; value: string }>();
  const current = () => useWorkspace.getState().settings.tabs.find(item => item.id === tab.id);
  const source = tab.fileSourceBinding;
  const metadata = view && sameQueryFileSource(view.ref, source) ? view : undefined;
  const dirty = !!source && (!metadata || digest?.sql !== (tab.sql ?? '') || digest.value !== metadata.savedSqlDigest);

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
    if (!source) { setDigest(undefined); return; }
    const sql = tab.sql ?? '', timer = setTimeout(() => { void queryFileSqlDigest(sql).then(value => { if (alive) setDigest({ sql, value }); }).catch(() => { if (alive) setDigest(undefined); }); }, 100);
    return () => { alive = false; clearTimeout(timer); };
  }, [tab.sql, source?.id, source?.revision]);
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
    let lease: QuerySourceLease | undefined, job: ReturnType<typeof acquireWorkspaceBusy> | undefined, sent = false;
    active.current = true; operationBusy(true); setProblem(undefined);
    try {
      const snapshot = capture();
      if (!options && !snapshot.fileSourceBinding) throw Error(text.unbound);
      lease = new QuerySourceLease(snapshot, current, changed => useWorkspace.subscribe(changed), ownsView);
      job = acquireWorkspaceBusy(tab.id);
      await flushSettings();
      if (!lease.current() || !job.owns()) throw Error(text.changed);
      sent = true;
      const result = options ? await invoke('queryFileSources.saveAs', { tabId: tab.id, ...(snapshot.fileSourceBinding ? { source: snapshot.fileSourceBinding } : {}), sql: snapshot.sql ?? '', ...options })
        : await invoke('queryFileSources.save', { tabId: tab.id, source: snapshot.fileSourceBinding!, sql: snapshot.sql ?? '' });
      if (result.state === 'blocked') { if (ownsView()) setProblem(result); request?.failed?.(); return unsuccessful; }
      if (result.state === 'cancelled') return unsuccessful;
      const applied = applyBinding(lease, result.binding, request, closeCurrent, adoptCloseTitle);
      let restored = false;
      if (applied) {
        // 回包摘要描述所存快照；不能用当前正文重新生成基线来清除新编辑。
        try { await flushSettings(); restored = true; } catch { setProblem({ state: 'blocked', reason: 'storage', message: text.restoreFailed, wrote: 'yes' }); }
      }
      if (ownsView()) useWorkspace.getState().notify(applied && restored ? text.saved.replace('{0}', result.binding.name) : text.retained, !applied || !restored);
      return { saved: true, applied, restored, busyUnchanged: job.owns() };
    } catch (reason) { if (ownsView()) { if (sent) uncertain(reason); else setProblem({ state: 'blocked', reason: 'document-changed', message: text.unavailable, wrote: 'no' }); } request?.failed?.(); return unsuccessful; }
    finally { lease?.dispose(); job?.release(); active.current = false; if (ownsView()) operationBusy(false); }
  }

  /** 打开前注册独立空文档且保存身份；失败只移除未改动的占位文档，不动原查询。 */
  async function open(encoding: QueryFileEncoding): Promise<boolean> {
    if (active.current || !ownsView()) return false;
    active.current = true; operationBusy(true); setProblem(undefined);
    const original = current();
    if (!original) { active.current = false; operationBusy(false); return false; }
    const target: WorkspaceTab = { id: uid(), kind: 'query', connectionId: original.connectionId, title: text.opening, sql: '', ...(original.database === undefined ? {} : { database: original.database }), ...(original.databaseContext === undefined ? {} : { databaseContext: original.databaseContext }) };
    let originalJob: ReturnType<typeof acquireWorkspaceBusy> | undefined, targetJob: ReturnType<typeof acquireWorkspaceBusy> | undefined, opened = false;
    try {
      capture();
      originalJob = acquireWorkspaceBusy(tab.id);
      const latest = useWorkspace.getState(); latest.updateSettings({ tabs: [...latest.settings.tabs, target] }); targetJob = acquireWorkspaceBusy(target.id);
      await flushSettings();
      if (!originalJob.owns() || !targetJob.owns()) throw Error(text.changed);
      const result = await invoke('queryFileSources.open', { tabId: target.id, encoding });
      if (result.state === 'blocked') { if (ownsView()) setProblem(result); return false; }
      if (result.state === 'cancelled') return false;
      const state = useWorkspace.getState(), existing = state.settings.tabs.find(item => item.id === target.id);
      if (!originalJob.owns() || !targetJob.owns() || !existing || existing.kind !== 'query' || existing.connectionId !== target.connectionId || existing.fileSourceBinding || existing.sourceBinding) return false;
      state.updateSettings({ tabs: state.settings.tabs.map(item => item.id === target.id ? { ...item, ...(item.title === target.title ? { title: result.binding.name } : {}), ...(item.sql === '' ? { sql: result.sql } : {}), fileSourceBinding: result.binding.ref } : item), activeTabId: target.id });
      opened = true; await flushSettings(); return true;
    } catch (reason) { if (ownsView()) uncertain(reason); return false; }
    finally {
      const state = useWorkspace.getState(), remove = !opened && targetJob?.owns() && state.settings.tabs.find(item => item.id === target.id) === target;
      targetJob?.release(); originalJob?.release(); if (remove) state.closeTab(target.id);
      active.current = false; if (ownsView()) operationBusy(false);
    }
  }

  /** 显式重读先核对Main当前私有来源；结果作为未关联新草稿展示，原标签只推进来源基线并保留全部正文。 */
  async function reread(): Promise<boolean> {
    if (active.current || !ownsView()) return false;
    const before = current(); if (!before?.fileSourceBinding) return false;
    active.current = true; operationBusy(true);
    let lease: QuerySourceLease | undefined;
    let job: ReturnType<typeof acquireWorkspaceBusy> | undefined;
    try {
      const snapshot = capture(); lease = new QuerySourceLease(snapshot, current, changed => useWorkspace.subscribe(changed), ownsView);
      job = acquireWorkspaceBusy(tab.id); await flushSettings();
      const status = await invoke('queryFileSources.status', { tabId: tab.id });
      if (!lease.current() || !job.owns()) throw Error(text.changed);
      if (status.state !== 'bound') { if (status.state === 'blocked') setProblem(status); else setProblem({ state: 'blocked', reason: 'not-bound', message: text.unbound, wrote: 'no' }); return false; }
      const result = await invoke('queryFileSources.open', { tabId: tab.id, source: status.binding.ref, encoding: status.binding.encoding });
      if (result.state === 'blocked') { if (ownsView()) setProblem(result); return false; }
      if (result.state === 'cancelled' || !lease.current()) return false;
      const applied = lease.apply(() => {
        const state = useWorkspace.getState(); state.updateTab(tab.id, { fileSourceBinding: result.binding.ref }); setView(result.binding);
        state.openTab({ kind: 'query', connectionId: before.connectionId, ...(before.database === undefined ? {} : { database: before.database }), ...(before.databaseContext === undefined ? {} : { databaseContext: before.databaseContext }), title: (result.binding.name + text.rereadSuffix).slice(0, 256), sql: result.sql });
      });
      if (applied) { await flushSettings(); setProblem(undefined); }
      return applied;
    } catch (reason) { if (ownsView()) uncertain(reason); return false; }
    finally { lease?.dispose(); job?.release(); active.current = false; if (ownsView()) operationBusy(false); }
  }
  return { view: metadata, dirty, busy, problem, save, open, reread, dismiss: () => setProblem(undefined), isBusy: () => active.current };
}
export type QueryFileSourceController = ReturnType<typeof useQueryFileSource>;
