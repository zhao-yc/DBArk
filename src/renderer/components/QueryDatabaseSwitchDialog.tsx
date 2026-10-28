import { useEffect, useRef, useState } from 'react';
import type { QueryDatabaseSwitchIntent } from '../queryDatabaseSwitchIntent';
import type { QueryDatabaseSwitchOutput } from '../../shared/queryDatabaseSwitch';
import { queryDatabaseSwitchZh as t } from '../locales/queryDatabaseSwitch.zh-CN';
import { queryContextZh } from '../locales/queryContext.zh-CN';
import { errorMessage } from '../lib';
import { ErrorBox, Field, Spinner } from './ui';

interface Props {
  intent: QueryDatabaseSwitchIntent;
  onLoad(): Promise<readonly string[]>;
  onApply(database: string): Promise<QueryDatabaseSwitchOutput>;
  onClose(): void;
}

/** 真实目录选择与一次显式确认；加载、取消和关闭都不会自行投递切库命令。 */
export function QueryDatabaseSwitchDialog(props: Props) {
  const latest = useRef(props); latest.current = props;
  const root = useRef<HTMLDivElement>(null), mounted = useRef(false), pending = useRef(false), epoch = useRef(0);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'applying' | 'settled'>('loading');
  const [choices, setChoices] = useState<readonly string[]>([]), [database, setDatabase] = useState('');
  const [invalid, setInvalid] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const inFlight = phase === 'applying';
  /** 已发请求的窗口保持占用至终态；仅目录读取期间允许直接关闭。 */
  function close() { if (phase !== 'applying' && !pending.current) latest.current.onClose(); }
  async function apply() {
    if (pending.current || phase !== 'ready' || !database || !choices.includes(database) || !props.intent.current()) return;
    pending.current = true; setPhase('applying'); setError(''); const generation = epoch.current;
    try {
      const output = await latest.current.onApply(database); props.intent.assertCurrent();
      if (mounted.current && generation === epoch.current) setStatus(t.completed + output.database);
    } catch (reason) { if (mounted.current && generation === epoch.current) setError(errorMessage(reason)); }
    finally { if (mounted.current && generation === epoch.current) { pending.current = false; setPhase('settled'); } }
  }
  useEffect(() => {
    mounted.current = true; const generation = ++epoch.current, previous = document.activeElement as HTMLElement | null;
    const unsubscribe = props.intent.subscribe(() => { if (mounted.current) setInvalid(true); });
    void latest.current.onLoad().then(value => {
      props.intent.assertCurrent(); if (mounted.current && generation === epoch.current) { setChoices(value); setPhase('ready'); }
    }).catch(reason => { if (mounted.current && generation === epoch.current) { setError(errorMessage(reason)); setPhase('settled'); } });
    /** 捕获键盘防止模态期间的执行快捷键和焦点落入后台编辑器。 */
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!pending.current) latest.current.onClose(); }
      if (event.key === 'Tab') {
        const controls = root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled)');
        if (!controls?.length) return;
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
      }
    };
    document.addEventListener('keydown', keydown, true); root.current?.focus();
    return () => { mounted.current = false; epoch.current++; unsubscribe(); document.removeEventListener('keydown', keydown, true); previous?.focus(); };
  }, [props.intent]);
  const context = props.intent.expectedContext;
  return <div className="modal-overlay"><div ref={root} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-label={t.title} style={{ width: 'min(600px, calc(100vw - 24px))', maxHeight: 'calc(100vh - 24px)', overflow: 'auto' }}>
    <header><h2>{t.title}</h2><button className="icon-button" aria-label={t.dismiss} disabled={inFlight} onClick={close}>×</button></header>
    <div className="modal-body"><p>{t.notice}</p><p className="muted small">{t.diagnostics}</p><p>{t.current}：{context.state === 'known' ? context.database ?? queryContextZh.none : queryContextZh.unknown}</p>
      <ErrorBox message={error || (invalid ? t.changed : '')}/>
      <Field label={t.database}><select aria-label={t.database} value={database} disabled={phase !== 'ready' || invalid} onChange={event => setDatabase(event.target.value)}><option value="" disabled>{t.choose}</option>{choices.map(value => <option key={value} value={value}>{value}</option>)}</select></Field>
      {phase === 'loading' ? <Spinner text={t.loading}/> : phase === 'ready' && !choices.length ? <p>{t.empty}</p> : null}
      <p role="status">{inFlight ? <Spinner text={t.applying}/> : status}</p>
    </div><footer><button className="primary" disabled={phase !== 'ready' || invalid || !database} onClick={() => void apply()}>{t.confirm}</button><button disabled={inFlight} onClick={close}>{t.close}</button></footer>
  </div></div>;
}
