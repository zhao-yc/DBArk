import { useEffect, useRef, useState } from 'react';
import { queryTransactionIsolations, queryTransactionSettingsSnapshotSchema, type QueryTransactionIsolation, type QueryTransactionSettingsSnapshot } from '../../shared/queryTransactionSettings';
import type { QueryTransactionSettingsIntent } from '../queryTransactionSettingsIntent';
import { queryTransactionSettingsZh as t } from '../locales/queryTransactionSettings.zh-CN';
import { errorMessage, uid } from '../lib';
import { ErrorBox, Field, Spinner } from './ui';
import { checkQueryAutocommitOutput, queryAutocommitConfirmedMessage, type QueryAutocommitApplyInput, type QueryAutocommitOutput } from '../../shared/queryAutocommit';

export interface QueryTransactionSettingsApplyInput {
  taskId: string; expected: QueryTransactionSettingsSnapshot; isolation: QueryTransactionIsolation; readOnly: boolean;
}
interface Props {
  intent: QueryTransactionSettingsIntent; connectionName: string;
  onRead(taskId: string): Promise<QueryTransactionSettingsSnapshot>;
  onApply(input: QueryTransactionSettingsApplyInput): Promise<QueryTransactionSettingsSnapshot>;
  onAutocommit?(input: Omit<QueryAutocommitApplyInput, 'sessionId'>): Promise<QueryAutocommitOutput>;
  onClose(): void;
}

