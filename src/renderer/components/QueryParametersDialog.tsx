import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus, Play, Trash2 } from 'lucide-react';
import { queryParameterTypes, validateQueryParameters, type QueryParameter, type QueryParameterNames, type QueryParameterType } from '../../shared/queryParameters';
import { errorMessage } from '../lib';
import { zh } from '../locales/zh-CN';
import { parameterZh as text } from '../locales/queryParameters.zh-CN';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import { SqlEditor } from './SqlEditor';
import '../queryParameters.css';
import type { QueryParameterReusePort } from '../queryParameterReusePort';
import { queryParameterReuseZh as reuseText } from '../locales/queryParameterReuse.zh-CN';

interface ParameterRow { id: number; parameter: QueryParameter; manual: boolean; }

/** 仅识别和填写参数；真正执行由拥有固定会话的查询标签统一管理。 */
export function QueryParametersDialog({ source, loadNames, onExecute, onClose, submitLabel, initialParameters = [], reuse }: { source: string; loadNames: () => Promise<QueryParameterNames>; onExecute: (parameters: QueryParameter[]) => void; onClose: () => void; submitLabel?: string; initialParameters?: QueryParameter[]; reuse?: QueryParameterReusePort }) {
  const [rows, setRows] = useState<ParameterRow[]>([]); const [loading, setLoading] = useState(true); const loadingRef = useRef(false);
  const [info, setInfo] = useState<QueryParameterNames | null>(null); const [error, setError] = useState('');
  const sequence = useRef(0); const ready = useRef(false); const alive = useRef(true); const loader = useRef(loadNames); loader.current = loadNames;
  const original = useRef({ source, reuse }), invalid = useRef(false), live = useRef<object | undefined>(undefined), ticket = {};
  const loadGeneration = useRef(0), infoRef = useRef<QueryParameterNames | null>(null), rememberRef = useRef(false), closing = useRef(false);
  const [, refreshFrame] = useState(0), actionOwner = useRef<object | null>(null), reuseInvalid = useRef(false);
  const [remember, setRemember] = useState(false), [reusable, setReusable] = useState(false), [notice, setNotice] = useState('');
  if (source !== original.current.source || reuse !== original.current.reuse) { invalid.current = true; ready.current = false; }
  useLayoutEffect(() => { live.current = ticket; return () => { if (live.current === ticket) live.current = undefined; }; });
  /** 旧渲染、已卸载或变更过的来源不能借后来恢复的表单再次提交。 */
  function frame(): boolean { return alive.current && !closing.current && !invalid.current && live.current === ticket; }
  /** 外部能力通知可能同步重入；先撤当前事件票据，下一次提交必须来自新的已提交渲染。 */
  function revokeFrame(): object { const action = {}; actionOwner.current = action; live.current = undefined; refreshFrame(value => value + 1); return action; }
  /** 主动撤渲染票据后，原操作靠独立token续接；新动作、关闭、卸载及来源变化仍立即撤销。 */
  function actionLocal(action: object): boolean { return alive.current && !closing.current && !invalid.current && actionOwner.current === action; }
  /** 暂存来源失效只撤销复用能力，原捕获模板的普通参数执行仍沿原路径。 */
  function reuseCurrent(): boolean {
    if (!alive.current || closing.current || invalid.current || reuseInvalid.current) return false;
    let current = true;
    try { current = !reuse || reuse.current(); } catch { current = false; }
    if (!current) { reuseInvalid.current = true; if (alive.current) setReusable(false); return false; }
    return !reuseInvalid.current;
  }
  /** 外部RAM能力可同步通知或重入；普通执行仅核原表单，复用动作额外核暂存来源。 */
  function actionCurrent(action: object, requireReuse = false): boolean { return actionLocal(action) && (!requireReuse || reuseCurrent()) && actionLocal(action); }

  useEffect(() => {
    if (!reuse) return;
    const update = () => {
      if (!alive.current || closing.current || invalid.current) return;
      const current = infoRef.current;
      if (!reuseCurrent()) return;
      if (!current) { setReusable(false); return; }
      // 订阅不创建新操作；正常has通知不撤销正在进行的原操作。
      let available = false;
      try { available = reuse.has(current); } catch { available = false; }
      if (!reuseCurrent()) return;
      if (alive.current && !closing.current && !invalid.current && current === infoRef.current && reuse === original.current.reuse) setReusable(available);
    };
    const off = reuse.subscribe(update); update(); return off;
  }, [reuse]);
  useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false; actionOwner.current = null; }; }, []);
  useEffect(() => {
    /** 模板预览和字段编辑的快捷键只作用于表单，不能执行后台 SQL 或保存参数值。 */
    const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('keydown', block, true); return () => document.removeEventListener('keydown', block, true);
  }, []);

  /** 手动重新识别时按名称保留已填写值，失败不静默丢弃用户输入。 */
  async function reload() {
    if (!frame() || loadingRef.current) return;
    const generation = ++loadGeneration.current, action = revokeFrame();
    loadingRef.current = true; setLoading(true); setError(''); setInfo(null); ready.current = false;
    try {
      const next = await loader.current(); if (loadGeneration.current !== generation || !actionCurrent(action)) return;
      let available = !!reuse && reuseCurrent() && reuse.has(next); if (loadGeneration.current !== generation || !actionCurrent(action)) return;
      if (reuse && !reuseCurrent()) available = false;
      if (loadGeneration.current !== generation || !actionCurrent(action)) return;
      setRows(previous => {
        const existingRows = previous.length ? previous : initialParameters.map(parameter => ({ id: ++sequence.current, parameter, manual: true }));
        const existing = new Map(existingRows.map(row => [row.parameter.name, row]));
        return [...next.names.map(name => { const old = existing.get(name); return { id: old?.id ?? ++sequence.current, parameter: old?.parameter ?? { name, type: 'text' as const, value: '' }, manual: false }; }), ...existingRows.filter(row => row.manual && !next.names.includes(row.parameter.name))];
      });
      infoRef.current = next; setInfo(next); ready.current = true;
      setReusable(available);
    } catch (reason) { if (loadGeneration.current === generation && actionCurrent(action)) setError(errorMessage(reason)); }
    finally { if (loadGeneration.current === generation) { loadingRef.current = false; if (alive.current) setLoading(false); } }
  }

  /** 每个输入值是普通文字；NULL 不携带值，整组预算与类型在本地先验证一次。 */
  function execute() {
    if (!frame() || loadingRef.current || !ready.current) return;
    let handedOff = false, action: object | undefined;
    try {
      const parameters = rows.map(row => row.parameter.type === 'null' ? { name: row.parameter.name, type: 'null' as const } : { ...row.parameter });
      validateQueryParameters(parameters, info?.maxDecimalScale ?? 30, info?.allowTimeEndpointFraction ?? false);
      ready.current = false; action = revokeFrame();
      if (!actionCurrent(action)) return;
      if (rememberRef.current) {
        if (!reuse || !info || !actionCurrent(action, true)) throw Error(reuseText.unavailable);
        const accepted = reuse.stage(info, parameters.map(parameter => ({ ...parameter })));
        if (!actionCurrent(action)) return;
        if (!actionCurrent(action, true) || !accepted) throw Error(reuseText.unavailable);
      }
      if (!actionCurrent(action)) return;
      handedOff = true; onExecute(parameters);
    } catch (reason) {
      const current = action ? actionCurrent(action) : frame();
      if (current) { if (!handedOff) ready.current = true; setError(errorMessage(reason)); }
    }
  }

  /** 使用稳定行编号更新，手动重命名不会串改同名行或覆盖另一个参数。 */
  function update(id: number, patch: Partial<QueryParameter>) { if (frame() && !loadingRef.current) setRows(previous => previous.map(row => row.id === id ? { ...row, parameter: { ...row.parameter, ...patch } } : row)); }
  /** 只在明确点击时填入完整副本；不识别参数、不投递SQL，不截取手动参数。 */
  function fillPrevious(): void {
    if (!frame() || loadingRef.current || !ready.current || !reuse || !info) return;
    const action = revokeFrame();
    try {
      if (!actionCurrent(action, true)) return;
      const values = reuse.read(info); if (!actionCurrent(action, true)) return;
      if (!values) { setReusable(false); setError(reuseText.missing); return; }
      validateQueryParameters(values, info.maxDecimalScale, info.allowTimeEndpointFraction);
      const next = values.map(parameter => ({ id: ++sequence.current, parameter: { ...parameter }, manual: !info.names.includes(parameter.name) }));
      if (!actionCurrent(action, true)) return;
      setRows(next); setError(''); setNotice(reuseText.filled);
    } catch { if (actionCurrent(action)) setError(reuseText.missing); }
  }
  /** 撤销勾选会立即忘记旧组；当前输入不进入持久化或自动执行路径。 */
  function changeRemember(value: boolean): void {
    if (!frame() || loadingRef.current || !reuse || value === rememberRef.current) return;
    const action = revokeFrame();
    // 失效后仍允许明确取消暂存；先同步清本地选择，再尽力通知父能力，不能锁死普通执行。
    if (!value) {
      rememberRef.current = false; setRemember(false); setError('');
      try { reuse.setOptIn(false); } catch { /* 父能力失效不能阻止用户取消暂存。 */ }
      return;
    }
    try {
      if (!actionCurrent(action, true)) { if (actionLocal(action)) setError(reuseText.unavailable); return; }
      const accepted = reuse.setOptIn(true); if (!actionCurrent(action)) return;
      if (!actionCurrent(action, true) || !accepted) { if (actionLocal(action)) setError(reuseText.unavailable); return; }
      rememberRef.current = true; setRemember(true); setError('');
    } catch { if (actionCurrent(action)) setError(reuseText.unavailable); }
  }
  /** 忘记先清本地选择且保留输入；父能力已失效时也不阻断普通执行。 */
  function forgetPrevious(): void {
    if (!frame() || loadingRef.current || !reuse) return;
    revokeFrame(); rememberRef.current = false; setRemember(false); setReusable(false); setNotice('');
    try { reuse.forget(); } catch { /* 忘记失败不恢复本地暂存选择或丢弃表单输入。 */ }
  }
  /** 新的有效取消可关闭失效表单；旧渲染或卸载后的取消不能关闭后继弹窗。 */
  function close(): void { if (!alive.current || live.current !== ticket || closing.current) return; closing.current = true; ready.current = false; revokeFrame(); onClose(); }
  const hint = (type: QueryParameterType) => type === 'boolean' ? text.booleanHint : type === 'binary' ? text.binaryHint : type === 'date' ? text.dateHint : type === 'datetime' ? text.datetimeHint : type === 'time' ? text.timeHint : type === 'integer' || type === 'decimal' ? text.numericHint : text.textHint;
  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content parameter-content"><p className="muted small">{text.hint}</p><p className="muted small">{reuse ? reuseText.privacy : text.privacy}</p>
      {reuse && <section aria-label={reuseText.title}><p>{reuseText.hint}</p><p>{reuseText.overwrite}</p><label><input type="checkbox" checked={remember} disabled={loading || !info} onChange={event => changeRemember(event.target.checked)}/>{reuseText.remember}</label><div className="parameter-actions"><button type="button" disabled={loading || !info || !reusable} onClick={fillPrevious}>{reuseText.fill}</button><button type="button" disabled={loading || !info || !reusable && !remember} onClick={forgetPrevious}>{reuseText.forget}</button></div>{notice && <p role="status">{notice}</p>}</section>}
      <h3>{text.source}</h3>{source.length > 65536 && <p className="warning-text">{text.sourceTruncated}</p>}<SqlEditor value={source.slice(0, 65536)} readOnly height={160}/>
      <div className="parameter-actions">{loading ? <Spinner text={text.namesLoading}/> : !rows.length && <span className="muted small">{text.noParameters}</span>}<span className="grow"/><button disabled={loading} onClick={() => void reload()}>{text.retry}</button><button disabled={loading || rows.length >= 200} onClick={() => { if (frame() && !loadingRef.current) setRows(previous => previous.length >= 200 ? previous : [...previous, { id: ++sequence.current, parameter: { name: '', type: 'text', value: '' }, manual: true }]); }}><Plus size={13}/>{text.add}</button></div>
      {!!info?.warnings?.length && <div className="info-strip">{text.namesDynamic}<ul>{info.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
      <div className="parameter-list">{rows.map(row => <div className="parameter-row" key={row.id}>
        <Field label={`${text.name} ${row.id}`}><input readOnly={!row.manual} disabled={loading} maxLength={64} value={row.parameter.name} onChange={event => update(row.id, { name: event.target.value })}/></Field>
        <Field label={`${text.type} ${row.parameter.name || row.id}`}><select disabled={loading} value={row.parameter.type} onChange={event => update(row.id, { type: event.target.value as QueryParameterType, value: event.target.value === 'null' ? undefined : row.parameter.value ?? '' })}>{queryParameterTypes.map(type => <option value={type} key={type}>{text[type]}</option>)}</select></Field>
        <Field label={`${text.value} ${row.parameter.name || row.id}`}><textarea disabled={loading || row.parameter.type === 'null'} value={row.parameter.value ?? ''} maxLength={65536} rows={2} placeholder={row.parameter.type === 'null' ? 'NULL' : hint(row.parameter.type)} onChange={event => update(row.id, { value: event.target.value })}/></Field>
        {row.manual && <button className="icon-button" disabled={loading} aria-label={`${text.remove} ${row.id}`} onClick={() => { if (frame() && !loadingRef.current) setRows(previous => previous.filter(item => item.id !== row.id)); }}><Trash2 size={13}/></button>}
      </div>)}</div><p className="muted small">{text.dateNote}</p><ErrorBox message={error}/>
    </div><footer className="modal-footer"><button onClick={close}>{zh.common.cancel}</button><span className="grow"/><button className="primary" disabled={loading || !info || !ready.current || invalid.current || closing.current} onClick={execute}><Play size={14}/>{submitLabel ?? text.execute}</button></footer>
  </Modal>;
}
