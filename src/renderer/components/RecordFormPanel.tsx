import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { DraftRow } from '../dataChanges';
import { formatText } from '../locales/zh-CN';
import { ownCell, rowEqual } from '../lib';
import { adjacentRecordId, recordMetadataKey, recordTargetKey, recordFieldOrder, recordFieldTooLarge, recordReadonlyReason, recordValueSummary, type RecordContext, type RecordDraft } from '../recordViews';
import { isBinaryCell } from '../binaryCell';
import { BinaryCellViewer } from './BinaryCellViewer';
import { binaryCellZh } from '../locales/binaryCell.zh-CN';
import type { RecordViewController } from '../hooks/useRecordViews';
import { recordViewZh as text } from '../locales/recordViews.zh-CN';
import { recordProjectionZh as projectionText } from '../locales/recordProjections.zh-CN';
import { recordDocumentZh as documentText } from '../locales/recordDocument.zh-CN';
import { recordJsonNodeInputZh as nodeText } from '../locales/recordJsonNodeInput.zh-CN';
import {RecordJsonStructureEditor} from './RecordJsonStructureEditor';
import { RecordValueEditor } from './RecordValueEditor';
import { RecordReadonlyProjection } from './RecordReadonlyProjection';
import { RecordJsonNodeEditor } from './RecordJsonNodeEditor';
import { recordDocumentInputBudget } from '../recordInputDocument';
import { BoundedRecordTextarea } from './BoundedRecordTextarea';
import { ErrorBox, Modal, UsageHelp } from './ui';
import '../recordViews.css';
import '../recordDocument.css';
import type { RecordPageNavigationView } from '../recordPageNavigation';

/** 表单快捷键只暂存本地草稿；不截获普通方向键、换行、删除或输入法组合输入。 */
function localKeys(event: KeyboardEvent, stage: () => boolean, close: () => void) {
  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
  if ((event.ctrlKey || event.metaKey) && ['Enter', 's', 'S'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); if (event.key === 'Enter') stage(); }
  else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
}

/** 图片与二进制展示缓存只绑定同一完整快照；待删除行可查看，写入仍由原有资格门控制。 */
function binarySnapshotCurrent(row: DraftRow | undefined, draft: RecordDraft | null, context: RecordContext): boolean {
  return !context.stale && !context.busy && !!row && !!draft && draft.target === recordTargetKey(context.target) && draft.metadata === recordMetadataKey(context.info) && draft.generation === context.generation && draft.connectionVersion === context.connectionVersion && draft.data === row.data && draft.original === row.original && draft.inserted === row.inserted;
}

