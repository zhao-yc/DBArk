import { useLayoutEffect, useRef, useState } from 'react';
import type { DataRow } from '../../shared/contracts';
import { postgresTableFieldValueSchema, postgresTableLimits, type PostgresTableColumn } from '../../shared/postgresTable';
import { parseJsonLexicalTree, type LexicalDocument, type LexicalPathSegment, type ReadyLexicalDocument } from '../jsonLexicalTree';
import { errorMessage } from '../lib';
import { postgresRecordJsonZh as text } from '../locales/postgresRecordJson.zh-CN';
import { isPostgresJsonTextType, postgresJsonFieldText } from '../postgresRecordJson';
import { applyRecordJsonFieldInput, beginRecordJsonFieldInput, changeRecordJsonFieldInput, type RecordJsonFieldInput } from '../recordJsonFieldInput';
import type { RecordStructureAction, RecordStructureKind } from '../recordJsonStructureInput';
import { JsonLexicalTreeView } from './JsonLexicalTreeView';
import { RecordJsonNodeEditor } from './RecordJsonNodeEditor';
import { RecordJsonStructureEditor } from './RecordJsonStructureEditor';
import type { PostgresRecordValues } from './PostgresRecordFields';
import { ErrorBox } from './ui';

/** 所有修改只替换当前字段输入；原行身份和草稿预算仍由调用表单负责。 */
export function PostgresRecordJsonTree({ columns, original, values, current, onAccept, onClose }: {
  columns: readonly PostgresTableColumn[]; original?: DataRow; values: PostgresRecordValues;
  current(): boolean; onAccept(column: string, previous: string, next: string): void; onClose(): void;
}) {
  const candidates = columns.filter(column => isPostgresJsonTextType(column.type));
  const [key, setKey] = useState(() => (candidates.find(column => /^jsonb?$/.test(column.type) &&
    postgresJsonFieldText(original, values, column.key) !== undefined) ?? candidates[0])?.key ?? '');
  const [parsed, setParsed] = useState<{ key: string; source: string; document: LexicalDocument }>();
  const [input, setInput] = useState<RecordJsonFieldInput>();
  const [error, setError] = useState('');
  const work = useRef<RecordJsonFieldInput>(undefined);
  const render = {}, committed = useRef<object>(undefined);
  useLayoutEffect(() => { committed.current = render; return () => { committed.current = undefined; }; });
  const column = candidates.find(item => item.key === key);
  const source = postgresJsonFieldText(original, values, key);
  const active = parsed?.key === key && parsed.source === source ? parsed.document : undefined;
  const readonly = !column || column.generated || (source?.length ?? 0) > postgresTableLimits.value;
  const valid = () => committed.current === render && current();

  function open(document: ReadyLexicalDocument, segments: readonly LexicalPathSegment[], kind?: RecordStructureKind) {
    if (!valid() || readonly || !column || work.current || active !== document) return;
    try {
      const next = beginRecordJsonFieldInput(column.name, document, segments, kind);
      work.current = next; setInput(next); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }

  function change(captured: RecordJsonFieldInput, next: string | RecordStructureAction) {
    if (!valid() || work.current !== captured || captured.base.value.document !== active) return;
    try {
      const updated = changeRecordJsonFieldInput(captured, next);
      work.current = updated; setInput(updated); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }

  function cancel(captured: RecordJsonFieldInput) {
    if (committed.current !== render || work.current !== captured) return;
    work.current = undefined; setInput(undefined); setError('');
  }

  function apply(captured: RecordJsonFieldInput) {
    if (!valid() || work.current !== captured) return;
    try {
      if (!column || readonly || active !== captured.base.value.document || source === undefined) throw Error(text.treeStale);
      const document = applyRecordJsonFieldInput(captured);
      if (!postgresTableFieldValueSchema.safeParse({ mode: 'text', value: document.text }).success) throw Error(text.value(column.name));
      if (source !== document.text) onAccept(key, source, document.text);
      setParsed({ key, source: document.text, document });
      cancel(captured);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  return <section className="pg-record-json-editor" aria-label={text.tree}>
    <p>{text.treeHint}</p>
    <div className="pg-record-pending">
      <select aria-label={text.treeField} value={key} disabled={!!input} onChange={event => {
        if (work.current) return;
        setKey(event.target.value); setParsed(undefined); setError('');
      }}>{candidates.map(item => <option key={item.key} value={item.key}>{item.name} · {item.type}</option>)}</select>
      <button type="button" disabled={!!input || source === undefined} onClick={() => {
        if (!valid() || work.current || source === undefined) return;
        setParsed({ key, source, document: parseJsonLexicalTree(source) }); setError('');
      }}>{text.parse}</button>
      <button type="button" disabled={!!input} onClick={() => { if (!work.current) onClose(); }}>{text.back}</button>
    </div>
    {active?.status === 'ready' ? column && <JsonLexicalTreeView columnName={column.name} document={active}
      reason={readonly ? text.treeReadonly : input ? text.treePending : ''} readOnly={readonly}
      current={() => valid() && !work.current} onEdit={(document, segments) => open(document, segments)}
      onStructure={(document, segments, kind) => open(document, segments, kind)}/>
      : active && <p role="status">{text.treeInvalid} · {active.reason}</p>}
    {input && <>
      {input.action ? <RecordJsonStructureEditor input={input as RecordJsonFieldInput & { action: RecordStructureAction }} reason=""
        onChange={(action, captured) => change(captured, action)} onClose={() => cancel(input)}/>
        : <RecordJsonNodeEditor input={input.base} reason="" scope={text.treeScope} onChange={(value, captured) => {
          if (captured === input.base) change(input, value);
        }} onClose={() => cancel(input)}/>}
      <button type="button" onClick={() => apply(input)}>{text.applyNode}</button>
      <p role="status">{text.treePending}</p>
    </>}
    <ErrorBox message={error}/>
  </section>;
}
