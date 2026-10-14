import { useEffect, useRef, useState } from 'react';
import type { DraftRow } from '../dataChanges';
import { errorMessage } from '../lib';
import { beginRecordDraft, editRecordInput, recordInputDirty, recordReadonlyReason, RecordFieldError, RecordLeaveGuard, stageRecordDraft, type RecordContext, type RecordDraft, type RecordInput } from '../recordViews';
import { recordViewZh as text } from '../locales/recordViews.zh-CN';

interface Options { rows: DraftRow[]; getRows(): DraftRow[]; getContext(): RecordContext; onRows(rows: DraftRow[]): void; onDirty(dirty: boolean): void; onFocusGrid(): void }
/** 展示方式与字段输入格式 RecordMode 分离，树和整行 JSON 永不进入写入解析。 */
export type RecordDisplayMode = 'form' | 'tree' | 'json';

/** 输入仅在内存中保留；同步引用让同一事件轮次的关闭、暂存和重复操作看到最新状态。 */
export function useRecordViews(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [draft, setDraft] = useState<RecordDraft | null>(null); const draftRef = useRef(draft);
  const [formOpen, setFormOpen] = useState(false); const [cellKey, setCellKey] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<RecordDisplayMode>('form');
  const [pending, setPending] = useState(false); const leaveGuard = useRef(new RecordLeaveGuard());
  const [error, setError] = useState(''); const [focusKey, setFocusKey] = useState<string | null>(null);
  const [notice, setNotice] = useState(''); const dirtyRef = useRef(false);
  const context = options.getContext(); const dirty = recordInputDirty(draft, context.info);

  /** 原始输入即刻进入全局 dirty，非法 JSON/HEX 与正常文本享有相同退出保护。 */
  function replace(next: RecordDraft | null) {
    draftRef.current = next; setDraft(next);
    dirtyRef.current = recordInputDirty(next, latest.current.getContext().info); latest.current.onDirty(dirtyRef.current);
  }
  /** 错误只影响本地显示，保留原始字段文本；字段级错误用于焦点恢复。 */
  function report(reason: unknown) { setError(errorMessage(reason)); setFocusKey(reason instanceof RecordFieldError ? reason.key : null); }
  /** 在成功加载、明确放弃整页或成功提交后失效旧输入身份，面板开关仍保留。 */
  function reset() { leaveGuard.current.reset(); setPending(false); setCellKey(null); replace(null); setError(''); setFocusKey(null); setNotice(''); }
  /** 重新捕获当前本地行；仅用户明确放弃缓冲时才允许替换竞争快照。 */
  function discard() {
    const current = draftRef.current; const row = latest.current.getRows().find(item => item.id === current?.rowId);
    replace(row ? beginRecordDraft(row, latest.current.getContext()) : null); setError(''); setFocusKey(null); setNotice('');
  }
  /** 一次校验全部输入再写同一 DraftRow[]，从不调用 IPC 或自行提交数据库。 */
  function stage(): boolean {
    if (!draftRef.current) return true;
    try {
      const next = stageRecordDraft(latest.current.getRows(), draftRef.current, latest.current.getContext());
      latest.current.onRows(next);
      const row = next.find(item => item.id === draftRef.current!.rowId)!;
      replace(beginRecordDraft(row, latest.current.getContext())); setError(''); setFocusKey(null); setNotice(text.stagedNotice); return true;
    } catch (reason) { report(reason); return false; }
  }
  /** 同页切行和关闭先处理输入；待处理动作只保留一份，连续点击不会改写其目标。 */
  function request(action: () => void): boolean {
    const completed = leaveGuard.current.request(dirtyRef.current, action);
    if (!completed) setPending(true); return completed;
  }
  /** 模式切换复用首次离开意图，暂存失败或选择留下时不清除稀疏输入、原值与展示方式。 */
  function changeDisplayMode(mode: RecordDisplayMode): boolean {
    if (mode === displayMode || latest.current.getContext().busy) return false;
    return request(() => { setDisplayMode(mode); setNotice(''); });
  }
  /** “留在当前编辑”不触碰任何草稿；暂存失败也不运行待处理动作。 */
  function resolve(choice: 'stage' | 'discard' | 'stay') {
    if (leaveGuard.current.resolve(choice, stage, discard)) setPending(false);
  }
  /** 当前活动行与复选集合分离，换行只捕获 UUID，不猜测主键或跨页定位。 */
  function select(rowId: string, after: () => void = () => {}) {
    if (draftRef.current?.rowId === rowId) { after(); return true; }
    return request(() => { const row = latest.current.getRows().find(item => item.id === rowId); replace(row ? beginRecordDraft(row, latest.current.getContext()) : null); setError(''); setFocusKey(null); setNotice(''); after(); });
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
      try { replace(editRecordInput(beginRecordDraft(row, current), column)); setError(''); setFocusKey(key); setCellKey(key); }
      catch (reason) { report(reason); setCellKey(key); replace(beginRecordDraft(row, current)); }
    });
  }
  /** 字段弹窗关闭与表单切行共享三选项，不会因 Escape 或关闭图标丢输入。 */
  function closeCell() { request(() => { setCellKey(null); latest.current.onFocusGrid(); }); }
  /** 完整字段文本仅按显式操作展开；超限保留摘要而非截断后当作完整值。 */
  function expand(key: string) {
    const current = draftRef.current; const column = latest.current.getContext().info?.columns.find(item => item.name === key); if (!current || !column) return;
    try { replace(editRecordInput(current, column)); setError(''); setFocusKey(key); } catch (reason) { report(reason); }
  }
  /** 修改只进稀疏缓冲，字段隐藏或折叠也不会删除其尚未暂存的内容。 */
  function change(key: string, value: RecordInput) {
    const current = draftRef.current; const column = latest.current.getContext().info?.columns.find(item => item.name === key); if (!current || !column) return;
    try {
      // 异步加载开始后的同轮输入事件也读取同步忙碌门，不能先接收文本再被加载结果清除。
      const reason = recordReadonlyReason(latest.current.getContext(), latest.current.getRows().find(row => row.id === current.rowId), key); if (reason) throw new Error(reason);
      replace(editRecordInput(current, column, value)); setError(''); setFocusKey(null); setNotice('');
    } catch (reason) { report(reason); }
  }
  /** 无未暂存输入时跟随网格草稿；有输入时保留原基线，让最终校验拒绝竞争覆盖。 */
  useEffect(() => {
    const current = draftRef.current; if (!current) return;
    const isDirty = recordInputDirty(current, latest.current.getContext().info);
    dirtyRef.current = isDirty; latest.current.onDirty(isDirty);
    if (isDirty) return;
    const row = latest.current.getRows().find(item => item.id === current.rowId);
    if (row && (row.data !== current.data || row.original !== current.original || row.inserted !== current.inserted)) replace(beginRecordDraft(row, latest.current.getContext()));
  }, [options.rows, context.info]);

  return { draft, formOpen, displayMode, changeDisplayMode, cellKey, pending, error, focusKey, notice, dirty, hasInput: () => dirtyRef.current, reset, discard, stage, request, resolve, select, openForm, closeForm, openCell, closeCell, expand, change };
}
export type RecordViewController = ReturnType<typeof useRecordViews>;
