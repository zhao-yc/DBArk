import { useEffect, useMemo, useRef, useState } from 'react';
import type { TableInfo } from '../../shared/contracts';
import type { DraftRow } from '../dataChanges';
import { findPageCells, pageOccurrences, pageReplaceWritable, previewPageReplacement, type PageFindOptions, type PageReplacement } from '../pageFindReplace';
import { errorMessage, ownCell } from '../lib';
import { formatText, zh } from '../locales/zh-CN';
import { tableGridZh as text } from '../locales/tableGrid.zh-CN';
import { ErrorBox, Field, Modal } from './ui';

/** 页内文字查找没有网络请求，预览窗口持有不可变整批替换计划。 */
export function PageFindPanel({ rows, keys, info, generation, disabled, focusRequest, onJump, onApply, onFilter }: { rows: DraftRow[]; keys: string[]; info: TableInfo | null; generation: number; disabled: boolean; focusRequest: { target: 'query' | 'replacement'; generation: number }; onJump(rowId: string, key: string): void; onApply(plan: PageReplacement): void; onFilter(): void }) {
  const [options, setOptions] = useState<PageFindOptions>({ kind: 'text', query: '', caseSensitive: false, wholeCell: false });
  const [replacement, setReplacement] = useState(''); const [position, setPosition] = useState(-1); const [preview, setPreview] = useState<PageReplacement | null>(null); const [error, setError] = useState(''); const applyLock = useRef(false);
  const queryInput = useRef<HTMLInputElement>(null), replacementInput = useRef<HTMLInputElement>(null), kindSelect = useRef<HTMLSelectElement>(null);
  /** 每次明确打开或重复快捷键都接管输入焦点，不能让查找文字进入活动网格草稿。 */
  useEffect(() => { const target = focusRequest.target === 'replacement' ? replacementInput.current : queryInput.current; (target && !target.disabled ? target : kindSelect.current)?.focus(); }, [focusRequest]);
  const found = useMemo(() => { try { return { matches: options.kind === 'text' && !options.query ? [] : findPageCells(rows, keys, options), error: '' }; } catch (reason) { return { matches: [], error: errorMessage(reason) }; } }, [rows, keys, options]);
  const occurrences = useMemo(() => pageOccurrences(found.matches), [found]);
  const current = occurrences[position];
  const currentRow = current ? rows.findIndex(row => row.id === current.rowId) : -1;
  const currentValue = currentRow >= 0 ? ownCell(rows[currentRow].data, current.key) : undefined;
  const canReplace = !!info && options.kind === 'text' && found.matches.some(match => pageReplaceWritable(info, match.key) && typeof ownCell(rows.find(row => row.id === match.rowId)!.data, match.key) === 'string');
  useEffect(() => { setPosition(-1); }, [found]);
  /** 任一页面上下文或输入变化都撤销旧预览，不能继续确认旧计划。 */
  useEffect(() => { setPreview(null); setError(''); }, [generation, rows, keys, info, options, replacement]);
  useEffect(() => { setOptions(current => current.column && !keys.includes(current.column) ? { ...current, column: undefined } : current); }, [keys]);
  /** 返回下一格的身份，由网格按最新可见列定位与虚拟滚动。 */
  function jump(delta: number) { if (!occurrences.length || disabled) return; const next = position < 0 ? delta > 0 ? 0 : occurrences.length - 1 : (position + delta + occurrences.length) % occurrences.length; const match = occurrences[next]; setPosition(next); onJump(match.rowId, match.key); }
  /** 单处替换只将当前范围写入草稿，同格其余出现保持原值。 */
  function replaceOne() { if (!info || disabled || !current?.range) return; try { onApply(previewPageReplacement(rows, keys, options, replacement, info, generation, current)); setError(''); } catch (reason) { setError(errorMessage(reason)); } }
  /** 替换预览不修改草稿，更不会调用服务器集中提交。 */
  function makePreview() { if (!info || disabled) return; try { setPreview(previewPageReplacement(rows, keys, options, replacement, info, generation)); applyLock.current = false; setError(''); } catch (reason) { setError(errorMessage(reason)); } }
  /** 单次确认先检查整批快照，失败保留窗口和既有草稿。 */
  function apply() { if (!preview || disabled || applyLock.current) return; applyLock.current = true; try { onApply(preview); setPreview(null); setError(''); } catch (reason) { applyLock.current = false; setError(errorMessage(reason)); } }
  return <section className="page-find-panel" aria-label={text.find}><p className="muted small">{text.scope}</p><div className="page-find-fields">
    <Field label={text.kind}><select ref={kindSelect} disabled={disabled} value={options.kind} onChange={event => setOptions({ ...options, kind: event.target.value as PageFindOptions['kind'] })}><option value="text">{text.text}</option><option value="null">{text.null}</option><option value="default">{text.default}</option></select></Field>
    <Field label={text.query}><input ref={queryInput} disabled={disabled || options.kind !== 'text'} maxLength={512} value={options.query} onChange={event => setOptions({ ...options, query: event.target.value })}/></Field>
    <Field label={text.column}><select disabled={disabled} value={options.column ?? ''} onChange={event => setOptions({ ...options, column: event.target.value || undefined })}><option value="">{text.all}</option>{keys.map(key => <option key={key}>{key}</option>)}</select></Field>
    <label><input type="checkbox" disabled={disabled || options.kind !== 'text'} checked={options.caseSensitive} onChange={event => setOptions({ ...options, caseSensitive: event.target.checked })}/>{text.case}</label><label><input type="checkbox" disabled={disabled || options.kind !== 'text'} checked={options.wholeCell} onChange={event => setOptions({ ...options, wholeCell: event.target.checked })}/>{text.whole}</label>
  </div><div className="page-find-actions"><span>{formatText(text.matches, found.matches.length, position < 0 ? 0 : position + 1, occurrences.length)}</span><button disabled={disabled || !occurrences.length} onClick={() => jump(-1)}>{text.previous}</button><button disabled={disabled || !occurrences.length} onClick={() => jump(1)}>{text.next}</button><span className="grow"/><button disabled={disabled} onClick={onFilter}>{text.filter}</button></div>
    {current && <div className="page-find-current" aria-live="polite"><span>{formatText(text.location, currentRow + 1, current.key, current.occurrence, current.range ? current.range.start + 1 : 1)}</span>{typeof currentValue === 'string' && current.range && <pre>{currentValue.slice(Math.max(0, current.range.start - 60), current.range.start)}<mark>{currentValue.slice(current.range.start, Math.min(current.range.end, current.range.start + 160))}</mark>{currentValue.slice(current.range.end, current.range.end + 60)}</pre>}</div>}
    <div className="page-find-actions"><Field label={text.replacement}><input ref={replacementInput} disabled={disabled || options.kind !== 'text'} maxLength={4096} value={replacement} onChange={event => setReplacement(event.target.value)}/></Field><button disabled={disabled || !canReplace || !current?.range || !info || !pageReplaceWritable(info, current.key)} onClick={replaceOne}>{text.replaceOne}</button><button disabled={disabled || !canReplace} onClick={makePreview}>{text.preview}</button></div><p className="muted small">{text.binaryHint}</p><ErrorBox message={found.error || error}/>
    {preview && <Modal title={text.replaceTitle} wide onClose={() => setPreview(null)}><div className="modal-content"><p>{text.replaceHint}</p><p>{formatText(text.count, preview.patches.length, preview.rows.length)}</p><div className="page-replace-preview"><table><thead><tr><th>{text.row}</th><th>{text.column}</th><th>{text.before}</th><th>{text.after}</th></tr></thead><tbody>{preview.patches.slice(0, 50).map(patch => <tr key={`${patch.rowId}-${patch.key}`}><td>{rows.findIndex(row => row.id === patch.rowId) + 1}</td><td>{patch.key}</td><td><pre>{patch.before}</pre></td><td><pre>{patch.after}</pre></td></tr>)}</tbody></table></div><ErrorBox message={error}/></div><footer className="modal-footer"><button onClick={() => setPreview(null)}>{zh.common.cancel}</button><span className="grow"/><button className="primary" disabled={disabled} onClick={apply}>{text.apply}</button></footer></Modal>}
  </section>;
}
