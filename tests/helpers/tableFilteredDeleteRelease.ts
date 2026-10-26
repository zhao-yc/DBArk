import type { TaskEvent } from '../../src/shared/contracts';
import { assertTableValueOptionsReleased, type TableValueOptionsConnectionFact } from './tableValueOptionsIntegration';

/** I_S事务缓存距最后一次读取超过100ms才刷新；留200ms避免本观察器自激，非空结果仍按原期限继续核验。 */
export async function waitTableFilteredDeleteTransactionObservation(check:()=>void,wait:(milliseconds:number)=>Promise<void>=milliseconds=>new Promise<void>(resolve=>setTimeout(resolve,milliseconds))):Promise<void>{
  check();await wait(200);check();
}

type Fact = TableValueOptionsConnectionFact;
type Command = Fact['commands'][number];
export interface TableFilteredDeleteCancelPhysicalProof {
  scope: 'table.filteredDelete.apply:cancel_wait';
  taskId: string;
  data: Fact;
  deletion: Command;
  deleteSql: string;
  lockWaitRows: readonly unknown[];
  cancelTaskId: string;
  cancelCompleted: boolean;
  cancelFailure: unknown;
  terminalEvent: TaskEvent | undefined;
  rpcTaskId: string;
  rpcCompleted: boolean;
  rpcError: unknown;
}
export interface TableFilteredDeleteCancelReleaseProof extends TableFilteredDeleteCancelPhysicalProof {
  processRows: readonly unknown[];
  transactionRows: readonly unknown[];
}
export interface TableFilteredDeleteCancelPhysicalReceipt {
  barrier: 'rpc-cancel-physical-close';
  scope: 'table.filteredDelete.apply:cancel_wait';
  taskId: string;
  rpcTaskId: string;
  cancelTaskId: string;
  dataThreadId: number;
  controlThreadId: number;
  deleteCommandIndex: number;
  deleteSql: string;
  killSql: string;
  commitCommands: 0;
  originalPending: number;
  originalDeleteCallback: boolean;
  originalDeleteEnd: boolean;
  processAndTransactionDisappearanceProven: false;
}
export interface TableFilteredDeleteReleaseReceipt {
  completion: 'driver-end' | 'physical-close';
  normalEnd: boolean;
  physicalClose: boolean;
  originalPending: number;
  dataThreadId?: number;
  deleteCommandIndex?: number;
  originalDeleteCallback?: boolean;
  originalDeleteEnd?: boolean;
}
const fail = (): never => { throw Error('全部筛选行取消缺少准确原命令或物理关闭证明，保留现场'); };

