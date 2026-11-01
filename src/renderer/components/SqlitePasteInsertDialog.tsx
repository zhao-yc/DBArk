import { useLayoutEffect, useRef, useState } from 'react';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import { decodeSqliteClipboard, defaultSqlitePasteMapping, encodeSqliteClipboard, prepareSqlitePaste, readSqliteClipboard, sqliteClipboardLimits, sqlitePastePlanValues, type SqliteClipboardCell, type SqliteClipboardSource, type SqlitePasteColumnMapping, type SqlitePasteMapping, type SqlitePastePlan } from '../sqliteTableClipboard';
import { sqliteTableClipboardZh as text } from '../locales/sqliteTableClipboard.zh-CN';
import { ErrorBox, Field, Modal } from './ui';
import '../sqliteTableClipboard.css';

interface Props { page: SqliteTablePage; initial?: SqliteClipboardSource; current(): boolean; onStage(plan: SqlitePastePlan): boolean | void; onClose(): void; }
interface Draft { raw: string; source?: SqliteClipboardSource; mapping: SqlitePasteMapping; selected: number; preview?: { plan: SqlitePastePlan; values: SqliteClipboardCell[][] }; error: string; }
/** 所有数据只在本地映射和暂存；不读取系统剪贴板、不调用IPC或SQL。 */
export function SqlitePasteInsertDialog({ page, initial, current, onStage, onClose }: Props) {
  const owner = useRef({ page, initial, current, onStage, onClose }).current, invalid = useRef(false), propsInvalid = useRef(false), closed = useRef(false), mounted = useRef(false), staging = useRef(false), consumed = useRef(new Set<SqlitePastePlan>());
  if (owner.page !== page || owner.initial !== initial) propsInvalid.current = true;
  /** 原native值再做有界纯复制，外部数组后续变动不能静默改写本窗口内容。 */
  function copied(source: SqliteClipboardSource): SqliteClipboardSource { const encoded = encodeSqliteClipboard(source.values, source.columns); return { ...decodeSqliteClipboard(encoded.sqlite, '', source.text), plain: source.plain }; }
  function fromSource(source: SqliteClipboardSource): Draft { const value = copied(source); return { raw: value.text, source: value, mapping: defaultSqlitePasteMapping(owner.page, value.values[0].length, value.columns), selected: 0, error: '' }; }
  const [draft, setDraft] = useState<Draft>(() => { try { return initial ? fromSource(initial) : { raw: '', mapping: [], selected: 0, error: '' }; } catch (reason) { return { raw: initial?.text ?? '', mapping: [], selected: 0, error: reason instanceof Error ? reason.message : text.invalid }; } }), live = useRef(draft); live.current = draft;
  const renderTicket = {}, committed = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { mounted.current = true; committed.current = renderTicket; return () => { if (committed.current === renderTicket) committed.current = undefined; mounted.current = false; }; });
  /** current由父页原ticket提供，允许本窗口自己的inputOpen占用；观察到失效就永久撤销原批次。 */
  function sourceCurrent(): boolean { try { if (propsInvalid.current || !owner.current()) invalid.current = true; } catch { invalid.current = true; } return !invalid.current && !closed.current; }
  function inputCurrent(): boolean { return mounted.current && sourceCurrent() && !staging.current; }
  function local(): boolean { return mounted.current && committed.current === renderTicket && live.current === draft && !closed.current; }
  function replace(value: Draft): void { live.current = value; setDraft(value); }
  /** 原生paste优先读取准确MIME；坏native内容不降级，原输入仍可见但旧plan同步撤销。 */
  function pasted(data: Pick<DataTransfer, 'types' | 'getData'>): void {
    if (!inputCurrent()) return; replace({ ...live.current, preview: undefined, error: '' });
    try { const value = readSqliteClipboard(data); if (sourceCurrent()) replace(fromSource(value)); }
    catch (reason) { replace({ ...live.current, preview: undefined, error: reason instanceof Error ? reason.message : text.invalid }); }
  }
  /** 同一textarea连续全文事件合并最新live，不用上次render草稿覆盖后半输入。 */
  function manual(raw: string): void {
    if (!inputCurrent()) return; replace({ raw, mapping: [], selected: 0, error: '' });
    if (!raw.length) return;
    try { const source = decodeSqliteClipboard('', '', raw); if (sourceCurrent()) replace(fromSource(source)); }
    catch (reason) { replace({ ...live.current, error: reason instanceof Error ? reason.message : text.invalid }); }
  }
  /** 单来源列编辑避免1024×1024个option；所有来源的完整映射仍保留于摘要。 */
  function mapping(index: number, patch: Partial<SqlitePasteColumnMapping>, source: SqliteClipboardSource): void {
    if (!inputCurrent() || live.current.source !== source || !live.current.mapping[index]) return;
    replace({ ...live.current, preview: undefined, error: '', mapping: live.current.mapping.map((item, at) => at === index ? { ...item, ...patch } : item) });
  }
  function preview(): void {
    if (!local() || !sourceCurrent() || !draft.source) return;
    const source = draft.source, value = { ...draft, preview: undefined, error: '' }; replace(value);
    try { const plan = prepareSqlitePaste(owner.page, source.values, value.mapping), values = sqlitePastePlanValues(plan, owner.page); if (!sourceCurrent()) return; replace({ ...value, preview: { plan, values: values.slice(0, 10) } }); }
    catch (reason) { replace({ ...value, error: reason instanceof Error ? reason.message : text.invalid }); }
  }
  /** 一次消费计划；暂存失败必须重新明确预览，绝不自动追加第二批或自动提交。 */
  function stage(): void {
    const previewed = draft.preview; if (!local() || !sourceCurrent() || !previewed || staging.current || consumed.current.has(previewed.plan)) return;
    consumed.current.add(previewed.plan); staging.current = true;
    try { sqlitePastePlanValues(previewed.plan, owner.page); if (!sourceCurrent()) throw Error(text.stale); if (owner.onStage(previewed.plan) === false) throw Error(text.stale); closed.current = true; owner.onClose(); }
    catch (reason) { replace({ ...live.current, preview: undefined, error: reason instanceof Error ? reason.message : text.invalid }); }
    finally { staging.current = false; }
  }
  /** 来源失效仍可关闭自己的当前窗口；旧render或卸载后的close不能关闭后继窗口。 */
  function close(): void { if (!local() || propsInvalid.current || staging.current) return; closed.current = true; owner.onClose(); }
  const valid = sourceCurrent(), readonly = owner.page.edit?.kind !== 'editable', source = draft.source, active = source ? draft.mapping[draft.selected] : undefined, previewed = draft.preview;
  const columns = owner.page.edit?.kind === 'editable' ? owner.page.edit.columns : [], writable = columns.filter(column => !column.generated);
  const cellText = (value: SqliteClipboardCell, generated: boolean) => value === undefined ? generated ? text.generatedValue : text.defaultValue : value.kind === 'null' ? text.kindLabels.null : text.kindLabels[value.kind] + ' · ' + value.value;
  return <Modal title={text.title} wide onClose={close}><div className="modal-content">
    <p>{owner.page.target.connectionId} / {owner.page.target.database} / {owner.page.target.table}</p>{source?.plain && <p>{text.plainHint}</p>}<p>{text.typedHint}</p><p>{text.mappingHint}</p>
    <Field label={text.source}><textarea aria-label={text.source} value={draft.raw} maxLength={sqliteClipboardLimits.bytes} disabled={!valid || readonly} onChange={event => manual(event.target.value)} onPaste={event => { event.preventDefault(); event.stopPropagation(); pasted(event.clipboardData); }}/></Field>
    <button type="button" disabled={!valid || readonly} onClick={() => { if (local() && inputCurrent()) replace({ raw: '', mapping: [], selected: 0, error: '' }); }}>{text.clear}</button>
    {source && <><p>{text.counts(source.values.length, source.values[0].length)}</p><Field label={text.sourceColumn}><select aria-label={text.sourceColumn} value={String(draft.selected)} disabled={!valid || readonly} onChange={event => { if (!inputCurrent() || live.current.source !== source) return; const selected = Number(event.target.value); if (Number.isInteger(selected) && selected >= 0 && selected < live.current.mapping.length) replace({ ...live.current, selected, preview: undefined }); }}>{source.values[0].map((_, index) => <option key={index} value={index}>{text.column(index)}{source.columns?.[index] ? ' · ' + source.columns[index] : ''}</option>)}</select></Field>
      {active && <div><Field label={text.target + ' · ' + text.column(draft.selected)}><select aria-label={text.target + ' · ' + text.column(draft.selected)} disabled={!valid || readonly} value={active.column ?? ''} onChange={event => mapping(draft.selected, { column: event.target.value || null }, source)}><option value="">{text.skip}</option>{writable.map(column => <option key={column.name} value={column.name}>{column.name}</option>)}</select></Field><Field label={text.conversion + ' · ' + text.column(draft.selected)}><select aria-label={text.conversion + ' · ' + text.column(draft.selected)} disabled={!valid || readonly || active.column === null} value={active.kind} onChange={event => { if (Object.hasOwn(text.kindLabels, event.target.value)) mapping(draft.selected, { kind: event.target.value as SqlitePasteColumnMapping['kind'] }, source); }}>{Object.entries(text.kindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></Field></div>}
      <details><summary>{text.mapping}</summary><div className="sqlite-paste-preview"><table aria-label={text.mapping}><tbody>{draft.mapping.map((item, index) => <tr key={index}><td>{text.column(index)}{source.columns?.[index] ? ' · ' + source.columns[index] : ''}</td><td>{item.column ?? text.skip}</td><td>{text.kindLabels[item.kind]}</td></tr>)}</tbody></table></div></details></>}
    {previewed && <section><p>{text.previewHint}</p><p>{text.counts(previewed.plan.rows, previewed.plan.width)}</p><div className="sqlite-paste-preview"><table aria-label={text.previewRows}><thead><tr><th>#</th>{columns.map(column => <th key={column.name}>{column.name}</th>)}</tr></thead><tbody>{previewed.values.map((row, index) => <tr key={index}><td>{index + 1}</td>{row.map((value, at) => <td key={at}>{cellText(value, columns[at].generated)}</td>)}</tr>)}</tbody></table></div></section>}
    <ErrorBox message={!valid ? text.stale : readonly ? text.readonly : draft.error}/>
  </div><footer className="modal-footer"><button type="button" onClick={close}>{text.cancel}</button><span className="grow"/><button type="button" disabled={!valid || readonly || !source} onClick={preview}>{text.preview}</button><button type="button" className="primary" disabled={!valid || readonly || !previewed || consumed.current.has(previewed.plan)} onClick={stage}>{text.stage}</button></footer></Modal>;
}
