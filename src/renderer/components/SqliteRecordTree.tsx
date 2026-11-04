import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SqliteEditColumn, SqliteOriginalValue } from '../../shared/sqliteTableEdit';
import { parseJsonLexicalTree, type LexicalDocument, type LexicalPathSegment, type ReadyLexicalDocument } from '../jsonLexicalTree';
import { beginSqliteJsonFieldInput, changeSqliteJsonFieldInput, applySqliteJsonFieldInput, type SqliteJsonFieldInput } from '../sqliteJsonFieldInput';
import type { RecordStructureAction, RecordStructureKind } from '../recordJsonStructureInput';
import { projectionPreview, projectionViewLimits } from '../recordProjectionView';
import { sqliteRecordTreeZh as text } from '../locales/sqliteRecordTree.zh-CN';
import { recordProjectionZh as viewText } from '../locales/recordProjections.zh-CN';
import { formatText } from '../locales/zh-CN';
import { errorMessage } from '../lib';
import { ErrorBox } from './ui';
import { JsonLexicalTreeView } from './JsonLexicalTreeView';
import { RecordJsonNodeEditor } from './RecordJsonNodeEditor';
import { RecordJsonStructureEditor } from './RecordJsonStructureEditor';
import '../recordProjections.css';

interface Props {
  columns: readonly SqliteEditColumn[]; values: readonly (SqliteOriginalValue | undefined)[]; current(): boolean;
  onPending(token: object, pending: boolean): boolean;
  onChange(index: number, value: SqliteOriginalValue, source: Props['values'], token: object): boolean;
}
/** 只展示当前窗口typed输入；父组件按值数组代次重建，节点缓冲与原行草稿互不冒充。 */
export function SqliteRecordTree({ columns, values, current, onPending, onChange }: Props) {
  const [offset, setOffset] = useState(0), [active, setActive] = useState<{ index: number; document: LexicalDocument }>(), [input, setInput] = useState<SqliteJsonFieldInput>(), [error, setError] = useState('');
  const work = useRef(input), source = useRef(values), ticket = {}, committed = useRef<object | undefined>(undefined);
  work.current = input;
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = undefined; }; });
  useEffect(() => () => { const last = work.current; work.current = undefined; if (last) onPending(last.base.session, false); }, []);
  /** 同key误复用或旧渲染回调均不能把原字段路径移植到新行。 */
  function valid(): boolean { return source.current === values && committed.current === ticket && current(); }
  /** 明确选择TEXT后才解析，不根据声明类型或字段名猜JSON。 */
  function inspect(index: number): void {
    if (!valid() || work.current) return;
    const value = values[index]; if (value?.kind !== 'text') { setError(text.textOnly); return; }
    setActive({ index, document: parseJsonLexicalTree(value.value) }); setError('');
  }
  /** 新节点输入取得独占token；原选择、字段及精确文档同时校验。 */
  function begin(document: ReadyLexicalDocument, segments: readonly LexicalPathSegment[], kind?: RecordStructureKind): void {
    if (!valid() || work.current || active?.document !== document) return;
    try {
      const next = beginSqliteJsonFieldInput(columns[active.index], values[active.index], document, segments, kind); work.current = next;
      if (!onPending(next.base.session, true)) { work.current = undefined; throw Error(text.stale); }
      setInput(next); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 文本可暂时无效但仍属于原输入token；迟到的子组件事件不能替换后来的操作。 */
  function change(captured: SqliteJsonFieldInput, next: string | RecordStructureAction): void {
    if (!valid() || work.current !== captured) return;
    try { const value = changeSqliteJsonFieldInput(captured, next); work.current = value; setInput(value); setError(''); } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 取消只放弃当前节点缓冲，不改变完整TEXT字段或窗口内其它输入。 */
  function cancel(captured: SqliteJsonFieldInput): void {
    if (source.current !== values || committed.current !== ticket || work.current !== captured) return;
    work.current = undefined; setInput(undefined); onPending(captured.base.session, false); setError('');
  }
  /** 完整词法拼接通过后才交给原窗口，父窗口继续核来源数组与独占token。 */
  function apply(captured: SqliteJsonFieldInput): void {
    if (!valid() || work.current !== captured || !active || captured.base.value.document !== active.document) { if (committed.current === ticket && work.current === captured) setError(text.stale); return; }
    try {
      const value = applySqliteJsonFieldInput(captured, values[active.index]);
      if (!onChange(active.index, value, values, captured.base.session)) throw Error(text.stale);
      onPending(captured.base.session, false); work.current = undefined; setInput(undefined);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  const shown = columns.slice(offset, offset + projectionViewLimits.fields), field = active && columns[active.index], value = active && values[active.index];
  const reason = field?.generated || value?.kind === 'text' && value.value.length > 65536 ? text.readonly : input ? text.pending : '';
  return <section aria-label={text.mode}><p>{text.hint}</p><p>{formatText(viewText.fieldRange, offset + 1, Math.min(columns.length, offset + projectionViewLimits.fields), columns.length)}</p>
    <div className="record-projection-pager"><button disabled={!!input || offset === 0} onClick={() => { if (valid() && !work.current) { setOffset(offset - projectionViewLimits.fields); setActive(undefined); } }}>{viewText.fieldPrevious}</button><button disabled={!!input || offset + projectionViewLimits.fields >= columns.length} onClick={() => { if (valid() && !work.current) { setOffset(offset + projectionViewLimits.fields); setActive(undefined); } }}>{viewText.fieldNext}</button></div>
    <ol aria-label={text.fields} className="record-lexical-list">{shown.map((column, i) => {
      const index = offset + i, value = values[index], preview = value && value.kind !== 'null' ? projectionPreview(value.value) : null;
      return <li key={column.name} className="record-projection-entry"><strong>{column.name}</strong><span>{value?.kind ?? text.default}{column.generated ? ' · ' + text.generated : ''} · {column.declaredType}</span>
        <pre>{value === undefined ? text.default : value.kind === 'null' ? text.null : preview?.text}</pre>{preview?.truncated && <small>{viewText.summaryOnly}</small>}
        {value?.kind === 'text' && <button disabled={!!input} onClick={() => inspect(index)}>{text.parse(column.name)}</button>}
      </li>;
    })}</ol>
    {active && <section aria-label={field?.name}><h3>{field?.name}</h3>{active.document.status === 'ready' ? <JsonLexicalTreeView columnName={field!.name} document={active.document} reason={reason} current={() => valid() && !work.current} onEdit={(document, segments) => begin(document, segments)} onStructure={(document, segments, kind) => begin(document, segments, kind)}/> : <p role="status">{text.invalid} · {active.document.reason}</p>}</section>}
    {input && <>{input.action ? <RecordJsonStructureEditor input={input as SqliteJsonFieldInput & { action: RecordStructureAction }} reason="" onChange={(action, captured) => change(captured, action)} onClose={() => cancel(input)}/> : <RecordJsonNodeEditor input={input.base} reason="" onChange={(value, captured) => { if (captured === input.base) change(input, value); }} onClose={() => cancel(input)}/>}<button onClick={() => apply(input)}>{text.edit}</button><p role="status">{text.pending}</p></>}
    <ErrorBox message={error}/>
  </section>;
}
