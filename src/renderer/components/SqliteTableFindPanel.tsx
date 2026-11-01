import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import type { SqliteDraftRow } from '../sqliteTableEditor';
import { sqliteFindMessages, type SqliteFindOptions, type SqliteFindOccurrence } from '../sqliteTableFind';
import { SqliteTableFindWorkerClient, sqliteTextReplacementPlanPreview, type SqliteFindReadyResult, type SqliteTextReplacementPlan } from '../sqliteTableFindWorkerClient';
import { sqliteTableFindZh as text } from '../locales/sqliteTableFind.zh-CN';
import { ErrorBox, Field, Modal, UsageHelp } from './ui';
import '../sqliteTableFind.css';

export interface SqliteTableFindFocusRequest { id: number; mode: 'find' | 'replace'; }
export interface SqliteTableFindSeed { options: SqliteFindOptions; replacement: string; mode: 'find' | 'replace'; }
interface Props {
  page: SqliteTablePage; rows: readonly SqliteDraftRow[]; focusRequest: SqliteTableFindFocusRequest;
  seed?: SqliteTableFindSeed; previewOwner?: string; isCurrent(): boolean;
  onJump(rowId: string, column: number, focusGrid?: boolean, range?: { start: number; end: number }): void;
  onStage(plan: SqliteTextReplacementPlan, continuation?: SqliteTableFindSeed): boolean | void;
  onPreviewChange?(open: boolean): void; onClearHit?(): void; onClose(): void;
}
type Preview = { plan: SqliteTextReplacementPlan; patches: ReturnType<typeof sqliteTextReplacementPlanPreview> };
interface Draft extends SqliteTableFindSeed { epoch: object; found?: SqliteFindReadyResult; position: number; preview?: Preview; error: string; }
const defaultOptions: SqliteFindOptions = { kind: 'text', query: '', caseSensitive: false, wholeCell: false };
/** 非模态当前页查找；所有正则与捕获仅交给真实有界Worker，替换只产生可核对的本地opaque计划。 */
export function SqliteTableFindPanel({ page, rows, focusRequest, seed, previewOwner, isCurrent, onJump, onStage, onPreviewChange, onClearHit, onClose }: Props) {
  const owner = useRef({ page, rows, seed, previewOwner, isCurrent, onJump, onStage, onPreviewChange, onClearHit, onClose }).current;
  const invalid = useRef(false), propsInvalid = useRef(false), closed = useRef(false), mounted = useRef(false), consumed = useRef(new WeakSet<SqliteTextReplacementPlan>()), staging = useRef(false);
  const [draft, setDraft] = useState<Draft>(() => ({ options: { ...(seed?.options ?? defaultOptions) }, replacement: seed?.replacement ?? '', mode: seed?.mode ?? focusRequest.mode, epoch: {}, position: -1, error: '' })), live = useRef(draft); live.current = draft;
  const client = useRef<SqliteTableFindWorkerClient | undefined>(undefined), serial = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), composing = useRef(false);
  const [working, setWorking] = useState<'running' | 'stopping' | undefined>(), work = useRef<typeof working>(undefined), renderTicket = {}, committed = useRef<object | undefined>(undefined);
  const queryInput = useRef<HTMLInputElement>(null), replacementInput = useRef<HTMLInputElement>(null), kindInput = useRef<HTMLSelectElement>(null);
  const pendingFocus = useRef<SqliteTableFindFocusRequest | undefined>(focusRequest);
  const metadata = () => JSON.stringify([owner.page.target, owner.page.schemaKey, owner.page.columns, owner.page.edit?.kind, owner.page.edit?.kind === 'editable' ? [owner.page.edit.snapshotId, owner.page.edit.expiresAt, owner.page.edit.columns, owner.page.edit.locator] : undefined]);
  const [source] = useState(() => ({ metadata: metadata(), rows: owner.rows.map(row => ({ row, id: row.id, index: row.index, deleted: row.deleted, values: row.values, cells: row.values.map(value => value === undefined ? undefined : { ...value }) })) }));
  if (owner.page !== page || owner.rows !== rows || owner.seed !== seed || owner.previewOwner !== previewOwner) propsInvalid.current = true;
  function sourceCurrent(): boolean { try { if (propsInvalid.current || !owner.isCurrent() || source.metadata !== metadata() || owner.rows.length !== source.rows.length || source.rows.some((item, index) => owner.rows[index] !== item.row || item.row.id !== item.id || item.row.index !== item.index || item.row.deleted !== item.deleted || item.row.values !== item.values || item.row.values.length !== item.cells.length || item.cells.some((before, at) => { const value = item.row.values[at]; return before === undefined ? value !== undefined : value === undefined || before.kind !== value.kind || before.kind !== 'null' && (value.kind === 'null' || before.value !== value.value); }))) invalid.current = true; } catch { invalid.current = true; } return !invalid.current && !closed.current; }
  function local(): boolean { return mounted.current && committed.current === renderTicket && live.current === draft && !closed.current; }
  function inputCurrent(epoch?: object): boolean { return mounted.current && sourceCurrent() && !staging.current && !live.current.preview && (!epoch || live.current.epoch === epoch); }
  function replace(value: Draft): void { live.current = value; if (mounted.current) setDraft(value); }
  function busy(value: typeof working): void { work.current = value; if (mounted.current) setWorking(value); }
  /** 仅撤准确owner的显示命中，不伪造空行导航；render中不回写父组件。 */
  function clearHit(): boolean { try { owner.onClearHit?.(); return true; } catch { invalid.current = true; return false; } }
  /** 输入、停止和关闭同步撤代次，真实cancel完成前不放开运行按钮。 */
  function cancelWork(message = '', clearFound = false): void {
    clearHit(); const request = ++serial.current; clearTimeout(timer.current); timer.current = undefined;
    const pending = client.current?.cancel();
    if (pending) {
      busy('stopping'); void pending.then(() => { if (mounted.current && serial.current === request && !closed.current) { busy(undefined); if (message) replace({ ...live.current, error: message }); } }).catch(reason => { if (mounted.current && serial.current === request) { busy(undefined); replace({ ...live.current, error: reason instanceof Error ? reason.message : text.failed }); } });
    } else busy(undefined);
    if (clearFound) replace({ ...live.current, found: undefined, position: -1 });
  }
  function previewClosed(): void { if (live.current.preview) { replace({ ...live.current, preview: undefined }); owner.onPreviewChange?.(false); } }
  /** 两个全文输入始终合并最新live；改变列/类型等结构选择会更换epoch拒绝旧文本回调。 */
  function changeOptions(patch: Partial<SqliteFindOptions>, epoch?: object, structural = false): void {
    if (!inputCurrent(epoch)) return; cancelWork(); const value = live.current, options = { ...value.options, ...patch };
    if (options.kind !== 'text' || !options.regex) options.captureReplacement = false;
    replace({ ...value, options, epoch: structural ? {} : value.epoch, found: undefined, position: -1, preview: undefined, error: '' });
    schedule();
  }
  function changeReplacement(value: string, epoch: object): void {
    if (!inputCurrent(epoch)) return; cancelWork(); replace({ ...live.current, replacement: value, preview: undefined, error: '' });
  }
  /** 字面模式防抖；正则和捕获无自动运行路径，必须明确search或preview。 */
  function schedule(): void {
    clearTimeout(timer.current); const value = live.current;
    if (composing.current || value.options.regex || value.options.captureReplacement || value.options.kind === 'text' && !value.options.query) return;
    const request = serial.current;
    timer.current = setTimeout(() => { timer.current = undefined; if (serial.current === request && mounted.current && sourceCurrent() && !work.current && !composing.current) void run('find'); }, 160);
  }
  function sameOccurrence(left: SqliteFindOccurrence, right: SqliteFindOccurrence): boolean { return left.rowId === right.rowId && left.column === right.column && left.occurrence === right.occurrence && left.range?.start === right.range?.start && left.range?.end === right.range?.end; }
  /** 预览明确重新find，再从该轮准确occurrences取单处，绝不复用被cancel撤销的旧cap。 */
  async function run(kind: 'find' | 'one' | 'all'): Promise<void> {
    if (!mounted.current || !sourceCurrent() || work.current || composing.current || live.current.preview || staging.current) return;
    const value = live.current, selected = kind === 'one' ? value.found?.occurrences[value.position] : undefined;
    if (value.options.kind === 'text' && !value.options.query || kind !== 'find' && (owner.page.edit?.kind !== 'editable' || value.options.kind !== 'text' || kind === 'one' && !selected?.replaceable)) return;
    if (!clearHit()) return; clearTimeout(timer.current); timer.current = undefined;
    const source: Draft = { ...value, preview: undefined, error: '' }, request = ++serial.current; replace(source); busy('running');
    const accepts = () => mounted.current && serial.current === request && live.current === source && sourceCurrent();
    try {
      client.current ??= new SqliteTableFindWorkerClient(() => new Worker(new URL('../sqliteTableFind.worker.ts', import.meta.url), { type: 'module' }));
      const found = await client.current.find(owner.page, owner.rows, source.options); if (!accepts()) return;
      if (found.status === 'blocked') { replace({ ...source, found: undefined, position: -1, error: found.message }); return; }
      if (kind === 'find') { replace({ ...source, found, position: -1 }); return; }
      const only = selected ? found.occurrences.find(item => sameOccurrence(item, selected)) : undefined;
      if (selected && (!only || !only.replaceable)) throw Error(text.stale);
      const result = await client.current.preview(found, source.replacement, only); if (!accepts()) return;
      if (result.status === 'blocked') { replace({ ...source, found, error: result.message === sqliteFindMessages.noReplace ? text.noChanges : result.message }); return; }
      const patches = sqliteTextReplacementPlanPreview(result.plan, owner.page, owner.rows); if (!accepts()) return;
      owner.onPreviewChange?.(true);
      replace({ ...source, found, position: only ? found.occurrences.indexOf(only) : source.position, preview: { plan: result.plan, patches } });
    } catch (reason) { if (accepts()) replace({ ...source, preview: undefined, error: reason instanceof Error ? reason.message : text.failed }); }
    finally { if (mounted.current && serial.current === request) busy(undefined); }
  }
  /** 仅定位准确行与列，不把面板输入焦点交给网格；按钮导航允许明确聚焦网格。 */
  function jump(delta: -1 | 1, focusGrid = true): void {
    if (!local() || !sourceCurrent() || work.current || composing.current || draft.preview || !draft.found?.occurrences.length) return;
    const all = draft.found.occurrences, before = live.current.position, index = before < 0 ? delta > 0 ? 0 : all.length - 1 : (before + delta + all.length) % all.length, match = all[index];
    replace({ ...live.current, position: index });
    try { owner.onJump(match.rowId, match.column, focusGrid, match.range); } catch (reason) { replace({ ...live.current, error: reason instanceof Error ? reason.message : text.failed }); }
  }
  /** 一次确认只交付一个opaque计划；父消费并整批更改草稿，失败不得自动重试旧计划。 */
  function stage(): void {
    const chosen = draft.preview;
    if (!local() || !sourceCurrent() || work.current || composing.current || staging.current || !chosen || !chosen.plan.changedCells || consumed.current.has(chosen.plan)) return;
    consumed.current.add(chosen.plan); staging.current = true;
    try {
      sqliteTextReplacementPlanPreview(chosen.plan, owner.page, owner.rows);
      if (!sourceCurrent()) throw Error(text.stale);
      const continuation: SqliteTableFindSeed = { options: { ...draft.options }, replacement: draft.replacement, mode: draft.mode };
      if (owner.onStage(chosen.plan, continuation) === false) throw Error(text.stale);
      // 父成功可同步卸载旧panel并创建全新source；不可再核旧rows或误清新窗口。
      if (mounted.current) previewClosed();
    } catch (reason) { if (mounted.current) { previewClosed(); replace({ ...live.current, error: reason instanceof Error ? reason.message : text.failed }); } }
    finally { staging.current = false; }
  }
  /** 取消自身预览不清其它窗口；即使来源失效仍可退出自己的当前panel。 */
  function closePreview(): void { if (!local() || staging.current || propsInvalid.current || !draft.preview) return; previewClosed(); cancelWork(); }
  function close(): void {
    if (!local() || propsInvalid.current || staging.current) return; clearHit(); closed.current = true; ++serial.current; clearTimeout(timer.current); owner.onPreviewChange?.(false); busy('stopping');
    void (client.current?.dispose() ?? Promise.resolve()).then(() => { if (mounted.current && !propsInvalid.current) owner.onClose(); }).catch(reason => { if (mounted.current) { closed.current = false; busy(undefined); replace({ ...live.current, error: reason instanceof Error ? reason.message : text.failed }); } });
  }
  /** Enter只导航/预览当前页；IME、重复键和快捷组合不能触发替换或穿透网格。 */
  function key(event: KeyboardEvent<HTMLInputElement>, target: 'query' | 'replacement'): void {
    if (!local() || !sourceCurrent() || live.current.preview) return;
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composing.current) return;
    if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); event.stopPropagation(); if (event.repeat) return; if (target === 'replacement' && !event.shiftKey) void run('one'); else jump(event.shiftKey ? -1 : 1, false); }
  }
  useLayoutEffect(() => { mounted.current = true; committed.current = renderTicket; return () => { if (committed.current === renderTicket) committed.current = undefined; mounted.current = false; }; });
  const valid = sourceCurrent(), readonly = owner.page.edit?.kind !== 'editable', found = draft.found, current = found?.occurrences[draft.position], currentRow = current ? owner.rows.findIndex(row => row.id === current.rowId) : -1, currentValue = currentRow >= 0 && current ? owner.rows[currentRow].values[current.column] : undefined;
  useEffect(() => { if (!sourceCurrent()) { cancelWork(); } }, [valid]);
  useEffect(() => { if (!mounted.current || !sourceCurrent() || live.current.preview) return; pendingFocus.current = focusRequest; if (live.current.mode !== focusRequest.mode) replace({ ...live.current, mode: focusRequest.mode, epoch: {} }); }, [focusRequest.id, focusRequest.mode]);
  useEffect(() => { const request = pendingFocus.current; if (!request || !sourceCurrent() || live.current.preview || draft.mode !== request.mode) return; pendingFocus.current = undefined; const input = request.mode === 'replace' ? replacementInput.current : queryInput.current; (input && !input.disabled ? input : kindInput.current)?.focus(); }, [focusRequest.id, focusRequest.mode, draft.mode]);
  useEffect(() => { if (seed && sourceCurrent() && !seed.options.regex && !seed.options.captureReplacement) schedule(); return () => { mounted.current = false; closed.current = true; ++serial.current; clearTimeout(timer.current); void client.current?.dispose(); owner.onPreviewChange?.(false); }; }, []);
  const unavailable = !valid || !!draft.preview || staging.current, options = draft.options, epoch = draft.epoch, replaceable = !readonly && options.kind === 'text' && !!found?.matches.some(match => match.replaceable);
  return <section className="sqlite-table-find" aria-label={text.title} onCompositionStart={() => { if (inputCurrent()) { composing.current = true; cancelWork(); } }} onCompositionEnd={() => { if (inputCurrent()) { composing.current = false; cancelWork(); schedule(); } }}>
    <UsageHelp><p>{text.scope}</p><p>{text.typedHint}</p><p>{text.regexHint}</p></UsageHelp><div className="sqlite-table-find-fields">
      <Field label={text.kind}><select ref={kindInput} aria-label={text.kind} disabled={unavailable} value={options.kind} onChange={event => { if (local() && Object.hasOwn(text.kinds, event.target.value)) changeOptions({ kind: event.target.value as SqliteFindOptions['kind'] }, undefined, true); }}>{Object.entries(text.kinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></Field>
      <Field label={text.query}><input ref={queryInput} aria-label={text.query} maxLength={512} value={options.query} disabled={unavailable || options.kind !== 'text'} onChange={event => changeOptions({ query: event.target.value }, epoch)} onKeyDown={event => key(event, 'query')}/></Field>
      <Field label={text.column}><select aria-label={text.column} disabled={unavailable} value={options.column === undefined ? '' : String(options.column)} onChange={event => { if (!local()) return; const value = event.target.value, column = value === '' ? undefined : Number(value); if (column === undefined || Number.isInteger(column) && column >= 0 && column < owner.page.columns.length) changeOptions({ column }, undefined, true); }}><option value="">{text.allColumns}</option>{owner.page.columns.map((column, index) => <option key={index} value={String(index)}>{column.name}</option>)}</select></Field>
      {(['caseSensitive', 'wholeCell', 'regex'] as const).map(name => <label key={name}><input type="checkbox" aria-label={name === 'caseSensitive' ? text.sensitive : name === 'wholeCell' ? text.whole : text.regex} disabled={unavailable || options.kind !== 'text'} checked={!!options[name]} onChange={event => { if (local()) changeOptions({ [name]: event.target.checked }, undefined, true); }}/>{name === 'caseSensitive' ? text.sensitive : name === 'wholeCell' ? text.whole : text.regex}</label>)}
      <button type="button" aria-pressed={draft.mode === 'replace'} disabled={unavailable} onClick={() => { if (local() && inputCurrent()) replace({ ...draft, mode: draft.mode === 'replace' ? 'find' : 'replace', epoch: {} }); }}>{text.replaceMode}</button>
    </div><div className="sqlite-table-find-actions"><span role="status">{working === 'running' ? text.searching : working === 'stopping' ? text.stopping : text.count(found?.matches.length ?? 0, found?.occurrences.length ?? 0, draft.position)}</span>
      <button type="button" disabled={unavailable || !!working || options.kind === 'text' && !options.query} onClick={() => { if (local()) void run('find'); }}>{text.search}</button>{working && <button type="button" disabled={working === 'stopping'} onClick={() => { if (local()) { previewClosed(); cancelWork(text.stopped, true); } }}>{text.stop}</button>}
      <button type="button" disabled={unavailable || !!working || !found?.occurrences.length} onClick={() => jump(-1)}>{text.previous}</button><button type="button" disabled={unavailable || !!working || !found?.occurrences.length} onClick={() => jump(1)}>{text.next}</button><span className="grow"/><button type="button" disabled={staging.current} onClick={close}>{text.close}</button>
    </div><p className="sqlite-table-find-status">{text.scopeCount(owner.rows.length, owner.page.columns.length)}</p>
    {current && <div className="sqlite-table-find-current"><p>{text.location(currentRow + 1, owner.page.columns[current.column]?.name ?? '', current.occurrence)}</p>{currentValue?.kind === 'text' && current.range && <pre>{currentValue.value.slice(Math.max(0, current.range.start - 60), current.range.start)}<mark>{currentValue.value.slice(current.range.start, current.range.end)}</mark>{currentValue.value.slice(current.range.end, current.range.end + 60)}</pre>}{!current.replaceable && <p>{text.currentReadonly}</p>}</div>}
    {draft.mode === 'replace' && <div className="sqlite-table-find-fields"><Field label={text.replacement}><input ref={replacementInput} aria-label={text.replacement} maxLength={4096} value={draft.replacement} disabled={unavailable || readonly || options.kind !== 'text'} onChange={event => changeReplacement(event.target.value, epoch)} onKeyDown={event => key(event, 'replacement')}/></Field><label><input type="checkbox" aria-label={text.captures} checked={!!options.captureReplacement} disabled={unavailable || readonly || options.kind !== 'text' || !options.regex} onChange={event => { if (local()) changeOptions({ captureReplacement: event.target.checked }, undefined, true); }}/>{text.captures}</label><button type="button" disabled={unavailable || !!working || readonly || !current?.replaceable || options.kind !== 'text'} onClick={() => { if (local()) void run('one'); }}>{text.replaceOne}</button><button type="button" disabled={unavailable || !!working || !replaceable} onClick={() => { if (local()) void run('all'); }}>{text.replaceAll}</button></div>}
    <ErrorBox message={!valid ? text.stale : draft.error}/>{readonly && <p>{text.readonly}</p>}
    {draft.preview && <Modal title={text.previewTitle} wide onClose={closePreview}><div className="modal-content" data-sqlite-find-preview={owner.previewOwner}><p>{text.previewHint}</p><p>{text.previewCount(draft.preview.plan.changedCells, draft.preview.plan.changedRows)}</p>{!draft.preview.plan.changedCells && <p>{text.noChanges}</p>}<div className="sqlite-table-find-preview"><table aria-label={text.previewRows}><thead><tr><th>{text.row}</th><th>{text.columnName}</th><th>{text.oldValue}</th><th>{text.newValue}</th></tr></thead><tbody>{draft.preview.patches.map(patch => <tr key={patch.rowId + ':' + patch.column}><td>{owner.rows.findIndex(row => row.id === patch.rowId) + 1}</td><td>{owner.page.columns[patch.column]?.name}</td><td><pre>{patch.before}</pre></td><td><pre>{patch.after}</pre></td></tr>)}</tbody></table></div><ErrorBox message={!valid ? text.stale : draft.error}/></div><footer className="modal-footer"><button type="button" onClick={closePreview}>{text.cancelPreview}</button><span className="grow"/><button type="button" className="primary" disabled={!valid || readonly || !!working || !draft.preview.plan.changedCells || consumed.current.has(draft.preview.plan)} onClick={stage}>{text.stage}</button></footer></Modal>}
  </section>;
}
