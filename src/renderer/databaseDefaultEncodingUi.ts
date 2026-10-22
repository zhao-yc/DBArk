import type { DatabaseDefaultEncodingProgress, DatabaseDefaultEncodingTarget } from '../shared/databaseDefaultEncoding';
import { databaseDefaultEncodingAcknowledgements } from '../shared/databaseDefaultEncoding';
import { databaseDefaultEncodingZh as text } from './locales/databaseDefaultEncoding.zh-CN';
export { IndexRequestFence as DatabaseDefaultEncodingRequestFence } from './indexPatches';
export { changeDefaultCharset, defaultEncodingSelectable } from './tableDefaultEncodingUi';
/** 精确数据库目标不用大小写折叠，也不把连接切换前的请求授给新配置。 */
export function sameDatabaseDefaultEncodingTarget(a: DatabaseDefaultEncodingTarget, b: DatabaseDefaultEncodingTarget): boolean { return a.connectionId === b.connectionId && a.database === b.database; }
/** 风险协议值只映射已认识的中文说明。 */
export function databaseDefaultEncodingAckLabel(id: string): string | undefined { return id === 'ddl-implicit-commit' ? text.ackImplicit : id === 'external-ddl-window' ? text.ackWindow : id === 'database-default-only' ? text.ackDefaults : undefined; }
/** 全部确认必须精确覆盖唯一且已知的计划风险。 */
export function databaseDefaultEncodingAcksComplete(required: readonly string[], selected: ReadonlySet<string>): boolean { return required.length === databaseDefaultEncodingAcknowledgements.length && new Set(required).size === required.length && selected.size === required.length && databaseDefaultEncodingAcknowledgements.every(id => required.includes(id) && selected.has(id)); }
/** 失败文本不能证明未执行，仅结构化进度可证明未发送或已完成。 */
export function databaseDefaultEncodingFailure(progress: DatabaseDefaultEncodingProgress | null, attempted: boolean): 'notSent' | 'unknown' | 'succeeded' | 'verificationFailed' { return !attempted ? 'notSent' : progress?.ddlCompleted ? progress.definitionVerified ? 'succeeded' : 'verificationFailed' : progress?.outcome === 'not-sent' && !progress.ddlSubmitted ? 'notSent' : 'unknown'; }
