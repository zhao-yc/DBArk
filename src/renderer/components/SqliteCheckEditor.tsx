import { useMemo } from 'react';
import type { SqliteTableRebuildInspectOutput } from '../../shared/sqliteTableRebuild';
import { sqliteTableCheckLimits, type SqliteTableCheckEdit } from '../../shared/sqliteTableChecks';
import { inspectSqliteTableChecks } from '../../shared/sqliteTableRebuildPlan';
import { sqliteCheckNeedsAcknowledgement, sqliteCheckSource, type SqliteCheckAction, type SqliteCheckForm } from '../sqliteCheckEditor';
import { sqliteCheckZh as text } from '../locales/sqliteCheck.zh-CN';
import { errorMessage } from '../lib';
import { ErrorBox, Field } from './ui';

interface Props { catalogue: SqliteTableRebuildInspectOutput; edits: readonly SqliteTableCheckEdit[]; form?: SqliteCheckForm; disabled: boolean; onAction(action: SqliteCheckAction): void; }
/** CHECK只产生本地动作；草稿归属、预览代次和真实写入由父窗口及Main统一保护。 */
export function SqliteCheckEditor({ catalogue, edits, form, disabled, onAction }: Props) {
  const originals = useMemo(() => { try { return { checks: inspectSqliteTableChecks(sqliteCheckSource(catalogue)), error: '' }; } catch (reason) { return { checks: [], error: errorMessage(reason) }; } }, [catalogue]);
  const listDisabled = disabled || !!form || !!originals.error;
  /** 列表摘要保留准确对象身份，完整表达式放在可展开原文内，避免长规则撑开布局。 */
  function summary(edit: SqliteTableCheckEdit): string {
    if (edit.kind === 'remove') { const original = originals.checks[edit.ordinal]; return original ? text.pendingRemove + '：' + (original.names.join(' / ') || text.unnamed) : text.invalid; }
    return (edit.kind === 'add' ? text.pendingAdd : text.pendingReplace) + '：' + (edit.definition.name ?? text.unnamed) + ' · ' + text.locations[edit.definition.location] + (edit.definition.location === 'column' ? ' / ' + edit.definition.column : '');
  }
  return <section className="sqlite-checks" aria-label={text.title}><h3>{text.title}</h3><p className="muted small">{text.hint}</p><p className="muted small">{text.riskHint}</p><ErrorBox message={originals.error}/>
    {!originals.checks.length && !originals.error && <p>{text.empty}</p>}
    <div className="sqlite-checks-list">{originals.checks.map(check => { const pending = edits.find(edit => edit.kind !== 'add' && edit.ordinal === check.ordinal); return <article key={check.ordinal}><div className="sqlite-check-heading"><strong>{check.ordinal + 1}. {check.names.join(' / ') || text.unnamed}</strong><span>{text.locations[check.location]}{check.column !== undefined ? ' / ' + check.column : ''}</span><button type="button" disabled={listDisabled || pending?.kind === 'remove'} onClick={() => onAction({ kind: 'open', ordinal: check.ordinal })}>{text.edit(check.ordinal + 1)}</button><button type="button" disabled={listDisabled || pending?.kind === 'remove'} onClick={() => onAction({ kind: 'remove', ordinal: check.ordinal })}>{text.remove(check.ordinal + 1)}</button></div>{pending && <p className="warning-text">{summary(pending)}</p>}<details><summary>{text.original}</summary><pre>{check.sql}</pre></details>{check.legacyConflict !== null && <p className="muted small">{text.legacyConflict(check.legacyConflict)}</p>}</article>; })}</div>
    <button type="button" disabled={listDisabled} onClick={() => onAction({ kind: 'open' })}>{text.add}</button>
    {!!edits.length && <section aria-label={text.pending}><h4>{text.pending}</h4><ul>{edits.map((edit, index) => <li key={index}><div className="sqlite-check-heading"><span>{summary(edit)}</span>{edit.kind !== 'remove' && <button type="button" disabled={listDisabled} onClick={() => onAction({ kind: 'open', edit })}>{text.editPending(index + 1)}</button>}<button type="button" disabled={listDisabled} onClick={() => onAction({ kind: 'undo', edit })}>{text.undo(index + 1)}</button></div>{edit.kind !== 'remove' && <details><summary>{text.expression}</summary><pre>{edit.definition.expression}</pre></details>}</li>)}</ul></section>}
    {form && <div className="sqlite-check-form" role="group" aria-label={text.editor}><p>{text.formHint}</p><p className="muted small">{text.deferred}</p><div className="sqlite-rebuild-fields">
      <Field label={text.name}><input aria-label={text.name} maxLength={512} disabled={disabled} value={form.name} onChange={event => onAction({ kind: 'field', token: form.token, field: 'name', value: event.target.value })}/></Field>
      <Field label={text.location}><select aria-label={text.location} disabled={disabled} value={form.location} onChange={event => onAction({ kind: 'field', token: form.token, field: 'location', value: event.target.value })}>{Object.entries(text.locations).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      {form.location === 'column' && <Field label={text.column}><select aria-label={text.column} disabled={disabled} value={form.column} onChange={event => onAction({ kind: 'field', token: form.token, field: 'column', value: event.target.value })}><option value="">—</option>{catalogue.columns.map(column => <option key={column.name} value={column.name}>{column.name}</option>)}</select></Field>}
    </div><Field label={text.expression}><textarea aria-label={text.expression} title={text.expressionHint} rows={6} maxLength={sqliteTableCheckLimits.expressionBytes} spellCheck={false} disabled={disabled} value={form.expression} onChange={event => onAction({ kind: 'field', token: form.token, field: 'expression', value: event.target.value })}/></Field><p className="muted small">{text.expressionHint}</p>
    {sqliteCheckNeedsAcknowledgement(form) && <><p className="warning-text">{text.legacy}</p><label><input type="checkbox" aria-label={text.legacyAck} disabled={disabled} checked={form.legacyAccepted} onChange={event => onAction({ kind: 'flag', token: form.token, value: event.target.checked })}/>{text.legacyAck}</label></>}
    <div className="sqlite-check-actions"><button type="button" disabled={disabled} onClick={() => onAction({ kind: 'stage', token: form.token })}>{text.stage}</button><button type="button" disabled={disabled} onClick={() => onAction({ kind: 'cancel', token: form.token })}>{text.cancel}</button></div></div>}
  </section>;
}
