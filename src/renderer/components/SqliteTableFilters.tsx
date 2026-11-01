import { useLayoutEffect, useRef } from 'react';
import { sqliteTableBrowseLimits, isSqliteTextFilter } from '../../shared/sqliteTableBrowse';
import type { SqliteFilterDraft } from '../sqliteTableBrowser';
import { sqliteTableBrowseZh as text } from '../locales/sqliteTableBrowse.zh-CN';

interface Props {
  names: readonly string[];
  filters: readonly SqliteFilterDraft[];
  mode: 'and' | 'or';
  disabled: boolean;
  current(): boolean;
  id(): string;
  onFilters(update: (values: SqliteFilterDraft[]) => SqliteFilterDraft[]): void;
  onMode(mode: 'and' | 'or'): void;
}

/** 筛选只编辑父级表单；停用保留类型、原值和位置，由原“应用”入口校验并读取。 */
export function SqliteTableFilters(props: Props) {
  const { names, filters, mode, disabled } = props, ticket = {}, live = useRef<object | null>(null);
  useLayoutEffect(() => { live.current = ticket; return () => { if (live.current === ticket) live.current = null; }; }, [ticket]);
  /** 已卸载、旧渲染、忙态及目标变化后的控件不能改写后继表单。 */
  function current(): boolean { try { return live.current === ticket && !disabled && props.current(); } catch { return false; } }
  /** 使用函数式更新合并同一帧内的输入；编辑停用条件不会隐式重新启用。 */
  function update(id: string, patch: Partial<SqliteFilterDraft>): void {
    if (current()) props.onFilters(values => values.map(value => value.id === id ? { ...value, ...patch } : value));
  }
  /** 列表按当前草稿函数式编辑；至少保留一项，首项同步单值，不自动启用或读取。 */
  function updateList(id: string, change: (values: string[]) => string[]): void {
    if (!current()) return;
    props.onFilters(values => values.map(value => {
      if (value.id !== id) return value;
      const next = change([...(value.values ?? [value.value])]);
      return !next.length || next.length > sqliteTableBrowseLimits.listValues ? value : { ...value, values: next, value: next[0] };
    }));
  }
  /** 全部启停仅设置标记，不删除条件或发送数据库请求。 */
  function toggleAll(enabled: boolean): void {
    if (current()) props.onFilters(values => values.map(value => ({ ...value, enabled })));
  }
  /** 新条件仍缺省启用，函数式数量检查阻止同帧添加突破原上限。 */
  function add(): void {
    if (!current() || !names.length) return;
    props.onFilters(values => values.length >= sqliteTableBrowseLimits.filters ? values : [...values, { id: props.id(), column: names[0], operator: 'eq', kind: 'text', value: '' }]);
  }
  const enabled = filters.filter(filter => filter.enabled !== false).length;
  return <fieldset aria-label={text.filters} disabled={disabled}>
    <legend>{text.filters}</legend>
    <select aria-label={text.mode} value={mode} onChange={event => { if (current()) props.onMode(event.target.value as 'and' | 'or'); }}><option value="and">AND</option><option value="or">OR</option></select>
    <button disabled={!names.length || filters.length >= sqliteTableBrowseLimits.filters} onClick={add}>{text.addFilter}</button>
    <button disabled={enabled === filters.length} onClick={() => toggleAll(true)}>{text.enableFilters}</button>
    <button disabled={!enabled} onClick={() => toggleAll(false)}>{text.disableFilters}</button>
    <span className="muted small" role="status">{text.enabledFilters(enabled, filters.length)}</span>
    <p className="muted small">{text.filterEnabledHint}</p>
    {filters.some(filter => isSqliteTextFilter(filter.operator)) && <p className="muted small">{text.textMatchHint}</p>}
    {!!filters.length && !enabled && <p className="muted small">{text.noEnabledFilters}</p>}
    {filters.map((filter, index) => <div className="sqlite-browse-rule" key={filter.id}>
      <label><input type="checkbox" aria-label={text.filterEnabled(index + 1)} checked={filter.enabled !== false} onChange={event => update(filter.id, { enabled: event.target.checked })}/>{filter.enabled === false ? text.filterDisabledState : text.filterEnabledState}</label>
      <select aria-label={text.filterColumn(index + 1)} value={filter.column} onChange={event => update(filter.id, { column: event.target.value })}>{names.map(name => <option key={name} value={name}>{name}</option>)}</select>
      <select aria-label={text.filterOperator(index + 1)} value={filter.operator} onChange={event => { const operator = event.target.value as SqliteFilterDraft['operator']; update(filter.id, { operator, ...(['in', 'notIn'].includes(operator) && !filter.values ? { values: [filter.value] } : {}), ...(isSqliteTextFilter(operator) ? { kind: 'text' as const } : {}) }); }}>{Object.entries(text.operators).map(([operator, label]) => <option key={operator} value={operator}>{label}</option>)}</select>
      {!['isNull', 'notNull'].includes(filter.operator) && <>
        <select aria-label={text.filterKind(index + 1)} value={filter.kind} onChange={event => update(filter.id, { kind: event.target.value as SqliteFilterDraft['kind'] })}>{Object.entries(text.kinds).map(([kind, label]) => <option key={kind} value={kind} disabled={isSqliteTextFilter(filter.operator) && kind !== 'text' || kind === 'blob' && !['eq', 'ne', 'in', 'notIn'].includes(filter.operator)}>{label}</option>)}</select>
        {['in', 'notIn'].includes(filter.operator) ? <div className="sqlite-browse-list"><p className="muted small">{text.listHint}</p>{(filter.values ?? [filter.value]).map((value, position, values) => <div className="sqlite-browse-list-value" key={position}>
          <span>{position + 1}</span><input aria-label={position === 0 ? text.filterValue(index + 1) : text.listValue(index + 1, position + 1)} value={value} maxLength={sqliteTableBrowseLimits.valueUnits} onChange={event => { const next = event.target.value; updateList(filter.id, values => values.map((before, at) => at === position ? next : before)); }}/>
          <button aria-label={text.removeListValue(index + 1, position + 1)} disabled={values.length <= 1} onClick={() => updateList(filter.id, values => values.filter((_, at) => at !== position))}>×</button>
        </div>)}<button disabled={(filter.values?.length ?? 1) >= sqliteTableBrowseLimits.listValues} onClick={() => updateList(filter.id, values => [...values, ''])}>{text.addListValue(index + 1)}</button></div> : <input aria-label={text.filterValue(index + 1)} placeholder={['between', 'notBetween'].includes(filter.operator) ? text.rangeStart : undefined} value={filter.value} maxLength={sqliteTableBrowseLimits.valueUnits} onChange={event => update(filter.id, { value: event.target.value })}/>}
        {['between', 'notBetween'].includes(filter.operator) && <input aria-label={text.filterSecondValue(index + 1)} placeholder={text.rangeEnd} value={filter.secondValue ?? ''} maxLength={sqliteTableBrowseLimits.valueUnits} onChange={event => update(filter.id, { secondValue: event.target.value })}/>}
      </>}
      <button aria-label={text.removeFilter(index + 1)} onClick={() => { if (current()) props.onFilters(values => values.filter(value => value.id !== filter.id)); }}>×</button>
    </div>)}
  </fieldset>;
}
