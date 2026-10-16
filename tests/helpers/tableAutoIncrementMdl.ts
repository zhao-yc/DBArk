export const tableAutoIncrementMdlState = 'Waiting for table metadata lock';

/** 只统一末尾空白及一个末尾分号，禁止前缀匹配或改写其它语句内容。 */
function mdlSql(value: unknown): string | undefined { return typeof value === 'string' ? value.trimEnd().replace(/;$/u, '').trimEnd() : undefined; }
/** PROCESSLIST线程编号只接受精确正安全整数，不把未知表示转换成本例线程。 */
function threadId(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value))) return;
  const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}
/** 仅返回本例记录、排除observer、完整SQL及明确MDL状态共同匹配的唯一线程。 */
export function tableAutoIncrementMdlThread(rows: readonly Record<string, unknown>[], ids: ReadonlySet<number>, observerId: number | undefined, expectedSql: string): number | undefined {
  if (threadId(observerId) === undefined || !mdlSql(expectedSql)) return;
  const matches = rows.filter(row => { const id = threadId(row.Id); return id !== undefined && id !== observerId && ids.has(id) && row.State === tableAutoIncrementMdlState && mdlSql(row.Info) === mdlSql(expectedSql); });
  return matches.length === 1 ? threadId(matches[0].Id) : undefined;
}
/** 发送事件不能替代等待证明；本任务若已终态或DDL完成，不允许补记为取消前MDL。 */
export function tableAutoIncrementTaskUnfinished(events: readonly { taskId: string; status?: string; tableAutoIncrement?: { ddlCompleted: boolean } }[], taskId: string): boolean {
  return !events.some(event => event.taskId === taskId && (event.tableAutoIncrement?.ddlCompleted === true || ['succeeded', 'failed', 'cancelled'].includes(event.status ?? '')));
}
/** 新增诊断只输出白名单端口/本例任务与线程/状态/观察布尔，不接收SQL或连接凭据。 */
export function tableAutoIncrementMdlProof(port: number, taskId: string, id: number | undefined, observed: boolean) {
  if (![13357, 13380, 13384, 13310, 13311, 13484].includes(port)) throw Error('MDL证据端口不在本片白名单');
  return { 端口: port, 任务ID: taskId, 本例线程ID: id ?? null, 状态: observed ? tableAutoIncrementMdlState : null, 已观察: observed };
}
