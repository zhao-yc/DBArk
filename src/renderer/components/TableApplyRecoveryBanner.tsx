import type { TableApplyRecoveryView } from '../tableApplyRecovery';
import { tableApplyRecoveryZh as text } from '../locales/tableApplyRecovery.zh-CN';
import { tableApplyReceiptZh } from '../locales/tableApplyReceiptZh';
/** 已知提交或未知结果只提供核对与读取，不能从旧草稿重放数据操作。 */
export function TableApplyRecoveryBanner({ view, busy, onRead, onView }: { view: TableApplyRecoveryView; busy: boolean; onRead(): void; onView(): void }) {
  if (!view.locked || view.outcome === 'in-flight') return null;
  return <section className="info-strip warning-text" role="status" aria-label={text.title}><p>{view.outcome === 'committed' ? text.committed : text.unknown}</p>{view.reading && <p>{text.refreshing}</p>}<button disabled={busy || view.reading} onClick={onView}>{tableApplyReceiptZh.openCurrent}</button><button disabled={busy || view.reading} onClick={onRead}>{text.reload}</button></section>;
}
