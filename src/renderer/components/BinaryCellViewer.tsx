import { useEffect, useMemo, useRef, useState } from 'react';
import type { CellValue } from '../../shared/contracts';
import { assertBinaryHexInputBudget, binaryByteLength, binaryCellFromHex, binaryCellLimits, binaryEncodings, binaryHexPage, decodeBinaryCell, decodeBinaryText, inspectBinaryImage, parseBinaryHex, replaceBinaryHexInput, type BinaryEncoding } from '../binaryCell';
import { binaryCellFileOpenOutputSchema, binaryCellFileSaveOutputSchema } from '../../shared/binaryCellFiles';
import { errorMessage, invoke } from '../lib';
import { binaryCellFilesZh as filesText } from '../locales/binaryCellFiles.zh-CN';
import { formatText } from '../locales/zh-CN';
import { binaryCellZh as text } from '../locales/binaryCell.zh-CN';
import { ErrorBox, UsageHelp } from './ui';
import { useWorkspace } from '../store';
import '../binaryCell.css';

interface Props { value: CellValue | undefined; hexInput?: string; onHexChange?(value: string): void; label?: string; reason?: string; focus?: boolean; source?: readonly unknown[]; isCurrent?(): boolean; }
/** 一份有界完整值提供三种展示；只有明确的 Hex 输入回调可进入既有记录缓冲。 */
export function BinaryCellViewer({ value, hexInput, onHexChange, label = text.hexLabel, reason = '', focus = false, source = [], isCurrent }: Props) {
  const host = useRef<HTMLElement>(null), alive = useRef(true), operation = useRef<object | null>(null);
  const [fileBusy, setFileBusy] = useState(false), [fileNotice, setFileNotice] = useState('');
  const identity = [...source, hexInput === undefined ? value : hexInput, reason, label, !!onHexChange];
  const lease = useRef({ identity, revision: 0 });
  // 渲染即递增身份，A→B→A也不复活旧回包；不依赖effect启动时间。
  if (identity.length !== lease.current.identity.length || identity.some((item, index) => !Object.is(item, lease.current.identity[index]))) lease.current = { identity, revision: lease.current.revision + 1 };
  const revision = lease.current.revision;
  useEffect(() => { alive.current = true; return () => { alive.current = false; lease.current.revision++; }; }, []);
  useEffect(() => { setFileNotice(''); setInputError(''); }, [revision]);
  const [mode, setMode] = useState<'hex' | 'text' | 'image'>('hex'), [encoding, setEncoding] = useState<BinaryEncoding>('utf-8'), [page, setPage] = useState(0);
  const [imageState, setImageState] = useState<{ url: string; source: Uint8Array } | null>(null), [imageError, setImageError] = useState('');
  const [inputError, setInputError] = useState('');
  const decoded = useMemo(() => { try { return { bytes: hexInput !== undefined ? parseBinaryHex(hexInput) : decodeBinaryCell(value), error: '', size: binaryByteLength(value) }; } catch (reason) { return { bytes: null, error: errorMessage(reason), size: null }; } }, [value, hexInput]);
  const bytes = decoded.bytes;
  const image = useMemo(() => { if (mode !== 'image' || !bytes) return null; try { return { info: inspectBinaryImage(bytes), error: '' }; } catch (reason) { return { info: null, error: errorMessage(reason) }; } }, [bytes, mode]);
  const decodedText = useMemo(() => { if (mode !== 'text' || !bytes) return null; try { return { value: decodeBinaryText(bytes, encoding), error: '' }; } catch (reason) { return { value: '', error: errorMessage(reason) }; } }, [bytes, encoding, mode]);
  const editable = !!onHexChange && !reason && hexInput !== undefined;
  /** 原父来源与本查看器的唯一模态共同准入；别的弹窗不能借旧按钮读写文件。 */
  function fileCurrent(requireDom = true): boolean {
    if (!alive.current || lease.current.revision !== revision || !isCurrent) return false;
    try {
      if (!isCurrent()) return false;
      if (!requireDom) return true;
      const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
      return !dialogs.length || dialogs.length === 1 && !!host.current && dialogs[0].contains(host.current);
    } catch { return false; }
  }
  /** 文件任务只持有原值租约；不提供虚构取消，也不释放尚未结算的文件任务。 */
  async function fileAction(kind: 'open' | 'save'): Promise<void> {
    if (operation.current || !fileCurrent() || kind === 'open' && !editable || kind === 'save' && !bytes) return;
    const owner = {}; operation.current = owner; setFileBusy(true); setInputError(''); setFileNotice('');
    let invalid = false;
    const current = () => { if (invalid || operation.current !== owner || !fileCurrent()) { invalid = true; return false; } return true; };
    // 文件选择器等待期间同步观察来源与其它模态，恢复原界面也不复活这次操作。
    const unsubscribe = useWorkspace.subscribe(() => { current(); });
    const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => { current(); });
    observer?.observe(document.body, { childList: true, subtree: true });
    try {
      if (kind === 'open') {
        const result = binaryCellFileOpenOutputSchema.parse(await invoke('binaryCellFiles.open', {}));
        if (!current() || result === null) return;
        const loaded = decodeBinaryCell({ type: 'binary', base64: result.base64 });
        if (!loaded || loaded.length !== result.bytes) throw Error(filesText.invalidReply);
        const hex = '0x' + Array.from(loaded, byte => byte.toString(16).padStart(2, '0')).join('');
        assertBinaryHexInputBudget(hex);
        if (!current()) return;
        onHexChange?.(hex); setFileNotice(filesText.loaded(result.name, result.bytes));
      } else {
        const base64 = hexInput !== undefined ? binaryCellFromHex(hexInput).base64 : typeof value === 'object' && value !== null && 'base64' in value ? value.base64 : undefined;
        if (typeof base64 !== 'string' || !current()) return;
        const result = binaryCellFileSaveOutputSchema.parse(await invoke('binaryCellFiles.save', { base64, suggestedName: 'binary-cell.bin' }));
        if (!current() || result === null) return;
        if (result.bytes !== bytes!.length) throw Error(filesText.invalidReply);
        setFileNotice(filesText.saved(result.name, result.bytes));
      }
    } catch (reason) { if (current()) setInputError(errorMessage(reason)); }
    finally { unsubscribe(); observer?.disconnect(); if (operation.current === owner) { operation.current = null; if (alive.current) setFileBusy(false); } }
  }
  useEffect(() => { setPage(0); }, [value, hexInput]);
  /** 只有通过格式与像素门的原始字节才创建 Blob；切换、改值和卸载均释放这一份 URL。 */
  useEffect(() => {
    setImageState(null); setImageError('');
    if (!image?.info || !bytes) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: image.info.mime })); setImageState({ url, source: bytes });
    return () => URL.revokeObjectURL(url);
  }, [image, bytes]);
  /** 浏览器尺寸与预检头必须一致，失败即撤销资源，不尝试其它 MIME 或外部加载。 */
  function rejectImage() { if (imageState) URL.revokeObjectURL(imageState.url); setImageState(null); setImageError(text.imageFailed); }
  /** 输入事件的兜底门也检查完整值；被拒绝时显式还原原编辑，不交付截断或超限内容。 */
  function acceptHex(node: HTMLTextAreaElement, next: string): boolean {
    if (!editable || operation.current) return false;
    try { assertBinaryHexInputBudget(next); onHexChange?.(next); setInputError(''); return true; }
    catch (reason) { node.value = hexInput ?? ''; setInputError(errorMessage(reason)); return false; }
  }
  /** 粘贴、拖入和选区替换复用同一个有界候选计算；拒绝不会改变缓冲、草稿或选择范围。 */
  function insertHex(node: HTMLTextAreaElement, inserted: string): void {
    if (!editable || operation.current) return;
    const start = node.selectionStart, end = node.selectionEnd;
    try {
      const next = replaceBinaryHexInput(hexInput ?? '', start, end, inserted);
      if (acceptHex(node, next)) requestAnimationFrame(() => { if (node.isConnected) node.setSelectionRange(start + inserted.length, start + inserted.length); });
    } catch (reason) { setInputError(errorMessage(reason)); }
  }
  const length = bytes?.length ?? 0;
  return <section ref={host} className="binary-cell-viewer" aria-label={text.title} data-binary-cell-files-viewer>
    <div className="binary-modes" role="group" aria-label={text.title}>{(['hex', 'text', 'image'] as const).map(item => <button key={item} type="button" aria-pressed={mode === item} onClick={() => setMode(item)}>{text[item]}</button>)}</div>
    <p role="status">{bytes ? length ? formatText(text.bytes, length) : text.empty : value === null ? text.null : value === undefined ? text.default : decoded.error}</p>
    {isCurrent && <><div className="binary-modes">{editable && <button type="button" disabled={fileBusy || !fileCurrent(false)} onClick={() => void fileAction('open')}>{filesText.load}</button>}<button type="button" disabled={fileBusy || !bytes || !fileCurrent(false)} onClick={() => void fileAction('save')}>{filesText.save}</button></div><UsageHelp><p>{editable ? filesText.hint : filesText.readonlyHint}</p></UsageHelp>{fileBusy && <p role="status">{filesText.busy}</p>}{fileNotice && <p role="status">{fileNotice}</p>}</>}
    {mode === 'hex' ? <>
      {hexInput !== undefined ? <><label>{label}<textarea aria-label={label} className="record-field-input binary-hex" value={hexInput} readOnly={!editable || fileBusy} autoFocus={focus} spellCheck={false} onBeforeInput={event => {
        if (operation.current) { event.preventDefault(); return; }
        const inserted = (event.nativeEvent as InputEvent).data; if (!editable || inserted === null || inserted === undefined) return;
        try { replaceBinaryHexInput(hexInput, event.currentTarget.selectionStart, event.currentTarget.selectionEnd, inserted); } catch (reason) { event.preventDefault(); setInputError(errorMessage(reason)); }
      }} onPaste={event => { event.preventDefault(); insertHex(event.currentTarget, event.clipboardData.getData('text/plain')); }} onDrop={event => { event.preventDefault(); if (!event.dataTransfer.files.length) insertHex(event.currentTarget, event.dataTransfer.getData('text/plain')); }} onChange={event => acceptHex(event.currentTarget, event.target.value)}/></label>{bytes && !inputError && <p className="muted small">{formatText(text.hexValid, length)}</p>}</> : bytes && <><textarea className="binary-hex" aria-label={text.hexLabel} readOnly value={binaryHexPage(bytes, page)}/><p>{formatText(text.segment, length ? page * binaryCellLimits.pageBytes + 1 : 0, Math.min(length, (page + 1) * binaryCellLimits.pageBytes), length)}</p><div className="binary-modes"><button disabled={page === 0} onClick={() => setPage(value => value - 1)}>{text.previous}</button><button disabled={(page + 1) * binaryCellLimits.pageBytes >= length} onClick={() => setPage(value => value + 1)}>{text.next}</button></div></>}
      {hexInput === undefined && <p className="muted small">{reason || text.readonly}</p>}
    </> : mode === 'text' ? <><label>{text.encoding}<select aria-label={text.encoding} value={encoding} onChange={event => setEncoding(event.target.value as BinaryEncoding)}>{binaryEncodings.map(value => <option key={value}>{value}</option>)}</select></label><UsageHelp><p>{text.textHint}</p></UsageHelp>{decodedText && <textarea aria-label={text.textLabel} className="binary-text" readOnly value={decodedText.value}/>}<ErrorBox message={decodedText?.error}/></> : <><UsageHelp><p>{text.imageHint}</p></UsageHelp>{image?.info && <p>{formatText(text.imageInfo, image.info.format, image.info.width, image.info.height, length)}</p>}{imageState?.source === bytes && image?.info && <img className="binary-image" src={imageState.url} alt={text.image} onError={rejectImage} onLoad={event => { const node = event.currentTarget; if (node.naturalWidth !== image.info!.width || node.naturalHeight !== image.info!.height) rejectImage(); }}/>}<ErrorBox message={image?.error || imageError}/></>}
    <ErrorBox message={inputError || decoded.error}/>
  </section>;
}
