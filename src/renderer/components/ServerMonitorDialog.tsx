import { useEffect, useRef, useState } from 'react';
import { postgresMonitorStatusNames, serverMonitorStatusNames } from '../../shared/serverMonitor';
import type { ServerMonitorSession, ServerMonitorSignalAction, ServerMonitorSummary } from '../../shared/serverMonitor';
import { ServerMonitorController, type ServerMonitorServices, type ServerMonitorViewState } from '../serverMonitorController';
import { serverMonitorZhCN as t } from '../serverMonitorZh';
import { Modal, UsageHelp } from './ui';
import { ServerMonitorSessions } from './ServerMonitorSessions';
import { errorMessage, uid } from '../lib';
import '../serverMonitor.css';

export interface ServerMonitorDialogProps { open: boolean; connectionId: string; connectionRevision: number; services: ServerMonitorServices; onClose(): void; }
/** 服务和原连接修订由 Root 提供，组件只传递所选快照能力。 */
export function ServerMonitorDialog(props: ServerMonitorDialogProps) {
  const { open, connectionId, connectionRevision, services } = props;
  const [view, setView] = useState<ServerMonitorViewState>({ busy: false, waiting: false, automatic: false, remaining: 0 }), [closing, setClosing] = useState(false);
  const [intent, setIntent] = useState<{ token: string; row: ServerMonitorSession; action: ServerMonitorSignalAction }>();
  const [confirmedPid, setConfirmedPid] = useState(''), [signalMessage, setSignalMessage] = useState('');
  const [signalling, setSignalling] = useState(false);
  const signalActive = useRef(false), confirmation = useRef<HTMLElement>(null);
  const controllerRef = useRef<ServerMonitorController | null>(null);
  if (!controllerRef.current) controllerRef.current = new ServerMonitorController(setView);
  const controller = controllerRef.current, epoch = useRef(0), latest = useRef(props); latest.current = props;
  useEffect(() => {
    ++epoch.current; setClosing(false); setIntent(undefined); setSignalMessage('');
    if (!open) { void controller.stop(); return; }
    const visibility = () => { if (document.visibilityState === 'hidden') void controller.stop(); else void controller.start({ connectionId, connectionRevision }, services); };
    visibility(); document.addEventListener('visibilitychange', visibility);
    return () => { ++epoch.current; document.removeEventListener('visibilitychange', visibility); void controller.stop(); };
  }, [open, connectionId, connectionRevision, services, controller]);
  useEffect(() => { if (intent) confirmation.current?.scrollIntoView?.({ block: 'center' }); }, [intent]);
  if (!open) return null;
  /** 旧回包不得关闭新窗口；onClose仅关闭视图，物理资源占用仍由Root独立host证明控制。 */
  const close = () => {
    if (closing || signalActive.current) return;
    const captured = epoch.current; setClosing(true);
    void controller.stop().then(() => { if (captured === epoch.current && latest.current.open && latest.current.connectionId === connectionId && latest.current.connectionRevision === connectionRevision) latest.current.onClose(); });
  };
  const sameTarget = view.target?.connectionId === connectionId && view.target.connectionRevision === connectionRevision;
  const snapshot = sameTarget ? view.snapshot : undefined, busy = !sameTarget || view.busy;
  const signal = services.signal ? snapshot?.signal : undefined;
  const selected = intent && signal?.token === intent.token ? intent : undefined;
  const chooseSignal = (row: ServerMonitorSession, action: ServerMonitorSignalAction) => {
    if (!signal || busy || closing || signalActive.current) return;
    controller.setAutomatic(false);
    setConfirmedPid(''); setSignalMessage('');
    setIntent({ token: signal.token, row, action });
  };
  const sendSignal = async () => {
    if (!selected || !services.signal || signalActive.current || busy || closing || confirmedPid !== selected.row.id) return;
    const original = epoch.current;
    const targetLabel = `${t.signal[selected.action]} · PID ${selected.row.id} · `;
    signalActive.current = true; setSignalling(true); setIntent(undefined);
    try {
      const result = await services.signal({ connectionId, taskId: uid(), token: selected.token, pid: selected.row.id, action: selected.action, confirmedPid });
      const message = result.status === 'accepted' ? result.observation === 'unknown' ? t.signal.acceptedUnknown : t.signal[result.observation] : t.signal[result.status];
      if (original === epoch.current) setSignalMessage(targetLabel + message + (result.cleanupUnconfirmed ? t.signal.cleanup : ''));
    } catch (reason) { if (original === epoch.current) setSignalMessage(targetLabel + errorMessage(reason)); }
    finally {
      signalActive.current = false; setSignalling(false);
      if (original === epoch.current) void controller.refresh();
    }
  };
  const postgres = snapshot?.dialect === 'postgresql';
  const names = postgres ? postgresMonitorStatusNames : serverMonitorStatusNames;
  const counters = { ...t.counters, ...t.postgres.counters };
  const fields = postgres ? { ...t.fields, hostname: t.postgres.host, connectionId: t.postgres.connectionId, database: t.postgres.database } : t.fields;
  const value = (source: string | null) => source === null ? t.null : source === '' ? t.emptyString : source;
  return <Modal title={t.title} wide onClose={close}>
    <section className="server-monitor-dialog" aria-busy={busy}>
      <div className="server-monitor-toolbar">
        <button type="button" disabled={busy || closing || signalling || !!selected} onClick={() => void controller.refresh()}>{busy ? t.loading : t.refresh}</button>
        <button type="button" disabled={!busy || view.waiting || closing} onClick={() => void controller.cancel()}>{t.cancel}</button>
        <label><input type="checkbox" checked={sameTarget && view.automatic} disabled={view.waiting || closing || !sameTarget || signalling || !!selected} onChange={event => controller.setAutomatic(event.target.checked)} />{t.auto}</label>
      </div>
      {selected && <section ref={confirmation} className="server-monitor-signal-confirmation" aria-label={t.signal.target}>
        <strong>{t.signal[selected.action]} · PID {selected.row.id} · {selected.row.user} · {selected.row.database}</strong>
        <p>{selected.action === 'cancel-query' ? t.signal.cancelHint : t.signal.terminateHint}</p>
        <label>{t.signal.pid}<input inputMode="numeric" value={confirmedPid} maxLength={10} onChange={event => setConfirmedPid(event.target.value)} /></label>
        <div className="server-monitor-signal-actions">
          <button type="button" className="danger" disabled={busy || confirmedPid !== selected.row.id} onClick={() => void sendSignal()}>{t.signal.confirm}</button>
          <button type="button" onClick={() => setIntent(undefined)}>{t.signal.back}</button>
        </div>
      </section>}
      {(signalling || signalMessage) && <p role="status">{signalling ? t.signal.pending : signalMessage}</p>}
      <p>{t.notice}</p><UsageHelp><p>{t.snapshot}</p><p>{postgres ? t.postgres.scope : t.scope}</p><p>{t.autoBudget}</p></UsageHelp>
      {closing ? <p role="status">{t.closing}</p> : view.waiting && <p role="status">{t.waiting}</p>}
      {sameTarget && view.error && <p role="alert">{view.error}</p>}
      {!snapshot && <p role="status">{t.empty}</p>}
      {snapshot && <>
        <p className="server-monitor-time"><time>{snapshot.startedAt}</time> — <time>{snapshot.completedAt}</time></p>
        <h3>{t.summary}</h3>{snapshot.summary.status === 'unavailable' ? <p>{t.unavailable}：{snapshot.summary.reason}</p> : <dl>{Object.entries(fields).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{value(snapshot.summary.status === 'available' ? snapshot.summary.value[key as keyof ServerMonitorSummary] ?? null : null)}</dd></div>)}</dl>}
        <h3>{postgres ? t.postgres.status : t.status}</h3>{snapshot.globalStatus.status === 'unavailable' ? <p>{t.unavailable}：{snapshot.globalStatus.reason}</p> : <>
          <dl>{snapshot.globalStatus.value.map(item => <div key={item.name}><dt>{counters[item.name]}（{item.name}）</dt><dd>{item.value}</dd></div>)}</dl>
          {postgres && <p>{t.postgres.reset}　{value(snapshot.statisticsReset ?? null)}</p>}
          <p>{t.missing}{names.filter(name => snapshot.globalStatus.status === 'available' && !snapshot.globalStatus.value.some(item => item.name === name)).join('、') || '—'}</p>
        </>}
      </>}
      <ServerMonitorSessions key={JSON.stringify([connectionId,connectionRevision])} section={snapshot?.sessions} postgres={postgres}
        signal={signal} onSignal={chooseSignal} disabled={closing || !sameTarget || !!signal && (busy || signalling || !!selected)}/>
      <footer><button type="button" disabled={closing || signalling} onClick={close}>{t.close}</button></footer>
    </section>
  </Modal>;
}
