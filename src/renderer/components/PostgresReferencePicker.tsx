import { useEffect, useRef, useState } from 'react';
import { postgresTableReferenceLimits as limits, type PostgresTableField, type PostgresTableReference, type PostgresTableReferenceInput, type PostgresTableReferenceResult } from '../../shared/postgresTable';
import { postgresReferencePickerZh as text } from '../locales/postgresReferencePicker.zh-CN';
import { postgresRecordViewZh as recordText } from '../locales/postgresRecordView.zh-CN';
import { cellPreview, cellText, errorMessage, invoke } from '../lib';
import { postgresReferenceSelection } from '../postgresReferenceSelection';
import { ErrorBox } from './ui';

export interface PostgresReferenceSource {
  input: Omit<PostgresTableReferenceInput, 'lookup'>;
  current(): boolean;
}
type CandidatePage = NonNullable<PostgresTableReferenceResult['page']>;
type View = { choice: PostgresTableReference; page: CandidatePage; offset: number; search: string };

/** 候选回包属于打开时的表单和查询代次，填入操作只写父级字段输入。 */
export function PostgresReferencePicker({ source, onClose, onChoose }: {
  source: PostgresReferenceSource; onClose(): void; onChoose?(fields: PostgresTableField[]): void;
}) {
  const parent = source.input.parentRow !== undefined, children = source.input.childrenRow !== undefined;
  const browse = parent || children;
  const [choices, setChoices] = useState<PostgresTableReference[]>();
  const [choice, setChoice] = useState<PostgresTableReference>();
  const [view, setView] = useState<View>();
  const [query, setQuery] = useState(''), [details, setDetails] = useState(true);
  const [expanded, setExpanded] = useState<string>();
  const [childIndex, setChildIndex] = useState<number>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const latest = useRef(source); latest.current = source;
  const generation = useRef(0);
  const liveView = useRef<View>(undefined);

  /** 查询开始立即收起旧结果，避免搜索和翻页过程中使用旧行。 */
  async function load(key?: PostgresTableReference, search = '', offset = 0) {
    const request = ++generation.current, input = latest.current.input;
    const current = () => generation.current === request && latest.current.input.pageToken === input.pageToken &&
      latest.current.input.parentRow === input.parentRow && latest.current.input.childrenRow === input.childrenRow &&
      latest.current.current();
    if (!current()) { setError(text.expired); return; }
    liveView.current = undefined;
    setView(undefined);
    setExpanded(undefined);
    setChildIndex(undefined);
    setBusy(true);
    setError('');
    try {
      if (!key) {
        const result = await invoke('postgres.table.references', input);
        if (!current()) return;
        setChoices(result.choices);
        key = result.choices[0];
        setChoice(key);
        if (!key) return;
      }
      const wanted = key;
      const result = await invoke('postgres.table.references', { ...input, lookup: { id: wanted.id, stamp: wanted.stamp, search, offset } });
      if (!current()) return;
      const confirmed = result.choices.find(item => item.id === wanted.id && item.stamp === wanted.stamp);
      if (!confirmed || !result.page) throw Error(text.expired);
      const next = { choice: confirmed, page: result.page, offset, search };
      setChoices(result.choices);
      liveView.current = next;
      setView(next);
    } catch (reason) { if (current()) setError(errorMessage(reason)); }
    finally { if (generation.current === request) setBusy(false); }
  }

  useEffect(() => {
    void load();
    return () => { generation.current++; liveView.current = undefined; };
  }, []);

  const columns = view ? details ? view.page.columns : view.page.columns.slice(0, view.choice.pairs.length) : [];
  const record = view?.page.rows[parent ? 0 : childIndex ?? -1];
  const emptyDirectory = children ? text.emptyChildKeys : parent ? text.emptyBrowseKeys : text.emptyKeys;
  return <section className="pg-reference-picker" aria-label={children ? text.childrenTitle : parent ? text.browseTitle : text.title}>
    <div className="pg-table-controls">
      <select aria-label={text.constraint} value={choice?.id ?? ''} disabled={busy || !choices?.length} onChange={event => {
        const selected = choices?.find(item => item.id === event.target.value);
        if (!selected) return;
        setChoice(selected); setQuery(''); void load(selected);
      }}>
        {!choices?.length && <option value="">{text.constraint}</option>}
        {choices?.map(item => <option key={item.id} value={item.id}>{item.name} · {item.schema}.{item.table}</option>)}
      </select>
      {!parent && <><input type="search" aria-label={children ? text.childQuery : text.query} placeholder={children ? text.childQuery : text.query}
        value={query} maxLength={limits.search} disabled={busy || !choice}
        onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229 || busy || !choice) return;
          event.preventDefault(); event.stopPropagation(); void load(choice, query);
        }}/>
      <button type="button" disabled={busy || !choice} onClick={() => void load(choice, query)}>{children ? text.childSearch : text.search}</button></>}
      <button type="button" disabled={busy} onClick={() => { setQuery(''); void load(); }}>{text.refresh}</button>
      {!browse && <button type="button" onClick={onClose}>{text.close}</button>}
    </div>
    {browse && choice && <p><strong>{children ? text.childTable : text.parentTable}</strong>　{choice.schema}.{choice.table}</p>}
    {choice && <p>{choice.pairs.map(pair => (children ? text.childPair : text.pair)(pair.localName, pair.remote)).join('，')}</p>}
    {busy && <p role="status">{text.loading}</p>}
    <ErrorBox message={error}/>
    {!busy && choices?.length === 0 && <p>{emptyDirectory}</p>}
    {children && record && <button type="button" onClick={() => { setChildIndex(undefined); setExpanded(undefined); }}>{text.backToChildren}</button>}
    {view && record && <div className="pg-reference-candidates pg-reference-record"><table>
      <tbody>{view.page.columns.map(column => {
        const value = record[column.key], open = expanded === column.key;
        return <tr key={column.key}><th scope="row">{column.name}</th><td>
          {value === null ? recordText.null : value === '' ? recordText.empty : cellPreview(value)}
          {value != null && value !== '' && <button type="button" aria-expanded={open} aria-label={recordText.raw(column.name)}
            onClick={() => setExpanded(open ? undefined : column.key)}>{open ? recordText.closeValue : recordText.fullValue}</button>}
          {open && <textarea readOnly aria-label={recordText.raw(column.name)} rows={3} value={cellText(value)}/>}
        </td></tr>;
      })}</tbody>
    </table></div>}
    {parent && view && !record && <p>{text.emptyParent}</p>}
    {!parent && !record && view && <>
      <div className="pg-table-controls">
        <button type="button" disabled={view.offset === 0 || busy}
          onClick={() => void load(view.choice, view.search, view.offset - limits.page)}>{children ? text.childPrevious : text.previous}</button>
        <button type="button" disabled={!view.page.hasNext || busy || view.offset + limits.page > limits.offset}
          onClick={() => void load(view.choice, view.search, view.offset + limits.page)}>{children ? text.childNext : text.next}</button>
        <span>{view.page.rows.length ? (children ? text.childRange : text.range)(view.offset, view.page.rows.length)
          : children ? text.emptyChildren : text.emptyRows}</span>
        <label className="check"><input type="checkbox" checked={details} onChange={event => setDetails(event.target.checked)}/>{text.details}</label>
      </div>
      {!!view.page.rows.length && <div className={children ? 'pg-reference-candidates pg-reference-children' : 'pg-reference-candidates'}><table>
        <thead><tr>{columns.map(column => <th key={column.key}>{column.name}</th>)}<th>{children ? text.inspectChild : text.use}</th></tr></thead>
        <tbody>{view.page.rows.map((row, index) => <tr key={index}>
          {columns.map(column => {
            const value = cellPreview(row[column.key]);
            return <td key={column.key}>{children ? <span>{value}</span> : value}</td>;
          })}
          <td><button type="button" disabled={busy} onClick={() => {
            try {
              if (liveView.current !== view || !latest.current.current()) throw Error(text.expired);
              if (children) setChildIndex(index);
              else if (onChoose) { onChoose(postgresReferenceSelection(view.choice, row)); onClose(); }
            } catch (reason) { setError(errorMessage(reason)); }
          }}>{children ? text.inspectChild : text.use}</button></td>
        </tr>)}</tbody>
      </table></div>}
    </>}
    <p className="muted small">{children ? text.childrenHint : parent ? text.browseHint : text.hint}</p>
  </section>;
}
