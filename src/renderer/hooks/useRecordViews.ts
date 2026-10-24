import { useEffect, useRef, useState } from 'react';
import type { DraftRow } from '../dataChanges';
import { errorMessage } from '../lib';
import { assertRecordDraftCurrent, beginRecordDraft, editRecordInput, recordInputDirty, recordMetadataKey, recordTargetKey, recordReadonlyReason, RecordFieldError, RecordLeaveGuard, stageRecordDraft, type RecordContext, type RecordDraft, type RecordInput } from '../recordViews';
import { recordViewZh as text } from '../locales/recordViews.zh-CN';
import { assertRecordDocumentCurrent, beginRecordDocument, changeRecordDocument, recordDocumentDirty, stageRecordDocument, type RecordDocumentInput } from '../recordInputDocument';
import { assertRecordJsonNodeCurrent, beginRecordJsonNodeInput, changeRecordJsonNodeInput, recordJsonNodeDirty, stageRecordJsonNodeInput, type RecordJsonNodeInput, type RecordNodeSelection } from '../recordJsonNodeInput';
import type { ReadyLexicalDocument } from '../jsonLexicalTree';
import {beginRecordJsonStructureInput,changeRecordJsonStructureInput,recordJsonStructureDirty,stageRecordJsonStructureInput,type RecordJsonStructureInput,type RecordStructureAction,type RecordStructureKind} from '../recordJsonStructureInput';

interface Options { rows: DraftRow[]; getRows(): DraftRow[]; getContext(): RecordContext; onRows(rows: DraftRow[]): void; onDirty(dirty: boolean): void; onFocusGrid(): void }
/** 展示方式与字段输入格式分离，只读投影与显式整行输入使用不同协议。 */
export type RecordDisplayMode = 'form' | 'tree' | 'json' | 'input';
type RecordBuffer = { kind: 'fields'; draft: RecordDraft } | { kind: 'document'; input: RecordDocumentInput } | { kind: 'node'; input: RecordJsonNodeInput } | {kind:'structure';input:RecordJsonStructureInput};
/** 一个互斥缓冲决定当前输入真值，不能同时暂存字段Map和整行原文。 */
function draftOf(buffer: RecordBuffer | null) { return buffer?.kind === 'fields' ? buffer.draft : buffer?.kind === 'structure' ? buffer.input.base.draft : buffer?.input.draft ?? null; }
/** 非法整行原文同样进入原有dirty守卫，不在此处解析。 */
function bufferDirty(buffer: RecordBuffer | null, context: RecordContext) { return buffer?.kind === 'document' ? recordDocumentDirty(buffer.input) : buffer?.kind === 'node' ? recordJsonNodeDirty(buffer.input) : buffer?.kind === 'structure' ? recordJsonStructureDirty(buffer.input) : recordInputDirty(draftOf(buffer), context.info); }

