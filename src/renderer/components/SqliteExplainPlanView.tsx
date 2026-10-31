import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { QueryOutcome } from '../../shared/contracts';
import { sqliteExplainLimits, type SqliteExplainNode } from '../../shared/sqliteExplain';
import { sqliteExplainZh as text } from '../locales/sqliteExplain.zh-CN';
import { ResultsGrid } from './ResultsGrid';
import '../explain.css';
import '../sqliteExplain.css';

interface Props { outcome: QueryOutcome; busy: boolean; isCurrent?(): boolean; }
/** 原 outcome/plan 换代同步撤销旧子树；A→B→A也不能复活旧按钮、折叠或勾选状态。 */
export function SqliteExplainPlanView(props: Props) {
  const owner = useRef({ outcome: props.outcome, plan: props.outcome.sqliteExplain, generation: 0 });
  if (owner.current.outcome !== props.outcome || owner.current.plan !== props.outcome.sqliteExplain) owner.current = { outcome: props.outcome, plan: props.outcome.sqliteExplain, generation: owner.current.generation + 1 };
  const captured = owner.current;
  return <OwnedSqliteExplain key={captured.generation} {...props} isCurrent={() => owner.current === captured && (props.isCurrent?.() ?? true)}/>;
}

/** 所有阅读操作只改变本地状态；表格复用后端原行列，绝不生成编辑或文件快照能力。 */
function OwnedSqliteExplain({ outcome, busy, isCurrent }: Props) {
  const plan = outcome.sqliteExplain!;
  const bounded = plan.nodes.length <= sqliteExplainLimits.nodes && plan.nodes.every(node => Number.isSafeInteger(node.depth) && node.depth >= 0 && node.depth < sqliteExplainLimits.depth);
  const nodes = bounded ? plan.nodes : [];
  const [view, setView] = useState<'tree' | 'table' | 'raw'>(plan.initialView === 'tree' && nodes.length ? 'tree' : 'table');
  const [selected, setSelected] = useState(nodes[0]?.id ?? ''), [collapsed, setCollapsed] = useState<Set<string>>(new Set()), [focus, setFocus] = useState<{ id: string }>();
  const ticket = {}, committed = useRef<object | undefined>(undefined), buttons = useRef(new Map<string, HTMLButtonElement>());
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = undefined; }; });
  const byId = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const parents = useMemo(() => new Set(nodes.flatMap(node => node.parent !== undefined && byId.has(node.parent) ? [node.parent] : [])), [nodes, byId]);
  /** 有界祖先链避免递归 DOM；父节点顺序不影响折叠正确性。 */
  function ancestor(node: SqliteExplainNode, match: (id: string) => boolean): boolean {
    const visited = new Set<string>(); let parent = node.parent;
    while (parent !== undefined && !visited.has(parent) && visited.size < sqliteExplainLimits.depth) { if (match(parent)) return true; visited.add(parent); parent = byId.get(parent)?.parent; }
    return false;
  }
  const visible = nodes.filter(node => !ancestor(node, id => collapsed.has(id))), currentNode = byId.get(selected) ?? visible[0];
  useLayoutEffect(() => { if (focus) { const button = buttons.current.get(focus.id); button?.focus(); button?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } }, [focus]);
  /** 每次事件核本次提交的渲染票据和原 outcome，旧视图事件不操作后继计划。 */
  function current(node?: SqliteExplainNode): boolean { try { return committed.current === ticket && (isCurrent?.() ?? true) && (!node || byId.get(node.id) === node); } catch { return false; } }
  function choose(id: string): void { setSelected(id); setFocus({ id }); }
  function toggle(node: SqliteExplainNode): void {
    if (!current(node) || !parents.has(node.id)) return;
    const next = new Set(collapsed); if (next.has(node.id)) next.delete(node.id); else { next.add(node.id); if (currentNode && ancestor(currentNode, id => id === node.id)) choose(node.id); } setCollapsed(next);
  }
  /** 键盘仅选择/折叠原节点，不触发数据库请求；输入法组合不接管。 */
  function navigate(event: KeyboardEvent, node: SqliteExplainNode): void {
    if (!current(node) || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const index = visible.indexOf(node); let target: string | undefined;
    switch (event.key) {
      case 'ArrowDown': target = visible[Math.min(index + 1, visible.length - 1)]?.id; break;
      case 'ArrowUp': target = visible[Math.max(0, index - 1)]?.id; break;
      case 'Home': target = visible[0]?.id; break;
      case 'End': target = visible.at(-1)?.id; break;
      case 'ArrowRight': if (parents.has(node.id)) { if (collapsed.has(node.id)) toggle(node); else target = nodes.find(child => child.parent === node.id)?.id; } break;
      case 'ArrowLeft': if (parents.has(node.id) && !collapsed.has(node.id)) toggle(node); else target = node.parent; break;
      case 'Enter': case ' ': toggle(node); break;
      default: return;
    }
    event.preventDefault(); if (target !== undefined && byId.has(target)) choose(target);
  }
  const result = outcome.results[0], raw = plan.raw.slice(0, sqliteExplainLimits.rawBytes);
  return <section className="explain-view sqlite-explain-view" aria-label={text.title} data-sqlite-explain-view>
    <div className="explain-toolbar" role="group" aria-label={text.title}>{(['tree', 'table', 'raw'] as const).map(mode => <button key={mode} aria-label={text[mode + 'Label' as 'treeLabel' | 'tableLabel' | 'rawLabel']} aria-pressed={view === mode} onClick={() => { if (current()) setView(mode); }}>{text[mode]}</button>)}<span>{text.source} · {plan.version}</span></div>
    <p className="explain-hint">{text.estimates}</p><p className="explain-hint">{text.keyboard}</p>{plan.warnings.map((warning, index) => <p className="explain-warning" role="status" key={index}>{warning}</p>)}{!bounded && <p className="explain-warning" role="status">{text.bounds}</p>}
    <div className="explain-content">{view === 'tree' && (nodes.length ? <div className="explain-layout"><div className="explain-tree-pane"><div className="explain-actions"><button aria-label={text.expand} onClick={() => { if (current()) setCollapsed(new Set()); }}>{text.expand}</button><button aria-label={text.collapse} onClick={() => { if (current()) { setCollapsed(new Set(parents)); choose(nodes.find(node => node.parent === undefined)?.id ?? nodes[0].id); } }}>{text.collapse}</button></div><div role="tree" aria-label={text.treeLabel} className="explain-tree">{visible.map(node => <button key={node.id} ref={element => { if (element) buttons.current.set(node.id, element); else buttons.current.delete(node.id); }} role="treeitem" aria-level={node.depth + 1} aria-expanded={parents.has(node.id) ? !collapsed.has(node.id) : undefined} aria-selected={currentNode === node} tabIndex={currentNode === node ? 0 : -1} className="explain-node sqlite-explain-node" style={{ paddingLeft: 10 + Math.min(node.depth, 12) * 14 }} onFocus={() => { if (current(node) && selected !== node.id) setSelected(node.id); }} onClick={() => { if (current(node)) choose(node.id); }} onDoubleClick={() => toggle(node)} onKeyDown={event => navigate(event, node)}><span aria-hidden="true">{parents.has(node.id) ? collapsed.has(node.id) ? '▸' : '▾' : '·'}</span><span className="sqlite-explain-detail-text">{node.detail}</span><small>{text.id}：{node.id} · {text.parent}：{node.parent ?? text.root}</small></button>)}</div></div>{currentNode && <div className="explain-detail" aria-label={text.detail}><dl><div><dt>{text.id}</dt><dd>{currentNode.id}</dd></div><div><dt>{text.parent}</dt><dd>{currentNode.parent ?? text.root}</dd></div><div><dt>{text.auxiliary}</dt><dd>{currentNode.auxiliary}</dd></div></dl><pre tabIndex={0}>{currentNode.detail}</pre></div>}</div> : <p className="explain-empty">{text.empty}</p>)}
      {view === 'table' && (result ? <ResultsGrid columns={result.columns} rows={result.rows} binaryFileActions={false} isCurrent={() => current() && !busy}/> : <p className="explain-empty">{text.noTable}</p>)}
      {view === 'raw' && <div className="explain-raw"><pre tabIndex={0} aria-label={text.rawContent}>{raw || text.noRaw}</pre>{(plan.rawTruncated || plan.raw.length > sqliteExplainLimits.rawBytes) && <p className="explain-warning" role="status">{text.truncated}</p>}</div>}
    </div>
  </section>;
}
