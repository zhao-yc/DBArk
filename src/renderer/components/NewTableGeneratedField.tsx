import { UsageHelp } from './ui';
import type { TableCreateDraft } from '../../shared/tableCreate';
import { tableCreateGeneratedReferenceColumns } from '../../shared/tableCreateGenerated';
import type { NewTableColumnMode } from '../newTableGeneratedDrafts';
import { tableCreateGeneratedZh as text } from '../locales/tableCreateGenerated.zh-CN';
import '../tableCreateGenerated.css';

/** 候选只来自本草稿之前的普通精确数值列；不构造现表目录权限或能力。 */
export function NewTableGeneratedField({ design, position, disabled, onMode, onExpression }: { design: TableCreateDraft; position: number; disabled: boolean; onMode(mode: NewTableColumnMode): void; onExpression(expression: string): void }) {
  const column = design.columns[position - 1];
  // 输入中的重复/空字段名不能让整张表单崩溃；预览入口仍严格拒绝这份草稿。
  let references: ReturnType<typeof tableCreateGeneratedReferenceColumns> = [], reason = '';
  if (column.generated) try { references = tableCreateGeneratedReferenceColumns(design, position - 1); } catch { reason = text.invalid; }
  return <div className="new-table-generated-field">
    <select aria-label={text.mode(position)} value={column.generated?.storage ?? 'ordinary'} disabled={disabled} onChange={event => { const mode = event.target.value; if (!disabled && (mode === 'ordinary' || mode === 'VIRTUAL' || mode === 'STORED')) onMode(mode); }}>
      <option value="ordinary">{text.ordinary}</option><option value="VIRTUAL">{text.virtual}</option><option value="STORED">{text.stored}</option>
    </select>
    {column.generated && <><textarea aria-label={text.expression(position)} value={column.generated.expression} maxLength={2048} disabled={disabled} rows={3} onChange={event => { if (!disabled) onExpression(event.target.value); }}/>
      <UsageHelp><p>{text.hint}</p><p>{text.planned}</p><p>{text.keys}</p></UsageHelp>
      <div aria-label={text.references(position)}>{reason ? <span className="warning-text">{reason}</span> : references.length ? references.map(value => <code key={value.ordinal}>{value.name}{' '}</code>) : <span>{text.noReferences}</span>}</div></>}
  </div>;
}
