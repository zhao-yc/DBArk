import { useEffect, useId, useRef, useState } from 'react';
import type { SchemaCompareDifference, SchemaCompareResult } from '../../shared/schemaCompare';
import { schemaCompareZh as labels } from '../locales/schemaCompare.zh-CN';
import { schemaCompareResultsZh as text } from '../locales/schemaCompareResults.zh-CN';
import { defaultSchemaCompareResultsFilter, projectSchemaCompareResults, schemaCompareResultsId, type SchemaCompareResultsFilter, type SchemaCompareResultsSelection } from '../schemaCompareResults';
import '../schemaCompareResults.css';

export interface SchemaCompareResultsProps {
  report: SchemaCompareResult;
  selectedIds: readonly string[];
  disabled: boolean;
  onSelectionChange(event: SchemaCompareResultsSelection): void;
}

/** 原定义仅在用户展开时挂载，React 按文本转义，NULL 字面值不会与缺失定义混淆。 */
function Definitions({ row }: { row: SchemaCompareDifference }) {
  const [expanded, setExpanded] = useState(false), id = useId();
  return <><button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? text.collapse : text.expand}</button>
    {expanded && <div id={id} className="schema-compare-result-definitions" role="group" aria-label={`${text.definitions} ${row.name}`}>
      <section><strong>{labels.sourceDefinition}</strong><pre>{row.source?.rawSql ?? labels.absent}</pre></section>
      <section><strong>{labels.targetDefinition}</strong><pre>{row.target?.rawSql ?? labels.absent}</pre></section>
    </div>}</>;
}

/** 报告切换时重建筛选及展开状态；选择由父级持有，并随原快照提交增量意图。 */
export function SchemaCompareResults(props: SchemaCompareResultsProps) {
  return <Results key={props.report.snapshotId} {...props}/>;
}

/** 当前渲染绑定同时约束筛选和选择事件，旧报告、旧筛选与卸载后的回调均失效。 */
function Results({ report, selectedIds, disabled, onSelectionChange }: SchemaCompareResultsProps) {
  const [filter, setFilter] = useState<SchemaCompareResultsFilter>(defaultSchemaCompareResultsFilter);
  const live = useRef<object | null>(null), mounted = useRef(true), binding = {};
  live.current = binding;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; live.current = null; }; }, []);
  const current = () => mounted.current && live.current === binding;
  const view = projectSchemaCompareResults(report, filter, selectedIds), selected = new Set(selectedIds);
  /** 所有筛选入口只改显示；晚到的输入不能使用新报告或新筛选的上下文。 */
  function changeFilter(next: SchemaCompareResultsFilter): void { if (current()) setFilter(next); }
  /** 清除携带本次隐藏集合，父级仍需活读当前快照；不会回传整份旧选择覆盖新状态。 */
  function select(event: SchemaCompareResultsSelection): void { if (current() && !disabled) onSelectionChange(event); }
  return <section aria-label={text.filters} className="schema-compare-filter-panel">
    <div className="schema-compare-result-filters">
      <label>{text.category}<select aria-label={text.category} value={filter.category} onChange={event => changeFilter({ ...filter, category: event.currentTarget.value as SchemaCompareResultsFilter['category'] })}>
        <option value="all">{text.allCategories}</option>{Object.entries(labels.categories).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select></label>
      <label>{text.status}<select aria-label={text.status} value={filter.status} onChange={event => changeFilter({ ...filter, status: event.currentTarget.value as SchemaCompareResultsFilter['status'] })}>
        <option value="differences">{text.differences}</option><option value="all">{text.allStatuses}</option>{Object.entries(labels.statuses).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select></label>
      <label>{text.name}<input type="search" aria-label={text.name} title={text.searchHint} value={filter.name} onChange={event => changeFilter({ ...filter, name: event.currentTarget.value })}/></label>
      <button type="button" onClick={() => changeFilter(defaultSchemaCompareResultsFilter)}>{text.reset}</button>
    </div>
    <p role="status" aria-live="polite">{text.count(view.rows.length, view.total)}</p>
    {view.hiddenSelectedIds.length > 0 && <div className="schema-compare-hidden-selection" role="status"><strong>{text.hidden(view.hiddenSelectedIds.length)}</strong><button type="button" disabled={disabled} onClick={() => select({ snapshotId: report.snapshotId, kind: 'clearHidden', ids: view.hiddenSelectedIds })}>{text.clearHidden}</button></div>}
    {view.rows.length === 0 ? <p>{view.total ? text.noMatch : text.noRows}</p> : <div className="schema-compare-results"><table><thead><tr><th>{labels.select}</th><th>{labels.category}</th><th>{labels.name}</th><th>{labels.status}</th><th>{labels.properties}</th><th>{labels.detail}</th></tr></thead><tbody>
      {view.rows.map(row => { const id = schemaCompareResultsId(row); return <tr key={id} data-status={row.status}>
        <td><input type="checkbox" aria-label={`${labels.select} ${labels.categories[row.category]} ${row.name}`} disabled={disabled || row.status === 'same' || row.status === 'unknown'} checked={selected.has(id)} onChange={event => select({ snapshotId: report.snapshotId, kind: 'toggle', id, checked: event.currentTarget.checked })}/></td>
        <td>{labels.categories[row.category]}</td><td><code>{JSON.stringify(row.name)}</code></td><td>{labels.statuses[row.status]}</td>
        <td>{row.changedProperties.map(key => labels.propertiesMap[key] ?? key).join('、')}{row.reasons.length > 0 && <ul aria-label={labels.reasons}>{row.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}</td>
        <td><Definitions row={row}/></td>
      </tr>; })}
    </tbody></table></div>}
  </section>;
}
