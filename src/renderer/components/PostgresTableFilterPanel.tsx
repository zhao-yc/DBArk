import { useState } from 'react';
import type { FilterGroup, FilterMode, FilterRule } from '../../shared/contracts';
import { postgresAdvancedTableFilterSchema, type PostgresAdvancedTableFilter } from '../../shared/postgresTable';
import { postgresTableZh as text } from '../locales/postgresTable.zh-CN';
import { TableFilterGroupsDialog } from './TableFilterGroupsDialog';
import { TableFilterPanel } from './TableFilterPanel';
import { ErrorBox } from './ui';

/** 条件与分组先在本地编辑，只有应用时才替换表页实际查询范围。 */
export function PostgresTableFilterPanel({ initial, columns, disabled, onApply }: {
  initial?: PostgresAdvancedTableFilter; columns: string[]; disabled: boolean;
  onApply(filter?: PostgresAdvancedTableFilter): void;
}) {
  const [rules, setRules] = useState<FilterRule[]>(initial?.rules ?? []);
  const [mode, setMode] = useState<FilterMode>(initial?.mode ?? 'all');
  const [group, setGroup] = useState<FilterGroup | undefined>(initial?.group);
  const [grouping, setGrouping] = useState(false);
  const [error, setError] = useState('');

  function apply() {
    if (!rules.length) { onApply(); return; }
    const result = postgresAdvancedTableFilterSchema.safeParse({ rules, mode, group });
    if (!result.success) { setError(result.error.issues[0]?.message ?? text.invalidFilter); return; }
    setError('');
    onApply(result.data);
  }

  return <section className="pg-table-filter-panel" aria-label={text.advancedFilter}>
    <TableFilterPanel columns={columns} filters={rules} mode={mode} disabled={disabled || grouping}
      onFiltersChange={next => {
        // 增减条件时旧编号不再有效，恢复平铺，避免将旧分组套到新条件。
        if (next.length !== rules.length) setGroup(undefined);
        setRules(next); setError(''); return true;
      }}
      onModeChange={next => { setMode(next); setGroup(previous => previous && { ...previous, mode: next }); return true; }}/>
    {grouping && <TableFilterGroupsDialog filters={rules} mode={mode} initial={group} isCurrent={() => !disabled}
      onApply={next => { setMode(next.mode); setGroup(next); setGrouping(false); return true; }}
      onClose={() => setGrouping(false)}/>}
    <div className="pg-table-controls">
      <button disabled={disabled || grouping || !rules.length} onClick={() => setGrouping(true)}>{text.filterGroups}</button>
      {group && <span className="muted small">{text.filterGrouped}</span>}
      <button className="primary" disabled={disabled || grouping} onClick={apply}>{text.applyAdvancedFilter}</button>
    </div>
    <ErrorBox message={error}/>
  </section>;
}
