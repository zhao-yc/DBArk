import { UsageHelp } from './ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnInfo } from '../../shared/contracts';
import type { DraftRow } from '../dataChanges';
import { lexicalToken, type LexicalDocument, type ReadyLexicalDocument } from '../jsonLexicalTree';
import { formatText } from '../locales/zh-CN';
import { recordProjectionZh as text } from '../locales/recordProjections.zh-CN';
import { buildRecordProjection, buildRecordSummary, RecordJsonTreeCache, resolveProjectionPath, sameProjectionIdentity, type ProjectionFailure, type ProjectionIdentity, type ProjectionSummaryField } from '../recordProjections';
import { lexicalViewWindow, projectionPreview, projectionViewLimits, type LexicalViewRow } from '../recordProjectionView';
import { recordFieldOrder, recordMetadataKey, recordTargetKey, type RecordContext, type RecordDraft } from '../recordViews';
import { recordReadonlyReason } from '../recordViews';
import type { RecordNodeSelection } from '../recordJsonNodeInput';
import { recordJsonNodeInputZh as nodeText } from '../locales/recordJsonNodeInput.zh-CN';
import type {RecordStructureKind} from '../recordJsonStructureInput';
import {recordJsonStructureInputZh as structureText} from '../locales/recordJsonStructureInput.zh-CN';
import '../recordProjections.css';

interface Props { row?: DraftRow; draft: RecordDraft | null; context: RecordContext; visibleKeys: string[]; showHidden: boolean; mode: 'tree' | 'json'; onEdit(selection: RecordNodeSelection, document: ReadyLexicalDocument): void; onStructure(selection:RecordNodeSelection,document:ReadyLexicalDocument,kind:RecordStructureKind):void }
interface SnapshotProps { row: DraftRow; context: RecordContext; identity: ProjectionIdentity; columns: ColumnInfo[]; visibleKeys: string[]; showHidden: boolean; mode: Props['mode']; onEdit: Props['onEdit']; onStructure:Props['onStructure'] }

/** 投影只接受当前已加载行；页代次或目标失效时即刻卸载缓存，不展示上一页的残留文本。 */
export function RecordReadonlyProjection({ row, draft, context, ...display }: Props) {
  if (!context.loaded || context.stale || context.busy || !context.info) return <p role="status">{text.stale}</p>;
  if (!row || !draft) return <p role="status">{text.noRecord}</p>;
  const target = recordTargetKey(context.target), metadata = recordMetadataKey(context.info);
  if (draft.rowId !== row.id || draft.target !== target || draft.connectionVersion !== context.connectionVersion || draft.generation !== context.generation || draft.metadata !== metadata) return <p role="status">{text.stale}</p>;
  const identity: ProjectionIdentity = { target, metadata, connectionVersion: context.connectionVersion, generation: context.generation, rowId: row.id, data: row.data, original: row.original, inserted: row.inserted, deleted: row.deleted };
  return <ProjectionBoundary row={row} context={context} identity={identity} columns={context.info.columns} {...display}/>;
}

/** 在提交渲染前切换子树身份；同 UUID 的草稿引用变化也不能沿用旧 token、节点选择和解析缓存。 */
function ProjectionBoundary(props: SnapshotProps) {
  const [snapshot, setSnapshot] = useState({ identity: props.identity, revision: 0 });
  if (!sameProjectionIdentity(snapshot.identity, props.identity)) { setSnapshot({ identity: props.identity, revision: snapshot.revision + 1 }); return null; }
  return <ProjectionContent key={snapshot.revision} {...props}/>;
}

/** 失败只显示原因，不提供部分全文或部分树；列名仍作为普通文本显示。 */
function ProjectionError({ result }: { result: ProjectionFailure }) {
  return <div className="info-strip" role="status"><strong>{result.status === 'limited' ? text.limited : text.unavailable}</strong><p>{result.columnName !== undefined ? `${result.columnName}：` : ''}{result.reason}</p></div>;
}

