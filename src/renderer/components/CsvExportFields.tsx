import type { CsvExportFieldState, CsvExportContext, CsvExportFieldsController } from '../csvExportFields';
/** CSV表导出选列与顺序预览；这里只操作草稿，不调用实际导出或加载行数据。 */
export function CsvExportFields({ context, state, controller, busy }: { context: CsvExportContext; state: CsvExportFieldState; controller: CsvExportFieldsController; busy: boolean }) {
  const ready = controller.ready(context), loading = state?.status === 'loading';
  return <section aria-label="CSV导出字段"><h3>CSV导出字段与顺序</h3><p className="muted small">{context.database}.{context.table}；只投影所选字段。重新读取会重置选择，未勾选字段不会写入文件。</p>
    <button disabled={busy || loading} onClick={() => void controller.prepare(context)}>重新读取CSV字段目录</button>
    {loading && <p role="status">正在读取CSV实际字段目录</p>}{state?.status === 'failed' && <p role="alert" className="error-box">{state.error}</p>}
    {!ready && !loading && state?.status !== 'failed' && <p className="warning-text">{busy && state?.status === 'consumed' ? 'CSV字段目录已绑定本次任务，正在等待终态。' : 'CSV字段目录未知、已使用或已过期，请重新读取后导出。'}</p>}
    {ready && <><div className="check-row">{ready.catalog.columns.map(column => <label className="check" key={column.name}><input type="checkbox" disabled={busy} checked={ready.selected.includes(column.name)} onChange={event => controller.select(context, column.name, event.target.checked)}/>{column.name} · {column.type}</label>)}</div>
      <h4>CSV字段顺序预览</h4>{!ready.selected.length && <p className="warning-text">至少选择一个实际字段，不能导出空投影。</p>}
      <ol aria-label="CSV字段顺序预览">{ready.selected.map((name, position) => <li key={name}><span>{name}</span> <button aria-label={`上移CSV字段 ${name}`} disabled={busy || position === 0} onClick={() => controller.move(context, name, -1)}>上移</button> <button aria-label={`下移CSV字段 ${name}`} disabled={busy || position === ready.selected.length - 1} onClick={() => controller.move(context, name, 1)}>下移</button></li>)}</ol></>}
  </section>;
}
