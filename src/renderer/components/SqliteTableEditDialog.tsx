import { useLayoutEffect, useRef, useState } from 'react';
import { sqliteEditValueSchema, type SqliteOriginalValue } from '../../shared/sqliteTableEdit';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import type { SqliteDraftRow, SqliteEditView } from '../sqliteTableEditor';
import { sqliteTableEditZh as text } from '../locales/sqliteTableEdit.zh-CN';
import { errorMessage } from '../lib';
import { ErrorBox, Modal, Spinner } from './ui';

interface FieldDraft { include: boolean; kind: SqliteOriginalValue['kind']; value: string; changed: boolean; }
/** 编辑输入保持原动态类型；未触碰的非有限原 REAL 只保留，不重新解析或偷偷转换。 */
export function SqliteTableValueDialog({ ticket, page, row, column, current, onSave, onClose }: { ticket: object; page: SqliteTablePage; row: SqliteDraftRow; column?: number; current(): boolean; onSave(values: (SqliteOriginalValue | undefined)[]): boolean; onClose(): void }) {
  const owner = useRef({ ticket, page, row, column, current, onSave, onClose }).current;
  const renderTicket = {}, committed = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { committed.current = renderTicket; return () => { if (committed.current === renderTicket) committed.current = undefined; }; });
  const [fields, setFields] = useState<FieldDraft[]>(() => row.values.map(value => ({ include: value !== undefined, kind: value?.kind ?? 'text', value: value && value.kind !== 'null' ? value.value : '', changed: false })));
  const live = useRef(fields); live.current = fields; const closed = useRef(false);
  const [error, setError] = useState('');
  const columns = owner.page.edit?.kind === 'editable' ? owner.page.edit.columns : [];
  /** 即使误用相同组件 key，来源变化也永久拒绝旧字段与回调；关闭同样受原输入票据约束。 */
  const invalid = useRef(false); if (owner.ticket !== ticket || owner.page !== page || owner.row !== row || owner.column !== column) invalid.current = true;
  function localCurrent(): boolean { return !invalid.current && !closed.current && committed.current === renderTicket && live.current === fields; }
  function close(): void { if (!localCurrent()) return; closed.current = true; owner.onClose(); }
  /** 全部字段作为一次本地 undo 步骤；只有显式改动字段才解析新输入。 */
  function save(): void {
    if (!localCurrent() || !owner.current()) { if (committed.current === renderTicket) setError(text.stale); return; }
    try {
      const values = owner.row.values.map((original, i) => {
        const field = fields[i]; if (columns[i].generated || !field.changed) return original;
        if (!field.include && owner.row.index === undefined) return undefined;
        return sqliteEditValueSchema.parse(field.kind === 'null' ? { kind: 'null' } : { kind: field.kind, value: field.value });
      });
      if (!owner.current() || !owner.onSave(values)) { setError(text.stale); return; } closed.current = true; owner.onClose();
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function change(index: number, patch: Partial<FieldDraft>): void { if (!localCurrent()) return; const next = fields.map((field, i) => i === index ? { ...field, ...patch, changed: true } : field); live.current = next; setFields(next); }
  return <Modal title={row.index === undefined ? text.add : column === undefined ? text.editRow : text.editCell} onClose={close} wide><div className="dialog-body"><p>{text.inputHint}</p>{columns.map((item, index) => column !== undefined && index !== column ? null : <fieldset key={item.name}><legend>{item.name}{item.generated ? ' · ' + text.generated : ''}</legend>{row.index === undefined && <label><input type="checkbox" aria-label={text.include(item.name)} checked={fields[index].include} disabled={item.generated} onChange={event => change(index, { include: event.target.checked })}/>{text.include(item.name)}</label>}<select aria-label={text.type(item.name)} value={fields[index].kind} disabled={item.generated || !fields[index].include} onChange={event => change(index, { kind: event.target.value as FieldDraft['kind'] })}>{Object.entries(text.kinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select><textarea aria-label={text.value(item.name)} value={fields[index].value} maxLength={65536} disabled={item.generated || !fields[index].include || fields[index].kind === 'null'} onChange={event => change(index, { value: event.target.value })}/></fieldset>)}<ErrorBox message={error}/></div><footer><button aria-label={text.cancelInput} onClick={close}>{text.cancelInput}</button><button className="primary" aria-label={text.saveInput} onClick={save}>{text.saveInput}</button></footer></Modal>;
}

/** 真实 modal 明确确认集中写入；预览关闭不丢本地草稿，也不伪取消已发送提交。 */
export function SqliteTablePreviewDialog({ ticket, view, current, onApply, onClose, onStop }: { ticket: object; view: SqliteEditView; current(): boolean; onApply(): void; onClose(): void; onStop(): void }) {
  const [confirmed, setConfirmed] = useState(false);
  const owner = useRef({ ticket, page: view.page, rows: view.rows, preview: view.preview }).current, invalid = useRef(false), renderTicket = {}, committed = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { committed.current = renderTicket; return () => { if (committed.current === renderTicket) committed.current = undefined; }; });
  if (owner.ticket !== ticket || owner.page !== view.page || owner.rows !== view.rows || owner.preview !== view.preview) invalid.current = true;
  /** 确认只属于原预览；旧按钮、旧 checkbox 或卸载组件不得向新预览发出动作。 */
  function actionCurrent(): boolean { return !invalid.current && committed.current === renderTicket && current(); }
  function close(): void { if (actionCurrent() && !view.busy) onClose(); }
  return <Modal title={text.previewTitle} onClose={close} wide><div className="dialog-body"><p>{text.previewHint}</p>{view.preview && <><p>{view.preview.target.database}.{view.preview.target.table} · {text.counts(view.preview.counts.insert, view.preview.counts.update, view.preview.counts.delete)}</p><pre aria-label="SQLite 修改 SQL 预览" style={{ maxHeight: '45vh', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{view.preview.sql.join('\n')}</pre><label><input type="checkbox" aria-label={text.confirmation} checked={confirmed} disabled={view.busy || !view.valid} onChange={event => { if (actionCurrent() && !view.busy && view.valid) setConfirmed(event.target.checked); }}/>{text.confirmation}</label></>}{view.busy && <Spinner text={text.working}/>}<ErrorBox message={view.message}/></div><footer><button aria-label={text.closePreview} disabled={view.busy} onClick={close}>{text.closePreview}</button>{view.busy && <button aria-label={text.stop} onClick={() => { if (actionCurrent()) onStop(); }}>{text.stop}</button>}<button className="primary" aria-label={text.submit} disabled={!confirmed || !view.preview || view.busy || !view.valid || view.unknown} onClick={() => { if (!confirmed || !view.preview || view.busy || !view.valid || view.unknown || !actionCurrent()) return; setConfirmed(false); onApply(); }}>{text.submit}</button></footer></Modal>;
}
