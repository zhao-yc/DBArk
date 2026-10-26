import type { QueryOutcome } from '../../shared/contracts';
import type { QueryFailure } from '../../shared/queryFailure';
import { queryContinueOnErrorZh as t } from '../locales/queryContinueOnError.zh-CN';

/** 仅确认原模板的UTF16半开范围，不搜索SQL文字，不复制或插值参数模板。 */
export function confirmedQueryContinueRange(source: string, failure: QueryFailure): boolean {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(failure, 'sourceRange');
    if (!descriptor || !('value' in descriptor) || !descriptor.value || typeof descriptor.value !== 'object' || Reflect.ownKeys(descriptor.value).length !== 2) return false;
    const start = Object.getOwnPropertyDescriptor(descriptor.value, 'start'), end = Object.getOwnPropertyDescriptor(descriptor.value, 'end');
    if (!start || !end || !('value' in start) || !('value' in end)) return false;
    const from = start.value, to = end.value;
    /** 不允许在代理对中间定位，否则Monaco选区将偏离原语句。 */
    const boundary = (offset: unknown): offset is number => Number.isSafeInteger(offset) && (offset as number) >= 0 && (offset as number) <= source.length && !((offset as number) > 0 && (offset as number) < source.length && /[\ud800-\udbff]/u.test(source[(offset as number) - 1]) && /[\udc00-\udfff]/u.test(source[offset as number]));
    return boundary(from) && boundary(to) && from < to;
  } catch { return false; }
}

/** 展示固定统计与有界错误，不把消息解释为HTML，也不触发查询或自动定位。 */
export function QueryContinueOnErrorNotice({ report, completedResults, locateAvailable, onLocate }: {
  report: NonNullable<QueryOutcome['scriptReport']>; completedResults: number;
  locateAvailable?(failure: QueryFailure): boolean; onLocate?(failure: QueryFailure): void;
}) {
  /** 展示预算独立于服务端预算，防异常回包造成巨量DOM。 */
  function bounded(value: string): string {
    if (value.length <= 4096) return value;
    const end = /[\ud800-\udbff]/u.test(value[4095]) && /[\udc00-\udfff]/u.test(value[4096]) ? 4095 : 4096;
    return value.slice(0, end) + t.truncated;
  }
  return <section className="query-partial-outcome" role="status" aria-label={t.title} style={{ maxHeight: 'min(320px, 35vh)', overflow: 'auto', overflowWrap: 'anywhere' }}>
    <strong>{t.title}</strong><p>{t.counts(report.statementsAttempted, report.statementsCompleted, report.errors.length)}</p>
    <p>{report.reachedEnd ? t.reachedEnd : t.stopped}</p>{report.stopReason && <p>{t.stopReason}：{bounded(report.stopReason)}</p>}
    <p>{t.results(completedResults)}</p><p className="warning-text">{t.warning}</p>
    {!!report.errors.length && <ol>{report.errors.slice(0, 100).map((failure, index) => {
      const available = !!onLocate && !!locateAvailable?.(failure);
      return <li key={`${failure.statementOrdinal}:${index}`}><strong>{t.error(failure.statementOrdinal)} · {failure.kind === 'server' ? t.server : t.terminal}</strong><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{bounded(failure.message)}</pre><button disabled={!available} title={available ? t.locate(failure.statementOrdinal) : t.unavailable} onClick={() => { if (locateAvailable?.(failure)) onLocate?.(failure); }}>{t.locate(failure.statementOrdinal)}</button></li>;
    })}</ol>}
  </section>;
}
