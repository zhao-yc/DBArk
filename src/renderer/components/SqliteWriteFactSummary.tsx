import type { SqliteWriteFact } from '../../shared/sqliteTableEdit';
import { sqliteWriteFactSchema } from '../../shared/sqliteWriteFact';
import { sqliteWriteFactZh as text } from '../locales/sqliteWriteFact.zh-CN';

/** TaskEvent只是展示通道，只有Main验证过的最小事实可展开，处理数量不冒充提交数量。 */
export function SqliteWriteFactSummary({ fact }: { fact?: SqliteWriteFact }) {
  const parsed = sqliteWriteFactSchema.safeParse(fact); if (!parsed.success) return null;
  const value = parsed.data;
  return <details aria-label={text.title}><summary>{text.phases[value.phase]}</summary><dl><dt>{text.operation}</dt><dd>{value.operationId}</dd><dt>{text.target}</dt><dd>{value.target.connectionId} / {value.target.database} / {value.target.table}</dd><dt>{text.requested}</dt><dd>{value.requestedRows}</dd><dt>{text.processed}</dt><dd>{value.appliedRows}</dd></dl></details>;
}
