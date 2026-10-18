import { useRef, useState } from 'react';
import type { RecordInput } from '../recordViews';
import { recordInputLimits } from '../recordViews';
import { batchFillColumns, type BatchFillIntent } from '../recordBatchFill';
import { recordBatchFillZh as text } from '../locales/recordBatchFill.zh-CN';
import { zh, formatText } from '../locales/zh-CN';
import { errorMessage } from '../lib';
import { ErrorBox, Modal } from './ui';
import { RecordValueEditor } from './RecordValueEditor';

/** 值输入复用原类型编辑器，只暂存本机草稿；没有读取系统剪贴板或数据库的动作。 */
export function TableBatchFillDialog(props: { intent: BatchFillIntent; initialColumn?: string; invalidReason: string; onStage(column: string, input: RecordInput): void; onClose(): void }) {
  const columns = batchFillColumns(props.intent.context), initial = columns.find(column => column.name === props.initialColumn) ?? columns[0];
  const blank = (name: string): RecordInput => ({ mode: /^(?:TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB|BINARY|VARBINARY|BIT)\b/i.test(columns.find(column => column.name === name)?.type ?? '') ? 'binary' : /json/i.test(columns.find(column => column.name === name)?.type ?? '') ? 'json' : 'text', text: '' });
  const [name, setName] = useState(initial?.name ?? ''), nameRef = useRef(name);
  const [input, setInput] = useState<RecordInput>(() => blank(name)), inputRef = useRef(input);
  const [error, setError] = useState(''), epoch = useRef(0), lock = useRef(false), latest = useRef(props); latest.current = props;
  const column = columns.find(column => column.name === name), revision = epoch.current, intent = props.intent;
  const invalidReason = props.invalidReason || (intent.invalidated ? text.changed : '');
  /** 字段改变同步清输入并撤销旧字段回调，切走再切回也不接受旧onChange。 */
  function changeColumn(value: string) { epoch.current++; nameRef.current = value; setName(value); inputRef.current = blank(value); setInput(inputRef.current); setError(''); }
  function changeInput(value: RecordInput) { if (epoch.current !== revision || latest.current.intent !== intent || nameRef.current !== name) return; inputRef.current = value; setInput(value); setError(''); }
  /** 点击同步读取最新输入并经父页最终门；旧窗口、旧字段及重复提交不能写第二次。 */
  function stage() {
    if (lock.current) return;
    try { if (latest.current.intent !== intent || latest.current.invalidReason || intent.invalidated) throw Error(latest.current.invalidReason || text.changed); lock.current = true; latest.current.onStage(nameRef.current, inputRef.current); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { lock.current = false; }
  }
  return <Modal title={text.title} onClose={props.onClose}><div className="modal-content"><p>{text.notice}</p><p>{formatText(text.count, props.intent.selected.size)}</p><label>{text.field}<select aria-label={text.field} value={name} disabled={!!invalidReason} onChange={event => changeColumn(event.target.value)}>{columns.map(column => <option key={column.name} value={column.name}>{column.name} · {column.type}</option>)}</select></label>{column && <RecordValueEditor key={`${name}:${revision}`} column={column} input={input} inserted={false} reason={invalidReason} focus={true} onChange={changeInput}/>}<ErrorBox message={invalidReason || error || (input.text.length > recordInputLimits.field ? text.budget : '')}/></div><footer className="modal-footer"><button onClick={props.onClose}>{zh.common.cancel}</button><button className="primary" disabled={!!invalidReason || !column || input.text.length > recordInputLimits.field} onClick={stage}>{text.stage}</button></footer></Modal>;
}
