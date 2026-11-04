import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { lexicalNodeAtPath, lexicalToken, type LexicalPathSegment, type ReadyLexicalDocument } from '../jsonLexicalTree';
import { lexicalViewWindow, projectionPreview, projectionViewLimits, type LexicalViewRow } from '../recordProjectionView';
import { formatText } from '../locales/zh-CN';
import { recordProjectionZh as text } from '../locales/recordProjections.zh-CN';
import { recordJsonNodeInputZh as nodeText } from '../locales/recordJsonNodeInput.zh-CN';
import { recordJsonStructureInputZh as structureText } from '../locales/recordJsonStructureInput.zh-CN';
import type { RecordStructureKind } from '../recordJsonStructureInput';
interface Props { columnName: string; document: ReadyLexicalDocument; reason: string; current?(): boolean; onEdit(document: ReadyLexicalDocument, segments: readonly LexicalPathSegment[]): void; onStructure(document: ReadyLexicalDocument, segments: readonly LexicalPathSegment[], kind: RecordStructureKind): void; }
/** 共用有界词法树；即使同一字段换成等值新文档，也卸载旧节点选择和回调。 */
export function JsonLexicalTreeView(props: Props) {
  const [source, setSource] = useState({ document: props.document, columnName: props.columnName, revision: 0 });
  if (source.document !== props.document || source.columnName !== props.columnName) { setSource({ document: props.document, columnName: props.columnName, revision: source.revision + 1 }); return null; }
  return <TreeContent key={source.revision} {...props}/>;
}
/** 节点以原文成员序号或数组下标标识，重复名称分别显示且不作为对象访问路径。 */
function nodeLabel(row: LexicalViewRow): string {
  const part = row.segment; if (!part) return text.root;
  if (part.kind === 'element') return formatText(text.element, part.index);
  const key = projectionPreview(part.key); return `${formatText(text.member, part.memberIndex + 1)} · ${JSON.stringify(key.text)}${key.truncated ? ` · ${text.summaryOnly}` : ''}`;
}

/** 原生列表和展开按钮提供键盘可访问入口，不冒用需要额外方向键实现的 ARIA tree。 */
function TreeContent({ columnName, document, reason, onEdit, onStructure, current }: Props) {
  const ticket = {}, committed = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = undefined; }; });
  const valid = () => committed.current === ticket && (!current || current());
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set([document.root]));
  const [offset, setOffset] = useState(0), [selected, setSelected] = useState<LexicalViewRow | null>(null);
  const detail=useRef<HTMLElement>(null),[actionsRequested,setActionsRequested]=useState(0);
  // 显式打开菜单后聚焦第一项操作，不要求键盘用户遍历后续数百个结构按钮。
  useEffect(()=>{if(actionsRequested)detail.current?.querySelector<HTMLButtonElement>('.record-structure-actions button:not(:disabled)')?.focus();},[actionsRequested]);
  const window = useMemo(() => lexicalViewWindow(document, expanded, offset), [document, expanded, offset]);
  const selectedNode = selected ? lexicalNodeAtPath(document, { document, segments: selected.path }) : null;
  const kinds:RecordStructureKind[]=[];
  if(selectedNode&&selected){if(selected.path.at(-1)?.kind==='member')kinds.push('rename');if(selected.path.length)kinds.push('remove');if(selectedNode.kind==='object'){kinds.push('append-member');if(selectedNode.members.length)kinds.push('move-member');}if(selectedNode.kind==='array'){kinds.push('insert-element');if(selectedNode.elements.length)kinds.push('move-element');}}
  /** 展开只改变显示集合；收起不改原文、词法路径或页内草稿。 */
  function toggle(id: number) { if (!valid()) return; setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  return <><p>{formatText(text.nodeRange, window.offset + 1, Math.min(window.offset + projectionViewLimits.nodes, window.total), window.total)}</p>
    <div className="record-projection-pager"><button disabled={!window.previous} onClick={() => { if (valid()) setOffset(window.offset - projectionViewLimits.nodes); }}>{text.nodePrevious}</button><button disabled={!window.next} onClick={() => { if (valid()) setOffset(window.offset + projectionViewLimits.nodes); }}>{text.nodeNext}</button></div>
    <ol className="record-lexical-list" aria-label={text.lexicalTree}>{window.rows.map(row => {
      const node = document.nodes[row.id]; const count = node.kind === 'object' ? node.members.length : node.kind === 'array' ? node.elements.length : null;
      const token = count === null ? projectionPreview(lexicalToken(document, node)) : null;
      return <li className="record-projection-entry" key={row.id} style={{ paddingInlineStart: `${Math.min(row.depth, 8) * 10}px` }}><strong>{nodeLabel(row)}</strong><span>{text.lexicalKinds[node.kind]}{count === null ? '' : ` · ${formatText(text.containerCount, count)}`}</span>
        {token && <><pre tabIndex={0}>{token.text}</pre>{token.truncated && <small>{text.summaryOnly}</small>}</>}
        <div>{count !== null && count > 0 && <button aria-expanded={expanded.has(row.id)} onClick={() => toggle(row.id)}>{expanded.has(row.id) ? text.collapse : text.expand}</button>}<button onClick={() => { if (valid()) setSelected(row); }}>{text.inspect}</button><button disabled={!!reason} title={reason||nodeText.hint} onClick={()=>{ if (valid()) onEdit(document,row.path); }}>{nodeText.edit}</button>{(row.path.length>0||count!==null)&&<button disabled={!!reason} title={reason} onClick={()=>{if(valid()){setSelected(row);setActionsRequested(value=>value+1);}}}>{structureText.more}</button>}</div>
      </li>;
    })}</ol>
    {selected && <section ref={detail} className="record-token-detail">{selectedNode ? <><label>{text.token}<textarea readOnly spellCheck={false} value={lexicalToken(document, selectedNode)}/></label><label>{text.path}<textarea readOnly spellCheck={false} value={JSON.stringify({ columnName, segments: selected.path })}/></label><div className="record-structure-actions" role="group" aria-label={structureText.more}>{kinds.map(kind=><button key={kind} disabled={!!reason} title={reason} onClick={()=>{ if(valid()) onStructure(document,selected.path,kind); }}>{structureText.actions[kind]}</button>)}</div></> : <p role="status">{text.selectionExpired}</p>}</section>}
  </>;
}
