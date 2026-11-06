import { useState } from 'react';
import { FILTER_LIMITS } from '../../shared/filtering';
import { postgresTableValueLimits as limits, type PostgresTableValues } from '../../shared/postgresTable';
import { errorMessage, invoke } from '../lib';
import { postgresTableZh } from '../locales/postgresTable.zh-CN';
import { usePostgresColumnRead, type PostgresColumnReadSource } from '../postgresColumnRead';
import { ErrorBox, Field, Modal, Spinner } from './ui';

const text = postgresTableZh.valueOptions;
/** 读取仅使用打开时的原页能力，翻阅已读候选和加入筛选草稿均不访问数据库。 */
export function PostgresTableValueOptions({ source, onAdd, onClose }: {
  source: PostgresColumnReadSource;
  onAdd(column: string, values: (string | null)[], exclude: boolean): void;
  onClose(): void;
}) {
  const { origin, result, busy, error, setError, reading, read, reset } = usePostgresColumnRead<PostgresTableValues>(source, text.expired);
  const [column, setColumn] = useState(origin.initialColumn ?? origin.columns[0]?.key ?? '');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<readonly number[]>([]);
  const [exclude, setExclude] = useState(false);
  const [offset, setOffset] = useState(0);

  function add() {
    if (!result || !selected.length || reading.current) return;
    try {
      const field = origin.columns.find(item => item.key === column);
      if (!field || !origin.current()) throw Error(text.expired);
      onAdd(field.name, selected.map(index => result.options[index].value), exclude);
      onClose();
    } catch (reason) { setError(errorMessage(reason)); }
  }

  const visible = result?.options.slice(offset, offset + limits.page) ?? [];
  return <Modal title={text.open} onClose={onClose} wide>
    <div className="modal-content">
      <p className="muted small">{text.hint}</p>
      <form className="pg-table-controls" onSubmit={event => {
        event.preventDefault();
        if (!column || reading.current) return;
        setSelected([]); setOffset(0);
        void read(() => invoke('postgres.table.values', { ...origin.input, column, search }));
      }}>
        <Field label={text.column}><select aria-label={text.column} value={column} disabled={busy} onChange={event => {
          setColumn(event.target.value); reset(); setSelected([]); setOffset(0);
        }}>{origin.columns.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}</select></Field>
        <Field label={text.search}><input type="search" maxLength={limits.search} disabled={busy} value={search}
          onChange={event => setSearch(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
          }}/></Field>
        <button type="submit" disabled={busy || !column}>{text.read}</button>
      </form>
      {busy && <Spinner text={postgresTableZh.waiting}/>}
      <ErrorBox message={error}/>
      {result?.truncated && <p className="warning-text">{text.truncated}</p>}
      {result && !visible.length && <p>{text.empty}</p>}
      {result && !!visible.length && <>
        <div className="pg-reference-candidates pg-value-options">
          <table><thead><tr><th>{text.label}</th><th>{text.frequency}</th></tr></thead>
            <tbody>{visible.map((option, index) => {
              const position = offset + index, checked = selected.includes(position);
              const label = option.value === null ? 'NULL' : option.value === '' ? text.emptyString : JSON.stringify(option.value);
              return <tr key={position}>
                <td><label className="check"><input type="checkbox" checked={checked}
                  disabled={option.clipped || (!checked && selected.length >= FILTER_LIMITS.setValues)}
                  onChange={() => setSelected(checked ? selected.filter(item => item !== position) : [...selected, position])}/>
                <span title={option.clipped ? text.clipped : undefined}>{label}{option.clipped && ' …'}</span></label></td>
                <td>{option.count}</td>
              </tr>;
            })}</tbody></table>
        </div>
        <div className="pg-table-controls">
          <button type="button" disabled={!offset} onClick={() => setOffset(offset - limits.page)}>{postgresTableZh.previous}</button>
          <button type="button" disabled={offset + visible.length >= result.options.length} onClick={() => setOffset(offset + limits.page)}>{postgresTableZh.next}</button>
          <span>{text.range(offset + 1, offset + visible.length, result.options.length)}</span>
        </div>
      </>}
    </div>
    <footer className="modal-footer">
      <label className="check"><input type="checkbox" checked={exclude} onChange={event => setExclude(event.target.checked)}/>{text.exclude}</label>
      <span>{text.checked(selected.length, FILTER_LIMITS.setValues)}</span>
      <button type="button" onClick={onClose}>{postgresTableZh.cancel}</button>
      <button type="button" className="primary" disabled={busy || !result || !selected.length} onClick={add}>{text.add}</button>
    </footer>
  </Modal>;
}