/** 当前页侧面表单只有展示与缓冲，不拥有第二份页数据或数据库写路径。 */
export function RecordFormPanel({ editor, context, rows, visibleKeys, onSelect, pageNavigation }: { editor: RecordViewController; context: RecordContext; rows: DraftRow[]; visibleKeys: string[]; onSelect(rowId: string): void; pageNavigation?: RecordPageNavigationView }) {
  const [showHidden, setShowHidden] = useState(false); const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const heading = useRef<HTMLHeadingElement>(null); const row = rows.find(item => item.id === editor.draft?.rowId);
  useEffect(() => { heading.current?.focus(); setExpanded(new Set()); }, [editor.draft?.rowId]);
  useEffect(() => { if (editor.focusKey) { setExpanded(current => new Set([...current, editor.focusKey!])); if (!visibleKeys.includes(editor.focusKey)) setShowHidden(true); } }, [editor.focusKey, visibleKeys]);
  // 暂存和放弃会清空稀疏缓冲；同时恢复摘要按钮，避免显示“收起”却没有输入区域。
  useEffect(() => { setExpanded(current => [...current].some(key => !editor.draft?.fields.has(key)) ? new Set([...current].filter(key => editor.draft?.fields.has(key))) : current); }, [editor.draft?.fields]);
  useEffect(() => { if (editor.notice) heading.current?.focus(); }, [editor.notice]);
  useEffect(() => { heading.current?.focus(); }, [editor.displayMode]);
  const keys = recordFieldOrder(context.info?.columns ?? [], visibleKeys, showHidden); const reason = recordReadonlyReason(context, row,editor.nodeInput?.columnName??editor.structureInput?.base.columnName);
  const previous = adjacentRecordId(rows, row?.id, -1), next = adjacentRecordId(rows, row?.id, 1);
  const status = !row ? text.empty : row.deleted ? text.deleted : row.inserted ? text.inserted : row.original && !rowEqual(row.original, row.data) ? text.staged : text.unchanged;
  const binaryCurrent = binarySnapshotCurrent(row, editor.draft, context);
  return <aside className="record-form-panel" aria-label={text.title} onKeyDown={event => {
    // 树和只读全文均阻止事件落入网格；只有显式节点输入才有本地暂存快捷键。
    if ((editor.displayMode === 'tree' || editor.displayMode === 'json') && ['Delete', 'Enter'].includes(event.key)) event.stopPropagation();
    localKeys(event, editor.displayMode === 'form' || editor.displayMode === 'input' || !!editor.nodeInput || !!editor.structureInput ? editor.stage : () => false, editor.closeForm);
  }}>
    <header><h2 tabIndex={-1} ref={heading}>{text.title}</h2><button onClick={editor.closeForm}>{text.close}</button></header>
    <p className="record-context">{context.target.database} / {context.target.table}</p>
    <nav aria-label={text.title}><button disabled={(!previous && !pageNavigation?.previous) || context.busy} onClick={() => previous ? onSelect(previous) : pageNavigation?.onNavigate(-1)}>{text.previous}</button><span>{row ? formatText(text.position, rows.indexOf(row) + 1, rows.length) : text.empty}</span><button disabled={(!next && !pageNavigation?.next) || context.busy} onClick={() => next ? onSelect(next) : pageNavigation?.onNavigate(1)}>{text.next}</button></nav>
    {pageNavigation?.message && <p role="note" aria-label={text.pageNavigation} aria-live="polite">{pageNavigation.message}</p>}
    <p aria-live="polite">{status}{editor.dirty ? ` · ${text.inputDirty}` : ''}</p>
    <div className="record-display-modes" role="group" aria-label={projectionText.mode}>{(['form', 'tree', 'json', 'input'] as const).map(mode => <button key={mode} aria-pressed={editor.displayMode === mode} disabled={context.busy || editor.pending || (mode==='input' && !!reason)} title={mode==='input' ? reason : mode==='tree' ? nodeText.treeHint : mode==='json' ? projectionText.readonly : undefined} onClick={() => editor.changeDisplayMode(mode)}>{mode==='input'?documentText.input:projectionText[mode]}</button>)}</div>
    {editor.displayMode !== 'json' && editor.displayMode !== 'input' && <label className="record-hidden-toggle"><input type="checkbox" checked={showHidden} onChange={event => setShowHidden(event.target.checked)}/>{text.showHidden}</label>}
    {editor.displayMode === 'form' ? <div className="record-fields">{row && editor.draft && keys.map(key => {
      const column = context.info!.columns.find(item => item.name === key)!; const value = ownCell(row.data, key); const input = editor.draft!.fields.get(key);
      const fieldReason = recordReadonlyReason(context, row, key); const tooLarge = recordFieldTooLarge(ownCell(editor.draft!.data, key));
      return <section className="record-field" key={key} aria-label={column.name}>
        <h3>{column.name}<small>{column.type} · {column.nullable ? text.nullable : text.notNullable}</small></h3>
        {column.comment && <p className="muted small">{column.comment}</p>}
        <dl><dt>{text.current}</dt><dd tabIndex={0}>{recordValueSummary(value)}</dd>{row.original && <><dt>{text.original}</dt><dd tabIndex={0}>{recordValueSummary(ownCell(row.original, key))}</dd></>}<dt>{text.metadataDefault}</dt><dd>{column.defaultValue ?? text.missingDefault}</dd></dl>
        {fieldReason && <p className="muted small">{fieldReason}</p>}
        {tooLarge ? <p className="muted small">{text.fieldTooLarge}</p> : <button onClick={() => { if (expanded.has(key)) setExpanded(current => new Set([...current].filter(item => item !== key))); else { editor.expand(key); setExpanded(current => new Set([...current, key])); } }}>{expanded.has(key) ? text.collapseField : fieldReason ? text.viewField : text.editField}</button>}
        {expanded.has(key) && input && <RecordValueEditor column={column} input={input} inserted={row.inserted} reason={fieldReason} binaryStale={!binaryCurrent} source={[editor.draft, key, context.info, context.generation, context.connectionVersion, context.busy, context.stale]} isCurrent={() => !!editor.draft && editor.isFieldCurrent(editor.draft, key, input, fieldReason)} focus={editor.focusKey === key} onChange={value => editor.change(key, value)}/>}
      </section>;
    })}</div> : editor.displayMode==='input' ? <div className="record-document-input"><UsageHelp><p>{documentText.hint}</p><p>{documentText.formatHint}</p><p>{documentText.scope}</p></UsageHelp>{editor.documentInput ? <BoundedRecordTextarea aria-label={documentText.label} className="record-document-editor" value={editor.documentInput.text} readOnly={!!reason} spellCheck={false} budget={recordDocumentInputBudget} inputIdentity={editor.documentInput.draft} onValueChange={value=>editor.documentInput&&editor.changeDocument(value,editor.documentInput)}/> : <p>{reason||documentText.unavailable}</p>}</div> : <><div className="record-projection-workspace"><RecordReadonlyProjection row={row} draft={editor.draft} context={context} visibleKeys={visibleKeys} showHidden={showHidden} mode={editor.displayMode} onEdit={editor.openNode} onStructure={editor.openStructure}/>{editor.nodeInput&&<RecordJsonNodeEditor input={editor.nodeInput} reason={recordReadonlyReason(context,row,editor.nodeInput.columnName)} onChange={editor.changeNode} onClose={editor.closeNode}/>}{editor.structureInput&&<RecordJsonStructureEditor input={editor.structureInput} reason={reason} onChange={editor.changeStructure} onClose={editor.closeNode}/>}</div></>}
    {(editor.displayMode !== 'json') && <footer><ErrorBox message={editor.error}/>{reason && <p className="muted small">{reason}</p>}<p className="muted small">{text.stageHint}</p><span role="status">{editor.notice}</span>{(editor.displayMode!=='tree'||editor.nodeInput||editor.structureInput)&&<div className="record-actions"><button disabled={!editor.dirty || context.busy} onClick={editor.discard}>{text.discard}</button><button className="primary" disabled={!editor.dirty || !!reason} onClick={editor.stage}>{text.stage}</button></div>}</footer>}
  </aside>;
}