/** 每次挂载重新读原会话；失败只展示，不重放请求或恢复配置。 */
export function QueryTransactionSettingsDialog(props: Props) {
  const latest = useRef(props); latest.current = props;
  const root = useRef<HTMLDivElement>(null), mounted = useRef(false), pendingRef = useRef(false), generation = useRef(0);
  const [pending, setPending] = useState<'read' | 'apply' | 'autocommit' | null>(null), [snapshot, setSnapshot] = useState<QueryTransactionSettingsSnapshot>();
  const snapshotRef = useRef<QueryTransactionSettingsSnapshot | undefined>(undefined);
  const [automatic, setAutomatic] = useState({ enabled: true, acknowledged: false });
  const automaticRef = useRef(automatic);
  const [isolation, setIsolation] = useState<QueryTransactionIsolation>('REPEATABLE READ'), [readOnly, setReadOnly] = useState(false);
  const [requiresRead, setRequiresRead] = useState(true), [invalid, setInvalid] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const requiresReadRef = useRef(true);

  /** 同步撤销读取资格，旧渲染闭包不能在失败后复用旧快照重发。 */
  function requireRead(value: boolean) { requiresReadRef.current = value; setRequiresRead(value); }

  /** 关闭不能抢在原请求落定前释放占用；X、Escape及底部按钮共用同一门。 */
  function close() { if (!pendingRef.current) latest.current.onClose(); }

  /** 每个选择创建新身份；选择往返、刷新与旧渲染回调不能复活先前的提交确认。 */
  function chooseAutomatic(enabled: boolean, acknowledged = false) {
    if (!mounted.current || pendingRef.current || requiresReadRef.current || !props.intent.current() || snapshotRef.current !== snapshot || automaticRef.current !== automatic) return;
    const next = { enabled, acknowledged }; automaticRef.current = next; setAutomatic(next);
  }

  /** 安装新鲜快照并撤销旧确认，默认值修改与自动提交不混成一条设置命令。 */
  function install(value: QueryTransactionSettingsSnapshot) {
    snapshotRef.current = value; setSnapshot(value); setIsolation(value.isolation); setReadOnly(value.readOnly);
    const next = { enabled: value.autocommit, acknowledged: false }; automaticRef.current = next; setAutomatic(next);
  }

  /** 仅显式点击发出一次；同一同步锁覆盖刷新、默认值应用、关闭及自动提交。 */
  async function applyAutomatic() {
    const before = snapshot, draft = automatic;
    if (!mounted.current || !before || snapshotRef.current !== before || automaticRef.current !== draft || !latest.current.onAutocommit || pendingRef.current || requiresReadRef.current || !props.intent.current() || before.autocommit === draft.enabled) return;
    const commits = draft.enabled && !before.autocommit && before.transactionOpen;
    if (commits && !draft.acknowledged) return;
    const epoch = ++generation.current;
    pendingRef.current = true; setPending('autocommit'); requireRead(true); setError(''); setStatus(t.autocommitApplying);
    try {
      const result = checkQueryAutocommitOutput(await latest.current.onAutocommit({ taskId: uid(), expected: before, autocommit: draft.enabled, allowImplicitCommit: commits && draft.acknowledged }), before, draft.enabled);
      props.intent.assertCurrent();
      if (!mounted.current || generation.current !== epoch) return;
      install(result.snapshot); requireRead(!!result.cleanupWarning); setStatus(queryAutocommitConfirmedMessage(result));
    } catch (reason) {
      if (mounted.current && generation.current === epoch) { setError(errorMessage(reason)); setStatus(t.retry); }
    } finally {
      if (mounted.current && generation.current === epoch) { pendingRef.current = false; setPending(null); }
    }
  }

  async function request(kind: 'read' | 'apply') {
    if (!mounted.current || pendingRef.current || !props.intent.current()) return;
    if (kind === 'apply' && (!snapshot || snapshotRef.current !== snapshot || requiresReadRef.current || snapshot.transactionOpen || snapshot.isolation === isolation && snapshot.readOnly === readOnly)) return;
    const epoch = ++generation.current; pendingRef.current = true; setPending(kind); setError(''); requireRead(true); setStatus(kind === 'read' ? t.loading : t.applying);
    const next = { enabled: automaticRef.current.enabled, acknowledged: false }; automaticRef.current = next; setAutomatic(next);
    try {
      const value = queryTransactionSettingsSnapshotSchema.parse(kind === 'read' ? await latest.current.onRead(uid()) : await latest.current.onApply({ taskId: uid(), expected: snapshot!, isolation, readOnly }));
      props.intent.assertCurrent();
      if (!mounted.current || generation.current !== epoch) return;
      if (snapshot && (value.serverConnectionId !== snapshot.serverConnectionId || value.dialect !== snapshot.dialect || value.serverVersion !== snapshot.serverVersion)) { setInvalid(true); throw Error(t.changed); }
      install(value); requireRead(false); setStatus(kind === 'read' ? t.ready : t.applied);
    } catch (reason) {
      if (mounted.current && generation.current === epoch) { setError(errorMessage(reason)); setStatus(t.retry); }
    } finally {
      if (mounted.current && generation.current === epoch) { pendingRef.current = false; setPending(null); }
    }
  }

  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const unsubscribe = props.intent.subscribe(() => { if (mounted.current) { setInvalid(true); requireRead(true); const next = { enabled: automaticRef.current.enabled, acknowledged: false }; automaticRef.current = next; setAutomatic(next); } });
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
      {props.onAutocommit && <section aria-label={t.autocommitTitle}>
        <h3>{t.autocommitTitle}</h3><p className="muted small">{t.autocommitNotice}</p>
        <label className="check"><input type="checkbox" aria-label={t.autocommitChoice} checked={automatic.enabled} disabled={blocked || requiresRead} onChange={event => chooseAutomatic(event.target.checked)}/>{t.autocommitChoice}</label>
        {snapshot && !snapshot.autocommit && automatic.enabled && snapshot.transactionOpen && <>
          <p role="alert">{t.implicitCommit}</p>
          <label className="check"><input type="checkbox" aria-label={t.acknowledgeCommit} checked={automatic.acknowledged} disabled={blocked || requiresRead} onChange={event => chooseAutomatic(automatic.enabled, event.target.checked)}/>{t.acknowledgeCommit}</label>
        </>}
        <button disabled={blocked || requiresRead || !snapshot || snapshot.autocommit === automatic.enabled || automatic.enabled && !snapshot.autocommit && snapshot.transactionOpen && !automatic.acknowledged} onClick={() => void applyAutomatic()}>{automatic.enabled ? snapshot?.transactionOpen && !snapshot.autocommit ? t.enableAndCommit : t.enableAutocommit : t.disableAutocommit}</button>
      </section>}
      <p role="status" aria-label={t.status}>{pending ? <Spinner text={status}/> : status}</p>
    </div>
    <footer style={{ flexShrink: 0, flexWrap: 'wrap' }}><button disabled={blocked} onClick={() => void request('read')}>{t.refresh}</button><button className="primary" disabled={blocked || requiresRead || unchanged || !!snapshot?.transactionOpen} onClick={() => void request('apply')}>{t.apply}</button><button disabled={!!pending} onClick={close}>{t.close}</button></footer>
  </div></div>;
}
