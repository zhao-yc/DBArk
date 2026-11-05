import { useMemo, useRef, useState } from 'react';
import type { PostgresTableColumn, PostgresTableField, PostgresTablePage } from '../../shared/postgresTable';
import { errorMessage } from '../lib';
import { postgresRecordViewZh as text } from '../locales/postgresRecordView.zh-CN';
import { postgresTableZh as tableText } from '../locales/postgresTable.zh-CN';
import { PostgresRecordFields, type PostgresRecordValues } from './PostgresRecordFields';
import { Empty, ErrorBox } from './ui';

export type PostgresRecordMove = 'first' | 'previous' | 'next' | 'last';
type RecordDraft = { kind: 'update'; fields: PostgresTableField[] } | { kind: 'delete' };

function equalFields(left: PostgresRecordValues, right: PostgresRecordValues): boolean {
  return left.size === right.size && Array.from(left).every(([key, value]) => {
    const saved = right.get(key);
    return saved?.mode === value.mode && (!('value' in value) || 'value' in saved && saved.value === value.value);
  });
}

/** 行输入只属于原页及原行。换行或跨页时通过 key 更换输入组件，字段导航偏好保留。 */
function RecordInput({ page, row, columns, draft, editable, onDirty, onStage }: {
  page: PostgresTablePage; row: number; columns: PostgresTableColumn[]; draft?: RecordDraft; editable: boolean;
  onDirty(dirty: boolean): void; onStage(fields: PostgresTableField[]): void;
}) {
  const saved = useMemo<PostgresRecordValues>(() => new Map(draft?.kind === 'update'
    ? draft.fields.map(field => [field.column, field.value]) : []), [draft]);
  const [input, setInput] = useState<PostgresRecordValues>();
  const pending = useRef<PostgresRecordValues>(undefined);
  const [error, setError] = useState('');

  function changeInput(change: (current: PostgresRecordValues) => PostgresRecordValues) {
    if (!editable) return;
    try {
      const next = change(pending.current ?? saved);
      const value = equalFields(next, saved) ? undefined : next;
      onDirty(!!value);
      pending.current = value;
      setInput(value);
      setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }

  function reset() {
    onDirty(false);
    pending.current = undefined;
    setInput(undefined);
    setError('');
  }

  return <>
    {draft && <p className="muted">{draft.kind === 'delete' ? text.deleted : text.staged}</p>}
    {!editable && !draft && <p className="muted">{tableText.noWrite}</p>}
    {input && <div className="pg-record-pending">
      <span role="status">{editable ? text.pending : text.expired}</span>
      <button type="button" onClick={reset}>{text.discard}</button>
      <button type="button" className="primary" disabled={!editable} onClick={() => {
        if (!pending.current) return;
        try { onStage(Array.from(pending.current, ([column, value]) => ({ column, value }))); reset(); }
        catch (reason) { setError(errorMessage(reason)); }
      }}>{text.stage}</button>
    </div>}
    <ErrorBox message={error}/>
    {columns.length ? <PostgresRecordFields columns={columns} original={page.rows[row]} fields={input ?? saved}
      editable={editable || !!input || draft?.kind === 'update'} disabled={!editable} inspect onChange={changeInput}/> : <Empty title={text.noFields}/>}
  </>;
}

export function PostgresTableRecordView({ page, row, offset, visible, draft, editable, moves, onMove, onDirty, onStage }: {
  page: PostgresTablePage; row: number | null; offset: number; visible: PostgresTableColumn[]; draft?: RecordDraft; editable: boolean;
  moves: Record<PostgresRecordMove, boolean>; onMove(move: PostgresRecordMove): void;
  onDirty(row: number, dirty: boolean): void; onStage(row: number, fields: PostgresTableField[]): void;
}) {
  const [showNavigation, setShowNavigation] = useState(true), [showHidden, setShowHidden] = useState(false), [query, setQuery] = useState('');
  const fieldArea = useRef<HTMLDivElement>(null);
  const columns = useMemo(() => {
    const candidates = showHidden ? [...visible, ...page.columns.filter(column => !visible.includes(column))] : visible;
    const needle = query.trim().toLowerCase();
    return candidates.filter(column => column.name.toLowerCase().includes(needle));
  }, [showHidden, visible, page.columns, query]);

  return <section className="pg-record-view" aria-label={text.title}>
    <div className="pg-table-controls pg-record-nav">
      {(['first', 'previous', 'next', 'last'] as const).map(move =>
        <button type="button" key={move} disabled={!moves[move]} onClick={() => onMove(move)}>{text[move]}</button>)}
      {row !== null && <strong>{text.position(row, offset, page.rows.length)}</strong>}
      <button type="button" aria-expanded={showNavigation} onClick={() => setShowNavigation(value => !value)}>{text.fields}</button>
      <label className="check"><input type="checkbox" checked={showHidden} onChange={event => setShowHidden(event.target.checked)}/>{text.hidden}</label>
      <input type="search" aria-label={text.search} placeholder={text.search} value={query} onChange={event => setQuery(event.target.value)}/>
    </div>
    {row === null || !page.rows[row] ? <Empty title={tableText.noSelection}/> : <div className="pg-record-body">
      {showNavigation && <nav aria-label={text.fields}>{columns.map(column => <button type="button" key={column.key} onClick={() => {
        const heading = fieldArea.current?.querySelector<HTMLElement>(`[data-record-column="${column.key}"] > strong`);
        heading?.scrollIntoView({ block: 'nearest' });
        heading?.focus({ preventScroll: true });
      }}>{column.name}</button>)}</nav>}
      <div className="pg-record-content" ref={fieldArea}>
        <RecordInput key={page.exportToken + ':' + row} page={page} row={row} columns={columns} draft={draft}
          editable={editable} onDirty={dirty => onDirty(row, dirty)} onStage={fields => onStage(row, fields)}/>
      </div>
    </div>}
  </section>;
}
