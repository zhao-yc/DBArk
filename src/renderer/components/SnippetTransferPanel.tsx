import { useEffect, useRef, useState } from 'react';
import type { SqlSnippet } from '../../shared/contracts';
import { snippetTransferZh as text, type SnippetTransferAction, type SnippetTransferPreview } from '../../shared/snippetTransfer';
import { errorMessage, invoke } from '../lib';
import { ErrorBox } from './ui';

/** 文件能力只存活于当前片段弹窗；迟到响应只释放能力，不更新界面或自动确认。 */
export function SnippetTransferPanel({ blocked, authorize, onActive, onApplied }: { blocked: boolean; authorize(action: () => void): void; onActive(active: boolean): void; onApplied(items: SqlSnippet[]): void }) {
  const [busy, setBusy] = useState<'import' | 'export' | 'apply' | null>(null), [preview, setPreview] = useState<SnippetTransferPreview | null>(null);
  const [actions, setActions] = useState<Record<string, SnippetTransferAction>>({}), [error, setError] = useState(''), [message, setMessage] = useState(''), [cancelling, setCancelling] = useState(false);
  const alive = useRef(true), generation = useRef(0), scope = useRef<string | undefined>(undefined), locked = useRef(false);
  const callbacks = useRef({ onActive, onApplied }); callbacks.current = { onActive, onApplied };
  /** 关闭只属于本弹窗的能力；卸载后的失败不恢复UI或触发自动重试。 */
  function release(id: string) { void invoke('snippets.transferCancel', { scopeId: id, close: true }).catch(() => {}); }
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; if (scope.current) release(scope.current); scope.current = undefined; }; }, []);
  /** 终态先使本代次所有迟到回包失效，再统一解除父锁并丢弃一次性预览。 */
  function finish() { generation.current++; if (scope.current) release(scope.current); scope.current = undefined; locked.current = false; setBusy(null); setPreview(null); setCancelling(false); callbacks.current.onActive(false); }
  /** 必须经父弹窗的未保存确认后才申请Main文档能力。 */
  function request(mode: 'import' | 'export') {
    if (blocked || locked.current) return;
    authorize(() => { if (!locked.current) void start(mode); });
  }
  /** 原生文件能力与后续响应绑定同一代次，迟到结果不能借新弹窗继续操作。 */
  async function start(mode: 'import' | 'export') {
    locked.current = true; callbacks.current.onActive(true); setBusy(mode); setError(''); setMessage('');
    const turn = ++generation.current; let retain = false;
    const current = () => alive.current && generation.current === turn;
    try {
      const opened = await invoke('snippets.transferOpen', {});
      if (!current()) { release(opened.scopeId); return; } scope.current = opened.scopeId;
      if (mode === 'import') {
        const result = await invoke('snippets.transferPreview', { scopeId: opened.scopeId }); if (!current()) return;
        if (result) {
          retain = true; setPreview(result);
          // 同ID替换和同名新增均默认跳过，避免文件选择就隐式覆盖或引入歧义。
          setActions(Object.fromEntries(result.entries.map(entry => [entry.snippet.id, entry.status === 'add' && !entry.warnings.length ? 'add' : 'skip'])));
        }
      } else {
        const result = await invoke('snippets.transferExport', { scopeId: opened.scopeId }); if (current() && result) setMessage(text.exported(result.count));
      }
    } catch (reason) { if (current()) setError(errorMessage(reason)); }
    finally { if (current()) { if (retain) setBusy(null); else finish(); } }
  }
  /** 取消必须以Main返回为准；文件已跨过rename提交点时保留等待状态。 */
  async function cancel() {
    if (busy === 'apply' || cancelling) return; setCancelling(true); const turn = generation.current;
    try {
      if (scope.current) {
        const result = await invoke('snippets.transferCancel', { scopeId: scope.current });
        if (!alive.current || generation.current !== turn) return;
        if (!result.cancelled) { setMessage(text.committing); return; }
      }
      finish();
    } catch (reason) {
      // 取消请求失败不代表原传输结束；保留代次、scope及父锁，等待原操作的真实结局。
      if (alive.current && generation.current === turn) setError(errorMessage(reason));
    }
    finally { if (alive.current && generation.current === turn) setCancelling(false); }
  }
  /** 确认仅回传ID和动作；成功、失败都消费该预览，禁止自动重放。 */
  async function apply() {
    if (!preview || !scope.current || busy || cancelling) return; const turn = generation.current; setBusy('apply'); setError('');
    try {
      const result = await invoke('snippets.transferApply', { scopeId: scope.current, previewId: preview.previewId, decisions: preview.entries.map(entry => ({ id: entry.snippet.id, action: actions[entry.snippet.id] })) });
      if (alive.current && generation.current === turn) { callbacks.current.onApplied(result.items); setMessage(text.applied(result.added, result.replaced, result.skipped)); }
    } catch (reason) { if (alive.current && generation.current === turn) setError(errorMessage(reason)); }
    finally { if (alive.current && generation.current === turn) finish(); }
  }
  // 外层标识文件操作区，只有实际差异区域使用预览名称，避免同名区域和空预览误报。
  return <section className="snippet-transfer" aria-label={text.region}>
    <div><button disabled={blocked || !!busy || !!preview || cancelling} onClick={() => request('export')}>{text.export}</button><button disabled={blocked || !!busy || !!preview || cancelling} onClick={() => request('import')}>{text.import}</button>{(busy || preview) && <button disabled={busy === 'apply' || cancelling} onClick={() => void cancel()}>{preview ? text.closePreview : text.cancel}</button>}</div>
    <p className="muted small">{text.hint}</p><ErrorBox message={error}/>{message && <p role="status">{message}</p>}
    {preview && <div role="region" aria-label={text.preview}><h3>{text.preview}</h3>{preview.entries.map(entry => <article key={entry.snippet.id} className="snippet-transfer-entry">
      <strong>{entry.snippet.name} · {text[entry.status]}</strong><p className="muted small">ID：{entry.snippet.id}</p>{entry.warnings.map(warning => <p key={warning}>{warning}</p>)}
      <label>{entry.snippet.name}<select aria-label={`${entry.snippet.name}（${entry.snippet.id}）导入动作`} disabled={!!busy || cancelling} value={actions[entry.snippet.id]} onChange={event => setActions(previous => ({ ...previous, [entry.snippet.id]: event.target.value as SnippetTransferAction }))}><option value="skip">{text.skip}</option>{entry.status !== 'same' && <option value={entry.status}>{text[entry.status]}</option>}</select></label>
      {entry.previous && <details><summary>{text.previous}</summary><p>{entry.previous.name} · {entry.previous.group}</p><p className="snippet-description">{entry.previous.description}</p><pre>{entry.previous.sql}</pre></details>}
      <details><summary>{text.incoming}</summary><p>{entry.snippet.name} · {entry.snippet.group}</p><p className="snippet-description">{entry.snippet.description}</p><pre>{entry.snippet.sql}</pre></details>
    </article>)}<button className="primary" disabled={!!busy || cancelling} onClick={() => void apply()}>{text.confirm}</button></div>}
  </section>;
}
