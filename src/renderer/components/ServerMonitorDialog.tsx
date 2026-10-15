import { useEffect, useMemo, useState } from 'react';
import { serverMonitorLimits, serverMonitorStatusNames, type ServerMonitorInput, type ServerMonitorSnapshot } from '../../shared/serverMonitor';
import { serverMonitorZhCN as t } from '../locales/serverMonitor.zh-CN';
import { Modal } from './ui';
import '../serverMonitor.css';

export interface ServerMonitorServices { read(input: ServerMonitorInput): Promise<ServerMonitorSnapshot>; cancel(taskId: string): Promise<unknown>; }
export interface ServerMonitorViewState { snapshot?: ServerMonitorSnapshot; busy: boolean; error?: string; }

/** 独立控制器按真实读取完成安排下一轮，隐藏/关闭后取消并等待原轮收尾。 */
export class ServerMonitorController {
  private active = false;
  private automatic = false;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: { taskId: string; done: Promise<void>; submitted: boolean; cancelled: boolean };
  private stopping: Promise<void> = Promise.resolve();
  constructor(private readonly connectionId: string, private readonly services: ServerMonitorServices, private readonly publish: (state: ServerMonitorViewState) => void, private readonly createId: () => string = () => crypto.randomUUID()) {}

  /** 重开必须等待上一轮停止；旧生命周期不能在新生命周期后重新启用。 */
  async start(): Promise<void> {
    const generation = ++this.generation;
    await this.stopping;
    if (generation !== this.generation) return;
    this.active = true;
    await this.refresh();
  }
  setAutomatic(value: boolean): void { this.automatic = value; this.clearTimer(); if (!this.pending) this.schedule(); }
  private clearTimer(): void { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; }
  private schedule(): void { if (this.active && this.automatic && !this.pending) this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, serverMonitorLimits.refreshMilliseconds); }

  /** 手动与自动共用同一正在执行标记，连续点击不会创建重叠任务。 */
  refresh(): Promise<void> {
    if (!this.active) return Promise.resolve();
    if (this.pending) return this.pending.done;
    this.clearTimer();
    const taskId = this.createId();
    this.publish({ busy: true, error: undefined });
    // 在微任务内调用服务，保证同步抛错也进入收尾，而且 pending 已建立。
    const pending = { taskId, submitted: false, cancelled: false, done: Promise.resolve() };
    const done = Promise.resolve().then(() => {
      // 隐藏/关闭可能在服务提交前发生；禁止先取消空任务再发送读取。
      if (!this.active || pending.cancelled) throw new Error(t.cancelled);
      pending.submitted = true;
      return this.services.read({ connectionId: this.connectionId, taskId });
    }).then(snapshot => {
      if (this.active) this.publish({ busy: true, snapshot });
    }, error => {
      if (this.active) this.publish({ busy: true, error: String(error instanceof Error ? error.message : error) });
    }).finally(() => {
      this.pending = undefined;
      if (this.active) { this.publish({ busy: false }); this.schedule(); }
    });
    pending.done = done;
    this.pending = pending;
    return done;
  }
  /** 用户取消同时关闭自动刷新；取消失败保留原轮占位直到真实完成。 */
  async cancel(): Promise<void> {
    this.setAutomatic(false);
    if (this.pending) {
      this.pending.cancelled = true;
      if (!this.pending.submitted) return;
      try { await this.services.cancel(this.pending.taskId); }
      catch (error) { if (this.active) this.publish({ busy: true, error: String(error instanceof Error ? error.message : error) }); }
    }
  }
  stop(): Promise<void> {
    ++this.generation;
    this.active = false;
    this.clearTimer();
    const pending = this.pending;
    // 不依赖 cancel 的返回证明原命令结束，必须等待真实 read promise。
    if (pending) pending.cancelled = true;
    this.stopping = pending ? Promise.allSettled([pending.submitted ? Promise.resolve().then(() => this.services.cancel(pending.taskId)) : Promise.resolve(), pending.done]).then(() => undefined) : this.stopping;
    return this.stopping;
  }
}

