import { useLayoutEffect, useRef, useState } from 'react';
import type { RecordInput } from '../recordViews';
import { recordInputLimits } from '../recordViews';
import { batchFillColumns, type BatchFillAssignment, type BatchFillIntent } from '../recordBatchFill';
import { recordBatchFillZh as text } from '../locales/recordBatchFill.zh-CN';
import { zh, formatText } from '../locales/zh-CN';
import { errorMessage } from '../lib';
import { ErrorBox, Modal } from './ui';
import { RecordValueEditor } from './RecordValueEditor';

/** 值输入复用原类型编辑器，只暂存本机草稿；没有读取系统剪贴板或数据库的动作。 */
export function TableBatchFillDialog(props: { intent: BatchFillIntent; initialColumn?: string; invalidReason: string; onStage(assignments: readonly BatchFillAssignment[]): void; onClose(): void }) {
  const columns = batchFillColumns(props.intent.context), initial = columns.find(column => column.name === props.initialColumn) ?? columns[0];
  const blank = (name: string): RecordInput => ({ mode: /^(?:TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB|BINARY|VARBINARY|BIT)\b/i.test(columns.find(column => column.name === name)?.type ?? '') ? 'binary' : /json/i.test(columns.find(column => column.name === name)?.type ?? '') ? 'json' : 'text', text: '' });
  const sequence = useRef(1), owner = useRef(props.intent).current;
  const [draft, setDraft] = useState(() => [{ id: 0, column: initial?.name ?? '', input: blank(initial?.name ?? '') }]);
  const live = useRef(draft), render = useRef<object | null>(null), ticket = {}, invalid = useRef(false), consumed = useRef(false), lock = useRef(false), latest = useRef(props); latest.current = props;
  const [error, setError] = useState('');
  if (props.intent !== owner || props.invalidReason || owner.invalidated) invalid.current = true;
  const invalidReason = props.invalidReason || (invalid.current || owner.invalidated ? text.changed : '');
  useLayoutEffect(() => { render.current = ticket; return () => { if (render.current === ticket) render.current = null; }; });
  /** 当前已提交渲染和完整字段集合共同占门；旧编辑器/移除项/关闭回调不能覆盖新输入。 */
  function current(): boolean {
    if (render.current !== ticket || live.current !== draft || consumed.current || lock.current) return false;
    // 同轮状态ABA可能不触发父页重绘；观察到原意图失效时主动重绘并永久禁用。
    if (latest.current.intent !== owner || latest.current.invalidReason || owner.invalidated || invalid.current) { invalid.current = true; setError(latest.current.invalidReason || text.changed); return false; }
    return true;
  }
  /** 所有编辑同步更换集合引用；即使字段ABA或同轮连点，旧事件也不能复活。 */
  function edit(next: typeof draft): void { if (!current()) return; live.current = next; setDraft(next); setError(''); }
  function changeColumn(id: number, value: string): void { if (!columns.some(column => column.name === value) || draft.some(item => item.id !== id && item.column === value)) return; edit(draft.map(item => item.id === id ? { ...item, column: value, input: blank(value) } : item)); }
  /** 新项只选尚未使用字段，类型空值各自初始化，至少保留一个填充项。 */
  function add(): void { const column = columns.find(column => !draft.some(item => item.column === column.name)); if (column) edit([...draft, { id: sequence.current++, column: column.name, input: blank(column.name) }]); }
  function remove(id: number): void { if (draft.length > 1) edit(draft.filter(item => item.id !== id)); }
  /** 整组只调用父页一次；失败可修正再试，成功即消费，仍不执行任何数据库写入。 */
  function stage() {
    if (!current()) return;
    try { lock.current = true; latest.current.onStage(draft.map(({ column, input }) => ({ column, input: { ...input } }))); consumed.current = true; }
    catch (reason) { setError(errorMessage(reason)); }
    finally { lock.current = false; }
  }
  /** 关闭可用于失效窗口，但原窗口卸载后的迟到关闭不能触碰新窗口。 */
  function close(): void { if (render.current !== ticket || consumed.current || lock.current) return; consumed.current = true; latest.current.onClose(); }
  const overBudget = draft.some(item => item.input.text.length > recordInputLimits.field), disabled = !!invalidReason || consumed.current;
  return <Modal title={text.title} wide onClose={close}><div className="modal-content"><p>{text.notice}</p><p>{formatText(text.count, owner.selected.size)}</p>{draft.map((item, index) => {
    const column = columns.find(column => column.name === item.column), label = index ? text.fieldAt(index + 1) : text.field;
    return <fieldset key={item.id} aria-label={text.assignment(index + 1)}><legend>{text.assignment(index + 1)}</legend><label>{label}<select aria-label={label} value={item.column} disabled={disabled} onChange={event => changeColumn(item.id, event.target.value)}>{columns.map(column => <option key={column.name} value={column.name} disabled={draft.some(other => other.id !== item.id && other.column === column.name)}>{column.name} · {column.type}</option>)}</select></label>{column && <RecordValueEditor key={`${item.id}:${item.column}`} column={column} input={item.input} inserted={false} reason={invalidReason} focus={index === 0} onChange={input => edit(draft.map(other => other.id === item.id ? { ...other, input } : other))}/>}<button type="button" disabled={disabled || draft.length === 1} onClick={() => remove(item.id)}>{text.remove(item.column)}</button></fieldset>;
  })}<button type="button" disabled={disabled || draft.length >= columns.length} onClick={add}>{text.add}</button><ErrorBox message={invalidReason || error || (overBudget ? text.budget : '')}/></div><footer className="modal-footer"><button onClick={close}>{zh.common.cancel}</button><button className="primary" disabled={disabled || !draft.length || draft.some(item => !columns.some(column => column.name === item.column)) || overBudget} onClick={stage}>{text.stage}</button></footer></Modal>;
}
