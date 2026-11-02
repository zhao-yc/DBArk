import { useMemo } from 'react';
import type { SqliteTableRebuildInspectOutput } from '../../shared/sqliteTableRebuild';
import { sqliteUniqueConflicts, sqliteTableUniqueLimits, type SqliteTableUniqueEdit } from '../../shared/sqliteTableUnique';
import { inspectSqliteTableUniques } from '../../shared/sqliteTableRebuildPlan';
import { sqliteUniqueNeedsAcknowledgement, sqliteUniqueSource, type SqliteUniqueAction, type SqliteUniqueForm } from '../sqliteUniqueEditor';
import { sqliteUniqueZh as text } from '../locales/sqliteUnique.zh-CN';
import { errorMessage } from '../lib';
import { ErrorBox, Field } from './ui';

interface Props { catalogue: SqliteTableRebuildInspectOutput; edits: readonly SqliteTableUniqueEdit[]; form?: SqliteUniqueForm; disabled: boolean; onAction(action: SqliteUniqueAction): void; }
/** UNIQUE区只发受控本地动作；预览、来源世代、关闭保护和真实提交由父窗口统一持有。 */
export function SqliteUniqueEditor({ catalogue, edits, form, disabled, onAction }: Props) {
  const originals = useMemo(() => { try { return { keys: inspectSqliteTableUniques(sqliteUniqueSource(catalogue)), error: '' }; } catch (reason) { return { keys: [], error: errorMessage(reason) }; } }, [catalogue]);
  const listDisabled = disabled || !!form || !!originals.error;
  /** 摘要始终显示准确原对象或新结构，移除项也不能只剩难以辨识的状态。 */
  function summary(edit: SqliteTableUniqueEdit): string {
    if (edit.kind === 'remove') { const original = originals.keys[edit.ordinal]; return original ? text.pendingRemove + '：' + (original.names.join(' / ') || text.unnamed) + ' · (' + original.columns.map(term => term.column).join('、') + ')' : text.invalid; }
    return (edit.kind === 'add' ? text.pendingAdd : text.pendingReplace) + '：' + (edit.definition.name ?? text.unnamed) + ' · (' + edit.definition.columns.map(term => term.column).join('、') + ')';
  }
  return <section className="sqlite-uniques" aria-label={text.title}><h3>{text.title}</h3><p className="muted small">{text.hint}</p><p className="muted small">{text.riskHint}</p>{catalogue.withoutRowid && <p className="warning-text">{text.wrHint}</p>}<ErrorBox message={originals.error}/>
    {!originals.keys.length && !originals.error && <p>{text.empty}</p>}
    <div className="sqlite-uniques-list">{originals.keys.map(key => { const pending = edits.find(edit => edit.kind !== 'add' && edit.ordinal === key.ordinal); return <article key={key.ordinal}><div className="sqlite-unique-heading"><strong>{key.ordinal + 1}. {key.names.join(' / ') || text.unnamed}</strong><span>({key.columns.map(term => term.column).join('、')}) · {text.locations[key.location]}</span><button type="button" disabled={listDisabled || pending?.kind === 'remove'} onClick={() => onAction({ kind: 'open', ordinal: key.ordinal })}>{text.edit(key.ordinal + 1)}</button><button type="button" disabled={listDisabled || pending?.kind === 'remove'} onClick={() => onAction({ kind: 'remove', ordinal: key.ordinal })}>{text.remove(key.ordinal + 1)}</button></div>{pending && <p className="warning-text">{summary(pending)}</p>}<details><summary>{text.original}</summary><pre>{key.sql}</pre></details></article>; })}</div>
    <button type="button" disabled={listDisabled} onClick={() => onAction({ kind: 'open' })}>{text.add}</button>
    {!!edits.length && <section aria-label={text.pending}><h4>{text.pending}</h4><ul>{edits.map((edit, index) => <li key={index}><span>{summary(edit)}</span>{edit.kind !== 'remove' && <button type="button" disabled={listDisabled} onClick={() => onAction({ kind: 'open', edit })}>{text.editPending(index + 1)}</button>}<button type="button" disabled={listDisabled} onClick={() => onAction({ kind: 'undo', edit })}>{text.undo(index + 1)}</button></li>)}</ul></section>}
    {form && <div className="sqlite-unique-form" role="group" aria-label={text.editor}><p>{text.formHint}</p><p className="muted small">{text.deferred}</p><div className="sqlite-rebuild-fields">
      <Field label={text.name}><input aria-label={text.name} maxLength={512} disabled={disabled} value={form.name} onChange={event => onAction({ kind: 'field', token: form.token, field: 'name', value: event.target.value })}/></Field>
      <Field label={text.location}><select aria-label={text.location} disabled={disabled} value={form.location} onChange={event => onAction({ kind: 'field', token: form.token, field: 'location', value: event.target.value })}>{Object.entries(text.locations).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field label={text.conflict}><select aria-label={text.conflict} disabled={disabled} value={form.conflict} onChange={event => onAction({ kind: 'field', token: form.token, field: 'conflict', value: event.target.value })}><option value="">{text.defaultConflict}</option>{sqliteUniqueConflicts.map(value => <option key={value} value={value}>{value}</option>)}</select></Field>
    </div><div className="sqlite-unique-fields" role="group" aria-label={text.fields}>{form.columns.map((term, index) => <div key={term.id} className="sqlite-unique-field">
      <Field label={text.column(index + 1)}><select aria-label={text.column(index + 1)} disabled={disabled} value={term.column} onChange={event => onAction({ kind: 'column', token: form.token, id: term.id, field: 'column', value: event.target.value })}><option value="">—</option>{catalogue.columns.map(column => <option key={column.name} value={column.name}>{column.name}</option>)}</select></Field>
      <Field label={text.collation(index + 1)}><input aria-label={text.collation(index + 1)} title={text.collationHint} maxLength={512} disabled={disabled} value={term.collation} onChange={event => onAction({ kind: 'column', token: form.token, id: term.id, field: 'collation', value: event.target.value })}/></Field>
      <Field label={text.order(index + 1)}><select aria-label={text.order(index + 1)} disabled={disabled} value={term.order} onChange={event => onAction({ kind: 'column', token: form.token, id: term.id, field: 'order', value: event.target.value })}><option value="">{text.defaultOrder}</option><option value="ASC">ASC</option><option value="DESC">DESC</option></select></Field>
      <button type="button" aria-label={text.up(index + 1)} disabled={disabled || index === 0} onClick={() => onAction({ kind: 'move', token: form.token, id: term.id, direction: -1 })}>↑</button><button type="button" aria-label={text.down(index + 1)} disabled={disabled || index === form.columns.length - 1} onClick={() => onAction({ kind: 'move', token: form.token, id: term.id, direction: 1 })}>↓</button><button type="button" disabled={disabled || form.columns.length <= 1} onClick={() => onAction({ kind: 'remove-field', token: form.token, id: term.id })}>{text.removeField(index + 1)}</button>
    </div>)}</div><button type="button" disabled={disabled || form.columns.length >= sqliteTableUniqueLimits.parts} onClick={() => onAction({ kind: 'add-field', token: form.token })}>{text.addField}</button>
    {sqliteUniqueNeedsAcknowledgement(form) && <><p className="warning-text">{text.legacy}</p><label><input type="checkbox" aria-label={text.legacyAck} disabled={disabled} checked={form.legacyAccepted} onChange={event => onAction({ kind: 'flag', token: form.token, field: 'legacyAccepted', value: event.target.checked })}/>{text.legacyAck}</label></>}
    <div className="sqlite-unique-actions"><button type="button" disabled={disabled} onClick={() => onAction({ kind: 'stage', token: form.token })}>{text.stage}</button><button type="button" disabled={disabled} onClick={() => onAction({ kind: 'cancel', token: form.token })}>{text.cancel}</button></div></div>}
  </section>;
}
