import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { QueryAnalyzeMetric, QueryAnalyzeNode, QueryAnalyzePlan } from '../../shared/queryAnalyze';
import { queryAnalyzeZh as t } from '../locales/queryAnalyze.zh-CN';
import '../queryAnalyze.css';

/** 指标原文独立保留；未知字段也展示服务器名称，不凭名称推测单位或计算总耗时。 */
function metricTitle(metric: QueryAnalyzeMetric): string { return Object.hasOwn(t.metricLabels, metric.source) ? t.metricLabels[metric.source] : metric.source; }
/** 单位只作展示附注，不能把原始十进制字符串转成 JavaScript 数值。 */
function metricValue(metric: QueryAnalyzeMetric): string { return metric.value + (metric.unit ? ` ${t.units[metric.unit]}` : ''); }

/** 新结果即换代，A→B→A不能继承旧计划的所选节点或折叠状态。 */
export function QueryAnalyzeView({ plan }: { plan: QueryAnalyzePlan }) {
  const owner = useRef({ plan, generation: 0 });
  if (owner.current.plan !== plan) owner.current = { plan, generation: owner.current.generation + 1 };
  return <OwnedQueryAnalyzeView key={owner.current.generation} plan={plan}/>;
}

/** 这里只阅读已经返回的分析结果；展开、选择及切换原文都不会执行 SQL 或调用 IPC。 */
function OwnedQueryAnalyzeView({ plan }: { plan: QueryAnalyzePlan }) {
  const [view, setView] = useState<'tree' | 'raw'>(plan.nodes.length ? 'tree' : 'raw');
  const [selected, setSelected] = useState(plan.nodes[0]?.id ?? '');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focusRequest, setFocusRequest] = useState<string>();
  const alive = useRef(true), buttons = useRef(new Map<string, HTMLButtonElement>());
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const children = useMemo(() => new Set(plan.nodes.flatMap(node => node.parent ? [node.parent] : [])), [plan]);
  const visible = useMemo(() => {
    const hidden = new Set<string>();
    return plan.nodes.filter(node => {
      if (node.parent && (collapsed.has(node.parent) || hidden.has(node.parent))) { hidden.add(node.id); return false; }
      return true;
    });
  }, [plan, collapsed]);
  const current = plan.nodes.find(node => node.id === selected) ?? plan.nodes[0];
  useLayoutEffect(() => {
    if (!focusRequest || !alive.current) return;
    const element = buttons.current.get(focusRequest); element?.focus(); element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focusRequest]);

  /** 焦点只在真实可见节点上移动，树的收起状态不影响原计划。 */
  function focus(id: string) { if (alive.current) { setSelected(id); setFocusRequest(id); } }
  /** 折叠后把选择移回父节点，隐藏子节点不保留不可见的键盘活动项。 */
  function toggle(node: QueryAnalyzeNode) {
    if (!alive.current || !children.has(node.id)) return;
    setCollapsed(previous => { const next = new Set(previous); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; });
    focus(node.id);
  }
  /** 扁平 DOM 保留服务器层级，避免深递归并实现标准树键盘行为。 */
  function navigate(event: KeyboardEvent, node: QueryAnalyzeNode) {
    if (!alive.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const index = visible.findIndex(item => item.id === node.id); let target: string | undefined;
    switch (event.key) {
      case 'ArrowDown': target = visible[Math.min(index + 1, visible.length - 1)]?.id; break;
      case 'ArrowUp': target = visible[Math.max(0, index - 1)]?.id; break;
      case 'Home': target = visible[0]?.id; break;
      case 'End': target = visible.at(-1)?.id; break;
      case 'ArrowRight': if (children.has(node.id)) { if (collapsed.has(node.id)) toggle(node); else target = visible[index + 1]?.id; } break;
      case 'ArrowLeft': if (children.has(node.id) && !collapsed.has(node.id)) toggle(node); else target = node.parent; break;
      case 'Enter': case ' ': setSelected(node.id); break;
      default: return;
    }
    event.preventDefault(); if (target) focus(target);
  }
  return <section className="query-analyze-view" aria-label={t.view}>
    <div className="query-analyze-toolbar" role="group" aria-label={t.view}>
      <button aria-pressed={view === 'tree'} onClick={() => { if (alive.current) setView('tree'); }}>{t.tree}</button><button aria-pressed={view === 'raw'} onClick={() => { if (alive.current) setView('raw'); }}>{t.raw}</button>
      <span className="muted">{t.source}：{plan.dialect === 'mysql' ? 'MySQL' : 'MariaDB'} {plan.version} · {plan.format === 'tree' ? 'EXPLAIN ANALYZE' : 'ANALYZE FORMAT=JSON'}</span>
    </div>
    <div className="query-analyze-hints"><p>{plan.dialect === 'mysql' ? t.mysqlHint : t.mariaHint}</p><p>{t.estimateHint}</p><p>{t.relationHint}</p>{plan.rawTruncated && <p className="query-analyze-warning" role="alert">{t.truncated}</p>}{plan.warnings.map((warning, index) => <p className="query-analyze-warning" role="status" key={index}>{warning}</p>)}</div>
    <div className="query-analyze-content">
      {view === 'raw' ? <pre className="query-analyze-raw" aria-label={t.raw} tabIndex={0}>{plan.raw || t.rawMissing}</pre> : !plan.nodes.length ? <p className="query-analyze-empty">{t.empty}</p> : <div className="query-analyze-layout">
        <div className="query-analyze-tree-pane"><div className="query-analyze-actions"><button onClick={() => { if (alive.current) setCollapsed(new Set()); }}>{t.expand}</button><button onClick={() => { if (alive.current) { setCollapsed(new Set(children)); focus(plan.nodes[0].id); } }}>{t.collapse}</button></div><p className="muted small">{t.keyboard}</p>
          <div role="tree" aria-label={t.tree} className="query-analyze-tree">{visible.map(node => <button key={node.id} data-node-id={node.id} ref={element => { if (element) buttons.current.set(node.id, element); else buttons.current.delete(node.id); }} role="treeitem" aria-level={node.depth + 1} aria-expanded={children.has(node.id) ? !collapsed.has(node.id) : undefined} aria-selected={selected === node.id} tabIndex={selected === node.id ? 0 : -1} className="query-analyze-node" style={{ paddingLeft: 10 + Math.min(node.depth, 10) * 14 }} onFocus={() => { if (alive.current) setSelected(node.id); }} onClick={() => { if (alive.current) setSelected(node.id); }} onDoubleClick={() => toggle(node)} onKeyDown={event => navigate(event, node)}>
            <span className="query-analyze-node-title"><span aria-hidden="true">{children.has(node.id) ? collapsed.has(node.id) ? '▸' : '▾' : '·'}</span> {node.label}{node.neverExecuted && <small>{t.neverExecuted}</small>}</span>
            <span className="query-analyze-node-metrics">{node.metrics.filter(metric => metric.kind === 'actual').slice(0, 3).map(metric => `${metricTitle(metric)}：${metricValue(metric)}`).join(' · ') || (node.neverExecuted ? t.neverExecuted : t.unavailable)}</span>
          </button>)}</div>
        </div>
        {current && <section className="query-analyze-detail" aria-label={t.details}><strong>{current.label}</strong>{current.neverExecuted && <p>{t.neverExecuted}</p>}{(['actual', 'estimate'] as const).map(kind => <div key={kind}><h3>{t[kind]}</h3><dl>{current.metrics.filter(metric => metric.kind === kind).length ? current.metrics.filter(metric => metric.kind === kind).map((metric, index) => <div key={metric.source + index}><dt>{metricTitle(metric)}<small>{metric.source}</small></dt><dd>{metricValue(metric)}</dd></div>) : <div><dd>{t.unavailable}</dd></div>}</dl></div>)}{current.path !== undefined && <p className="muted small">{t.path}：{current.path || '/'}{current.pathTruncated && <span className="query-analyze-warning"> · {t.pathTruncated}</span>}</p>}</section>}
      </div>}
    </div>
  </section>;
}
