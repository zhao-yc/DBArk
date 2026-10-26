import { useEffect, useRef, useState } from 'react';
import { queryTransactionIsolations, queryTransactionSettingsSnapshotSchema, type QueryTransactionIsolation, type QueryTransactionSettingsSnapshot } from '../../shared/queryTransactionSettings';
import type { QueryTransactionSettingsIntent } from '../queryTransactionSettingsIntent';
import { queryTransactionSettingsZh as t } from '../locales/queryTransactionSettings.zh-CN';
import { errorMessage, uid } from '../lib';
import { ErrorBox, Field, Spinner } from './ui';

export interface QueryTransactionSettingsApplyInput {
  taskId: string; expected: QueryTransactionSettingsSnapshot; isolation: QueryTransactionIsolation; readOnly: boolean;
}
interface Props {
  intent: QueryTransactionSettingsIntent; connectionName: string;
  onRead(taskId: string): Promise<QueryTransactionSettingsSnapshot>;
  onApply(input: QueryTransactionSettingsApplyInput): Promise<QueryTransactionSettingsSnapshot>;
  onClose(): void;
}

/** 每次挂载重新读原会话；失败只展示，不重放请求或恢复配置。 */
export function QueryTransactionSettingsDialog(props: Props) {
  const latest = useRef(props); latest.current = props;
  const root = useRef<HTMLDivElement>(null), mounted = useRef(false), pendingRef = useRef(false), generation = useRef(0);
  const [pending, setPending] = useState<'read' | 'apply' | null>(null), [snapshot, setSnapshot] = useState<QueryTransactionSettingsSnapshot>();
  const [isolation, setIsolation] = useState<QueryTransactionIsolation>('REPEATABLE READ'), [readOnly, setReadOnly] = useState(false);
  const [requiresRead, setRequiresRead] = useState(true), [invalid, setInvalid] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');

  /** 关闭不能抢在原请求落定前释放占用；X、Escape及底部按钮共用同一门。 */
  function close() { if (!pendingRef.current) latest.current.onClose(); }

  async function request(kind: 'read' | 'apply') {
    if (pendingRef.current || !props.intent.current()) return;
    if (kind === 'apply' && (!snapshot || requiresRead || snapshot.transactionOpen || snapshot.isolation === isolation && snapshot.readOnly === readOnly)) return;
    const epoch = ++generation.current; pendingRef.current = true; setPending(kind); setError(''); setRequiresRead(true); setStatus(kind === 'read' ? t.loading : t.applying);
    try {
      const value = queryTransactionSettingsSnapshotSchema.parse(kind === 'read' ? await latest.current.onRead(uid()) : await latest.current.onApply({ taskId: uid(), expected: snapshot!, isolation, readOnly }));
      props.intent.assertCurrent();
      if (!mounted.current || generation.current !== epoch) return;
      if (snapshot && (value.serverConnectionId !== snapshot.serverConnectionId || value.dialect !== snapshot.dialect || value.serverVersion !== snapshot.serverVersion)) { setInvalid(true); throw Error(t.changed); }
      setSnapshot(value); setIsolation(value.isolation); setReadOnly(value.readOnly); setRequiresRead(false); setStatus(kind === 'read' ? t.ready : t.applied);
    } catch (reason) {
      if (mounted.current && generation.current === epoch) { setError(errorMessage(reason)); setStatus(t.retry); }
    } finally {
      if (mounted.current && generation.current === epoch) { pendingRef.current = false; setPending(null); }
    }
  }

  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const unsubscribe = props.intent.subscribe(() => { if (mounted.current) { setInvalid(true); setRequiresRead(true); } });
    /** 捕获阶段处理焦点循环和关闭键，防止键盘落到后方查询编辑器。 */
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const elements = root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)');
        if (!elements?.length) return;
        if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements[elements.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === elements[elements.length - 1]) { event.preventDefault(); elements[0].focus(); }
      }
    };
    document.addEventListener('keydown', keydown, true); void request('read'); root.current?.focus();
    return () => { mounted.current = false; generation.current++; unsubscribe(); document.removeEventListener('keydown', keydown, true); previous?.focus(); };
  }, [props.intent]);

  const blocked = !!pending || invalid, unchanged = !snapshot || snapshot.isolation === isolation && snapshot.readOnly === readOnly;
  return <div className="modal-overlay"><div ref={root} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-label={t.title} style={{ width: 'min(680px, calc(100vw - 24px))', maxHeight: 'calc(100vh - 24px)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
    <header><h2>{t.title}</h2><button className="icon-button" aria-label={t.dismiss} disabled={!!pending} onClick={close}>×</button></header>
    <div className="modal-body" style={{ overflow: 'auto', minHeight: 0, overflowWrap: 'anywhere' }}>
      <p>{t.defaultsNotice}</p><p className="muted small">{t.diagnosticsNotice}</p>
      <dl><dt>{t.connection}</dt><dd aria-label={t.connection}>{props.connectionName}</dd>{snapshot && <>
        <dt>{t.physicalId}</dt><dd aria-label={t.physicalId}>{snapshot.serverConnectionId}</dd>
        <dt>{t.serverVersion}</dt><dd aria-label={t.serverVersion}>{snapshot.dialect} {snapshot.serverVersion}</dd>
        <dt>{t.database}</dt><dd aria-label={t.database}>{snapshot.database ?? t.none}</dd>
        <dt>{t.transaction}</dt><dd aria-label={t.transaction}>{snapshot.transactionOpen ? t.yes : t.no}</dd>
        <dt>{t.autocommit}</dt><dd aria-label={t.autocommit}>{snapshot.autocommit ? t.yes : t.no}</dd>
      </>}</dl>
      <ErrorBox message={invalid ? t.changed : error}/>
      {snapshot?.transactionOpen && <p role="note">{t.activeTransaction}</p>}
      <Field label={t.isolation}><select aria-label={t.isolation} value={isolation} disabled={blocked || requiresRead || !!snapshot?.transactionOpen} onChange={event => setIsolation(event.target.value as QueryTransactionIsolation)}>{queryTransactionIsolations.map(value => <option key={value} value={value}>{value}</option>)}</select></Field>
      <label className="check"><input type="checkbox" aria-label={t.readOnly} checked={readOnly} disabled={blocked || requiresRead || !!snapshot?.transactionOpen} onChange={event => setReadOnly(event.target.checked)}/>{t.readOnly}</label>
      <p role="status" aria-label={t.status}>{pending ? <Spinner text={status}/> : status}</p>
    </div>
    <footer style={{ flexShrink: 0, flexWrap: 'wrap' }}><button disabled={blocked} onClick={() => void request('read')}>{t.refresh}</button><button className="primary" disabled={blocked || requiresRead || unchanged || !!snapshot?.transactionOpen} onClick={() => void request('apply')}>{t.apply}</button><button disabled={!!pending} onClick={close}>{t.close}</button></footer>
  </div></div>;
}
