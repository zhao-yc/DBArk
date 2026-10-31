import { sqliteTableCreateFactSchema, type SqliteTableCreateFact } from '../../shared/sqliteTableCreate';
import { sqliteTableCreateZh as text } from '../locales/sqliteTableCreate.zh-CN';

/** 只展示严格最小事务事实；DDL语句数量不能冒充数据行数或提交确认。 */
export function SqliteTableCreateFactSummary({ fact }: { fact?: SqliteTableCreateFact }) {
  const parsed = sqliteTableCreateFactSchema.safeParse(fact); if (!parsed.success) return null;
  const value = parsed.data;
  return <details aria-label={text.factTitle}><summary>{text.factPhases[value.phase]}</summary><dl><dt>{text.factOperation}</dt><dd>{value.operationId}</dd><dt>{text.factTarget}</dt><dd>{value.target.connectionId} / {value.target.database} / {value.target.table}</dd><dt>{text.factRequested}</dt><dd>{value.requestedStatements}</dd><dt>{text.factCompleted}</dt><dd>{value.completedStatements}</dd></dl><p>{text.factHint}</p></details>;
}
