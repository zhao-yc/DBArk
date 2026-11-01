import { sqliteTableMaintenanceFactSchema } from '../../shared/sqliteTableMaintenance';
import { sqliteTableMaintenanceFactZh as text } from '../locales/sqliteTableMaintenanceFact.zh-CN';

/** 精确展示原操作及真实ACK；原表行数不冒充触发器、级联或实际删除数量。 */
export function SqliteTableMaintenanceFactSummary({ fact }: { fact?: unknown }) {
  const parsed = sqliteTableMaintenanceFactSchema.safeParse(fact); if (!parsed.success) return null;
  const value = parsed.data;
  return <details aria-label={text.title}><summary>{text.phases[value.phase]}</summary><dl><dt>{text.operation}</dt><dd>{value.operationId}</dd><dt>{text.target}</dt><dd>{value.target.connectionId} / {value.target.database} / {value.target.table}</dd><dt>{text.action}</dt><dd>{text.actions[value.action]}</dd><dt>{text.requested}</dt><dd>{value.requestedStatements}</dd><dt>{text.completed}</dt><dd>{value.completedStatements}</dd><dt>{text.actualBeforeRows}</dt><dd>{value.actualBeforeRows ?? text.unknownRows}</dd></dl></details>;
}
