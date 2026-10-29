import { useState } from 'react';
import type { QueryOutcome } from '../../shared/contracts';
import { queryWarningsZh as t } from '../locales/queryWarnings.zh-CN';
import { UsageHelp, Empty, Field, Modal  } from './ui';

/** 警告报告只阅读已取得的快照；不提供当前会话重读或重新执行入口。 */
export function QueryWarningsDialog({ report, onClose }: { report: NonNullable<QueryOutcome['warnings']>; onClose(): void }) {
  const [selected, setSelected] = useState(() => Math.max(0, report.statements.findIndex(statement => statement.conditions.length || statement.unavailable)));
  const statements = report.statements.slice(0, 200), statement = statements[selected];
  /** UI另设展示预算，纯文本保留服务端内容，截断时不拆UTF16代理对。 */
  function bounded(value: string): string { const limit = 4096; if (value.length <= limit) return value; const end = /[\ud800-\udbff]/u.test(value[limit - 1]) && /[\udc00-\udfff]/u.test(value[limit]) ? limit - 1 : limit; return value.slice(0, end) + `［${t.messageTruncated}］`; }
  return <Modal title={t.title} wide onClose={onClose}>
    <div className="modal-content" style={{ minHeight: 0, overflow: 'auto', maxHeight: 'calc(100vh - 180px)', overflowWrap: 'anywhere' }}>
      <UsageHelp><p>{t.snapshot}</p></UsageHelp><p>{t.statements(statements.length)}</p>
      {report.truncated && <p className="warning-text" role="status">{t.truncated}</p>}{report.omittedStatements > 0 && <p className="warning-text">{t.omitted(report.omittedStatements)}</p>}
      {!!statements.length && <Field label={t.statement}><select aria-label={t.statement} value={String(selected)} style={{ maxWidth: '100%' }} onChange={event => setSelected(Number(event.target.value))}>{statements.map((entry, index) => <option key={`${entry.statementOrdinal}:${index}`} value={String(index)}>{t.ordinal(entry.statementOrdinal)} · {entry.status === 'completed' ? t.completed : t.failed} · {t.total} {entry.warningCount === undefined ? t.unknown : String(entry.warningCount)} · {t.collected} {entry.conditions.length}</option>)}</select></Field>}
      {statement && <section aria-label={t.ordinal(statement.statementOrdinal)}>
        <h3>{t.ordinal(statement.statementOrdinal)} · {statement.status === 'completed' ? t.completed : t.failed}</h3>
        <p>{t.total}：<span aria-label={t.total}>{statement.warningCount === undefined ? t.unknown : String(statement.warningCount)}</span> · {t.collected}：<span aria-label={t.collected}>{statement.conditions.length}</span></p>
        {statement.truncated && <p className="warning-text" role="status">{t.statementTruncated}</p>}{statement.unavailable && <p className="warning-text">{t.unavailable}：{bounded(statement.unavailable)}</p>}
        {statement.conditions.length ? <div style={{ overflowX: 'auto' }}><table aria-label={t.fields} style={{ width: '100%', tableLayout: 'fixed' }}><thead><tr><th style={{ width: 88 }}>{t.level}</th><th style={{ width: 80 }}>{t.code}</th><th>{t.message}</th></tr></thead><tbody>{statement.conditions.slice(0, 100).map((condition, index) => <tr key={index}><td>{bounded(condition.level)}</td><td>{String(condition.code)}</td><td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{condition.messageHidden ? <span>{t.hidden}</span> : condition.message === undefined ? t.messageUnavailable : bounded(condition.message)}{condition.messageTruncated && <strong className="warning-text"> · {t.messageTruncated}</strong>}</td></tr>)}</tbody></table></div> : <Empty title={t.empty}/>}
      </section>}
      {!statements.length && <Empty title={t.empty}/>}
    </div><footer className="modal-footer"><span className="grow"/><button onClick={onClose}>{t.close}</button></footer>
  </Modal>;
}
