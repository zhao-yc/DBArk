import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { QueryOutcome } from '../../shared/contracts';
import { explainLimits, explainNodeDetail, type ExplainNode } from '../../shared/explain';
import { explainZh as t } from '../locales/explain.zh-CN';
import { ResultsGrid } from './ResultsGrid';
import '../explain.css';

/** 方言节点来自服务器，原型同名名称也只能当作普通文本显示。 */
const nodeTitle = (kind: string) => Object.hasOwn(t.kinds, kind) ? t.kinds[kind] : kind;

/** 展示有界的真实计划；所有视图切换都读取已有结果，只有明确的文本按钮会发送请求。 */
export function ExplainPlanView({ outcome, onText, busy }: { outcome: QueryOutcome; onText(): void; busy: boolean }) {
  const plan = outcome.explain!;
  const [view, setView] = useState<'tree' | 'raw' | 'table'>(plan.nodes.length ? 'tree' : plan.format === 'text' ? 'table' : 'raw');
  const [selected, setSelected] = useState(plan.nodes[0]?.id ?? '');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const children = useMemo(() => new Set(plan.nodes.flatMap(node => node.parent ? [node.parent] : [])), [plan]);
  const visible = useMemo(() => {
    const hidden = new Set<string>();
    return plan.nodes.filter(node => { if (node.parent && (collapsed.has(node.parent) || hidden.has(node.parent))) { hidden.add(node.id); return false; } return true; });
  }, [plan, collapsed]);
  const current = plan.nodes.find(node => node.id === selected) ?? plan.nodes[0];
  const detail = useMemo(() => current?.pathTruncated ? t.longPath : current ? explainNodeDetail(plan.raw, current.path) : '', [plan, current]);
  const first = outcome.results[0], rawCell = first?.rows[0]?.[first.columns[0]?.key];
  const raw = plan.raw || (plan.format === 'json' && typeof rawCell === 'string' ? rawCell : '');
  const result = outcome.results[0];
  /** 选择与焦点一起移动；收起父节点时也把活动项移回可见范围。 */
  function focus(id: string) { setSelected(id); const element = buttons.current.get(id); element?.focus(); element?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  function toggle(id: string) { setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  /** 扁平 DOM 避免深递归；ARIA 层级仍保留真实父子关系。 */
  function navigate(event: KeyboardEvent, node: ExplainNode) {
    const index = visible.findIndex(item => item.id === node.id);
    let target: string | undefined;
    switch (event.key) {
      case 'ArrowDown': target = visible[Math.min(index + 1, visible.length - 1)]?.id; break;
      case 'ArrowUp': target = visible[Math.max(0, index - 1)]?.id; break;
      case 'Home': target = visible[0]?.id; break;
      case 'End': target = visible.at(-1)?.id; break;
      case 'ArrowRight': if (children.has(node.id)) { if (collapsed.has(node.id)) toggle(node.id); else target = visible[index + 1]?.id; } break;
      case 'ArrowLeft': if (children.has(node.id) && !collapsed.has(node.id)) toggle(node.id); else target = node.parent; break;
      case 'Enter': case ' ': setSelected(node.id); break;
      default: return;
    }
    event.preventDefault(); if (target) focus(target);
  }
  return <section className="explain-view" aria-label={t.title}>
    <div className="explain-toolbar" role="group" aria-label={t.title}>
      {(['tree', 'raw', 'table'] as const).map(mode => <button key={mode} aria-pressed={view === mode} onClick={() => setView(mode)}>{t[mode]}</button>)}
      <button disabled={busy} onClick={onText}>{t.text}</button>
      <span className="muted">{t.source}：{plan.dialect === 'mysql' ? 'MySQL' : 'MariaDB'} {plan.version} · {plan.format === 'json' ? 'EXPLAIN FORMAT=JSON' : 'EXPLAIN'}</span>
    </div>
    <p className="explain-hint">{t.estimates}</p>
    {plan.warnings.map((warning, index) => <p className="explain-warning" role="status" key={index}>{warning}</p>)}
    <div className="explain-content">
      {view === 'tree' && (plan.nodes.length ? <div className="explain-layout">
        <div className="explain-tree-pane">
          <div className="explain-actions"><button onClick={() => setCollapsed(new Set())}>{t.expand}</button><button onClick={() => { setCollapsed(new Set(children)); setSelected(plan.nodes[0].id); }}>{t.collapse}</button></div>
          <p className="explain-hint">{t.keyboard}</p>
          <div role="tree" aria-label={t.tree} className="explain-tree">
            {visible.map(node => <button key={node.id} ref={element => { if (element) buttons.current.set(node.id, element); else buttons.current.delete(node.id); }} role="treeitem" aria-level={node.depth + 1} aria-expanded={children.has(node.id) ? !collapsed.has(node.id) : undefined} aria-selected={selected === node.id} tabIndex={selected === node.id ? 0 : -1} className="explain-node" style={{ paddingLeft: 10 + Math.min(node.depth, 10) * 14 }} onFocus={() => setSelected(node.id)} onClick={() => setSelected(node.id)} onDoubleClick={() => { if (children.has(node.id)) toggle(node.id); }} onKeyDown={event => navigate(event, node)}>
              <span className="explain-node-title"><span aria-hidden="true" onClick={event => { if (children.has(node.id)) { event.stopPropagation(); setSelected(node.id); toggle(node.id); } }}>{children.has(node.id) ? collapsed.has(node.id) ? '▸' : '▾' : '·'}</span> {nodeTitle(node.kind)}{node.name ? ` · ${node.name}` : ''}{node.unknown && <small>{t.unknown}</small>}</span>
              <span className="explain-node-metrics">{t.access}：{node.access ?? t.unavailable} · {t.rows}：{node.rows?.value ?? t.unavailable} · {t.filtered}：{node.filtered ? node.filtered.value + '%' : t.unavailable}</span>
            </button>)}
          </div>
        </div>
        {current && <div className="explain-detail" aria-label={t.details}>
          <strong>{nodeTitle(current.kind)} {current.name}</strong>
          <dl>{[[t.access, current.access], [t.rows, current.rows?.value, current.rows?.source], [t.produced, current.produced?.value, current.produced?.source], [t.filtered, current.filtered ? current.filtered.value + '%' : undefined, current.filtered?.source], [t.index, current.index]].map(([label, value, source]) => <div key={label}><dt>{label}</dt><dd title={source ?? (!value ? t.missing : undefined)}>{value ?? t.unavailable}{source && <small>{source}</small>}</dd></div>)}</dl>
          <strong>{t.cost}</strong><dl>{current.costs.length ? current.costs.map(cost => <div key={cost.source}><dt>{cost.source}</dt><dd>{cost.value}</dd></div>) : <div><dd>{t.unavailable}</dd></div>}</dl>
          <p className="explain-hint">{t.path}：{current.path || '/'}{current.pathTruncated ? '…' : ''}</p><p className="explain-hint">{t.detailHint}</p><pre tabIndex={0}>{detail}</pre>
        </div>}
      </div> : <p className="explain-empty">{t.empty}</p>)}
      {view === 'raw' && <div className="explain-raw"><pre tabIndex={0} aria-label={t.raw}>{raw ? raw.slice(0, explainLimits.jsonBytes) : t.rawMissing}</pre>{(raw.length > explainLimits.jsonBytes || plan.rawTruncated) && <p>{t.rawLimited}</p>}</div>}
      {view === 'table' && result && <ResultsGrid columns={result.columns} rows={result.rows}/>}
    </div>
  </section>;
}
