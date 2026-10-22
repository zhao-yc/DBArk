import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { QueryOutcome } from '../../shared/contracts';
import { explainLimits, explainNodeDetail, type ExplainNode } from '../../shared/explain';
import { explainZh as t } from '../locales/explain.zh-CN';
import { ResultsGrid } from './ResultsGrid';
import '../explain.css';

/** 方言节点来自服务器，原型同名名称也只能当作普通文本显示。 */
const nodeTitle = (kind: string) => Object.hasOwn(t.kinds, kind) ? t.kinds[kind] : kind;

/** 展示有界的真实计划；所有视图切换都读取已有结果，只有明确的文本按钮会发送请求。 */
export function ExplainPlanView({ outcome, onText, busy }: { outcome: QueryOutcome; onText(): void; busy: boolean }) {
  const owner = useRef({ outcome, plan: outcome.explain, generation: 0 });
  // 父查询保留组件时仍以真实结果对象换代；A→B→A不能复活旧节点和查找闭包。
  if (owner.current.outcome !== outcome || owner.current.plan !== outcome.explain) owner.current = { outcome, plan: outcome.explain, generation: owner.current.generation + 1 };
  return <OwnedExplainPlan key={owner.current.generation} outcome={outcome} onText={onText} busy={busy}/>;
}

