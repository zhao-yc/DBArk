import type { TaskEvent } from '../../src/shared/contracts';
import { assertTableValueOptionsReleased, type TableValueOptionsConnectionFact } from './tableValueOptionsIntegration';

type Fact = TableValueOptionsConnectionFact;
type Command = Fact['commands'][number];
export interface TableFilteredUpdateCancelReleaseProof {
  scope: 'table.filteredUpdate.apply:cancel_wait';
  taskId: string;
  data: Fact;
  update: Command;
  updateSql: string;
  lockWaitRows: readonly unknown[];
  cancelTaskId: string;
  cancelCompleted: boolean;
  cancelFailure: unknown;
  terminalEvent: TaskEvent | undefined;
  processRows: readonly unknown[];
  transactionRows: readonly unknown[];
}
export interface TableFilteredUpdateReleaseReceipt {
  completion: 'driver-end' | 'physical-close';
  normalEnd: boolean;
  physicalClose: boolean;
  originalPending: number;
  dataThreadId?: number;
  updateCommandIndex?: number;
  originalUpdateEnd?: boolean;
}
const fail = (): never => { throw Error('全部筛选行取消缺少准确原命令或物理关闭证明，保留现场'); };

/** 正常路径沿旧严格门；唯一例外须以原KILL、原UPDATE回调及同一物理关闭独立证明，绝不改写原观察事实。 */
export function assertTableFilteredUpdateReleased(facts: readonly Fact[], strict: boolean, proof?: TableFilteredUpdateCancelReleaseProof): TableFilteredUpdateReleaseReceipt {
  if (!proof) {
    assertTableValueOptionsReleased(facts, strict);
    return { completion: 'driver-end', normalEnd: true, physicalClose: false, originalPending: 0 };
  }
  const data = proof.data, update = proof.update, index = data.commands.indexOf(update);
  if (!strict || proof.scope !== 'table.filteredUpdate.apply:cancel_wait' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(proof.taskId) || data.scope !== proof.scope || facts.length !== 2 || facts.filter(fact => fact === data).length !== 1 || index < 0) fail();
  if (proof.cancelCompleted !== true || proof.cancelTaskId !== proof.taskId || proof.cancelFailure !== undefined) fail();
  const waiting = proof.lockWaitRows;
  if (!Array.isArray(waiting) || waiting.length !== 1 || !waiting[0] || typeof waiting[0] !== 'object' || Reflect.ownKeys(waiting[0]).length !== 2 || !Object.hasOwn(waiting[0], 'id') || !Object.hasOwn(waiting[0], 'state')) fail();
  const lock = waiting[0] as { id: unknown; state: unknown };
  if (!['number', 'string'].includes(typeof lock.id) || String(lock.id) !== String(data.id) || lock.state !== 'LOCK WAIT' || !Array.isArray(proof.processRows) || proof.processRows.length !== 0 || !Array.isArray(proof.transactionRows) || proof.transactionRows.length !== 0) fail();
  const terminal = proof.terminalEvent, state = terminal?.tableFilteredUpdate;
  if (!terminal || terminal.taskId !== proof.taskId || !['cancelled', 'failed'].includes(terminal.status) || !state || state.outcome !== 'unknown' || state.dmlMayHaveBeenSent !== true || state.commitMayHaveBeenSent !== false || state.commitAcknowledged !== false || state.rollbackAcknowledged !== false) fail();
  if (!Number.isSafeInteger(data.id) || data.id < 1 || data.managed.connection !== (data.native as unknown) || data.native.stream !== data.stream || data.native.threadId !== data.id || data.strict !== true || data.closeCalls !== 1 || !data.closeReturned || data.closeFailed || !data.sawClose || data.stream.closed !== true) fail();
  if (update.sql !== proof.updateSql || !proof.updateSql.startsWith('UPDATE ') || update.method !== 'execute' || update.streamed !== false || update.callbackReturned !== true || data.commands.filter(command => command.sql === proof.updateSql).length !== 1 || data.commands.filter(command => /^UPDATE\b/i.test(command.sql)).length !== 1 || data.commands.some(command => command.sql === 'COMMIT' || /^KILL\b/i.test(command.sql))) fail();
  if (data.commands.some(command => command !== update && (!command.callbackReturned || !command.terminal))) fail();
  const controls = facts.filter(fact => fact !== data), control = controls[0];
  if (!control || control.scope !== proof.scope || control.id === data.id || control.native === data.native || control.stream === data.stream || control.managed === data.managed) fail();
  const kills = control.commands.filter(command => /^KILL\b/i.test(command.sql));
  if (kills.length !== 1 || kills[0].sql !== 'KILL CONNECTION ' + data.id || kills[0].method !== 'query' || kills[0].streamed !== false || !kills[0].callbackReturned || !kills[0].terminal) fail();
  // 控制连接及data上的其它命令仍必须通过原callback+end/strictclose门。
  assertTableValueOptionsReleased(controls, true);
  if (update.terminal) {
    assertTableValueOptionsReleased([data], true);
    return { completion: 'driver-end', normalEnd: true, physicalClose: false, originalPending: data.pending, dataThreadId: data.id, updateCommandIndex: index, originalUpdateEnd: true };
  }
  if (update.terminal !== false || data.pending !== 1) fail();
  return { completion: 'physical-close', normalEnd: false, physicalClose: true, originalPending: data.pending, dataThreadId: data.id, updateCommandIndex: index, originalUpdateEnd: false };
}
