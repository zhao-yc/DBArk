import { csvExportFieldsZh } from '../locales/csvExportFields.zh-CN';
import type { CsvExportFieldState, CsvExportContext, CsvExportFieldsController } from '../csvExportFields';
/** CSV表导出选列与顺序预览；这里只操作草稿，不调用实际导出或加载行数据。 */
export function CsvExportFields({ context, state, controller, busy }: { context: CsvExportContext; state: CsvExportFieldState; controller: CsvExportFieldsController; busy: boolean }) {
  const ready = controller.ready(context), loading = state?.status === 'loading';
  return <section aria-label={csvExportFieldsZh.regionLabel}><h3>{csvExportFieldsZh.title}</h3><p className="muted small">{context.database}.{context.table}{csvExportFieldsZh.scopeSuffix}</p>
    <button disabled={busy || loading} onClick={() => void controller.prepare(context)}>{csvExportFieldsZh.read}</button>
    {loading && <p role="status">{csvExportFieldsZh.loading}</p>}{state?.status === 'failed' && <p role="alert" className="error-box">{state.error}</p>}
    {!ready && !loading && state?.status !== 'failed' && <p className="warning-text">{busy && state?.status === 'consumed' ? csvExportFieldsZh.consumed : csvExportFieldsZh.unavailable}</p>}
    {ready && <><div className="check-row">{ready.catalog.columns.map(column => <label className="check" key={column.name}><input type="checkbox" disabled={busy} checked={ready.selected.includes(column.name)} onChange={event => controller.select(context, column.name, event.target.checked)}/>{column.name} · {column.type}</label>)}</div>
      <h4>{csvExportFieldsZh.orderTitle}</h4>{!ready.selected.length && <p className="warning-text">{csvExportFieldsZh.empty}</p>}
      <ol aria-label={csvExportFieldsZh.orderTitle}>{ready.selected.map((name, position) => <li key={name}><span>{name}</span> <button aria-label={`${csvExportFieldsZh.moveUpLabel} ${name}`} disabled={busy || position === 0} onClick={() => controller.move(context, name, -1)}>{csvExportFieldsZh.moveUp}</button> <button aria-label={`${csvExportFieldsZh.moveDownLabel} ${name}`} disabled={busy || position === ready.selected.length - 1} onClick={() => controller.move(context, name, 1)}>{csvExportFieldsZh.moveDown}</button></li>)}</ol></>}
  </section>;
}
