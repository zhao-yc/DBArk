import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileDown, FolderOpen } from 'lucide-react';
import type { QueryFileEncoding } from '../../shared/contracts';
import type { QueryFileBom, QueryFileEolPolicy } from '../../shared/queryFileSources';
import type { WorkspaceTab } from '../store';
import { useWorkspace } from '../store';
import { errorMessage } from '../lib';
import { zh } from '../locales/zh-CN';
import { queryFilesZh as text } from '../locales/queryFiles.zh-CN';
import type { QueryFileSourceController } from '../useQueryFileSource';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import { QueryFileTaskProgress } from './QueryFileTaskProgress';
import { RecentQueryFilesDialog } from './RecentQueryFilesDialog';

/** 选择编码与换行后由Main原生选择路径；renderer从不接收或回传授权路径。 */
export function QueryFilesDialog({ mode, files, onClose }: { mode: 'open' | 'save'; files: QueryFileSourceController; onClose(): void }) {
  const [encoding, setEncoding] = useState<QueryFileEncoding>(files.view?.encoding ?? 'utf8');
  const [bom, setBom] = useState<QueryFileBom>(files.view?.bom ?? 'none'), [eol, setEol] = useState<QueryFileEolPolicy>('preserve');
  const [busy, setBusy] = useState(false), active = useRef(false), [error, setError] = useState('');
  /** 每次点击只调用一次原生操作，blocked交回恢复窗口，取消则继续保留选项和草稿。 */
  async function choose() {
    if (active.current || files.isBusy()) return;
    active.current = true; setBusy(true); setError('');
    try {
      const result = mode === 'open' ? await files.open(encoding) : await files.save({ encoding, bom, eol });
      if (typeof result === 'boolean' ? result : result.saved) onClose();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { active.current = false; setBusy(false); }
  }
  /** 编码切换只允许相符BOM，不暗改正文或现有来源。 */
  function changeEncoding(next: QueryFileEncoding) { setEncoding(next); if (bom !== 'none' && bom !== next) setBom('none'); }
  return createPortal(<Modal title={mode === 'open' ? text.open : text.saveAs} onClose={() => { if (!active.current) onClose(); }}>
    <div className="modal-content"><p className="muted small">{mode === 'open' ? text.openHint : text.optionsHint}</p>
      <Field label={text.encoding}><select value={encoding} disabled={busy} onChange={event => changeEncoding(event.target.value as QueryFileEncoding)}><option value="utf8">{text.utf8}</option><option value="utf16le">{text.utf16le}</option><option value="gb18030">{text.gb18030}</option></select></Field>
      {mode === 'save' && <><Field label={text.bom}><select value={bom} disabled={busy} onChange={event => setBom(event.target.value as QueryFileBom)}><option value="none">{text.noBom}</option>{encoding !== 'gb18030' && <option value={encoding}>{encoding === 'utf8' ? text.utf8 : text.utf16le} BOM</option>}</select></Field><Field label={text.eol}><select value={eol} disabled={busy} onChange={event => setEol(event.target.value as QueryFileEolPolicy)}><option value="preserve">{text.preserve}</option><option value="lf">{text.lf}</option><option value="crlf">{text.crlf}</option><option value="cr">{text.cr}</option></select></Field></>}
      <p className="muted small">{text.limitHint}</p>{busy && files.task && <QueryFileTaskProgress task={files.task}/>}<ErrorBox message={error}/>
    </div><footer className="modal-footer"><span className="grow"/>{busy && <Spinner/>}<button disabled={busy} onClick={onClose}>{zh.common.cancel}</button><button className="primary" disabled={busy} onClick={() => void choose()}>{mode === 'open' ? <FolderOpen size={14}/> : <FileDown size={14}/>}{mode === 'open' ? text.openAction : text.saveAction}</button></footer>
  </Modal>, document.body);
}

/** 文件来源、dirty与恢复均来自真实控制器；显示路径只是文案，不能作为IPC权限。 */
export function QueryFileSourceCaption({ tab, files }: { tab: WorkspaceTab; files: QueryFileSourceController }) {
  if (!tab.fileSourceBinding) return <span className="muted small">{tab.sourceBinding ? text.librarySource : text.draftSource}</span>;
  const view = files.view;
  const encoding = view && text[view.encoding], bom = view?.bom === 'none' ? text.noBom : view ? `${text[view.bom]} BOM` : '', eol = view?.eol === 'none' ? text.noEol : view?.eol === 'mixed' ? text.mixedEol : view ? text[view.eol] : '';
  return <span className="muted small" style={{ maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} role="status" aria-label={text.fileSource} title={view?.displayPath}>{text.fileSource}：{view?.displayPath ?? text.unknown} · {view ? `${encoding} / ${bom} / ${eol}` : text.unknown} · {files.dirty ? text.dirty : text.clean}</span>;
}

/** 工具栏保留独立文件另存与本地查询库入口；快捷键“保存查询”的来源路由由QueryTab处理。 */
export function QueryFileActions({ tab, files }: { tab: WorkspaceTab; files: QueryFileSourceController }) {
  const [mode, setMode] = useState<'open' | 'save' | 'recent' | null>(null);
  useEffect(() => window.dbark?.onMenu(action => {
    if (useWorkspace.getState().settings.activeTabId !== tab.id || document.querySelector('[role="dialog"]') || files.isBusy()) return;
    if (action === 'open-sql-file') setMode('open'); if (action === 'save-sql-file') setMode('save'); if (action === 'recent-sql-file') setMode('recent');
  }), [tab.id, files]);
  useEffect(() => { if (files.problem) setMode(null); }, [files.problem]);
  const problem = files.problem;
  return <><button disabled={files.busy} title={text.open} aria-label={text.open} onClick={() => setMode('open')}><FolderOpen size={15}/></button><button disabled={files.busy} title={text.recent} aria-label={text.recent} onClick={() => { files.dismiss(); setMode('recent'); }}>{text.recent}</button><button disabled={files.busy} title={text.saveAs} aria-label={text.saveAs} onClick={() => { files.dismiss(); setMode('save'); }}><FileDown size={15}/></button>{mode === 'recent' ? <RecentQueryFilesDialog files={files} onClose={() => setMode(null)}/> : mode && <QueryFilesDialog mode={mode} files={files} onClose={() => setMode(null)}/>}
    {files.busy && files.task && !mode && !problem && <QueryFileTaskProgress task={files.task}/>}
    {problem && createPortal(<Modal title={text.recovery} onClose={() => { if (!files.isBusy()) files.dismiss(); }}><div className="modal-content"><ErrorBox message={problem.message}/>{files.busy && files.task && <QueryFileTaskProgress task={files.task}/>}<p>{problem.wrote === 'no' ? text.wroteNo : problem.wrote === 'yes' ? text.wroteYes : text.wroteUnknown}</p><p className="muted small">{text.rereadHint}</p></div><footer className="modal-footer">{files.busy && <Spinner/>}<button disabled={files.busy} onClick={files.dismiss}>{zh.common.cancel}</button><span className="grow"/><button disabled={files.busy} onClick={() => { files.dismiss(); setMode('open'); }}>{text.chooseAgain}</button>{tab.fileSourceBinding && <button disabled={files.busy} onClick={() => void files.reread()}>{text.reread}</button>}<button disabled={files.busy} onClick={() => { files.dismiss(); setMode('save'); }}>{text.saveAs}</button></footer></Modal>, document.body)}
  </>;
}
