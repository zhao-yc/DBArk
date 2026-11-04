import { useLayoutEffect, useRef, useState } from 'react';
import type { DraftRow } from '../dataChanges';
import { useRecordViews, type RecordViewController } from '../hooks/useRecordViews';
import { RecordBatchEditIntent } from '../recordBatchEdit';
import { recordBatchEditZh as text } from '../locales/recordBatchEdit.zh-CN';
import { errorMessage } from '../lib';
import { RecordFormPanel, RecordEditorDialogs } from './RecordFormPanel';
import { ErrorBox, Modal } from './ui';
import '../recordBatchEdit.css';
interface Props { intent: RecordBatchEditIntent; current(): boolean; onStage(rows: DraftRow[]): boolean; onDirty(dirty: boolean): void; onClose(): void; }
/** 完整原记录编辑器只写窗口RAM；最后一次发布整组，不创建第二套类型转换或数据库操作。 */
export function TableRecordBatchDialog(props: Props) {
  const owner = useRef(props).current, [rows, setRows] = useState(owner.intent.initial), rowsRef = useRef(rows); rowsRef.current = rows;
  const mounted = useRef(true), closed = useRef(false), invalid = useRef(false), initialized = useRef(false), committed = useRef<object | null>(null), frame = {};
  const [error, setError] = useState(''), keptDirty = useRef(false), pendingElement = useRef<HTMLDivElement>(null);
  if (owner.intent !== props.intent) invalid.current = true;
  /** 任何一次观察到来源失效都永久撤销；旧render的输入及关闭不能接管后来记录。 */
  function current(): boolean { if (!invalid.current) try { if (!owner.current() || owner.intent.invalidated) invalid.current = true; } catch { invalid.current = true; } return mounted.current && !closed.current && !invalid.current; }
  function eventCurrent(): boolean { return committed.current === frame && current(); }
  const context = () => ({ ...owner.intent.context, stale: !current() });
  const editor = useRecordViews({ rows, getRows: () => rowsRef.current, getContext: context, onRows: next => { if (!current()) throw Error(text.stale); keptDirty.current = owner.intent.check(next) !== owner.intent.rows; rowsRef.current = next; setRows(next); setError(''); }, onDirty: dirty => { if (mounted.current && !closed.current) owner.onDirty(dirty || keptDirty.current); }, onFocusGrid: () => {} });
  // 三选提示前置到长表单上方，并恢复键盘焦点，不能要求用户自行滚到底部寻找。
  useLayoutEffect(() => { if (editor.pending) pendingElement.current?.focus(); }, [editor.pending]);
  /** 明确取消只清自己的窗口，不运行本行未完成输入的离开动作。 */
  function close(): void { if (committed.current !== frame || !mounted.current || closed.current || owner.intent !== props.intent) return; closed.current = true; owner.onClose(); }
  /** 当前行先沿原字段／JSON／节点校验保留；全部候选通过后才调用父级一次。 */
  function save(): void {
    if (!eventCurrent() || editor.pending) return;
    if (!editor.stage()) return;
    try { if (!current()) throw Error(text.stale); if (owner.onStage(rowsRef.current)) closed.current = true; } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 所有用户入口绑定原render，换行后缓存的change／node／document／close均不可复用。 */
  function guard<T extends unknown[], R>(action: (...args: T) => R) { return (...args: T): R | undefined => eventCurrent() ? action(...args) : undefined; }
  const view = { ...editor, closeForm: close,
    stage: () => eventCurrent() && editor.stage(), discard: guard(editor.discard), expand: guard(editor.expand), change: guard(editor.change), changeDocument: guard(editor.changeDocument),
    changeDisplayMode: (...args: Parameters<typeof editor.changeDisplayMode>) => eventCurrent() && editor.changeDisplayMode(...args), openNode: (...args: Parameters<typeof editor.openNode>) => eventCurrent() && editor.openNode(...args),
    changeNode: guard(editor.changeNode), openStructure: (...args: Parameters<typeof editor.openStructure>) => eventCurrent() && editor.openStructure(...args), changeStructure: guard(editor.changeStructure), closeNode: guard(editor.closeNode), resolve: guard(editor.resolve),
    isFieldCurrent: (...args: Parameters<typeof editor.isFieldCurrent>) => eventCurrent() && editor.isFieldCurrent(...args),
  } as RecordViewController;
  useLayoutEffect(() => { mounted.current = true; committed.current = frame; if (!initialized.current) { initialized.current = true; editor.openForm(rowsRef.current[0]?.id); } return () => { if (committed.current === frame) committed.current = null; mounted.current = false; }; });
  return <Modal title={text.title} onClose={close} wide><div className="modal-content dialog-body record-batch-workspace" data-record-batch-owner={owner.intent.id}><p>{text.hint}</p><div ref={pendingElement} tabIndex={-1} aria-label={text.pending}><RecordEditorDialogs batch editor={view} context={context()} rows={rows}/></div><RecordFormPanel batch editor={view} context={context()} rows={rows} visibleKeys={owner.intent.context.info!.columns.map(c => c.name)} onSelect={rowId => { if (eventCurrent() && !editor.pending) editor.select(rowId); }}/><ErrorBox message={invalid.current ? text.stale : error}/></div><footer className="modal-footer"><button onClick={close}>{text.cancel}</button><button className="primary" disabled={editor.pending || invalid.current} onClick={save}>{text.save}</button></footer></Modal>;
}