export interface ServerMonitorDialogProps { open: boolean; connectionId: string; services: ServerMonitorServices; onClose(): void; }
/** 原始 SQL 与错误仅保存在窗口状态，不通过任务摘要或本地存储持久化。 */
export function ServerMonitorDialog({ open, connectionId, services, onClose }: ServerMonitorDialogProps) {
  const [view, setView] = useState<ServerMonitorViewState>({ busy: false }), [automatic, setAutomatic] = useState(false), [closing, setClosing] = useState(false);
  const controller = useMemo(() => new ServerMonitorController(connectionId, services, patch => setView(old => ({ ...old, ...patch }))), [connectionId, services]);
  useEffect(() => {
    if (!open) { setView({ busy: false }); return; }
    setView({ busy: false }); setClosing(false);
    const visibility = () => { if (document.visibilityState === 'hidden') void controller.stop(); else void controller.start(); };
    visibility(); document.addEventListener('visibilitychange', visibility);
    return () => { document.removeEventListener('visibilitychange', visibility); void controller.stop(); };
  }, [open, controller]);
  useEffect(() => { controller.setAutomatic(automatic); }, [automatic, controller]);
  if (!open) return null;
  const close = () => { if (closing) return; setClosing(true); void controller.stop().then(() => { setView({ busy: false }); onClose(); }); };
  const snapshot = view.snapshot;
  const value = (source: string | null) => source === null ? t.null : source === '' ? t.emptyString : source;
  return <Modal title={t.title} wide onClose={close}>
    <section className="server-monitor-dialog">
      <header><button type="button" disabled={closing} onClick={close}>{t.close}</button></header>
      <div className="server-monitor-toolbar"><button type="button" disabled={view.busy || closing} onClick={() => void controller.refresh()}>{view.busy ? t.loading : t.refresh}</button><button type="button" disabled={!view.busy || closing} onClick={() => { setAutomatic(false); void controller.cancel(); }}>{t.cancel}</button><label><input type="checkbox" checked={automatic} disabled={closing} onChange={event => setAutomatic(event.target.checked)} />{t.auto}</label></div>
      <p>{t.snapshot}</p><p>{t.scope}</p>
      {view.error && <p role="alert">{view.error}</p>}
      {!snapshot && <p role="status">{t.empty}</p>}
      {snapshot && <><p><time>{snapshot.startedAt}</time> — <time>{snapshot.completedAt}</time></p>
        <h3>{t.summary}</h3>{snapshot.summary.status === 'unavailable' ? <p>{t.unavailable}：{snapshot.summary.reason}</p> : <dl>{Object.entries(t.fields).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{value(snapshot.summary.status === 'available' ? snapshot.summary.value[key as keyof typeof t.fields] : null)}</dd></div>)}</dl>}
        <h3>{t.status}</h3>{snapshot.globalStatus.status === 'unavailable' ? <p>{t.unavailable}：{snapshot.globalStatus.reason}</p> : <><dl>{snapshot.globalStatus.value.map(item => <div key={item.name}><dt>{t.counters[item.name]}（{item.name}）</dt><dd>{item.value}</dd></div>)}</dl><p>{t.missing}{serverMonitorStatusNames.filter(name => snapshot.globalStatus.status === 'available' && !snapshot.globalStatus.value.some(item => item.name === name)).join('、') || '—'}</p></>}
        <h3>{t.sessions}</h3>{snapshot.sessions.status === 'unavailable' ? <p>{t.unavailable}：{snapshot.sessions.reason}</p> : <>{snapshot.sessions.value.truncated && <p>{t.limited}</p>}<div className="server-monitor-table"><table><thead><tr>{t.sessionFields.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{snapshot.sessions.value.rows.map(row => <tr key={row.id}><td>{row.id}</td><td>{value(row.user)}</td><td>{value(row.host)}</td><td>{value(row.database)}</td><td>{value(row.command)}</td><td>{value(row.seconds)}</td><td>{value(row.state)}</td><td><pre>{value(row.sql)}</pre><span>{value(row.sqlLength)}{row.sqlTruncated ? ` · ${t.sqlLimited}` : ''}</span></td></tr>)}</tbody></table></div></>}
      </>}
    </section>
  </Modal>;
}
