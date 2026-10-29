import { useEffect, useMemo, useRef, useState, type KeyboardEvent as InputKeyEvent } from 'react';
import type { TableInfo } from '../../shared/contracts';
import type { DraftRow } from '../dataChanges';
import { nextPageOccurrenceAfterReplacement, pageOccurrences, pageReplaceWritable, type PageCellMatch, type PageFindOptions, type PageOccurrence, type PageReplacement } from '../pageFindReplace';
import { tableCellKeyIsComposing } from '../tableCellKeyboard';
import { PageFindWorkerClient } from '../pageFindWorkerClient';
import { errorMessage, ownCell } from '../lib';
import { formatText, zh } from '../locales/zh-CN';
import { tableGridZh as text } from '../locales/tableGrid.zh-CN';
import { UsageHelp, ErrorBox, Field, Modal  } from './ui';

/** 当前页查找和预览全部在线程内执行；正则模式需要明确点击，编辑模式不会自动重跑恶意表达式。 */
export function PageFindPanel({ rows, keys, info, generation, disabled, replaceDisabled = false, focusRequest, onJump, onApply, onFilter, getSelectionToken }: { rows: DraftRow[]; keys: string[]; info: TableInfo | null; generation: number; disabled: boolean; replaceDisabled?: boolean; focusRequest: { target: 'query' | 'replacement'; generation: number }; onJump(rowId: string, key: string, focusGrid?: boolean): void; onApply(plan: PageReplacement, only?: PageOccurrence, selectionToken?: unknown): DraftRow[] | void; onFilter(): void; getSelectionToken?(): unknown }) {
  const [options, setOptions] = useState<PageFindOptions>({ kind: 'text', query: '', caseSensitive: false, wholeCell: false });
  const [replacement, setReplacement] = useState(''); const [position, setPosition] = useState(-1); const [preview, setPreview] = useState<PageReplacement | null>(null); const [error, setError] = useState(''); const applyLock = useRef(false);
  const [working, setWorking] = useState(false), [composing, setComposing] = useState(false);
  const workingRef = useRef(false), composingRef = useRef(false), singleLock = useRef(false), positionRef = useRef(-1);
  const client = useRef<PageFindWorkerClient | null>(null), requestSerial = useRef(0);
  const intentRevision = useRef(0), activeOptions = useRef(options); activeOptions.current = options;
  const autoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const snapshot = useMemo(() => ({ rows, keys, info, generation, options, disabled, replaceDisabled }), [rows, keys, info, generation, options, disabled, replaceDisabled]);
  const latest = useRef(snapshot); latest.current = snapshot;
  const advance = useRef<{ rows: DraftRow[]; source: typeof snapshot; only: PageOccurrence; value: string; intent: number } | null>(null);
  const latestReplacement = useRef(replacement); latestReplacement.current = replacement;
  const previewSource = useRef<{ snapshot: typeof snapshot; replacement: string; intent: number } | null>(null);
  const [foundState, setFound] = useState<{ matches: PageCellMatch[]; snapshot: typeof snapshot | null }>({ matches: [], snapshot: null });
  const found = foundState.snapshot === snapshot ? foundState.matches : [];
  const queryInput = useRef<HTMLInputElement>(null), replacementInput = useRef<HTMLInputElement>(null), kindSelect = useRef<HTMLSelectElement>(null);
  /** 每次明确打开或重复快捷键都接管输入焦点，不能让查找文字进入活动网格草稿。 */
  useEffect(() => { const target = focusRequest.target === 'replacement' ? replacementInput.current : queryInput.current; (target && !target.disabled ? target : kindSelect.current)?.focus(); }, [focusRequest]);
  const occurrences = useMemo(() => pageOccurrences(found), [foundState, snapshot]);
  const current = occurrences[position];
  const currentRow = current ? rows.findIndex(row => row.id === current.rowId) : -1;
  const currentValue = currentRow >= 0 ? ownCell(rows[currentRow].data, current.key) : undefined;
  const canReplace = !replaceDisabled && !!info && options.kind === 'text' && found.some(match => pageReplaceWritable(info, match.key) && typeof ownCell(rows.find(row => row.id === match.rowId)!.data, match.key) === 'string');
  const currentWritable = !!current?.range && typeof currentValue === 'string' && !!info && pageReplaceWritable(info, current.key) && options.kind === 'text' && !replaceDisabled;
  /** 导航状态同步写引用，连续键盘事件不能借尚未渲染的位置替换上一处。 */
  function selectPosition(next: number) { positionRef.current = next; setPosition(next); }
  /** 每次新意图永久撤销旧命令；不能因文字或组合布尔值恢复原样而重新获得写稿资格。 */
  function invalidateIntent() {
    intentRevision.current++; const serial = ++requestSerial.current; advance.current = null; previewSource.current = null; setPreview(null);
    clearTimeout(autoTimer.current); autoTimer.current = undefined;
    const stopped = client.current?.cancel();
    if (stopped) void stopped.then(() => { if (serial === requestSerial.current) { workingRef.current = false; singleLock.current = false; setWorking(false); } });
    else { workingRef.current = false; singleLock.current = false; setWorking(false); }
  }
  /** 先同步递增修订及最新值，再交给React；同一事件轮次的ABA也不能漏掉。 */
  function changeReplacement(value: string) { invalidateIntent(); latestReplacement.current = value; setReplacement(value); if (!found.length && options.kind === 'text' && options.query && !options.regex) autoTimer.current = setTimeout(() => { void run('find'); }, 120); }
  /** 查找类型、文字、列及匹配选项统一撤销在途计划。 */
  function changeOptions(value: PageFindOptions) { invalidateIntent(); if (value.captureReplacement && (value.kind !== 'text' || !value.regex)) value = { ...value, captureReplacement: false }; activeOptions.current = value; setOptions(value); }
  /** 组合开始和结束各自都是新意图，结束后不能恢复组合前的预览授权。 */
  function compositionStarted() { invalidateIntent(); composingRef.current = true; setComposing(true); }
  function compositionEnded(target: EventTarget | null) { invalidateIntent(); composingRef.current = false; setComposing(false); if (target === queryInput.current && !options.regex) autoTimer.current = setTimeout(() => { void run('find'); }, 120); }
  /** 最终提交前再核精确选中位置，不依赖当前渲染文字或格内序号单独推断。 */
  function sameCurrent(only: PageOccurrence) { const selected = occurrences[positionRef.current]; return !!selected && selected.rowId === only.rowId && selected.key === only.key && selected.occurrence === only.occurrence && selected.range?.start === only.range?.start && selected.range?.end === only.range?.end; }
  /** 上下文一变就清空旧位置，并终止线程；字面模式短暂防抖，用户正则只接受明确触发。 */
  useEffect(() => {
    const serial = ++requestSerial.current;
    const resume = advance.current; advance.current = null; singleLock.current = false;
    const ownUpdate = resume && resume.intent === intentRevision.current && resume.rows === rows && resume.source.info === info && resume.source.keys === keys && resume.source.options === options && resume.source.generation + 1 === generation && !disabled && !replaceDisabled;
    intentRevision.current++;
    setFound({ matches: [], snapshot: null }); selectPosition(-1); setPreview(null); setError('');
    void client.current?.cancel().then(() => { if (serial === requestSerial.current) { workingRef.current = false; setWorking(false); } });
    if (disabled || (options.kind === 'text' && (!options.query || (options.regex && !ownUpdate)))) return;
    autoTimer.current = setTimeout(() => { void run('find', undefined, ownUpdate ? resume : undefined); }, 120);
    return () => { clearTimeout(autoTimer.current); requestSerial.current++; void client.current?.cancel(); };
  }, [snapshot]);
  useEffect(() => { setPreview(null); }, [replacement]);
  useEffect(() => () => { requestSerial.current++; void client.current?.dispose(); client.current = null; }, []);
  useEffect(() => { setOptions(current => current.column && !keys.includes(current.column) ? { ...current, column: undefined } : current); }, [keys]);
  /** 返回下一格的身份，由网格按最新可见列定位与虚拟滚动。 */
  function jump(delta: number, focusGrid = true) { if (!occurrences.length || disabled || composingRef.current || activeOptions.current !== snapshot.options) return; invalidateIntent(); const active = positionRef.current, next = active < 0 ? delta > 0 ? 0 : occurrences.length - 1 : (active + delta + occurrences.length) % occurrences.length; const match = occurrences[next]; selectPosition(next); onJump(match.rowId, match.key, focusGrid); }
  /** 单处命令只接受当前快照中的精确出现位置；不能回退成整格或整页替换。 */
  function replaceCurrent() { const match = occurrences[positionRef.current], row = match && rows.find(row => row.id === match.rowId); if (disabled || composingRef.current || workingRef.current || singleLock.current || replaceDisabled || options.kind !== 'text' || !info || !match?.range || !row || typeof ownCell(row.data, match.key) !== 'string' || !pageReplaceWritable(info, match.key)) return; void run('preview', match); }
  /** Enter仅处理本面板输入；组合标志或229保留原生输入，不产生导航或草稿。 */
  function inputKey(event: InputKeyEvent<HTMLInputElement>, target: 'query' | 'replacement') { if (composingRef.current || tableCellKeyIsComposing(event.nativeEvent) || event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey) return; event.preventDefault(); event.stopPropagation(); if (event.repeat) return; if (event.shiftKey) jump(-1, false); else if (target === 'query') jump(1, false); else replaceCurrent(); }
  /** 完成消息必须仍属于当前快照和请求；单处替换与整批预览共用原值、资格和预算政策。 */
  async function run(operation: 'find' | 'preview', only?: PageOccurrence, resume?: NonNullable<typeof advance.current>) {
    if (disabled || composingRef.current || latest.current !== snapshot || activeOptions.current !== snapshot.options || (operation === 'preview' && (!info || replaceDisabled || workingRef.current || singleLock.current || (only && !sameCurrent(only))))) return;
    clearTimeout(autoTimer.current); autoTimer.current = undefined;
    const serial = ++requestSerial.current, intent = ++intentRevision.current, source = snapshot, value = latestReplacement.current, selectionToken = getSelectionToken?.();
    client.current ??= new PageFindWorkerClient(() => new Worker(new URL('../pageFind.worker.ts', import.meta.url), { type: 'module' }));
    workingRef.current = true; if (only) singleLock.current = true; setWorking(true); setError('');
    const result = await client.current.run({ operation, rows, keys, options, generation, ...(operation === 'preview' ? { info: info!, replacement: value, only } : {}) });
    if (requestSerial.current !== serial || intentRevision.current !== intent || latest.current !== source) return;
    workingRef.current = false; setWorking(false);
    if (result.status === 'blocked') { singleLock.current = false; setError(result.message); return; }
    if (result.operation === 'find') { setFound({ matches: result.matches, snapshot: source }); const matches = pageOccurrences(result.matches), next = resume ? nextPageOccurrenceAfterReplacement(rows, keys, matches, resume.only, resume.value) : -1; selectPosition(next); if (next >= 0) onJump(matches[next].rowId, matches[next].key, false); return; }
    if (composingRef.current || latestReplacement.current !== value || (only && (!sameCurrent(only) || (getSelectionToken && getSelectionToken() !== selectionToken)))) { singleLock.current = false; setError(text.changed); return; }
    try {
      if (only) {
        // 捕获模板长度不同于实际插入长度，后续定位必须跳过真正写入的文本。
        const patch = result.preview.patches[0], inserted = patch.after.slice(only.range!.start, patch.after.length - (patch.before.length - only.range!.end));
        const next = onApply(result.preview, only, selectionToken);
        if (next) advance.current = { rows: next, source, only, value: inserted, intent }; else singleLock.current = false;
      }
      else { previewSource.current = { snapshot: source, replacement: value, intent }; setPreview(result.preview); applyLock.current = false; }
    } catch (reason) { singleLock.current = false; setError(errorMessage(reason)); }
  }
  /** 取消后等待线程终止完成，再释放按钮，迟到响应由请求序号与快照双重隔离。 */
  async function cancel() { invalidateIntent(); const serial = requestSerial.current; await client.current?.cancel(); if (serial === requestSerial.current) { workingRef.current = false; singleLock.current = false; setWorking(false); setError(text.cancelled); } }
  /** 单次确认先检查整批快照，失败保留窗口和既有草稿。 */
  function apply() { if (!preview || disabled || replaceDisabled || composingRef.current || applyLock.current) return; applyLock.current = true; try { if (previewSource.current?.snapshot !== latest.current || previewSource.current.replacement !== latestReplacement.current || previewSource.current.intent !== intentRevision.current) throw new Error(text.changed); onApply(preview); setPreview(null); setError(''); } catch (reason) { applyLock.current = false; setError(errorMessage(reason)); } }
  return <section className="page-find-panel" aria-label={text.find} onCompositionStart={compositionStarted} onCompositionEnd={event => compositionEnded(event.target)}><UsageHelp><p>{text.scope}</p><p>{text.binaryHint}</p><p>{text.replaceOneHint}</p>{options.kind === 'text' && options.regex && <p>{text.regexHint}</p>}{options.captureReplacement && <p>{text.captureHint}</p>}</UsageHelp><div className="page-find-fields">
    <Field label={text.kind}><select ref={kindSelect} disabled={disabled} value={options.kind} onChange={event => changeOptions({ ...options, kind: event.target.value as PageFindOptions['kind'] })}><option value="text">{text.text}</option><option value="null">{text.null}</option><option value="default">{text.default}</option></select></Field>
    <Field label={text.query}><input ref={queryInput} disabled={disabled || options.kind !== 'text'} maxLength={512} value={options.query} onKeyDown={event => inputKey(event, 'query')} onChange={event => changeOptions({ ...options, query: event.target.value })}/></Field>
    <Field label={text.column}><select disabled={disabled} value={options.column ?? ''} onChange={event => changeOptions({ ...options, column: event.target.value || undefined })}><option value="">{text.all}</option>{keys.map(key => <option key={key}>{key}</option>)}</select></Field>
    <label><input type="checkbox" disabled={disabled || options.kind !== 'text'} checked={options.caseSensitive} onChange={event => changeOptions({ ...options, caseSensitive: event.target.checked })}/>{text.case}</label><label><input type="checkbox" disabled={disabled || options.kind !== 'text'} checked={options.wholeCell} onChange={event => changeOptions({ ...options, wholeCell: event.target.checked })}/>{text.whole}</label><label><input type="checkbox" disabled={disabled || options.kind !== 'text'} checked={!!options.regex} onChange={event => changeOptions({ ...options, regex: event.target.checked })}/>{text.regex}</label>
  </div><div className="page-find-actions"><span role="status">{working ? text.searching : formatText(text.matches, found.length, position < 0 ? 0 : position + 1, occurrences.length)}</span><button disabled={disabled || working || (options.kind === 'text' && !options.query)} onClick={() => void run('find')}>{text.search}</button>{working && <button onClick={() => void cancel()}>{text.cancelSearch}</button>}<button disabled={disabled || composing || !occurrences.length} onClick={() => jump(-1)}>{text.previous}</button><button disabled={disabled || composing || !occurrences.length} onClick={() => jump(1)}>{text.next}</button><span className="grow"/><button disabled={disabled} onClick={onFilter}>{text.filter}</button></div>
    {current && <div className="page-find-current" aria-live="polite"><span>{formatText(text.location, currentRow + 1, current.key, current.occurrence, current.range ? current.range.start + 1 : 1)}</span>{typeof currentValue === 'string' && current.range && <pre>{currentValue.slice(Math.max(0, current.range.start - 60), current.range.start)}<mark>{current.range.start === current.range.end ? text.zeroWidth : currentValue.slice(current.range.start, Math.min(current.range.end, current.range.start + 160))}</mark>{currentValue.slice(current.range.end, current.range.end + 60)}</pre>}</div>}
    <div className="page-find-actions"><Field label={text.replacement}><input ref={replacementInput} disabled={disabled || options.kind !== 'text'} maxLength={4096} value={replacement} onKeyDown={event => inputKey(event, 'replacement')} onChange={event => changeReplacement(event.target.value)}/></Field><label><input type="checkbox" disabled={disabled || options.kind !== 'text' || !options.regex} checked={!!options.captureReplacement} onChange={event => changeOptions({ ...options, captureReplacement: event.target.checked })}/>{text.captureReplacement}</label><button title={text.replaceOneHint} disabled={disabled || working || composing || !currentWritable} onKeyDown={event => { if ((composingRef.current || tableCellKeyIsComposing(event.nativeEvent)) && ['Enter', ' '].includes(event.key)) event.preventDefault(); }} onClick={replaceCurrent}>{text.replaceOne}</button><button disabled={disabled || working || composing || !canReplace} onClick={() => void run('preview')}>{text.preview}</button></div>{current && !currentWritable && <p className="muted small">{text.currentReadonly}</p>}<ErrorBox message={error}/>
    {preview && <Modal title={text.replaceTitle} wide onClose={() => setPreview(null)}><div className="modal-content"><p>{text.replaceHint}</p><p>{formatText(text.count, preview.patches.length, preview.rows.length)}</p><div className="page-replace-preview"><table><thead><tr><th>{text.row}</th><th>{text.column}</th><th>{text.before}</th><th>{text.after}</th></tr></thead><tbody>{preview.patches.slice(0, 50).map(patch => <tr key={`${patch.rowId}-${patch.key}`}><td>{rows.findIndex(row => row.id === patch.rowId) + 1}</td><td>{patch.key}</td><td><pre>{patch.before}</pre></td><td><pre>{patch.after}</pre></td></tr>)}</tbody></table></div><ErrorBox message={error}/></div><footer className="modal-footer"><button onClick={() => setPreview(null)}>{zh.common.cancel}</button><span className="grow"/><button className="primary" disabled={disabled} onClick={apply}>{text.apply}</button></footer></Modal>}
  </section>;
}
