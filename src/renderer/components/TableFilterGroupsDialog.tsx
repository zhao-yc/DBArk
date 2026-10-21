import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { FilterGroup, FilterMode, FilterRule } from '../../shared/contracts';
import { FILTER_LIMITS, copyFilterRules, validateFilterGroup } from '../../shared/filtering';
import { filterRuleSummary } from '../tableFilters';
import { tableFilterGroupsZh as text } from '../locales/tableFilterGroups.zh-CN';
import { errorMessage } from '../lib';
import { ErrorBox } from './ui';

type Leaf = { kind: 'rule'; id: number; index: number };
type Group = { kind: 'group'; id: number; mode: FilterMode; children: (Leaf | Group)[] };
type EventSignal = { defaultPrevented?: boolean; nativeEvent?: { defaultPrevented?: boolean } };
interface Props {
  filters: readonly FilterRule[]; mode: FilterMode; initial?: FilterGroup;
  isCurrent(): boolean; onApply(group: FilterGroup): boolean; onClose(): void;
}

/** 只重建协议树，不让稳定UI节点编号混入服务器条件或替换现有条件原值。 */
function output(group: Group): FilterGroup {
  return { mode: group.mode, children: group.children.map(child => child.kind === 'group' ? output(child) : child.index) };
}

/** 对指定稳定组做不可变编辑，移位后路径变化不会改变其编辑身份。 */
function editGroup(group: Group, id: number, change: (group: Group) => Group): Group {
  return group.id === id ? change(group) : { ...group, children: group.children.map(child => child.kind === 'group' ? editGroup(child, id, change) : child) };
}

/** 原条件只读快照用于摘要及来源复核，含停用叶，集合及区间不转换或修剪。 */
function sameFilters(current: readonly FilterRule[], expected: readonly FilterRule[]): boolean {
  return current.length === expected.length && current.every((rule, index) => {
    const old = expected[index];
    return rule.column === old.column && rule.operator === old.operator && rule.value === old.value && rule.enabled === old.enabled &&
      (rule.values === undefined ? old.values === undefined : old.values !== undefined && rule.values.length === old.values.length && rule.values.every((value, position) => value === old.values![position]));
  });
}

