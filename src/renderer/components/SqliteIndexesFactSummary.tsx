import { sqliteIndexesFactSchema } from '../../shared/sqliteIndexes';
import { sqliteIndexesZh as text } from '../locales/sqliteIndexes.zh-CN';

/** 只展示严格最小索引事务事实；处理DDL条数不代表提交，ACK和未知阶段使用统一准确文案。 */
export function SqliteIndexesFactSummary({ fact }: { fact?: unknown }) {
  const parsed = sqliteIndexesFactSchema.safeParse(fact); if (!parsed.success) return null;
  const value = parsed.data;
  return <details aria-label={text.factTitle}><summary>{text.phases[value.phase]}</summary><dl><dt>{text.factOperation}</dt><dd>{value.operationId}</dd><dt>{text.factTarget}</dt><dd>{value.target.connectionId} / {value.target.database} / {value.target.table}</dd><dt>{text.factRequested}</dt><dd>{value.requestedStatements}</dd><dt>{text.factCompleted}</dt><dd>{value.completedStatements}</dd></dl></details>;
}