/** 交互状态只归属于本轮结果；本地阅读永远不产生新的数据库请求。 */
function OwnedExplainPlan({ outcome, onText, busy }: { outcome: QueryOutcome; onText(): void; busy: boolean }) {
  const plan = outcome.explain!;
  const [view, setView] = useState<'tree' | 'raw' | 'table'>(plan.nodes.length ? 'tree' : plan.format === 'text' ? 'table' : 'raw');
  const [selected, setSelected] = useState(plan.nodes[0]?.id ?? '');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [searchError, setSearchError] = useState(false);
  const [matchIndex, setMatchIndex] = useState(-1);
  const [focusRequest, setFocusRequest] = useState<{ id: string }>();
  const alive = useRef(true);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const children = useMemo(() => new Set(plan.nodes.flatMap(node => node.parent ? [node.parent] : [])), [plan]);
  const visible = useMemo(() => {
    const hidden = new Set<string>();
    return plan.nodes.filter(node => { if (node.parent && (collapsed.has(node.parent) || hidden.has(node.parent))) { hidden.add(node.id); return false; } return true; });
  }, [plan, collapsed]);
  const current = plan.nodes.find(node => node.id === selected) ?? plan.nodes[0];
  const matches = useMemo(() => {
    if (!search) return [];
    const needle = search.toLocaleLowerCase();
    return plan.nodes.filter(node => [node.kind, nodeTitle(node.kind), node.name, node.access, node.index, node.rows?.source, node.rows?.value, node.produced?.source, node.produced?.value, node.filtered?.source, node.filtered ? node.filtered.value + '%' : undefined, ...node.costs.flatMap(cost => [cost.source, cost.value]), ...(node.properties ?? []).flatMap(property => [property.source, property.value, Object.hasOwn(t.propertyLabels, property.source) ? t.propertyLabels[property.source] : undefined])].some(value => value?.toLocaleLowerCase().includes(needle)));
  }, [plan, search]);
  // 等祖先展开后的真实DOM提交，再聚焦滚动；不使用定时器或遗留异步回调。
  useLayoutEffect(() => {
    if (!focusRequest || !alive.current) return;
    const element = buttons.current.get(focusRequest.id); element?.focus(); element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focusRequest]);
  const detail = useMemo(() => current?.pathTruncated ? t.longPath : current ? explainNodeDetail(plan.raw, current.path) : '', [plan, current]);
  const first = outcome.results[0], rawCell = first?.rows[0]?.[first.columns[0]?.key];
  const raw = plan.raw || (plan.format === 'json' && typeof rawCell === 'string' ? rawCell : '');
  const result = outcome.results[0];
  /** 选择与焦点一起移动；收起父节点时也把活动项移回可见范围。 */
  function focus(id: string) { if (!alive.current) return; setSelected(id); setFocusRequest({ id }); }
  function toggle(id: string) { if (!alive.current) return; setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  /** 在完整节点集内逐处环绕；只展开目标祖先，保留其他分支的收起状态。 */
  function travel(direction: -1 | 1) {
    if (!alive.current || !matches.length) return;
    const index = matchIndex < 0 ? direction === 1 ? 0 : matches.length - 1 : (matchIndex + direction + matches.length) % matches.length;
    const node = matches[index], ancestors = new Set<string>(); let parent = node.parent;
    while (parent && !ancestors.has(parent)) { ancestors.add(parent); parent = plan.nodes.find(item => item.id === parent)?.parent; }
    setCollapsed(previous => new Set([...previous].filter(id => !ancestors.has(id)))); setView('tree'); setMatchIndex(index); focus(node.id);
  }
  /** 清除搜索不改变所选节点，也不重新读取计划。 */
  function clearSearch() { if (!alive.current) return; setSearch(''); setSearchError(false); setMatchIndex(-1); }
  /** 扁平 DOM 避免深递归；ARIA 层级仍保留真实父子关系。 */
  function navigate(event: KeyboardEvent, node: ExplainNode) {
    if (!alive.current) return;
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
      <button disabled={busy} onClick={() => { if (alive.current && !busy) onText(); }}>{t.text}</button>
      <span className="muted">{t.source}：{plan.dialect === 'mysql' ? 'MySQL' : 'MariaDB'} {plan.version} · {plan.format === 'json' ? 'EXPLAIN FORMAT=JSON' : 'EXPLAIN'}</span>
    </div>
    <div className="explain-search" role="search" aria-label={t.find}>
      <input aria-label={t.find} aria-invalid={searchError || undefined} maxLength={200} placeholder={t.findPlaceholder} value={search} onInput={event => {
        if (!alive.current) return;
        // 原生输入限制之外也校验程序赋值；明确拒绝整次超长输入，不截成另一条关键字。
        if (event.currentTarget.value.length > 200) { event.currentTarget.value = search; setSearchError(true); return; }
        setSearch(event.currentTarget.value); setSearchError(false); setMatchIndex(-1);
      }} onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Escape') { event.preventDefault(); clearSearch(); } else if (event.key === 'Enter') { event.preventDefault(); travel(event.shiftKey ? -1 : 1); } }}/>
      <span role="status" aria-label={t.findCount}>{search ? t.matches(matchIndex < 0 ? 0 : matchIndex + 1, matches.length) : t.findIdle}</span>
      <button disabled={!matches.length} onClick={() => travel(-1)}>{t.previous}</button><button disabled={!matches.length} onClick={() => travel(1)}>{t.next}</button><button disabled={!search} onClick={clearSearch}>{t.clear}</button>
    </div>
    <p className="explain-hint">{t.findHint}</p>
    {searchError && <p className="explain-warning" role="alert">{t.findTooLong}</p>}
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
          <strong>{t.properties}</strong><dl className="explain-properties">{current.properties?.length ? current.properties.map(property => <div key={property.source}><dt>{Object.hasOwn(t.propertyLabels, property.source) ? t.propertyLabels[property.source] : property.source}<small>{property.source}</small></dt><dd>{property.value}{property.truncated && <small className="explain-property-truncated">{t.propertyTruncated}</small>}</dd></div>) : <div><dd>{t.unavailable}</dd></div>}</dl>
          <p className="explain-hint">{t.path}：{current.path || '/'}{current.pathTruncated ? '…' : ''}</p><p className="explain-hint">{t.detailHint}</p><pre tabIndex={0}>{detail}</pre>
        </div>}
      </div> : <p className="explain-empty">{t.empty}</p>)}
      {view === 'raw' && <div className="explain-raw"><pre tabIndex={0} aria-label={t.raw}>{raw ? raw.slice(0, explainLimits.jsonBytes) : t.rawMissing}</pre>{(raw.length > explainLimits.jsonBytes || plan.rawTruncated) && <p>{t.rawLimited}</p>}</div>}
      {view === 'table' && result && <ResultsGrid columns={result.columns} rows={result.rows}/>}
    </div>
  </section>;
}