/** 内联分组审核只组合现有叶，父页确认并重新核原环境后才可能读取服务器。 */
export function TableFilterGroupsDialog({ filters, mode, initial, isCurrent, onApply, onClose }: Props) {
  const sequence = useRef(0), origin = useRef({ filters, mode, initial }).current;
  const [prepared] = useState(() => {
    try {
      const group = validateFilterGroup(filters, mode, initial) ?? { mode, children: filters.map((_, index) => index) };
      /** 初始协议树已完整校验，UI只增添稳定身份，不共享可变children容器。 */
      function copy(value: FilterGroup): Group {
        return { kind: 'group', id: sequence.current++, mode: value.mode, children: value.children.map(child => typeof child === 'number' ? { kind: 'rule', id: sequence.current++, index: child } : copy(child)) };
      }
      return { root: copy(group), filters: copyFilterRules(filters), initialGroup: initial === undefined ? undefined : JSON.stringify(group), error: '' };
    } catch (reason) { return { root: undefined, filters: [] as FilterRule[], initialGroup: undefined, error: errorMessage(reason) }; }
  });
  const [draft, setDraft] = useState(prepared.root), [error, setError] = useState(prepared.error), [composing, setComposing] = useState(false);
  const live = useRef(draft), props = useRef({ filters, mode, initial }); live.current = draft; props.current = { filters, mode, initial };
  const mounted = useRef(true), invalid = useRef(false), consumed = useRef(false), composition = useRef(false), committed = useRef<object | undefined>(undefined);
  const ticket = {};
  useLayoutEffect(() => { mounted.current = true; committed.current = ticket; return () => { if (committed.current === ticket) committed.current = undefined; }; });
  useLayoutEffect(() => () => { mounted.current = false; }, []);

  /** 父级失效及条件漂移是单向撤销，恢复相同值也不能追认旧草稿。 */
  function environment(): boolean {
    if (invalid.current || consumed.current || !mounted.current || !prepared.root) return false;
    try {
      if (origin.filters !== props.current.filters || origin.mode !== props.current.mode || origin.initial !== props.current.initial || !sameFilters(copyFilterRules(filters), prepared.filters) || initial !== undefined && JSON.stringify(validateFilterGroup(filters, mode, initial)) !== prepared.initialGroup || !isCurrent()) throw Error(text.stale);
      return true;
    } catch { invalid.current = true; return false; }
  }

  /** 根身份同步消费，同一事件栈及旧渲染回调不能改写后来草稿。 */
  function current(): boolean { return committed.current === ticket && live.current === draft && !!draft && environment(); }
  /** 草稿允许暂时空组；完整叶覆盖和非空子组只在明确应用时验证。 */
  function replace(next: Group): void {
    if (!current() || composition.current) return;
    live.current = next; setDraft(next); setError('');
  }
  /** 取消可关闭本面板的失效提示，但旧节点/旧渲染或组合输入不能关闭新草稿。 */
  function cancel(event?: EventSignal): void {
    if (event?.defaultPrevented || event?.nativeEvent?.defaultPrevented || committed.current !== ticket || live.current !== draft || !mounted.current || consumed.current || composition.current) return;
    consumed.current = true; onClose();
  }
  /** 只有本次明确提交核完整协议；父页否决时保留草稿及原筛选，不自动读取或关面板。 */
  function apply(event?: EventSignal): void {
    if (event?.defaultPrevented || event?.nativeEvent?.defaultPrevented || !current() || composition.current || !filters.length) return;
    try {
      const group = validateFilterGroup(prepared.filters, draft!.mode, output(draft!))!;
      if (!current()) return;
      consumed.current = true;
      if (!onApply(group)) { consumed.current = false; setError(text.declined); }
    } catch (reason) { consumed.current = false; setError(errorMessage(reason)); }
  }
  /** 移动只改变叶的所属组，保留稳定叶身份及原编号；不接受外部伪造的目标ID。 */
  function moveLeaf(leaf: Leaf, source: Group, destination: string): void {
    if (!current() || composition.current) return;
    const target = groups.find(item => String(item.group.id) === destination)?.group;
    if (!target || !source.children.includes(leaf)) { setError(text.invalidDestination); return; }
    if (target === source) return;
    const removed = editGroup(draft!, source.id, group => ({ ...group, children: group.children.filter(child => child !== leaf) }));
    replace(editGroup(removed, target.id, group => ({ ...group, children: [...group.children, leaf] })));
  }
  /** 解散将原children按原位置提升到父级，不能静默删除停用叶或孙组。 */
  function dissolve(id: number): void {
    if (!current() || composition.current) return;
    function remove(group: Group): Group {
      return { ...group, children: group.children.flatMap(child => child.kind === 'group' ? child.id === id ? child.children : [remove(child)] : [child]) };
    }
    replace(remove(draft!));
  }
  /** 输入法拥有的按键及已消费事件不触发应用/取消，也不会穿透至底层表页。 */
  function keyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.defaultPrevented || event.nativeEvent?.defaultPrevented || event.nativeEvent?.isComposing || event.keyCode === 229 || composition.current || event.repeat) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); apply(); }
    else if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); cancel(); }
  }
  const groups: { group: Group; path: string; depth: number }[] = [];
  /** 路径只是当前显示名称，目标select使用稳定ID；条件编号始终为原filters位置加一。 */
  function collect(group: Group, path = '', depth = 1): void {
    groups.push({ group, path, depth }); let index = 0;
    for (const child of group.children) if (child.kind === 'group') collect(child, path ? `${path}.${++index}` : String(++index), depth + 1);
  }
  if (draft) collect(draft);
  const valid = environment(), disabled = !valid || composing, empty = !filters.length;
  /** 递归呈现仅有界组合控件，摘要沿现有条件摘要函数且明确标记停用。 */
  function render(group: Group, path = '', depth = 1): ReactNode {
    let groupIndex = 0;
    return <><label>{text.groupMode(path)}<select aria-label={text.groupMode(path)} value={group.mode} disabled={disabled || empty} onChange={event => {
      if (event.defaultPrevented || event.nativeEvent?.defaultPrevented || !current()) return;
      if (event.target.value !== 'all' && event.target.value !== 'any') { setError(text.invalidDestination); return; }
      replace(editGroup(draft!, group.id, item => ({ ...item, mode: event.target.value as FilterMode })));
    }}><option value="all">{text.all}</option><option value="any">{text.any}</option></select></label>
      {group.children.map(child => {
        if (child.kind === 'group') {
          const childPath = path ? `${path}.${++groupIndex}` : String(++groupIndex);
          return <fieldset key={child.id} aria-label={text.group(childPath)}><legend>{text.group(childPath)}</legend>{render(child, childPath, depth + 1)}<button type="button" aria-label={text.dissolve(childPath)} disabled={disabled} onClick={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) dissolve(child.id); }}>{text.dissolve(childPath)}</button></fieldset>;
        }
        const rule = prepared.filters[child.index];
        return <div key={child.id} className={rule.enabled === false ? 'filter-chip condition-disabled' : 'filter-chip'}><span>{text.summary(child.index + 1, filterRuleSummary(rule), rule.enabled === false)}</span><label>{text.destination(child.index + 1)}<select aria-label={text.destination(child.index + 1)} value={String(group.id)} disabled={disabled} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) moveLeaf(child, group, event.target.value); }}>{groups.map(item => <option key={item.group.id} value={String(item.group.id)}>{text.group(item.path)}</option>)}</select></label></div>;
      })}
      {!!path && !group.children.length && <p>{text.emptyGroup}</p>}
      <button type="button" aria-label={text.addGroup(path)} disabled={disabled || empty || groups.length >= FILTER_LIMITS.groups || depth >= FILTER_LIMITS.depth} onClick={event => {
        if (event.defaultPrevented || event.nativeEvent?.defaultPrevented) return;
        if (current() && !composition.current && groups.length < FILTER_LIMITS.groups && depth < FILTER_LIMITS.depth) replace(editGroup(draft!, group.id, item => ({ ...item, children: [...item.children, { kind: 'group', id: sequence.current++, mode: 'any', children: [] }] })));
      }}>{text.addGroup(path)}</button></>;
  }
  return <section className="filter-panel expanded-filter-panel" role="region" aria-label={text.title} onKeyDown={keyDown}
    onCompositionStart={() => { if (current()) { composition.current = true; setComposing(true); } }}
    onCompositionEnd={() => { if (current()) { composition.current = false; setComposing(false); } }}>
    <strong>{text.title}</strong><p>{text.hint}</p><p>{text.limits}</p><p>{text.shortcuts}</p>
    {empty && <p>{text.empty}</p>}{draft && render(draft)}{composing && <p>{text.composing}</p>}
    <ErrorBox message={error || (!valid && !consumed.current ? text.stale : '')}/>
    <div className="filter-inputs"><span className="grow"/><button type="button" disabled={composing || consumed.current} onClick={cancel}>{text.cancel}</button><button type="button" className="primary" disabled={disabled || empty} onClick={apply}>{text.apply}</button></div>
  </section>;
}
