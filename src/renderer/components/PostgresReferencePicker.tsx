import { useEffect, useRef, useState } from 'react';
import { postgresTableReferenceLimits as limits, type PostgresTableField, type PostgresTableReference, type PostgresTableReferenceInput, type PostgresTableReferenceResult } from '../../shared/postgresTable';
import { postgresReferencePickerZh as text } from '../locales/postgresReferencePicker.zh-CN';
import { cellPreview, errorMessage, invoke } from '../lib';
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
  source: PostgresReferenceSource; onClose(): void; onChoose(fields: PostgresTableField[]): void;
}) {
  const [choices, setChoices] = useState<PostgresTableReference[]>();
  const [choice, setChoice] = useState<PostgresTableReference>();
  const [view, setView] = useState<View>();
  const [query, setQuery] = useState(''), [details, setDetails] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const latest = useRef(source); latest.current = source;
  const generation = useRef(0);
  const liveView = useRef<View>(undefined);

  /** 查询开始立即收起旧结果，避免搜索和翻页过程中使用旧行。 */
  async function load(key?: PostgresTableReference, search = '', offset = 0) {
    const request = ++generation.current, input = latest.current.input;
    const current = () => generation.current === request && latest.current.input.pageToken === input.pageToken && latest.current.current();
    if (!current()) { setError(text.expired); return; }
    liveView.current = undefined;
    setView(undefined);
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
  return <section className="pg-reference-picker" aria-label={text.title}>
    <div className="pg-table-controls">
      <select aria-label={text.constraint} value={choice?.id ?? ''} disabled={busy || !choices?.length} onChange={event => {
        const selected = choices?.find(item => item.id === event.target.value);
        if (!selected) return;
        setChoice(selected); setQuery(''); void load(selected);
      }}>
        {!choices?.length && <option value="">{text.constraint}</option>}
        {choices?.map(item => <option key={item.id} value={item.id}>{item.name} · {item.schema}.{item.table}</option>)}
      </select>
      <input type="search" aria-label={text.query} placeholder={text.query} value={query} maxLength={limits.search} disabled={busy || !choice}
        onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229 || busy || !choice) return;
          event.preventDefault(); event.stopPropagation(); void load(choice, query);
        }}/>
      <button type="button" disabled={busy || !choice} onClick={() => void load(choice, query)}>{text.search}</button>
      <button type="button" disabled={busy} onClick={() => { setQuery(''); void load(); }}>{text.refresh}</button>
      <button type="button" onClick={onClose}>{text.close}</button>
    </div>
    {choice && <p>{choice.pairs.map(pair => text.pair(pair.localName, pair.remote)).join('，')}</p>}
    {busy && <p role="status">{text.loading}</p>}
    <ErrorBox message={error}/>
    {!busy && choices?.length === 0 && <p>{text.emptyKeys}</p>}
    {view && <>
      <div className="pg-table-controls">
        <button type="button" disabled={view.offset === 0 || busy} onClick={() => void load(view.choice, view.search, view.offset - limits.page)}>{text.previous}</button>
        <button type="button" disabled={!view.page.hasNext || busy || view.offset + limits.page > limits.offset}
          onClick={() => void load(view.choice, view.search, view.offset + limits.page)}>{text.next}</button>
        <span>{view.page.rows.length ? text.range(view.offset, view.page.rows.length) : text.emptyRows}</span>
        <label className="check"><input type="checkbox" checked={details} onChange={event => setDetails(event.target.checked)}/>{text.details}</label>
      </div>
      {!!view.page.rows.length && <div className="pg-reference-candidates"><table>
        <thead><tr>{columns.map(column => <th key={column.key}>{column.name}</th>)}<th>{text.use}</th></tr></thead>
        <tbody>{view.page.rows.map((row, index) => <tr key={index}>
          {columns.map(column => <td key={column.key}>{cellPreview(row[column.key])}</td>)}
          <td><button type="button" disabled={busy} onClick={() => {
            try {
              if (liveView.current !== view || !latest.current.current()) throw Error(text.expired);
              onChoose(postgresReferenceSelection(view.choice, row));
              onClose();
            } catch (reason) { setError(errorMessage(reason)); }
          }}>{text.use}</button></td>
        </tr>)}</tbody>
      </table></div>}
    </>}
    <p className="muted small">{text.hint}</p>
  </section>;
}