/** 输入仅在内存中保留；同步引用让同一事件轮次的关闭、暂存和重复操作看到最新状态。 */
export function useRecordViews(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [buffer, setBuffer] = useState<RecordBuffer | null>(null); const bufferRef = useRef(buffer);
  const draft = draftOf(buffer); const draftRef = useRef(draft);
  const [formOpen, setFormOpen] = useState(false); const [cellKey, setCellKey] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<RecordDisplayMode>('form'); const modeRef = useRef(displayMode);
  const [pending, setPending] = useState(false); const leaveGuard = useRef(new RecordLeaveGuard());
  const [error, setError] = useState(''); const [focusKey, setFocusKey] = useState<string | null>(null);
  const [notice, setNotice] = useState(''); const dirtyRef = useRef(false);
  const context = options.getContext(); const dirty = bufferDirty(buffer, context);

  /** 原始输入即刻进入全局 dirty，非法 JSON/HEX 与正常文本享有相同退出保护。 */
  function replaceBuffer(next: RecordBuffer | null) {
    bufferRef.current = next; draftRef.current = draftOf(next); setBuffer(next);
    dirtyRef.current = bufferDirty(next, latest.current.getContext()); latest.current.onDirty(dirtyRef.current);
  }
  /** 每次换行、暂存和明确放弃后重新捕获身份，整行模式只从原页面草稿生成。 */
  function replace(next: RecordDraft | null) {
    if (!next) { replaceBuffer(null); return; }
    if (modeRef.current === 'input') {
      try { replaceBuffer({kind:'document',input:beginRecordDocument(latest.current.getRows(),next,latest.current.getContext())}); return; }
      catch (reason) { report(reason); }
    }
    replaceBuffer({kind:'fields',draft:next});
  }
  /** 错误只影响本地显示，保留原始字段文本；字段级错误用于焦点恢复。 */
  function report(reason: unknown) { setError(errorMessage(reason)); setFocusKey(reason instanceof RecordFieldError ? reason.key : null); }
  /** 在成功加载、明确放弃整页或成功提交后失效旧输入身份，面板开关仍保留。 */
  function reset() { leaveGuard.current.reset(); setPending(false); setCellKey(null); replace(null); setError(''); setFocusKey(null); setNotice(''); }
  /** 重新捕获当前本地行；仅用户明确放弃缓冲时才允许替换竞争快照。 */
  function discard() {
    const current = draftRef.current; const row = latest.current.getRows().find(item => item.id === current?.rowId);
    setError(''); setFocusKey(null); setNotice(''); replace(row ? beginRecordDraft(row, latest.current.getContext()) : null);
  }
  /** 一次校验全部输入再写同一 DraftRow[]，从不调用 IPC 或自行提交数据库。 */
  function stage(): boolean {
    if (!draftRef.current) return true;
    try {
      const current = bufferRef.current;
      const next = current?.kind === 'document' ? stageRecordDocument(latest.current.getRows(), current.input, latest.current.getContext()) : current?.kind === 'node' ? stageRecordJsonNodeInput(latest.current.getRows(), current.input, latest.current.getContext()) : current?.kind === 'structure' ? stageRecordJsonStructureInput(latest.current.getRows(),current.input,latest.current.getContext()) : stageRecordDraft(latest.current.getRows(), draftRef.current, latest.current.getContext());
      latest.current.onRows(next);
      const row = next.find(item => item.id === draftRef.current!.rowId)!;
      setError(''); setFocusKey(null); replace(beginRecordDraft(row, latest.current.getContext())); setNotice(text.stagedNotice); return true;
    } catch (reason) { report(reason); return false; }
  }
  /** 同页切行和关闭先处理输入；待处理动作只保留一份，连续点击不会改写其目标。 */
  function request(action: () => void): boolean {
    const completed = leaveGuard.current.request(dirtyRef.current, action);
    if (!completed) setPending(true); return completed;
  }
  /** 模式切换复用首次离开意图，暂存失败或选择留下时不清除稀疏输入、原值与展示方式。 */
  function changeDisplayMode(mode: RecordDisplayMode): boolean {
    if (mode === modeRef.current || latest.current.getContext().busy) return false;
    return request(() => {
      const current=draftRef.current;
      try {
        // 只读模式之间保留原字段Map和展开状态；离开整行原文才重建字段缓冲。
        const next=current ? mode==='input' ? {kind:'document' as const,input:beginRecordDocument(latest.current.getRows(),current,latest.current.getContext())} : {kind:'fields' as const,draft:bufferRef.current?.kind!=='fields'?beginRecordDraft(assertRecordDraftCurrent(latest.current.getRows(),current,latest.current.getContext()),latest.current.getContext()):current} : null;
        modeRef.current=mode; setDisplayMode(mode); replaceBuffer(next); setError(''); setFocusKey(null); setNotice('');
      } catch (reason) { report(reason); }
    });
  }
  /** “留在当前编辑”不触碰任何草稿；暂存失败也不运行待处理动作。 */
  function resolve(choice: 'stage' | 'discard' | 'stay') {
    if (leaveGuard.current.resolve(choice, stage, discard)) setPending(false);
  }
  /** 当前活动行与复选集合分离，换行只捕获 UUID，不猜测主键或跨页定位。 */
  function select(rowId: string, after: () => void = () => {}) {
    if (draftRef.current?.rowId === rowId) { after(); return true; }
    return request(() => { const row = latest.current.getRows().find(item => item.id === rowId); setError(''); setFocusKey(null); setNotice(''); replace(row ? beginRecordDraft(row, latest.current.getContext()) : null); after(); });
  }
  /** 打开表单可无活动行，此时显示选择提示，不自动发送额外读取。 */
  function openForm(rowId?: string) { setFormOpen(true); if (rowId) select(rowId); }
  /** 收起前确认输入，完成后恢复原行与列的网格焦点。 */
  function closeForm() { request(() => { setFormOpen(false); setCellKey(null); latest.current.onFocusGrid(); }); }
  /** 单元格弹窗复用同一输入模型，打开时显式捕获列名和当前行代次。 */
  function openCell(rowId: string, key: string) {
    request(() => {
      const row = latest.current.getRows().find(item => item.id === rowId); const current = latest.current.getContext();
      const column = current.info?.columns.find(item => item.name === key); if (!row || !column) return;
      try { if(modeRef.current==='input'){modeRef.current='form';setDisplayMode('form');} replace(editRecordInput(beginRecordDraft(row, current), column)); setError(''); setFocusKey(key); setCellKey(key); }
      catch (reason) { report(reason); setCellKey(key); replace(beginRecordDraft(row, current)); }
    });
  }
  /** 字段弹窗关闭与表单切行共享三选项，不会因 Escape 或关闭图标丢输入。 */
  function closeCell() { request(() => { setCellKey(null); latest.current.onFocusGrid(); }); }
  /** 完整字段文本仅按显式操作展开；超限保留摘要而非截断后当作完整值。 */
  function expand(key: string) {
    if(bufferRef.current?.kind!=='fields')return;
    const current = draftRef.current; const column = latest.current.getContext().info?.columns.find(item => item.name === key); if (!current || !column) return;
    try { replace(editRecordInput(current, column)); setError(''); setFocusKey(key); } catch (reason) { report(reason); }
  }
  /** 修改只进稀疏缓冲，字段隐藏或折叠也不会删除其尚未暂存的内容。 */
  function change(key: string, value: RecordInput) {
    if(bufferRef.current?.kind!=='fields')return;
    const current = draftRef.current; const column = latest.current.getContext().info?.columns.find(item => item.name === key); if (!current || !column) return;
    try {
      // 异步加载开始后的同轮输入事件也读取同步忙碌门，不能先接收文本再被加载结果清除。
      const reason = recordReadonlyReason(latest.current.getContext(), latest.current.getRows().find(row => row.id === current.rowId), key); if (reason) throw new Error(reason);
      replace(editRecordInput(current, column, value)); setError(''); setFocusKey(null); setNotice('');
    } catch (reason) { report(reason); }
  }
  /** 文件回包只读核原字段输入与同步行来源；不调用change，不重选或重建缓冲。 */
  function isFieldCurrent(captured: RecordDraft, key: string, input: RecordInput | undefined, reason = ''): boolean {
    if (bufferRef.current?.kind !== 'fields' || draftRef.current !== captured || captured.fields.get(key) !== input) return false;
    const current = latest.current.getContext(), row = latest.current.getRows().find(item => item.id === captured.rowId);
    // 待删除行仍可另存原字节，因此不借只能写入的assertRecordDraftCurrent资格门。
    return current.loaded && !current.busy && !current.stale && !!row && recordReadonlyReason(current, row, key) === reason && !!current.info?.columns.some(column => column.name === key) && captured.target === recordTargetKey(current.target) && captured.metadata === recordMetadataKey(current.info) && captured.generation === current.generation && captured.connectionVersion === current.connectionVersion && captured.data === row.data && captured.original === row.original && captured.inserted === row.inserted;
  }
  /** 当前只有整行variant时才能接收原文；晚到事件先核身份与忙碌门，不能覆盖新行。 */
  function changeDocument(value: string, captured: RecordDocumentInput) {
    const current=bufferRef.current;if(current?.kind!=='document')return;
    if(current.input.draft!==captured.draft)return;
    try {
      const row=assertRecordDocumentCurrent(latest.current.getRows(),current.input,latest.current.getContext());
      const reason=recordReadonlyReason(latest.current.getContext(),row);if(reason)throw Error(reason);
      replaceBuffer({kind:'document',input:changeRecordDocument(current.input,value)});setError('');setFocusKey(null);setNotice('');
    }catch(reason){report(reason);}
  }
  /** 选择来自当前树缓存；先处理旧输入，再核行、文档引用及结构路径，不自动重选或重放。 */
  function openNode(selection: RecordNodeSelection, document: ReadyLexicalDocument) {
    if (modeRef.current !== 'tree' || latest.current.getContext().busy) return false;
    return request(() => {
      const current = draftRef.current; if (!current) return;
      try {
        const input = beginRecordJsonNodeInput({rows:latest.current.getRows(),draft:current,context:latest.current.getContext(),columnName:selection.columnName,document,selection});
        replaceBuffer({kind:'node',input});setError('');setFocusKey(null);setNotice('');
      } catch (reason) { report(reason); }
    });
  }
  /** 同一输入会话才接收迟到事件；每次改字都重新检查当前行和忙碌门。 */
  function changeNode(value: string, captured: RecordJsonNodeInput) {
    const current = bufferRef.current;
    if (current?.kind !== 'node' || current.input.session !== captured.session) return;
    try {
      assertRecordJsonNodeCurrent(latest.current.getRows(),current.input,latest.current.getContext());
      replaceBuffer({kind:'node',input:changeRecordJsonNodeInput(current.input,value)});setError('');setFocusKey(null);setNotice('');
    } catch (reason) { report(reason); }
  }
  /** 结构操作单独捕获同一缓存选择，复用已有离开守卫；暂存后过期的选择不能自动重放。 */
  function openStructure(selection:RecordNodeSelection,document:ReadyLexicalDocument,kind:RecordStructureKind) {
    if(modeRef.current!=='tree'||latest.current.getContext().busy)return false;
    return request(()=>{
      const current=draftRef.current;if(!current)return;
      try{const input=beginRecordJsonStructureInput({rows:latest.current.getRows(),draft:current,context:latest.current.getContext(),columnName:selection.columnName,document,selection},kind);replaceBuffer({kind:'structure',input});setError('');setFocusKey(null);setNotice('');}catch(reason){report(reason);}
    });
  }
  /** 原文修改与操作类型均绑定输入会话，结构编辑和旧值编辑的迟到事件不能交叉覆盖。 */
  function changeStructure(action:RecordStructureAction,captured:RecordJsonStructureInput) {
    const current=bufferRef.current;if(current?.kind!=='structure'||current.input.base.session!==captured.base.session)return;
    try{assertRecordJsonNodeCurrent(latest.current.getRows(),current.input.base,latest.current.getContext());replaceBuffer({kind:'structure',input:changeRecordJsonStructureInput(current.input,action)});setError('');setFocusKey(null);setNotice('');}catch(reason){report(reason);}
  }
  /** 关闭节点输入同样使用首次离开意图与三选守卫；放弃不修改页面草稿。 */
  function closeNode() { request(() => { const row=latest.current.getRows().find(item=>item.id===draftRef.current?.rowId);replace(row?beginRecordDraft(row,latest.current.getContext()):null);setError('');setFocusKey(null);setNotice(''); }); }
  /** 无未暂存输入时跟随网格草稿；有输入时保留原基线，让最终校验拒绝竞争覆盖。 */
  useEffect(() => {
    const current = draftRef.current; if (!current) return;
    const isDirty = bufferDirty(bufferRef.current, latest.current.getContext());
    dirtyRef.current = isDirty; latest.current.onDirty(isDirty);
    if (isDirty) return;
    const row = latest.current.getRows().find(item => item.id === current.rowId);
    if(!row){replace(null);return;}
    // 普通字段沿用原引用跟随，删除时保留已展开的只读文本；整行额外失效整个行对象身份。
    let identityChanged=row.data!==current.data||row.original!==current.original||row.inserted!==current.inserted;
    if(bufferRef.current?.kind==='document')try{assertRecordDocumentCurrent(latest.current.getRows(),bufferRef.current.input,latest.current.getContext());}catch{identityChanged=true;}
    if(bufferRef.current?.kind==='node')try{assertRecordJsonNodeCurrent(latest.current.getRows(),bufferRef.current.input,latest.current.getContext());}catch{identityChanged=true;}
    if(bufferRef.current?.kind==='structure')try{assertRecordJsonNodeCurrent(latest.current.getRows(),bufferRef.current.input.base,latest.current.getContext());}catch{identityChanged=true;}
    const needsDocument=modeRef.current==='input'&&bufferRef.current?.kind!=='document'&&!recordReadonlyReason(latest.current.getContext(),row);
    if(identityChanged||needsDocument){setError('');setFocusKey(null);replace(beginRecordDraft(row,latest.current.getContext()));}
  }, [options.rows, context.info]);

  return { draft, documentInput:buffer?.kind==='document'?buffer.input:null, nodeInput:buffer?.kind==='node'?buffer.input:null, structureInput:buffer?.kind==='structure'?buffer.input:null, formOpen, displayMode, changeDisplayMode, changeDocument, openNode, changeNode, openStructure, changeStructure, closeNode, cellKey, pending, error, focusKey, notice, dirty, hasInput: () => dirtyRef.current, reset, discard, stage, request, resolve, select, openForm, closeForm, openCell, closeCell, expand, change, isFieldCurrent };
}
export type RecordViewController = ReturnType<typeof useRecordViews>;
