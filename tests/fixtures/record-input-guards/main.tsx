import { createRoot } from 'react-dom/client';
import { useRef, useState } from 'react';
import { RecordEditorDialogs, RecordFormPanel } from '../../../src/renderer/components/RecordFormPanel';
import { useRecordViews } from '../../../src/renderer/hooks/useRecordViews';
import { parseJsonLexicalTree } from '../../../src/renderer/jsonLexicalTree';
import type { RecordContext } from '../../../src/renderer/recordViews';
import type { DraftRow } from '../../../src/renderer/dataChanges';
import type { TableInfo } from '../../../src/shared/contracts';
import '../../../src/renderer/styles.css';

export interface InputEventEvidence { type: string; trusted: boolean; inputType?: string; composing?: boolean; dataUnits: number; valueUnits: number; clipboardUnits?: number }
export interface RecordInputGuardAudit { dirty: boolean; error: string; buffer: string | undefined; note: string; doc: string; events: InputEventEvidence[] }
declare global { interface Window { __recordInputGuardAudit: RecordInputGuardAudit } }
const names = ['id', 'note', 'doc'], events: InputEventEvidence[] = [];
const info: TableInfo = { database: '离线', name: '记录输入', objectKind: 'table', engine: 'InnoDB', primaryKey: ['id'], editableKey: ['id'], indexes: [], foreignKeys: [], ddl: '', columns: names.map(name => ({ name, type: name === 'doc' ? 'JSON' : 'TEXT', nullable: true, generated: false, defaultValue: null, extra: '', comment: '' })) };
const context: RecordContext = { target: { connectionId: '离线', database: info.database, table: info.name }, connectionVersion: 1, generation: 1, info, loaded: true, stale: false, busy: false };

/** 只提供离线行和节点选择；生产组件、父回调、稀疏缓冲及最终暂存均不替换。 */
function Fixture() {
  const [rows, setRows] = useState<DraftRow[]>(() => { const data = { id: '18446744073709551615', note: 'OLD', doc: '"old"' }; return [{ id: '本地行', data, original: { ...data }, inserted: false, deleted: false }]; });
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const editor = useRecordViews({ rows, getRows: () => rowsRef.current, getContext: () => context, onRows(next) { rowsRef.current = next; setRows(next); }, onDirty() {}, onFocusGrid() {} });
  window.__recordInputGuardAudit = { dirty: editor.dirty, error: editor.error, buffer: editor.documentInput?.text ?? editor.nodeInput?.value.text, note: rows[0].data.note as string, doc: rows[0].data.doc as string, events };
  /** 选择由当前原行和同一词法文档生成，不直接写输入或草稿。 */
  function openNode() {
    const draft = editor.draft, row = rowsRef.current[0], document = parseJsonLexicalTree(row.data.doc as string);
    if (!draft || document.status !== 'ready') throw Error('夹具节点尚未就绪');
    const identity = { target: draft.target, metadata: draft.metadata, rowId: row.id, data: row.data, original: row.original, connectionVersion: 1, generation: 1, inserted: false, deleted: false };
    editor.openNode({ row, identity, columnName: 'doc', document, segments: [] }, document);
  }
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><nav><button onClick={() => editor.openForm('本地行')}>打开夹具记录</button><button onClick={openNode}>选择夹具JSON根节点</button></nav>{editor.formOpen && <RecordFormPanel editor={editor} context={context} rows={rows} visibleKeys={names} onSelect={editor.select}/>}<RecordEditorDialogs editor={editor} context={context} rows={rows}/></div>;
}

// 被动记录原生事件的可信标记和长度，不读取用户原剪贴板内容，不修改事件行为或输入值。
for (const type of ['paste', 'beforeinput', 'input', 'compositionupdate']) document.addEventListener(type, event => {
  if (!(event.target instanceof HTMLTextAreaElement)) return;
  const input = event as InputEvent, clipboard = (event as ClipboardEvent).clipboardData;
  events.push({ type, trusted: event.isTrusted, inputType: input.inputType, composing: input.isComposing, dataUnits: input.data?.length ?? 0, valueUnits: event.target.value.length, clipboardUnits: clipboard?.getData('text/plain').length });
}, true);
createRoot(document.getElementById('root')!).render(<Fixture/>);
