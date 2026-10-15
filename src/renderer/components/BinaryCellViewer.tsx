import { useEffect, useMemo, useState } from 'react';
import type { CellValue } from '../../shared/contracts';
import { binaryByteLength, binaryCellLimits, binaryEncodings, binaryHexPage, decodeBinaryCell, decodeBinaryText, inspectBinaryImage, parseBinaryHex, type BinaryEncoding } from '../binaryCell';
import { errorMessage } from '../lib';
import { formatText } from '../locales/zh-CN';
import { binaryCellZh as text } from '../locales/binaryCell.zh-CN';
import { ErrorBox } from './ui';
import '../binaryCell.css';

interface Props { value: CellValue | undefined; hexInput?: string; onHexChange?(value: string): void; label?: string; reason?: string; focus?: boolean; }
/** 一份有界完整值提供三种展示；只有明确的 Hex 输入回调可进入既有记录缓冲。 */
export function BinaryCellViewer({ value, hexInput, onHexChange, label = text.hexLabel, reason = '', focus = false }: Props) {
  const [mode, setMode] = useState<'hex' | 'text' | 'image'>('hex'), [encoding, setEncoding] = useState<BinaryEncoding>('utf-8'), [page, setPage] = useState(0);
  const [imageState, setImageState] = useState<{ url: string; source: Uint8Array } | null>(null), [imageError, setImageError] = useState('');
  const decoded = useMemo(() => { try { return { bytes: hexInput !== undefined ? parseBinaryHex(hexInput) : decodeBinaryCell(value), error: '', size: binaryByteLength(value) }; } catch (reason) { return { bytes: null, error: errorMessage(reason), size: null }; } }, [value, hexInput]);
  const bytes = decoded.bytes;
  const image = useMemo(() => { if (mode !== 'image' || !bytes) return null; try { return { info: inspectBinaryImage(bytes), error: '' }; } catch (reason) { return { info: null, error: errorMessage(reason) }; } }, [bytes, mode]);
  const decodedText = useMemo(() => { if (mode !== 'text' || !bytes) return null; try { return { value: decodeBinaryText(bytes, encoding), error: '' }; } catch (reason) { return { value: '', error: errorMessage(reason) }; } }, [bytes, encoding, mode]);
  const editable = !!onHexChange && !reason && hexInput !== undefined;
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
  const length = bytes?.length ?? 0;
  return <section className="binary-cell-viewer" aria-label={text.title}>
    <div className="binary-modes" role="group" aria-label={text.title}>{(['hex', 'text', 'image'] as const).map(item => <button key={item} type="button" aria-pressed={mode === item} onClick={() => setMode(item)}>{text[item]}</button>)}</div>
    <p role="status">{bytes ? length ? formatText(text.bytes, length) : text.empty : value === null ? text.null : value === undefined ? text.default : decoded.error}</p>
    {mode === 'hex' ? <>
      {hexInput !== undefined ? <><label>{label}<textarea aria-label={label} className="record-field-input binary-hex" value={hexInput} readOnly={!editable} autoFocus={focus} maxLength={binaryCellLimits.hexUnits} spellCheck={false} onChange={event => onHexChange?.(event.target.value)}/></label>{bytes && <p className="muted small">{formatText(text.hexValid, length)}</p>}</> : bytes && <><textarea className="binary-hex" aria-label={text.hexLabel} readOnly value={binaryHexPage(bytes, page)}/><p>{formatText(text.segment, length ? page * binaryCellLimits.pageBytes + 1 : 0, Math.min(length, (page + 1) * binaryCellLimits.pageBytes), length)}</p><div className="binary-modes"><button disabled={page === 0} onClick={() => setPage(value => value - 1)}>{text.previous}</button><button disabled={(page + 1) * binaryCellLimits.pageBytes >= length} onClick={() => setPage(value => value + 1)}>{text.next}</button></div></>}
      {hexInput === undefined && <p className="muted small">{reason || text.readonly}</p>}
    </> : mode === 'text' ? <><label>{text.encoding}<select aria-label={text.encoding} value={encoding} onChange={event => setEncoding(event.target.value as BinaryEncoding)}>{binaryEncodings.map(value => <option key={value}>{value}</option>)}</select></label><p className="muted small">{text.textHint}</p>{decodedText && <textarea aria-label={text.textLabel} className="binary-text" readOnly value={decodedText.value}/>}<ErrorBox message={decodedText?.error}/></> : <><p className="muted small">{text.imageHint}</p>{image?.info && <p>{formatText(text.imageInfo, image.info.format, image.info.width, image.info.height, length)}</p>}{imageState?.source === bytes && image?.info && <img className="binary-image" src={imageState.url} alt={text.image} onError={rejectImage} onLoad={event => { const node = event.currentTarget; if (node.naturalWidth !== image.info!.width || node.naturalHeight !== image.info!.height) rejectImage(); }}/>}<ErrorBox message={image?.error || imageError}/></>}
    <ErrorBox message={decoded.error}/><p className="muted small">{text.driverScope}</p>
  </section>;
}
