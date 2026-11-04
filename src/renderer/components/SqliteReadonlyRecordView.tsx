import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import type { QueryRowDetails, QueryRowDetailsView } from '../queryRowDetails';
import { SqliteReadonlyRecord } from '../sqliteReadonlyRecord';
import { sqliteReadonlyRecordZh as text } from '../locales/sqliteReadonlyRecord.zh-CN';
import { recordProjectionZh as viewText } from '../locales/recordProjections.zh-CN';
import { parseJsonLexicalTree, type LexicalDocument } from '../jsonLexicalTree';
import { projectionPreview, projectionViewLimits } from '../recordProjectionView';
import { formatText } from '../locales/zh-CN';
import { errorMessage } from '../lib';
import { ErrorBox } from './ui';
import { JsonLexicalTreeView } from './JsonLexicalTreeView';
import '../recordProjections.css';

interface Props { controller: QueryRowDetails; view: QueryRowDetailsView; page: SqliteTablePage; current(): boolean; mode: 'tree' | 'json'; filter: string; }
/** 完整只读记录只从准确页建立；不借用可写Editor、伪造编辑元数据或取得写入token。 */
export function SqliteReadonlyRecordView({ controller, view, page, current, mode, filter }: Props) {
  const [captured] = useState(() => { try { return { record: new SqliteReadonlyRecord(page, controller, view, current), error: '' }; } catch (reason) { return { record: undefined, error: errorMessage(reason) }; } });
  const origin = useRef({ page, view }), invalid = useRef(false), ticket = {}, committed = useRef<object | undefined>(undefined);
  if (origin.current.page !== page || origin.current.view !== view) invalid.current = true;
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = undefined; }; });
  const [offset, setOffset] = useState(0), [active, setActive] = useState<{ index: number; document: LexicalDocument }>(), [error, setError] = useState('');
  const [filterWindow, setFilterWindow] = useState(filter);
  const record = captured.record;
  const matching = useMemo(() => record?.fields.map((field, index) => ({ field, index })).filter(({ field }) => field.name.toLowerCase().includes(filter.trim().toLowerCase())) ?? [], [record, filter]);
  const whole = useMemo(() => { if (!record || mode !== 'json') return { value: '', error: '' }; try { return { value: record.json(), error: '' }; } catch (reason) { return { value: '', error: errorMessage(reason) }; } }, [record, mode]);
  const start = Math.min(offset, Math.max(0, Math.floor((matching.length - 1) / projectionViewLimits.fields) * projectionViewLimits.fields));
  const selected = active && matching.some(value => value.index === active.index) ? active : undefined;
  // 搜索换范围时同步撤下旧节点及字段页，保留同一原行模型而不重复扫描大BLOB。
  if (filterWindow !== filter) { setFilterWindow(filter); setOffset(0); setActive(undefined); return null; }
  /** 旧渲染不能改变新搜索／新行选择，来源失效仅提示并撤下原只读值。 */
  function valid(): boolean {
    if (committed.current !== ticket) return false;
    if (invalid.current || !record?.current()) { setError(text.stale); return false; } return true;
  }
  /** 只明确解析当前搜索范围内的TEXT完整原文，不使用摘要或声明亲和性猜测。 */
  function inspect(index: number): void {
    if (!valid() || !matching.some(value => value.index === index)) return;
    const field = record!.fields[index]; if (field.value.kind !== 'text') return;
    setActive({ index, document: parseJsonLexicalTree(field.value.value) }); setError('');
  }
  if (!record) return <ErrorBox message={captured.error}/>;
  if (invalid.current || !record.current()) return <ErrorBox message={text.stale}/>;
  if (mode === 'json') return <section aria-label={text.json}><p>{text.jsonHint}</p>{whole.error ? <ErrorBox message={whole.error}/> : <textarea aria-label={text.jsonText} className="record-whole-json" spellCheck={false} readOnly value={whole.value}/>}</section>;
  return <section aria-label={text.tree}><p>{text.readonly}</p><p>{formatText(viewText.fieldRange, matching.length ? start + 1 : 0, Math.min(matching.length, start + projectionViewLimits.fields), matching.length)}</p>
    <div className="record-projection-pager"><button disabled={start === 0} onClick={() => { if (valid()) { setOffset(start - projectionViewLimits.fields); setActive(undefined); } }}>{viewText.fieldPrevious}</button><button disabled={start + projectionViewLimits.fields >= matching.length} onClick={() => { if (valid()) { setOffset(start + projectionViewLimits.fields); setActive(undefined); } }}>{viewText.fieldNext}</button></div>
    <ol className="record-lexical-list">{matching.slice(start, start + projectionViewLimits.fields).map(({ field, index }) => {
      const preview = field.value.kind === 'null' ? null : projectionPreview(field.value.value);
      return <li className="record-projection-entry" key={index}><strong>{index + 1}. {field.name}</strong><span>{field.value.kind}{field.generated ? ' · ' + text.generated : ''} · {field.declaredType}</span>
        {field.value.kind === 'blob' && <p>{text.binary(field.value.bytes)}</p>}<pre>{field.value.kind === 'null' ? 'NULL' : preview?.text}</pre>{preview?.truncated && <small>{viewText.summaryOnly}</small>}
        {field.value.kind === 'text' && <button onClick={() => inspect(index)}>{text.parse(field.name)}</button>}
      </li>;
    })}</ol>
    {selected && <section aria-label={record.fields[selected.index].name}><h4>{record.fields[selected.index].name}</h4>{selected.document.status === 'ready' ? <JsonLexicalTreeView columnName={record.fields[selected.index].name} document={selected.document} reason={text.readonly} readOnly current={valid} onEdit={() => {}} onStructure={() => {}}/> : <p role="status">{text.invalidJson} · {selected.document.reason}</p>}</section>}
    <ErrorBox message={error}/>
  </section>;
}
