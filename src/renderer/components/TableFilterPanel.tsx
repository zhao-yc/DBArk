import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Pencil, X } from 'lucide-react';
import type { FilterRule } from '../../shared/contracts';
import { errorMessage } from '../lib';
import { zh, formatText } from '../locales/zh-CN';
import { emptyFilterDraft, filterDraftFromRule, filterOperatorLabels, filterRuleFromDraft, filterRuleSummary, replaceFilterRule, setFilterRuleEnabled, setAllFilterRulesEnabled, type FilterDraft, type FilterMode } from '../tableFilters';
import { ErrorBox, UsageHelp } from './ui';
import { tableCellFilterZh as cellText } from '../locales/tableCellFilter.zh-CN';
import { tableFilterEnabledZh as enabledText } from '../locales/tableFilterEnabled.zh-CN';

interface Props {
  children?:ReactNode;
  seed?: FilterDraft;
  columns: string[]; filters: FilterRule[]; mode: FilterMode; disabled: boolean;
  onFiltersChange: (filters: FilterRule[]) => boolean;
  onModeChange: (mode: FilterMode) => boolean;
}

/** 编辑区只维护待应用条件；父组件确认草稿处理后，才替换已应用规则并重新读取服务器。 */
export function TableFilterPanel({ columns, filters, mode, disabled, onFiltersChange, onModeChange, children, seed }: Props) {
  const [draft, setDraft] = useState(() => seed ? { ...seed } : emptyFilterDraft(columns[0] ?? ''));
  const [editing, setEditing] = useState<number | null>(null); const [error, setError] = useState('');
  const live = useRef<object | null>(null), ticket = {};
  useLayoutEffect(() => { live.current = ticket; return () => { if (live.current === ticket) live.current = null; }; });
  const enabledCount = filters.filter(filter => filter.enabled !== false).length;
  /** 每个动作只接受当前已提交渲染，防止旧编号切换后来移位的条件。 */
  function current(): boolean { return live.current === ticket && !disabled; }
  /** 每次显式带入独立草稿；不调用父层应用、不改变现有规则或数据页。 */
  useEffect(() => { if (seed) { setDraft({ ...seed }); setEditing(null); setError(''); } }, [seed]);
  useEffect(() => { if (!columns.includes(draft.column)) setDraft(current => ({ ...current, column: columns[0] ?? '' })); }, [columns, draft.column]);
  const isSet = draft.operator === 'IN' || draft.operator === 'NOT IN';
  const isRange = draft.operator === 'BETWEEN'; const isNull = draft.operator === 'IS NULL' || draft.operator === 'IS NOT NULL';

  /** 切换条件类型时保留编辑内容，生成规则时仅发送当前运算符需要的值。 */
  function changeDraft(patch: Partial<FilterDraft>) { if (!current()) return; setDraft(current => ({ ...current, ...patch })); setError(''); }
  /** 将现有条件原样载入编辑器，空字符串、精确数值和集合顺序不做转换。 */
  function editCondition(index: number) { if (!current()) return; setEditing(index); setDraft(filterDraftFromRule(filters[index])); setError(''); }
  /** 取消编辑只清理条件编辑器，不修改已经应用的筛选条件或表数据草稿。 */
  function cancelEdit() { setEditing(null); setDraft(emptyFilterDraft(draft.column)); setError(''); }
  /** 先校验参数和总量，再请父组件确认是否放弃当前页草稿；用户取消时保留正在编辑的条件。 */
  function applyCondition() {
    if (!current()) return;
    try {
      const rule = filterRuleFromDraft(draft, columns); const next = replaceFilterRule(filters, rule, editing);
      if (onFiltersChange(next)) cancelEdit();
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 移除条件后调整编辑下标，避免继续编辑时覆盖相邻的另一条规则。 */
  function removeCondition(index: number) {
    if (!current() || !onFiltersChange(filters.filter((_, position) => position !== index))) return;
    if (editing === index) cancelEdit(); else if (editing !== null && editing > index) setEditing(editing - 1);
  }
  /** 启停沿原父层草稿确认；拒绝时强制恢复受控勾选并明确保留现状。 */
  function changeEnabled(index: number | null, enabled: boolean): void {
    if (!current() || index !== null && (filters[index]?.enabled !== false) === enabled || index === null && enabledCount === (enabled ? filters.length : 0)) return;
    try { const next = index === null ? setAllFilterRulesEnabled(filters, enabled) : setFilterRuleEnabled(filters, index, enabled); setError(onFiltersChange(next) ? '' : enabledText.declined); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  return <div className="filter-panel expanded-filter-panel">
    {children}
    {seed && <p className="filter-value-hint">{cellText.staged}</p>}
    <div className="filter-mode-row"><label>{zh.table.filterModeLabel}<select aria-label={zh.table.filterModeLabel} value={mode} disabled={disabled} onChange={event => { if (current()) onModeChange(event.target.value as FilterMode); }}><option value="all">{zh.table.filterModeAll}</option><option value="any">{zh.table.filterModeAny}</option></select></label><button disabled={disabled || !filters.length} onClick={() => { if (current() && onFiltersChange([])) cancelEdit(); }}>{zh.common.clearAll}</button><button aria-label={enabledText.enableAll} title={enabledText.hint} disabled={disabled || enabledCount === filters.length} onClick={() => changeEnabled(null, true)}>{enabledText.enableAllLabel}</button><button aria-label={enabledText.disableAll} title={enabledText.hint} disabled={disabled || enabledCount === 0} onClick={() => changeEnabled(null, false)}>{enabledText.disableAllLabel}</button><span className="muted small" role="status">{enabledText.status(enabledCount, filters.length)}</span></div>
    <form className="filter-rule-form" onSubmit={event => { event.preventDefault(); applyCondition(); }}>
      <div className="filter-inputs"><select aria-label={zh.table.text009} value={draft.column} disabled={disabled} onChange={event => changeDraft({ column: event.target.value })}>{columns.map(column => <option key={column}>{column}</option>)}</select><select aria-label={zh.table.filterOperatorLabel} value={draft.operator} disabled={disabled} onChange={event => changeDraft({ operator: event.target.value as FilterRule['operator'] })}>{Object.entries(filterOperatorLabels).map(([operator, label]) => <option key={operator} value={operator}>{label}</option>)}</select>
        {!isSet && !isRange && !isNull && <input aria-label={zh.table.text011} value={draft.value} disabled={disabled} onChange={event => changeDraft({ value: event.target.value })} placeholder={zh.table.text012}/>}
        {isRange && <><input aria-label={zh.table.filterRangeStart} value={draft.value} disabled={disabled} onChange={event => changeDraft({ value: event.target.value })} placeholder={zh.table.filterRangeStart}/><input aria-label={zh.table.filterRangeEnd} value={draft.upperValue} disabled={disabled} onChange={event => changeDraft({ upperValue: event.target.value })} placeholder={zh.table.filterRangeEnd}/></>}
        <button type="submit" disabled={disabled || !columns.length}>{editing === null ? zh.table.text013 : zh.table.filterSaveCondition}</button>{editing !== null && <button type="button" disabled={disabled} onClick={cancelEdit}>{zh.table.filterCancelEdit}</button>}
      </div>
      {isSet && <div className="filter-set-editor"><textarea rows={3} aria-label={zh.table.filterSetValues} value={draft.valuesText} disabled={disabled} onChange={event => changeDraft({ valuesText: event.target.value })}/><label className="check"><input type="checkbox" checked={draft.includeEmptyString} disabled={disabled} onChange={event => changeDraft({ includeEmptyString: event.target.checked })}/>{zh.table.filterIncludeEmptyString}</label></div>}
      <UsageHelp><p>{isNull ? zh.table.filterNullHint : isRange ? zh.table.filterRangeHint : isSet ? zh.table.filterSetHint : zh.table.filterScalarHint}</p></UsageHelp>
    </form>
    <ErrorBox message={error}/>
    {filters.length > 0 && <div className="filter-chips editable-filter-chips">{filters.map((filter, index) => <div className={`filter-chip ${editing === index ? 'editing' : ''} ${filter.enabled === false ? 'condition-disabled' : ''}`} key={index}><label className="filter-chip-enabled" title={enabledText.hint}><input type="checkbox" aria-label={enabledText.enabled(index + 1)} checked={filter.enabled !== false} disabled={disabled} onChange={event => changeEnabled(index, event.target.checked)}/><span>{filter.enabled === false ? enabledText.disabledLabel : enabledText.enabledLabel}</span></label><button type="button" className="filter-chip-edit" aria-label={formatText(zh.table.filterEditCondition, index + 1)} title={filterRuleSummary(filter)} disabled={disabled} onClick={() => editCondition(index)}><Pencil size={10}/><span>{filterRuleSummary(filter)}</span></button><button type="button" className="filter-chip-remove" aria-label={formatText(zh.table.filterRemoveCondition, index + 1)} disabled={disabled} onClick={() => removeCondition(index)}><X size={11}/></button></div>)}</div>}
  </div>;
}
