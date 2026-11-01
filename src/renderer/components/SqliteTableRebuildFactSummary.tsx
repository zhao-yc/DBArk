import { sqliteTableRebuildFactSchema } from '../../shared/sqliteTableRebuild';
import { sqliteTableRebuildFactZh as text } from '../locales/sqliteTableRebuildFact.zh-CN';

/** 三个行数始终按原十进制字符串显示；复制或核验完成不冒充 COMMIT。 */
export function SqliteTableRebuildFactSummary({ fact }: { fact?: unknown }) {
  const parsed = sqliteTableRebuildFactSchema.safeParse(fact); if (!parsed.success) return null; const value = parsed.data;
  return <details aria-label={text.title}><summary>{text.phases[value.phase]}</summary><dl><dt>{text.operation}</dt><dd>{value.operationId}</dd><dt>{text.target}</dt><dd>{value.target.connectionId} / {value.target.database} / {value.target.table}</dd><dt>{text.requested}</dt><dd>{value.requestedStatements}</dd><dt>{text.completed}</dt><dd>{value.completedStatements}</dd><dt>{text.sourceRows}</dt><dd>{value.sourceRows}</dd><dt>{text.copiedRows}</dt><dd>{value.copiedRows}</dd><dt>{text.verifiedRows}</dt><dd>{value.verifiedRows}</dd></dl></details>;
}