/** 值摘要不会解码全量 BLOB；NULL、缺值、JSON 原文和普通字符串使用各自的明确标签。 */
function SummaryValue({ field }: { field: ProjectionSummaryField }) {
  return <><p>{text.type}：{text.kinds[field.kind]}</p>{field.kind === 'binary' && <p>{formatText(text.binaryBytes, field.bytes ?? 0)}</p>}
    {field.reason ? <p role="status">{field.reason}</p> : ['null', 'default', 'generated-pending'].includes(field.kind) ? null : <pre tabIndex={0}>{field.preview}</pre>}
    {field.truncated && <p className="muted small">{text.summaryOnly}</p>}</>;
}

/** 单活动行管理一个解析缓存；显示顺序只影响字段摘要，不改变元数据或页草稿。 */
function ProjectionContent({ row, context, identity, columns, visibleKeys, showHidden, mode, onEdit, onStructure }: SnapshotProps) {
  const cache = useRef(new RecordJsonTreeCache());
  const [fieldOffset, setFieldOffset] = useState(0);
  const [active, setActive] = useState<{ name: string; result: LexicalDocument | ProjectionFailure } | null>(null);
  useEffect(() => () => cache.current.clear(), []);
  const hidden = useMemo(() => new Set(columns.filter(column => !visibleKeys.includes(column.name)).map(column => column.name)), [columns, visibleKeys]);
  const summary = useMemo(() => mode === 'tree' ? buildRecordSummary(identity, columns, hidden) : null, [identity.data, identity.inserted, columns, hidden, mode]);
  const projection = useMemo(() => mode === 'json' ? buildRecordProjection(identity, columns, hidden) : null, [identity.data, identity.inserted, columns, hidden, mode]);
  const order = recordFieldOrder(columns, visibleKeys, showHidden);
  const offset = Math.min(fieldOffset, Math.max(0, Math.floor((order.length - 1) / projectionViewLimits.fields) * projectionViewLimits.fields));
  const names = order.slice(offset, offset + projectionViewLimits.fields);
  const fieldMap = useMemo(() => new Map(summary?.status === 'ready' ? summary.fields.map(field => [field.name, field]) : []), [summary]);
  /** 翻字段组立即撤下不属于当前窗口的结构，解析预算仍由当前行缓存统一管理。 */
  function changeFieldPage(next: number) { setFieldOffset(next); setActive(null); }
  /** 用户显式选择后才解析；LONGTEXT 不根据内容或名称被自动当作 JSON。 */
  function inspectJson(column: ColumnInfo) { setActive({ name: column.name, result: cache.current.read(identity, column, column.type.toLowerCase() !== 'json') }); }
  /** 点击时再次读取当前缓存文档，不能只用选择里自带的旧文档冒充当前树。 */
  function editNode(document: ReadyLexicalDocument, columnName: string, segments: RecordNodeSelection['segments']) {
    const column=columns.find(item=>item.name===columnName);if(!column)return;
    const current=cache.current.read(identity,column,column.type.toLowerCase()!=='json');
    if(current.status!=='ready')return;
    onEdit({row,identity,columnName,document,segments},current);
  }
  /** 结构菜单同样复核当前缓存；名字、下标及后续输入都不能绕过原行身份门。 */
  function structureNode(document:ReadyLexicalDocument,columnName:string,segments:RecordNodeSelection['segments'],kind:RecordStructureKind){
    const column=columns.find(value=>value.name===columnName);if(!column)return;
    const current=cache.current.read(identity,column,column.type.toLowerCase()!=='json');if(current.status!=='ready')return;
    onStructure({row,identity,columnName,document,segments},current,kind);
  }
  if (mode === 'json') return <section className="record-projection-content" aria-label={text.json}>
    <p>{text.jsonScope}</p><UsageHelp><p>{text.jsonHint}</p></UsageHelp>{projection?.status === 'ready' ? <><p>{formatText(text.jsonBytes, projection.outputBytes)}</p><textarea className="record-whole-json" aria-label={text.jsonText} spellCheck={false} readOnly value={projection.text}/></> : projection && <ProjectionError result={projection}/>}</section>;
  if (!summary) return null;
  if (summary.status !== 'ready') return <ProjectionError result={summary}/>;
  const selected = active && names.includes(active.name) ? active : null;
  return <section className="record-projection-content" aria-label={text.tree}>
    {!summary.complete && <p role="status">{text.incomplete}</p>}
    <p>{formatText(text.fieldRange, order.length ? offset + 1 : 0, Math.min(offset + projectionViewLimits.fields, order.length), order.length)}</p>
    <div className="record-projection-pager"><button disabled={!offset} onClick={() => changeFieldPage(Math.max(0, offset - projectionViewLimits.fields))}>{text.fieldPrevious}</button><button disabled={offset + projectionViewLimits.fields >= order.length} onClick={() => changeFieldPage(offset + projectionViewLimits.fields)}>{text.fieldNext}</button></div>
    <ol className="record-projection-fields" aria-label={text.fields}>{names.map(name => {
      const field = fieldMap.get(name), column = columns.find(item => item.name === name); if (!field || !column) return null;
      return <li className="record-projection-entry" key={name}><h3>{field.name}<small>{field.sqlType}{field.hidden ? ` · ${text.hidden}` : ''}</small></h3><SummaryValue field={field}/>
        {(field.kind === 'string' || field.kind === 'json-text') && <button aria-expanded={selected?.name === name} onClick={() => selected?.name === name ? setActive(null) : inspectJson(column)}>{selected?.name === name ? text.closeTree : field.kind === 'json-text' ? text.parse : text.parseExplicit}</button>}
      </li>;
    })}</ol>
    {selected && <section className="record-lexical-section" aria-label={selected.name}><h3>{selected.name}</h3><UsageHelp><p>{text.jsonSource}</p><p>{text.ordered}</p></UsageHelp>
      {selected.result.status === 'ready' ? <LexicalTree key={selected.name} identity={identity} columnName={selected.name} document={selected.result} reason={recordReadonlyReason(context,row,selected.name)} onEdit={segments=>editNode(selected.result as ReadyLexicalDocument,selected.name,segments)} onStructure={(segments,kind)=>structureNode(selected.result as ReadyLexicalDocument,selected.name,segments,kind)}/> : <div role="status"><strong>{selected.result.status === 'invalid' ? text.invalid : selected.result.status === 'limited' ? text.lexicalLimited : text.unavailable}</strong><p>{'offset' in selected.result ? formatText(text.failureAt, selected.result.offset, selected.result.reason) : selected.result.reason}</p></div>}
    </section>}
  </section>;
}