/** 同一时刻仅一个模态层：确认期间保留字段编辑器状态，避免嵌套焦点陷阱。 */
export function RecordEditorDialogs({ editor, context, rows }: { editor: RecordViewController; context: RecordContext; rows: DraftRow[] }) {
  if (editor.pending) return <Modal title={text.leaveTitle} onClose={() => editor.resolve('stay')}><div className="modal-content"><p>{text.leaveHint}</p><ErrorBox message={editor.error}/></div><footer className="modal-footer"><button onClick={() => editor.resolve('stay')}>{text.stay}</button><button onClick={() => editor.resolve('discard')}>{text.discardContinue}</button><button className="primary" onClick={() => editor.resolve('stage')}>{text.stageContinue}</button></footer></Modal>;
  if (editor.cellKey === null || !editor.draft) return null;
  const key = editor.cellKey; const column = context.info?.columns.find(item => item.name === key); const row = rows.find(item => item.id === editor.draft!.rowId);
  const reason = recordReadonlyReason(context, row, key); const input = editor.draft.fields.get(key);
  // 二进制缓存只跟随同一快照；待删除行仍可只读查看，不借用写入资格判断隐藏原值。
  const binary = isBinaryCell(ownCell(editor.draft.data, key), column?.type);
  const current = !binary || binarySnapshotCurrent(row, editor.draft, context);
  /** 快捷键和按钮共用同一次暂存；成功后关闭，校验失败保留输入与弹窗。 */
  function stageCell() { if (reason || !editor.dirty || !editor.stage()) return false; editor.closeCell(); return true; }
  return <Modal title={formatText(text.cellTitle, key)} onClose={editor.closeCell}><div className="modal-content" onKeyDown={event => localKeys(event, stageCell, editor.closeCell)}>
    {!current ? <p role="alert">{text.changed}</p> : column && input ? <RecordValueEditor column={column} input={input} inserted={!!row?.inserted} reason={reason} source={[editor.draft, key, context.info, context.generation, context.connectionVersion, context.busy, context.stale]} isCurrent={() => !!editor.draft && editor.isFieldCurrent(editor.draft, key, input, reason)} focus onChange={value => editor.change(key, value)}/> : typeof ownCell(editor.draft.data, key) === 'object' && ownCell(editor.draft.data, key) !== null ? <><BinaryCellViewer value={ownCell(editor.draft.data, key)} reason={reason || binaryCellZh.editLimit} source={[editor.draft, key, context.info, context.generation, context.connectionVersion, context.busy, context.stale]} isCurrent={() => !!editor.draft && editor.isFieldCurrent(editor.draft, key, undefined, reason)}/><p className="muted small">{binaryCellZh.editLimit}</p></> : <p>{recordValueSummary(ownCell(editor.draft.data, key))}</p>}
    <ErrorBox message={editor.error}/><p className="muted small">{reason || text.stageHint}</p>
  </div><footer className="modal-footer"><button onClick={editor.closeCell}>{text.closeCell}</button><span className="grow"/><button className="primary" disabled={!!reason || !editor.dirty} onClick={stageCell}>{text.stageCell}</button></footer></Modal>;
}
