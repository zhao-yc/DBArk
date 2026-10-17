import { useEffect, useRef, useState } from 'react';
import { serverMonitorLimits, serverMonitorStatusNames } from '../../shared/serverMonitor';
import { ServerMonitorController, type ServerMonitorServices, type ServerMonitorViewState } from '../serverMonitorController';
import { serverMonitorZhCN as t } from '../serverMonitorZh';
import { Modal } from './ui';
import '../serverMonitor.css';

export interface ServerMonitorDialogProps { open: boolean; connectionId: string; connectionRevision: number; services: ServerMonitorServices; onClose(): void; }
/** 正式可接线只读组件：服务和原连接修订由Root提供，组件不访问window.dbark或任意SQL入口。 */
export function ServerMonitorDialog(props: ServerMonitorDialogProps) {
  const { open, connectionId, connectionRevision, services } = props;
  const [view, setView] = useState<ServerMonitorViewState>({ busy: false, waiting: false, automatic: false, remaining: 0 }), [closing, setClosing] = useState(false);
  const controllerRef = useRef<ServerMonitorController | null>(null);
  if (!controllerRef.current) controllerRef.current = new ServerMonitorController(setView);
  const controller = controllerRef.current, epoch = useRef(0), latest = useRef(props); latest.current = props;
  useEffect(() => {
    ++epoch.current; setClosing(false);
    if (!open) { void controller.stop(); return; }
    const visibility = () => { if (document.visibilityState === 'hidden') void controller.stop(); else void controller.start({ connectionId, connectionRevision }, services); };
    visibility(); document.addEventListener('visibilitychange', visibility);
    return () => { ++epoch.current; document.removeEventListener('visibilitychange', visibility); void controller.stop(); };
  }, [open, connectionId, connectionRevision, services, controller]);
  if (!open) return null;
  /** 旧回包不得关闭新窗口；onClose仅关闭视图，物理资源占用仍由Root独立host证明控制。 */
  const close = () => {
    if (closing) return;
    const captured = epoch.current; setClosing(true);
    void controller.stop().then(() => { if (captured === epoch.current && latest.current.open && latest.current.connectionId === connectionId && latest.current.connectionRevision === connectionRevision) latest.current.onClose(); });
  };
  const sameTarget = view.target?.connectionId === connectionId && view.target.connectionRevision === connectionRevision;
  const snapshot = sameTarget ? view.snapshot : undefined, busy = !sameTarget || view.busy;
  const value = (source: string | null) => source === null ? t.null : source === '' ? t.emptyString : source;
  return <Modal title={t.title} wide onClose={close}>
    <section className="server-monitor-dialog" aria-busy={busy}>
      <div className="server-monitor-toolbar">
        <button type="button" disabled={busy || closing} onClick={() => void controller.refresh()}>{busy ? t.loading : t.refresh}</button>
        <button type="button" disabled={!busy || view.waiting || closing} onClick={() => void controller.cancel()}>{t.cancel}</button>
        <label><input type="checkbox" checked={sameTarget && view.automatic} disabled={view.waiting || closing || !sameTarget} onChange={event => controller.setAutomatic(event.target.checked)} />{t.auto}</label>
      </div>
      <p>{t.snapshot}</p><p>{t.scope}</p><p className="server-monitor-note">{t.autoBudget}</p>
      {closing ? <p role="status">{t.closing}</p> : view.waiting && <p role="status">{t.waiting}</p>}
      {sameTarget && view.error && <p role="alert">{view.error}</p>}
      {!snapshot && <p role="status">{t.empty}</p>}
      {snapshot && <>
        <p className="server-monitor-time"><time>{snapshot.startedAt}</time> — <time>{snapshot.completedAt}</time></p>
        <h3>{t.summary}</h3>{snapshot.summary.status === 'unavailable' ? <p>{t.unavailable}：{snapshot.summary.reason}</p> : <dl>{Object.entries(t.fields).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{value(snapshot.summary.status === 'available' ? snapshot.summary.value[key as keyof typeof t.fields] : null)}</dd></div>)}</dl>}
        <h3>{t.status}</h3>{snapshot.globalStatus.status === 'unavailable' ? <p>{t.unavailable}：{snapshot.globalStatus.reason}</p> : <><dl>{snapshot.globalStatus.value.map(item => <div key={item.name}><dt>{t.counters[item.name]}（{item.name}）</dt><dd>{item.value}</dd></div>)}</dl><p>{t.missing}{serverMonitorStatusNames.filter(name => snapshot.globalStatus.status === 'available' && !snapshot.globalStatus.value.some(item => item.name === name)).join('、') || '—'}</p></>}
        <h3>{t.sessions}</h3>{snapshot.sessions.status === 'unavailable' ? <p>{t.unavailable}：{snapshot.sessions.reason}</p> : <>
          <p>{t.rows}：{Math.min(snapshot.sessions.value.rows.length, serverMonitorLimits.sessions)} / {snapshot.sessions.value.limit}</p>
          {(snapshot.sessions.value.truncated || snapshot.sessions.value.rows.length > serverMonitorLimits.sessions) && <p>{t.limited}</p>}
          {!snapshot.sessions.value.rows.length && <p>{t.noSessions}</p>}
          <div className="server-monitor-table"><table><thead><tr>{t.sessionFields.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{snapshot.sessions.value.rows.slice(0, serverMonitorLimits.sessions).map(row => <tr key={row.id}>
            <td>{row.id}</td><td>{value(row.user)}</td><td>{value(row.host)}</td><td>{value(row.database)}</td><td>{value(row.command)}</td><td>{value(row.seconds)}</td><td>{value(row.state)}</td>
            <td><details><summary>{t.sqlDetail}</summary><pre>{value(row.sql)}</pre></details><span>{value(row.sqlLength)}{row.sqlTruncated ? ` · ${t.sqlLimited}` : ''}</span></td>
          </tr>)}</tbody></table></div>
        </>}
      </>}
      <footer><button type="button" disabled={closing} onClick={close}>{t.close}</button></footer>
    </section>
  </Modal>;
}
