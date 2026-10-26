import { useLayoutEffect, useRef, useState } from 'react';
import { queryAnalyzeZh as t } from '../locales/queryAnalyze.zh-CN';
import { SqlEditor } from './SqlEditor';
import { Modal } from './ui';
import '../queryAnalyze.css';

export interface QueryAnalyzeConfirmDialogProps {
  source: string; connectionName: string; databaseLabel: string; invalidReason?: string;
  onConfirm(): void; onClose(): void;
}

/** 确认只授权本次冻结正文；失效、关闭及已经提交的旧回调均不能再次执行。 */
export function QueryAnalyzeConfirmDialog({ source, connectionName, databaseLabel, invalidReason, onConfirm, onClose }: QueryAnalyzeConfirmDialogProps) {
  const original = useRef({ source, connectionName, databaseLabel }).current;
  const [acknowledged, setAcknowledged] = useState(false), ack = useRef(false);
  const alive = useRef(true), invalid = useRef(false), finished = useRef(false);
  const latest = useRef({ onConfirm, onClose }); latest.current = { onConfirm, onClose };
  if (invalidReason || source !== original.source || connectionName !== original.connectionName || databaseLabel !== original.databaseLabel) invalid.current = true;
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const reason = invalid.current ? invalidReason || t.changed : undefined;

  /** 点击时再核同一份确认状态，双击及已经排队的事件不产生第二次授权。 */
  function confirm() {
    if (!alive.current || finished.current || invalid.current || !ack.current) return;
    finished.current = true; latest.current.onConfirm();
  }
  /** 取消只关闭确认框，不启动分析，也不会复用勾选状态。 */
  function close() {
    if (!alive.current || finished.current) return;
    finished.current = true; latest.current.onClose();
  }
  return <Modal title={t.title} wide onClose={close}>
    <div className="modal-content query-analyze-confirm">
      <dl className="query-analyze-target"><div><dt>{t.connection}</dt><dd>{original.connectionName}</dd></div><div><dt>{t.database}</dt><dd>{original.databaseLabel}</dd></div></dl>
      <p className="warning-text">{t.risk}</p>
      <strong>{t.sql}</strong><div className="query-analyze-confirm-source" aria-label={t.sql}><SqlEditor value={original.source} readOnly height="100%"/></div>
      <p className="muted small">{t.once}</p>
      {reason && <p className="error-box" role="alert">{reason}</p>}
      <label className="query-analyze-acknowledgement"><input type="checkbox" checked={acknowledged} disabled={!!reason} onChange={event => { if (!alive.current || finished.current || invalid.current) return; ack.current = event.currentTarget.checked; setAcknowledged(event.currentTarget.checked); }}/><span>{t.acknowledge}</span></label>
    </div>
    <footer className="modal-footer"><button onClick={close}>{t.cancel}</button><span className="grow"/><button className="primary" disabled={!acknowledged || !!reason} onClick={confirm}>{t.confirm}</button></footer>
  </Modal>;
}
