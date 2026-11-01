import { sqliteTableRenameFactSchema } from '../../shared/sqliteTableRename';
import { sqliteTableRenameFactZh as text } from '../locales/sqliteTableRenameFact.zh-CN';

/** 严格展示最小表重命名事务事实；处理DDL条数不代表提交，只有真实ACK才能确定终态。 */
export function SqliteTableRenameFactSummary({ fact }: { fact?: unknown }) {
  const parsed = sqliteTableRenameFactSchema.safeParse(fact); if (!parsed.success) return null;
  const value = parsed.data;
  return <details aria-label={text.title}><summary>{text.phases[value.phase]}</summary><dl><dt>{text.operation}</dt><dd>{value.operationId}</dd><dt>{text.target}</dt><dd>{value.target.connectionId} / {value.target.database} / {value.target.table}</dd><dt>{text.requested}</dt><dd>{value.requestedStatements}</dd><dt>{text.completed}</dt><dd>{value.completedStatements}</dd></dl></details>;
}