/** 成员名显示有界前缀且始终携带序号；同名成员与特殊符号不会被当作访问表达式。 */
function nodeLabel(row: LexicalViewRow): string {
  const part = row.segment; if (!part) return text.root;
  if (part.kind === 'element') return formatText(text.element, part.index);
  const key = projectionPreview(part.key); return `${formatText(text.member, part.memberIndex + 1)} · ${JSON.stringify(key.text)}${key.truncated ? ` · ${text.summaryOnly}` : ''}`;
}

/** 原生列表和展开按钮提供键盘可访问入口，不冒用需要额外方向键实现的 ARIA tree。 */
function LexicalTree({ identity, columnName, document, reason, onEdit, onStructure }: { identity: ProjectionIdentity; columnName: string; document: ReadyLexicalDocument; reason: string; onEdit(segments: RecordNodeSelection['segments']): void; onStructure(segments:RecordNodeSelection['segments'],kind:RecordStructureKind):void }) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set([document.root]));
  const [offset, setOffset] = useState(0), [selected, setSelected] = useState<LexicalViewRow | null>(null);
  const detail=useRef<HTMLElement>(null),[actionsRequested,setActionsRequested]=useState(0);
  // 显式打开菜单后聚焦第一项操作，不要求键盘用户遍历后续数百个结构按钮。
  useEffect(()=>{if(actionsRequested)detail.current?.querySelector<HTMLButtonElement>('.record-structure-actions button:not(:disabled)')?.focus();},[actionsRequested]);
  const window = useMemo(() => lexicalViewWindow(document, expanded, offset), [document, expanded, offset]);
  const path = selected ? { identity, columnName, document, segments: selected.path } : null;
  const selectedNode = path ? resolveProjectionPath(identity, columnName, document, path) : null;
  const kinds:RecordStructureKind[]=[];
  if(selectedNode&&selected){if(selected.path.at(-1)?.kind==='member')kinds.push('rename');if(selected.path.length)kinds.push('remove');if(selectedNode.kind==='object'){kinds.push('append-member');if(selectedNode.members.length)kinds.push('move-member');}if(selectedNode.kind==='array'){kinds.push('insert-element');if(selectedNode.elements.length)kinds.push('move-element');}}
  /** 展开只改变显示集合；收起不改原文、词法路径或页内草稿。 */
  function toggle(id: number) { setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  return <><p>{formatText(text.nodeRange, window.offset + 1, Math.min(window.offset + projectionViewLimits.nodes, window.total), window.total)}</p>
    <div className="record-projection-pager"><button disabled={!window.previous} onClick={() => setOffset(window.offset - projectionViewLimits.nodes)}>{text.nodePrevious}</button><button disabled={!window.next} onClick={() => setOffset(window.offset + projectionViewLimits.nodes)}>{text.nodeNext}</button></div>
    <ol className="record-lexical-list" aria-label={text.lexicalTree}>{window.rows.map(row => {
      const node = document.nodes[row.id]; const count = node.kind === 'object' ? node.members.length : node.kind === 'array' ? node.elements.length : null;
      const token = count === null ? projectionPreview(lexicalToken(document, node)) : null;
      return <li className="record-projection-entry" key={row.id} style={{ paddingInlineStart: `${Math.min(row.depth, 8) * 10}px` }}><strong>{nodeLabel(row)}</strong><span>{text.lexicalKinds[node.kind]}{count === null ? '' : ` · ${formatText(text.containerCount, count)}`}</span>
        {token && <><pre tabIndex={0}>{token.text}</pre>{token.truncated && <small>{text.summaryOnly}</small>}</>}
        <div>{count !== null && count > 0 && <button aria-expanded={expanded.has(row.id)} onClick={() => toggle(row.id)}>{expanded.has(row.id) ? text.collapse : text.expand}</button>}<button onClick={() => setSelected(row)}>{text.inspect}</button><button disabled={!!reason} title={reason||nodeText.hint} onClick={()=>onEdit(row.path)}>{nodeText.edit}</button>{(row.path.length>0||count!==null)&&<button disabled={!!reason} title={reason} onClick={()=>{setSelected(row);setActionsRequested(value=>value+1);}}>{structureText.more}</button>}</div>
      </li>;
    })}</ol>
    {selected && <section ref={detail} className="record-token-detail">{selectedNode ? <><label>{text.token}<textarea readOnly spellCheck={false} value={lexicalToken(document, selectedNode)}/></label><label>{text.path}<textarea readOnly spellCheck={false} value={JSON.stringify({ columnName, segments: selected.path })}/></label><div className="record-structure-actions" role="group" aria-label={structureText.more}>{kinds.map(kind=><button key={kind} disabled={!!reason} title={reason} onClick={()=>onStructure(selected.path,kind)}>{structureText.actions[kind]}</button>)}</div></> : <p role="status">{text.selectionExpired}</p>}</section>}
  </>;
}
