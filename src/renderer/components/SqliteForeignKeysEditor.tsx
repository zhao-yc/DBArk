import { useId, useMemo } from 'react';
import type { SqliteTableRebuildInspectOutput } from '../../shared/sqliteTableRebuild';
import { sqliteTableForeignKeyLimits, type SqliteTableForeignKeyEdit } from '../../shared/sqliteTableForeignKeys';
import { sqliteTableCreateActions } from '../../shared/sqliteTableCreate';
import { inspectSqliteTableForeignKeys } from '../../shared/sqliteTableRebuildPlan';
import { sqliteForeignKeyNeedsAcknowledgement, sqliteForeignKeySource, type SqliteForeignKeyAction, type SqliteForeignKeyForm } from '../sqliteForeignKeyEditor';
import { sqliteForeignKeysZh as text } from '../locales/sqliteForeignKeys.zh-CN';
import { errorMessage } from '../lib';
import { ErrorBox, Field } from './ui';

interface Props { catalogue: SqliteTableRebuildInspectOutput; edits: readonly SqliteTableForeignKeyEdit[]; form?: SqliteForeignKeyForm; disabled: boolean; onAction(action: SqliteForeignKeyAction): void; }
/** 受控外键区只发本地动作；表单、队列和关闭保护由父重建窗口持有。 */
export function SqliteForeignKeysEditor({ catalogue, edits, form, disabled, onAction }: Props) {
  const choices = useId();
  const originals = useMemo(() => { try { return { keys: inspectSqliteTableForeignKeys(sqliteForeignKeySource(catalogue)), error: '' }; } catch (error) { return { keys: [], error: errorMessage(error) }; } }, [catalogue]);
  const listDisabled = disabled || !!form || !!originals.error;
  /** 删除草稿同样展示准确原对象，避免多项待移除只有状态而无法辨识目标。 */
  const definitionText = (edit: SqliteTableForeignKeyEdit) => {
    if (edit.kind === 'remove') { const original = originals.keys[edit.ordinal]; return original ? `${text.pendingRemove}：${original.names.join(' / ') || text.unnamed} · (${original.columns.join('、')}) → ${original.referencedTable} (${original.referencedColumns.join('、') || 'PRIMARY KEY'})` : text.invalid; }
    return `${edit.kind === 'add' ? text.pendingAdd : text.pendingReplace}：${edit.definition.name ?? text.unnamed} · (${edit.definition.columns.join('、')}) → ${edit.definition.referencedTable} (${edit.definition.referencedColumns.join('、') || 'PRIMARY KEY'})`;
  };
  return <section className="sqlite-foreign-keys" aria-label={text.title}><h3>{text.title}</h3><p className="muted small">{text.hint}</p><ErrorBox message={originals.error}/>
    {!originals.keys.length && !originals.error && <p>{text.empty}</p>}
    <div className="sqlite-foreign-keys-list">{originals.keys.map(key => { const pending = edits.find(edit => edit.kind !== 'add' && edit.ordinal === key.ordinal); return <article key={key.ordinal}>
      <div className="sqlite-foreign-key-heading"><strong>{key.ordinal + 1}. {key.names.join(' / ') || text.unnamed}</strong><span>({key.columns.join('、')}) → {key.referencedTable} ({key.referencedColumns.join('、') || 'PRIMARY KEY'})</span><button type="button" disabled={listDisabled || pending?.kind === 'remove'} onClick={() => onAction({ kind: 'open', ordinal: key.ordinal })}>{text.edit(key.ordinal + 1)}</button><button type="button" disabled={listDisabled || pending?.kind === 'remove'} onClick={() => onAction({ kind: 'remove', ordinal: key.ordinal })}>{text.remove(key.ordinal + 1)}</button></div>
      {pending && <p className="warning-text">{definitionText(pending)}</p>}<details><summary>{text.original}</summary><pre>{key.sql}</pre></details>
    </article>; })}</div>
    <button type="button" disabled={listDisabled} onClick={() => onAction({ kind: 'open' })}>{text.add}</button>
    {!!edits.length && <section aria-label={text.pending}><h4>{text.pending}</h4><ul>{edits.map((edit, index) => <li key={index}><span>{definitionText(edit)}</span>{edit.kind !== 'remove' && <button type="button" disabled={listDisabled} onClick={() => onAction({ kind: 'open', edit })}>{text.editPending(index + 1)}</button>}<button type="button" disabled={listDisabled} onClick={() => onAction({ kind: 'undo', edit })}>{text.undo(index + 1)}</button></li>)}</ul></section>}
    {form && <div className="sqlite-foreign-key-form" role="group" aria-label={text.editor}><p>{text.formHint}</p><div className="sqlite-rebuild-fields">
      <Field label={text.name}><input aria-label={text.name} maxLength={512} disabled={disabled} value={form.name} onChange={event => onAction({ kind: 'field', token: form.token, field: 'name', value: event.target.value })}/></Field>
      <Field label={text.parent}><input aria-label={text.parent} maxLength={512} list={choices} disabled={disabled} value={form.parent} onChange={event => onAction({ kind: 'field', token: form.token, field: 'parent', value: event.target.value })}/><datalist id={choices}>{catalogue.relatedObjects.filter(object => object.type === 'table' && !/^sqlite_/i.test(object.name)).map(object => <option key={object.name} value={object.name}/>)}</datalist></Field>
      <Field label={text.onDelete}><select aria-label={text.onDelete} disabled={disabled} value={form.onDelete} onChange={event => onAction({ kind: 'field', token: form.token, field: 'onDelete', value: event.target.value })}>{sqliteTableCreateActions.map(action => <option key={action} value={action}>{action}</option>)}</select></Field>
      <Field label={text.onUpdate}><select aria-label={text.onUpdate} disabled={disabled} value={form.onUpdate} onChange={event => onAction({ kind: 'field', token: form.token, field: 'onUpdate', value: event.target.value })}>{sqliteTableCreateActions.map(action => <option key={action} value={action}>{action}</option>)}</select></Field>
      <Field label={text.deferral}><select aria-label={text.deferral} disabled={disabled} value={form.deferral} onChange={event => onAction({ kind: 'field', token: form.token, field: 'deferral', value: event.target.value })}>{Object.entries(text.deferrals).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
    </div><label><input type="checkbox" aria-label={text.implicit} disabled={disabled} checked={form.implicit} onChange={event => onAction({ kind: 'flag', token: form.token, field: 'implicit', value: event.target.checked })}/>{text.implicit}</label>
    <div className="sqlite-foreign-key-mappings" role="group" aria-label={text.mappings}>{form.mappings.map((row, index) => <div key={row.id} className="sqlite-foreign-key-mapping"><span>{index + 1}.</span>
      <Field label={text.local(index + 1)}><select aria-label={text.local(index + 1)} disabled={disabled} value={row.local} onChange={event => onAction({ kind: 'mapping', token: form.token, id: row.id, field: 'local', value: event.target.value })}><option value="">—</option>{catalogue.columns.map(column => <option key={column.name} value={column.name}>{column.name}</option>)}</select></Field><span>→</span>
      <Field label={text.remote(index + 1)}><input aria-label={text.remote(index + 1)} maxLength={512} disabled={disabled || form.implicit} value={row.parent} onChange={event => onAction({ kind: 'mapping', token: form.token, id: row.id, field: 'parent', value: event.target.value })}/></Field>
      <button type="button" aria-label={text.up(index + 1)} disabled={disabled || index === 0} onClick={() => onAction({ kind: 'move', token: form.token, id: row.id, direction: -1 })}>↑</button><button type="button" aria-label={text.down(index + 1)} disabled={disabled || index === form.mappings.length - 1} onClick={() => onAction({ kind: 'move', token: form.token, id: row.id, direction: 1 })}>↓</button><button type="button" disabled={disabled || form.mappings.length <= 1} onClick={() => onAction({ kind: 'remove-mapping', token: form.token, id: row.id })}>{text.removeMapping(index + 1)}</button>
    </div>)}</div><button type="button" disabled={disabled || form.mappings.length >= sqliteTableForeignKeyLimits.parts} onClick={() => onAction({ kind: 'add-mapping', token: form.token })}>{text.addMapping}</button>
    {sqliteForeignKeyNeedsAcknowledgement(form) && <><p className="warning-text">{text.legacy}</p><label><input type="checkbox" disabled={disabled} aria-label={text.legacyAck} checked={form.legacyAccepted} onChange={event => onAction({ kind: 'flag', token: form.token, field: 'legacyAccepted', value: event.target.checked })}/>{text.legacyAck}</label></>}
    <div className="sqlite-foreign-key-form-actions"><button type="button" disabled={disabled} onClick={() => onAction({ kind: 'stage', token: form.token })}>{text.stage}</button><button type="button" disabled={disabled} onClick={() => onAction({ kind: 'cancel', token: form.token })}>{text.cancel}</button></div></div>}
  </section>;
}
