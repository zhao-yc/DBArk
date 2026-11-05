import type { TableEditPage } from '../tableEditWorkspace';
import { tableEditWorkspaceZh as text } from '../locales/tableEditWorkspace.zh-CN';
/** 仅显示页号和统计，返回原缓存或明确放弃准确原页，不把行值写入配置。 */
export function TableEditWorkspaceBar({ pages, current, changes, stale, disabled, onSelect, onDiscard }: { pages: readonly TableEditPage[]; current?: TableEditPage; changes: number; stale: boolean; disabled: boolean; onSelect(page: TableEditPage): void; onDiscard(page: TableEditPage): void }) {
  if (pages.length < 2 && !changes && !pages.some(page => page.history.status.undo || page.history.status.redo)) return null;
  return <section className="info-strip" role="region" aria-label={text.region}><p>{text.summary(pages.length, changes)}</p><p className="muted small">{stale ? text.stale : text.hint}</p><div>{pages.map(page => <span key={page.index}><button aria-label={text.page(page.index)} aria-current={page === current ? 'page' : undefined} disabled={disabled || stale || page === current} onClick={() => onSelect(page)}>{page.index}</button><button aria-label={text.discard(page.index)} disabled={disabled} onClick={() => onDiscard(page)}>×</button></span>)}</div></section>;
}
