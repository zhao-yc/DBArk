import type { QueryFailure } from '../../shared/queryFailure';
import { queryPartialOutcomeZh as text } from '../locales/queryPartialOutcome.zh-CN';
import { queryFailureSourceZh as sourceText } from '../locales/queryFailureSource.zh-CN';

/** 仅展示可信执行序号与完整结果数，失败原消息由原ErrorBox显示，不回显源SQL。 */
export function QueryPartialOutcomeNotice({ failure, completedResults, onLocate, locateAvailable = false }: { failure: QueryFailure; completedResults: number; onLocate?(): void; locateAvailable?: boolean }) {
  return <section className="query-partial-outcome warning-text" role="status" aria-label={text.title}><strong>{text.title}</strong><p>{text.position(failure.statementOrdinal, failure.statementsCompleted)}</p><p>{completedResults ? text.retained(completedResults) : text.empty}</p><p>{text.warning}</p><button disabled={!locateAvailable || !onLocate} title={locateAvailable ? sourceText.available : sourceText.unavailable} onClick={onLocate}>{sourceText.locate}</button>{!locateAvailable && <p className="muted small">{sourceText.unavailable}</p>}</section>;
}
