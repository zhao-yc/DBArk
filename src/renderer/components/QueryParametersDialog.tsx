import { useEffect, useRef, useState } from 'react';
import { Plus, Play, Trash2 } from 'lucide-react';
import { queryParameterTypes, validateQueryParameters, type QueryParameter, type QueryParameterNames, type QueryParameterType } from '../../shared/queryParameters';
import { errorMessage } from '../lib';
import { zh } from '../locales/zh-CN';
import { parameterZh as text } from '../locales/queryParameters.zh-CN';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import { SqlEditor } from './SqlEditor';
import '../queryParameters.css';

interface ParameterRow { id: number; parameter: QueryParameter; manual: boolean; }

/** 仅识别和填写参数；真正执行由拥有固定会话的查询标签统一管理。 */
export function QueryParametersDialog({ source, loadNames, onExecute, onClose, submitLabel, initialParameters = [] }: { source: string; loadNames: () => Promise<QueryParameterNames>; onExecute: (parameters: QueryParameter[]) => void; onClose: () => void; submitLabel?: string; initialParameters?: QueryParameter[] }) {
  const [rows, setRows] = useState<ParameterRow[]>([]); const [loading, setLoading] = useState(true); const loadingRef = useRef(false);
  const [info, setInfo] = useState<QueryParameterNames | null>(null); const [error, setError] = useState('');
  const sequence = useRef(0); const ready = useRef(false); const alive = useRef(true); const loader = useRef(loadNames); loader.current = loadNames;
  useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false; }; }, []);
  useEffect(() => {
    /** 模板预览和字段编辑的快捷键只作用于表单，不能执行后台 SQL 或保存参数值。 */
    const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('keydown', block, true); return () => document.removeEventListener('keydown', block, true);
  }, []);

  /** 手动重新识别时按名称保留已填写值，失败不静默丢弃用户输入。 */
  async function reload() {
    if (loadingRef.current) return;
    loadingRef.current = true; setLoading(true); setError(''); setInfo(null); ready.current = false;
    try {
      const next = await loader.current(); if (!alive.current) return;
      setRows(previous => {
        const existingRows = previous.length ? previous : initialParameters.map(parameter => ({ id: ++sequence.current, parameter, manual: true }));
        const existing = new Map(existingRows.map(row => [row.parameter.name, row]));
        return [...next.names.map(name => { const old = existing.get(name); return { id: old?.id ?? ++sequence.current, parameter: old?.parameter ?? { name, type: 'text' as const, value: '' }, manual: false }; }), ...existingRows.filter(row => row.manual && !next.names.includes(row.parameter.name))];
      });
      setInfo(next); ready.current = true;
    } catch (reason) { if (alive.current) setError(errorMessage(reason)); }
    finally { loadingRef.current = false; if (alive.current) setLoading(false); }
  }

  /** 每个输入值是普通文字；NULL 不携带值，整组预算与类型在本地先验证一次。 */
  function execute() {
    if (loadingRef.current || !ready.current) return;
    try {
      const parameters = rows.map(row => row.parameter.type === 'null' ? { name: row.parameter.name, type: 'null' as const } : { ...row.parameter });
      validateQueryParameters(parameters, info?.maxDecimalScale ?? 30, info?.allowTimeEndpointFraction ?? false);
      ready.current = false; onExecute(parameters);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  /** 使用稳定行编号更新，手动重命名不会串改同名行或覆盖另一个参数。 */
  function update(id: number, patch: Partial<QueryParameter>) { setRows(previous => previous.map(row => row.id === id ? { ...row, parameter: { ...row.parameter, ...patch } } : row)); }
  const hint = (type: QueryParameterType) => type === 'boolean' ? text.booleanHint : type === 'binary' ? text.binaryHint : type === 'date' ? text.dateHint : type === 'datetime' ? text.datetimeHint : type === 'time' ? text.timeHint : type === 'integer' || type === 'decimal' ? text.numericHint : text.textHint;
  return <Modal title={text.title} wide onClose={onClose}>
    <div className="modal-content parameter-content"><p className="muted small">{text.hint}</p><p className="muted small">{text.privacy}</p>
      <h3>{text.source}</h3>{source.length > 65536 && <p className="warning-text">{text.sourceTruncated}</p>}<SqlEditor value={source.slice(0, 65536)} readOnly height={160}/>
      <div className="parameter-actions">{loading ? <Spinner text={text.namesLoading}/> : !rows.length && <span className="muted small">{text.noParameters}</span>}<span className="grow"/><button disabled={loading} onClick={() => void reload()}>{text.retry}</button><button disabled={loading || rows.length >= 200} onClick={() => setRows(previous => [...previous, { id: ++sequence.current, parameter: { name: '', type: 'text', value: '' }, manual: true }])}><Plus size={13}/>{text.add}</button></div>
      {!!info?.warnings?.length && <div className="info-strip">{text.namesDynamic}<ul>{info.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
      <div className="parameter-list">{rows.map(row => <div className="parameter-row" key={row.id}>
        <Field label={`${text.name} ${row.id}`}><input readOnly={!row.manual} disabled={loading} maxLength={64} value={row.parameter.name} onChange={event => update(row.id, { name: event.target.value })}/></Field>
        <Field label={`${text.type} ${row.parameter.name || row.id}`}><select disabled={loading} value={row.parameter.type} onChange={event => update(row.id, { type: event.target.value as QueryParameterType, value: event.target.value === 'null' ? undefined : row.parameter.value ?? '' })}>{queryParameterTypes.map(type => <option value={type} key={type}>{text[type]}</option>)}</select></Field>
        <Field label={`${text.value} ${row.parameter.name || row.id}`}><textarea disabled={loading || row.parameter.type === 'null'} value={row.parameter.value ?? ''} maxLength={65536} rows={2} placeholder={row.parameter.type === 'null' ? 'NULL' : hint(row.parameter.type)} onChange={event => update(row.id, { value: event.target.value })}/></Field>
        {row.manual && <button className="icon-button" disabled={loading} aria-label={`${text.remove} ${row.id}`} onClick={() => setRows(previous => previous.filter(item => item.id !== row.id))}><Trash2 size={13}/></button>}
      </div>)}</div><p className="muted small">{text.dateNote}</p><ErrorBox message={error}/>
    </div><footer className="modal-footer"><button onClick={onClose}>{zh.common.cancel}</button><span className="grow"/><button className="primary" disabled={loading || !info} onClick={execute}><Play size={14}/>{submitLabel ?? text.execute}</button></footer>
  </Modal>;
}