/** 仅证明原RPC、原取消及同一物理关闭，可据此释放fixture读锁；不接收或证明服务器线程/事务已消失。 */
export function assertTableFilteredDeleteCancelPhysical(facts: readonly Fact[], strict: boolean, proof: TableFilteredDeleteCancelPhysicalProof): TableFilteredDeleteCancelPhysicalReceipt {
  const data = proof.data, deletion = proof.deletion, index = data.commands.indexOf(deletion);
  if (!strict || proof.scope !== 'table.filteredDelete.apply:cancel_wait' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(proof.taskId) || data.scope !== proof.scope || facts.length !== 2 || facts.filter(fact => fact === data).length !== 1 || index < 0) fail();
  if (proof.rpcCompleted !== true || proof.rpcTaskId !== proof.taskId || !(proof.rpcError instanceof Error)) fail();
  if (proof.cancelCompleted !== true || proof.cancelTaskId !== proof.taskId || proof.cancelFailure !== undefined) fail();
  const waiting = proof.lockWaitRows;
  if (!Array.isArray(waiting) || waiting.length !== 1 || !waiting[0] || typeof waiting[0] !== 'object' || Reflect.ownKeys(waiting[0]).length !== 2 || !Object.hasOwn(waiting[0], 'id') || !Object.hasOwn(waiting[0], 'state')) fail();
  const lock = waiting[0] as { id: unknown; state: unknown };
  if (!['number', 'string'].includes(typeof lock.id) || String(lock.id) !== String(data.id) || lock.state !== 'LOCK WAIT') fail();
  const terminal = proof.terminalEvent, state = terminal?.tableFilteredDelete;
  if (!terminal || terminal.taskId !== proof.taskId || !['cancelled', 'failed'].includes(terminal.status) || !state || state.outcome !== 'unknown' || state.dmlMayHaveBeenSent !== true || state.commitMayHaveBeenSent !== false || state.commitAcknowledged !== false || state.rollbackAcknowledged !== false) fail();
  if (!Number.isSafeInteger(data.id) || data.id < 1 || data.managed.connection !== (data.native as unknown) || data.native.stream !== data.stream || data.native.threadId !== data.id || data.strict !== true || data.closeCalls !== 1 || !data.closeReturned || data.closeFailed || !data.sawClose || data.stream.closed !== true) fail();
  if (deletion.sql !== proof.deleteSql || !proof.deleteSql.startsWith('DELETE FROM ') || deletion.method !== 'execute' || deletion.streamed !== false || typeof deletion.callbackReturned !== 'boolean' || typeof deletion.terminal !== 'boolean' || data.commands.filter(command => command.sql === proof.deleteSql).length !== 1 || data.commands.filter(command => command.method === 'execute' && /^DELETE\b/i.test(command.sql)).length !== 1 || data.commands.some(command => command.sql === 'COMMIT' || /^KILL\b/i.test(command.sql))) fail();
  const where = proof.deleteSql.indexOf(' WHERE '); if (where <= 'DELETE FROM '.length || proof.deleteSql.endsWith(' WHERE 0')) fail();
  const zeroDelete = proof.deleteSql.slice(0, where) + ' WHERE 0';
  if (facts.some(fact => fact.commands.some(command => /^COMMIT\b/i.test(command.sql))) || data.commands.filter(command => /^DELETE\b/i.test(command.sql) && command !== deletion).some(command => command.sql !== zeroDelete || command.method !== 'query') || data.commands.filter(command => command.sql === zeroDelete).length > 1) fail();
  if (data.commands.some(command => command !== deletion && (!command.callbackReturned || !command.terminal))) fail();
  const controls = facts.filter(fact => fact !== data), control = controls[0];
  if (!control || control.scope !== proof.scope || control.id === data.id || control.native === data.native || control.stream === data.stream || control.managed === data.managed) fail();
  const kills = control.commands.filter(command => /^KILL\b/i.test(command.sql));
  if (control.commands.length !== 1 || kills.length !== 1 || kills[0].sql !== 'KILL CONNECTION ' + data.id || kills[0].method !== 'query' || kills[0].streamed !== false || !kills[0].callbackReturned || !kills[0].terminal) fail();
  // 控制连接及data上的其它命令仍必须通过原callback+end/strictclose门。
  assertTableValueOptionsReleased(controls, true);
  // Runtime允许同一socket物理关闭先于callback/end；原watch只在两者均完成时将pending减为0，不能补造任一事实。
  if (deletion.callbackReturned && deletion.terminal) {
    assertTableValueOptionsReleased([data], true);
  } else if (data.pending !== 1) fail();
  return { barrier: 'rpc-cancel-physical-close', scope: proof.scope, taskId: proof.taskId, rpcTaskId: proof.rpcTaskId, cancelTaskId: proof.cancelTaskId, dataThreadId: data.id, controlThreadId: control.id, deleteCommandIndex: index, deleteSql: proof.deleteSql, killSql: kills[0].sql, commitCommands: 0, originalPending: data.pending, originalDeleteCallback: deletion.callbackReturned, originalDeleteEnd: deletion.terminal, processAndTransactionDisappearanceProven: false };
}

/** 完整释放仍须原observer真实查明线程及事务消失；物理屏障不能替代该证明。 */
export function assertTableFilteredDeleteReleased(facts: readonly Fact[], strict: boolean, proof?: TableFilteredDeleteCancelReleaseProof): TableFilteredDeleteReleaseReceipt {
  if (!proof) {
    assertTableValueOptionsReleased(facts, strict);
    return { completion: 'driver-end', normalEnd: true, physicalClose: false, originalPending: 0 };
  }
  const physical = assertTableFilteredDeleteCancelPhysical(facts, strict, proof);
  if (!Array.isArray(proof.processRows) || proof.processRows.length !== 0 || !Array.isArray(proof.transactionRows) || proof.transactionRows.length !== 0) fail();
  const normalEnd = physical.originalDeleteCallback && physical.originalDeleteEnd;
  return { completion: normalEnd ? 'driver-end' : 'physical-close', normalEnd, physicalClose: !normalEnd, originalPending: physical.originalPending, dataThreadId: physical.dataThreadId, deleteCommandIndex: proof.data.commands.indexOf(proof.deletion), originalDeleteCallback: physical.originalDeleteCallback, originalDeleteEnd: physical.originalDeleteEnd };
}
