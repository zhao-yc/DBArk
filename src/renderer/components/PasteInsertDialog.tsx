import { useRef, useState, type ClipboardEvent } from 'react';
import type { TableInfo } from '../../shared/contracts';
import { errorMessage } from '../lib';
import { decodePasteInsert, defaultPasteInsertMapping, preparePasteInsert, readPasteInsert, pasteInsertSummary, type PasteInsertMapping, type PasteInsertPlan } from '../pasteInsert';
import { maxClipboardCharacters, type ClipboardCell } from '../gridClipboard';
import { pasteInsertZh as text } from '../locales/pasteInsert.zh-CN';
import { ErrorBox, Modal } from './ui';

/** 独立本地预览：只接收真实paste事件或手工输入，关闭丢弃本弹窗输入，不触碰原页草稿。 */
export function PasteInsertDialog({ info, visibleKeys, invalidReason, onStage, onClose }: {
  info: TableInfo; visibleKeys: readonly string[]; invalidReason: string; onStage(plan: PasteInsertPlan): void; onClose(): void;
}) {
  const [input, setInput] = useState(''), inputRef = useRef('');
  const [matrix, setMatrix] = useState<ClipboardCell[][] | null>(null), matrixRef = useRef<ClipboardCell[][] | null>(null);
  const [mapping, setMapping] = useState<PasteInsertMapping>([]), mappingRef = useRef<PasteInsertMapping>([]);
  const [plan, setPlan] = useState<PasteInsertPlan | null>(null), planRef = useRef<PasteInsertPlan | null>(null);
  const [error, setError] = useState(''), [mappingPage, setMappingPage] = useState(0), [columnPage, setColumnPage] = useState(0);
  const invalidRef = useRef(invalidReason); invalidRef.current = invalidReason;
  const writable = info.columns.filter(column => !column.generated);
  /** 同步撤销旧预览；React更新前的旧点击也不能消费先前输入。 */
  function invalidate() { planRef.current = null; setPlan(null); setError(''); }
  function source(values: ClipboardCell[][], plain: string) {
    matrixRef.current = values; setMatrix(values); inputRef.current = plain; setInput(plain);
    mappingRef.current = defaultPasteInsertMapping(info, visibleKeys, values[0].length); setMapping(mappingRef.current); setMappingPage(0); setColumnPage(0);
  }
  /** 只读取此事件的DataTransfer，失败时清掉旧来源，不降级旧typed或偷偷保留旧Apply。 */
  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    event.preventDefault(); invalidate(); matrixRef.current = null; setMatrix(null);
    try { const result = readPasteInsert(event.clipboardData); source(result.values, result.plain); }
    catch (reason) { inputRef.current = ''; setInput(''); mappingRef.current = []; setMapping([]); setError(errorMessage(reason)); }
  }
  function changeInput(value: string) { invalidate(); matrixRef.current = null; setMatrix(null); mappingRef.current = []; setMapping([]); if (value.length > maxClipboardCharacters) { inputRef.current = ''; setInput(''); setError(text.limits); return; } inputRef.current = value; setInput(value); }
  /** 手工文本也必须明确预览；只构建有界值计划，不分配草稿行或发起IPC。 */
  function preview() {
    invalidate();
    try {
      if (invalidRef.current) throw Error(invalidRef.current);
      let values = matrixRef.current;
      if (!values) { values = decodePasteInsert('', inputRef.current); source(values, inputRef.current); }
      const next = preparePasteInsert(info, values, mappingRef.current); planRef.current = next; setPlan(next);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function mapColumn(index: number, target: string | null) {
    invalidate(); const next = mappingRef.current.map((value, current) => current === index ? target : value); mappingRef.current = next; setMapping(next);
  }
  /** 先消费本次按钮票据，双击或回调失败都不能再次发布同一批草稿。 */
  function stage() {
    const current = planRef.current; if (!current || invalidRef.current) return;
    planRef.current = null; setPlan(null);
    try { onStage(current); } catch (reason) { setError(errorMessage(reason)); }
  }
  const mappingPages = Math.max(1, Math.ceil(mapping.length / 10)), columnPages = Math.max(1, Math.ceil(info.columns.length / 10));
  return <Modal title={text.action} wide onClose={() => { planRef.current = null; onClose(); }}><div className="modal-content">
    <p>{text.hint}</p><p className="muted small">{text.limits}</p>
    <label className="field full"><span>{text.input}</span><textarea aria-label={text.input} rows={5} value={input} onPaste={paste} onChange={event => changeInput(event.target.value)} disabled={!!invalidReason}/></label>
    {matrix && <><p>{text.rows}：{matrix.length} · {text.columns}：{matrix[0].length}</p><h3>{text.mapping}</h3>
      <p>{text.defaults}</p><p className="muted small">{text.autoHint}</p>
      {mapping.slice(mappingPage * 10, mappingPage * 10 + 10).map((target, offset) => { const index = mappingPage * 10 + offset; return <label className="inline-field" key={index}>{text.source} {index + 1}<select aria-label={`${text.destination} ${index + 1}`} value={target === null ? '' : String(info.columns.findIndex(column => column.name === target) + 1)} disabled={!!invalidReason} onChange={event => mapColumn(index, event.target.value ? info.columns[Number(event.target.value) - 1].name : null)}><option value="">{text.skip}</option>{writable.map(column => <option key={column.name} value={String(info.columns.indexOf(column) + 1)}>{column.name}{/\bauto_increment\b/i.test(column.extra) ? ` · ${text.auto}` : ''}</option>)}</select></label>; })}
      <p><button disabled={mappingPage === 0} onClick={() => setMappingPage(value => value - 1)}>{text.previous}</button> {mappingPage + 1}/{mappingPages} <button disabled={mappingPage + 1 >= mappingPages} onClick={() => setMappingPage(value => value + 1)}>{text.next}</button></p>
    </>}
    {plan && <><p role="status">{text.prepared} {text.rows}：{plan.data.length}</p><p className="muted small">{text.previewHint}</p><div style={{ overflow: 'auto', maxHeight: 320 }}><table><thead><tr>{info.columns.slice(columnPage * 10, columnPage * 10 + 10).map(column => <th key={column.name}>{column.name}{column.generated ? ` · ${text.generated}` : ''}</th>)}</tr></thead><tbody>{plan.data.slice(0, 10).map((row, index) => <tr key={index}>{info.columns.slice(columnPage * 10, columnPage * 10 + 10).map(column => <td key={column.name}>{pasteInsertSummary(row, column.name)}</td>)}</tr>)}</tbody></table></div><p><button disabled={columnPage === 0} onClick={() => setColumnPage(value => value - 1)}>{text.previous}</button> {columnPage + 1}/{columnPages} <button disabled={columnPage + 1 >= columnPages} onClick={() => setColumnPage(value => value + 1)}>{text.next}</button></p></>}
    <ErrorBox message={invalidReason || error}/>
  </div><footer className="modal-footer"><button onClick={() => { planRef.current = null; onClose(); }}>{text.close}</button><span className="grow"/><button disabled={!!invalidReason} onClick={preview}>{text.preview}</button><button className="primary" disabled={!plan || !!invalidReason} onClick={stage}>{text.stage}</button></footer></Modal>;
}
