import { useEffect, useState } from 'react';
import type { QueryFileSourceController } from '../useQueryFileSource';
import { queryFileReloadZh as text } from '../../shared/queryFileReload.zh-CN';
import { Modal } from './ui';
import '../query-file-reload.css';

/** 只读有界差异，不挂第二个可执行编辑器；复选确认包含dirty丢弃及新物理身份。 */
export function QueryFileReloadDialog({ files }: { files: QueryFileSourceController }) {
  const [accepted, setAccepted] = useState(false), preview = files.reloadPreview;
  useEffect(() => setAccepted(false), [preview?.previewId]);
  return <Modal title={text.title} wide onClose={() => { if (!files.reloadApplying) void files.cancelReload(); }}>
    <div className="modal-content"><p>{text.hint}</p>{!preview ? <p role="status">{text.checking}</p> : <>
      <p role="status">{text[preview.change]}</p><p>{preview.binding.name} · {preview.binding.encoding} / BOM {preview.binding.bom} / {preview.binding.eol}</p>
      {preview.dirty && <p role="alert">{text.dirty}</p>}
      {!preview.difference.beforeUnits && !preview.difference.afterUnits ? <p>{text.identical}</p> : <>
        <p>{text.counts(preview.difference.prefixUnits, preview.difference.suffixUnits, preview.difference.beforeUnits, preview.difference.afterUnits)}</p>
        <div className="query-file-reload-diff"><section><h3>{text.before}</h3><pre>{preview.difference.before}</pre></section><section><h3>{text.after}</h3><pre>{preview.difference.after}</pre></section></div>
        {(preview.difference.beforeTruncated || preview.difference.afterTruncated) && <p>{text.omitted}</p>}
      </>}
      <label><input type="checkbox" checked={accepted} disabled={files.reloadApplying} onChange={event => setAccepted(event.target.checked)}/>{text.acknowledge}</label>
    </>}{files.reloadApplying && <p role="status">{text.loading}</p>}</div>
    <footer className="modal-footer"><button disabled={files.reloadApplying} onClick={() => void files.cancelReload()}>{text.cancel}</button><span className="grow"/><button className="primary" disabled={!preview || !accepted || files.reloadApplying} onClick={() => void files.confirmReload()}>{text.confirm}</button></footer>
  </Modal>;
}
