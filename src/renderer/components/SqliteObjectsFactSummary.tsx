import { sqliteObjectsFactSchema } from '../../shared/sqliteObjects';
import { sqliteObjectsFactZh as text } from '../locales/sqliteObjectsFact.zh-CN';

/** 对象定义计数不是提交数，只有真实ACK才显示已提交或已回滚。 */
export function SqliteObjectsFactSummary({fact}:{fact?:unknown}) { const parsed=sqliteObjectsFactSchema.safeParse(fact);if(!parsed.success)return null;const value=parsed.data;return <details aria-label={text.title}><summary>{text.phases[value.phase]}</summary><dl><dt>{text.operation}</dt><dd>{value.operationId}</dd><dt>{text.target}</dt><dd>{value.target.connectionId} / {value.target.database} / {value.target.name}</dd><dt>{text.kind}</dt><dd>{text.kinds[value.target.kind]}</dd><dt>{text.action}</dt><dd>{text.actions[value.action]}</dd><dt>{text.requested}</dt><dd>{value.requestedStatements}</dd><dt>{text.completed}</dt><dd>{value.completedStatements}</dd></dl></details>; }
