import { useLayoutEffect, useRef, useState } from 'react';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import type { SqliteDraftRow } from '../sqliteTableEditor';
import { decodeSqliteClipboard, encodeSqliteClipboard, readSqliteClipboard, sqliteClipboardLimits, type SqliteClipboardCell, type SqliteClipboardSource, type SqlitePasteKind } from '../sqliteTableClipboard';
import { prepareSqliteRangePaste, sqliteRangePastePlanValues, sqliteRangePastePreview, sqlitePasteColumnOrder, type SqlitePasteAnchor, type SqliteRangePastePlan, type SqliteRangePastePreview } from '../sqliteTableRangePaste';
import { sqliteTableRangePasteZh as text } from '../locales/sqliteTableRangePaste.zh-CN';
import { ErrorBox, Field, Modal } from './ui';
import '../sqliteTableClipboard.css';

interface Props { page: SqliteTablePage; rows: readonly SqliteDraftRow[]; anchor: SqlitePasteAnchor; initial?: SqliteClipboardSource; current(): boolean; onStage(plan: SqliteRangePastePlan): boolean | void; onClose(): void; }
interface Draft { raw: string; fieldEpoch: object; source?: SqliteClipboardSource; kinds: SqlitePasteKind[]; selected: number; preview?: { plan: SqliteRangePastePlan; data: SqliteRangePastePreview }; error: string; }
/** 区域粘贴仅生成完整矩形本地计划；与新增草稿入口分离，任何错误都不部分覆盖。 */
export function SqlitePasteRangeDialog({ page, rows, anchor, initial, current, onStage, onClose }: Props) {
  let orderSignature: string | undefined; try { orderSignature = JSON.stringify(sqlitePasteColumnOrder(page, anchor)); } catch { /* 非法映射由原预览门报告，不能猜测另一目标。 */ }
  const owner = useRef({ page, rows, anchor, row: anchor.row, column: anchor.column, columns: anchor.columns, orderSignature, initial, current, onStage, onClose }).current;
  const invalid = useRef(false), propsInvalid = useRef(false), closed = useRef(false), mounted = useRef(false), staging = useRef(false), consumed = useRef(new WeakSet<SqliteRangePastePlan>());
  if (owner.page !== page || owner.rows !== rows || owner.anchor !== anchor || owner.row !== anchor.row || owner.column !== anchor.column || owner.columns !== anchor.columns || owner.orderSignature !== orderSignature || owner.initial !== initial) propsInvalid.current = true;
  /** native列名只供核对来源，绝不借它重排目标列或跳过生成列。 */
  function fromSource(source: SqliteClipboardSource): Draft { const encoded = encodeSqliteClipboard(source.values, source.columns), value = { ...decodeSqliteClipboard(encoded.sqlite, '', source.text), plain: source.plain }; return { raw: value.text, fieldEpoch: {}, source: value, kinds: value.values[0].map(() => 'preserve'), selected: 0, error: '' }; }
  const [draft, setDraft] = useState<Draft>(() => { try { return initial ? fromSource(initial) : { raw: '', fieldEpoch: {}, kinds: [], selected: 0, error: '' }; } catch (reason) { return { raw: initial?.text ?? '', fieldEpoch: {}, kinds: [], selected: 0, error: reason instanceof Error ? reason.message : text.invalid }; } }), live = useRef(draft); live.current = draft;
  const renderTicket = {}, committed = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { mounted.current = true; committed.current = renderTicket; return () => { if (committed.current === renderTicket) committed.current = undefined; mounted.current = false; }; });
  /** 原page、rows和anchor一旦变化就留墓碑；父current允许本窗口自己的输入占用。 */
  function sourceCurrent(): boolean { try { if (propsInvalid.current || !owner.current()) invalid.current = true; } catch { invalid.current = true; } return !invalid.current && !closed.current; }
  function inputCurrent(): boolean { return mounted.current && sourceCurrent() && !staging.current; }
  function local(): boolean { return mounted.current && committed.current === renderTicket && live.current === draft && !closed.current; }
  function replace(value: Draft): void { live.current = value; setDraft(value); }
  /** 所有原生paste先撤销旧计划；坏native格式不会回退到plain或新增模式。 */
  function pasted(data: Pick<DataTransfer, 'types' | 'getData'>): void {
    if (!inputCurrent()) return; replace({ ...live.current, preview: undefined, error: '' });
    try { const value = readSqliteClipboard(data); if (sourceCurrent()) replace(fromSource(value)); }
    catch (reason) { replace({ ...live.current, preview: undefined, error: reason instanceof Error ? reason.message : text.invalid }); }
  }
  /** 连续全文事件使用最新live，保留CRLF、NUL及明确的TEXT来源，不自动推断数值。 */
  function manual(raw: string): void {
    if (!inputCurrent()) return; replace({ raw, fieldEpoch: {}, kinds: [], selected: 0, error: '' }); if (!raw.length) return;
    try { const source = decodeSqliteClipboard('', '', raw); if (sourceCurrent()) replace(fromSource(source)); }
    catch (reason) { replace({ ...live.current, error: reason instanceof Error ? reason.message : text.invalid }); }
  }
  function changeKind(index: number, kind: string, source: SqliteClipboardSource, epoch: object): void { if (!inputCurrent() || live.current.fieldEpoch !== epoch || live.current.source !== source || !Object.hasOwn(text.kindLabels, kind) || !live.current.kinds[index]) return; replace({ ...live.current, preview: undefined, error: '', kinds: live.current.kinds.map((item, at) => at === index ? kind as SqlitePasteKind : item) }); }
  /** 全矩形校验后才公布首10行old/new；计数和实际计划始终保持完整批次。 */
  function preview(): void {
    if (!local() || !sourceCurrent() || !draft.source) return; const source = draft.source, value = { ...draft, preview: undefined, error: '' }; replace(value);
    try { const plan = prepareSqliteRangePaste(owner.page, owner.rows, owner.anchor, source.values, value.kinds), data = sqliteRangePastePreview(plan, owner.page, owner.rows, owner.anchor); if (sourceCurrent()) replace({ ...value, preview: { plan, data } }); }
    catch (reason) { replace({ ...value, error: reason instanceof Error ? reason.message : text.invalid }); }
  }
  /** 一次消费准确计划；父级仍须核票据并整批replaceRange，不能直接执行SQL。 */
  function stage(): void {
    const previewed = draft.preview; if (!local() || !sourceCurrent() || !previewed || !previewed.plan.changedCells || staging.current || consumed.current.has(previewed.plan)) return;
    consumed.current.add(previewed.plan); staging.current = true;
    try { sqliteRangePastePlanValues(previewed.plan, owner.page, owner.rows, owner.anchor); if (!sourceCurrent()) throw Error(text.stale); if (owner.onStage(previewed.plan) === false) throw Error(text.stale); closed.current = true; owner.onClose(); }
    catch (reason) { if (mounted.current) replace({ ...live.current, preview: undefined, error: reason instanceof Error ? reason.message : text.invalid }); }
    finally { staging.current = false; }
  }
  /** 失效仍能取消自己的当前窗口；旧render与来源误复用不能关闭后继窗口。 */
  function close(): void { if (!local() || propsInvalid.current || staging.current) return; closed.current = true; owner.onClose(); }
  const valid = sourceCurrent(), readonly = owner.page.edit?.kind !== 'editable', source = draft.source, previewed = draft.preview, startRow = owner.rows.indexOf(owner.row) + 1;
  const targetColumn = (index: number) => { try { const order = sqlitePasteColumnOrder(owner.page, owner.anchor); return owner.page.columns[order[order.indexOf(owner.column) + index]]?.name ?? text.outOfBounds; } catch { return text.outOfBounds; } };
  const cellText = (value: SqliteClipboardCell) => value === undefined ? text.defaultValue : value.kind === 'null' ? text.kindLabels.null : text.kindLabels[value.kind] + ' · ' + value.value;
  return <Modal title={text.title} wide onClose={close}><div className="modal-content">
    <p>{owner.page.target.connectionId} / {owner.page.target.database} / {owner.page.target.table}</p><p>{text.positionHint}</p><p>{text.bindingHint}</p><p>{text.targetRange(startRow, startRow, owner.column + 1, owner.column + 1)} · {targetColumn(0)}</p>
    <Field label={text.source}><textarea aria-label={text.source} value={draft.raw} maxLength={sqliteClipboardLimits.bytes} disabled={!valid || readonly} onChange={event => manual(event.target.value)} onPaste={event => { event.preventDefault(); event.stopPropagation(); pasted(event.clipboardData); }}/></Field>
    {source && <><p>{text.targetRange(startRow, startRow + source.values.length - 1, owner.column + 1, owner.column + source.values[0].length)}</p><Field label={text.sourceColumn}><select aria-label={text.sourceColumn} value={String(draft.selected)} disabled={!valid || readonly} onChange={event => { if (!inputCurrent() || live.current.source !== source) return; const selected = Number(event.target.value); if (Number.isInteger(selected) && selected >= 0 && selected < live.current.kinds.length) replace({ ...live.current, selected, fieldEpoch: {}, preview: undefined }); }}>{source.values[0].map((_, index) => <option key={index} value={index}>{text.column(index)}{source.columns?.[index] ? ' · ' + source.columns[index] : ''}</option>)}</select></Field>
      <p>{targetColumn(draft.selected)}</p><Field label={text.conversion + ' · ' + text.column(draft.selected)}><select aria-label={text.conversion + ' · ' + text.column(draft.selected)} disabled={!valid || readonly} value={draft.kinds[draft.selected]} onChange={event => changeKind(draft.selected, event.target.value, source, draft.fieldEpoch)}>{Object.entries(text.kindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></Field>
      <details><summary>{text.mapping}</summary><div className="sqlite-paste-preview"><table aria-label={text.mapping}><tbody>{source.values[0].map((_, index) => <tr key={index}><td>{text.column(index)}{source.columns?.[index] ? ' · ' + source.columns[index] : ''}</td><td>{targetColumn(index)}</td><td>{text.kindLabels[draft.kinds[index]]}</td></tr>)}</tbody></table></div></details></>}
    {previewed && <section><p>{text.previewHint}</p><p>{text.changedCounts(previewed.plan.rows, previewed.plan.width, previewed.plan.changedCells)}</p><p>{text.targetRange(previewed.plan.startRow, previewed.plan.endRow, previewed.plan.startColumn, previewed.plan.endColumn)}</p>{!previewed.plan.changedCells && <p>{text.noChanges}</p>}<div className="sqlite-paste-preview"><table aria-label={text.previewRows}><thead><tr><th>#</th>{previewed.data.columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{previewed.data.rows.map(row => <tr key={row.row}><td>{row.row}</td>{row.cells.map((cell, index) => <td key={index} data-changed={cell.changed ? 'true' : 'false'}><p>{text.oldValue}：{cellText(cell.oldValue)}</p><p>{text.newValue}：{cellText(cell.newValue)}</p></td>)}</tr>)}</tbody></table></div></section>}
    <ErrorBox message={!valid ? text.stale : readonly ? text.readonly : draft.error}/>
  </div><footer className="modal-footer"><button type="button" onClick={close}>{text.cancel}</button><span className="grow"/><button type="button" disabled={!valid || readonly || !source} onClick={preview}>{text.preview}</button><button type="button" className="primary" disabled={!valid || readonly || !previewed || !previewed.plan.changedCells || consumed.current.has(previewed.plan)} onClick={stage}>{text.stage}</button></footer></Modal>;
}
