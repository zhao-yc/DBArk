export interface ForeignKeysUiOwner { assertCurrent(allowClosed?: boolean): void; closed(): boolean; retain(): void; }
export interface ForeignKeysUiState { active: boolean; pending: number; tasksVerified: boolean; retained: boolean; }
interface Task { kind: string; status: string; }
/** 本地停链标记先写入；共享保留通知本身失败也不能覆盖首因或恢复后续动作。 */
function preserve(owner: ForeignKeysUiOwner, state: ForeignKeysUiState) { state.retained = true; try { owner.retain(); } catch { /* 本地停链仍有效，保留原失败。 */ } }
/** 原观察或控制返回未知，立即保留；超时afterEach可看到未结束的观察，不能抢先退出清库。 */
export async function observeForeignKeysUi<T>(owner: ForeignKeysUiOwner, state: ForeignKeysUiState, action: () => Promise<T>): Promise<T> {
  if (state.retained) throw Error('复合外键验收已停链保留现场');
  try { owner.assertCurrent(); } catch (reason) { preserve(owner, state); throw reason; } state.pending++;
  try { const result = await action(); owner.assertCurrent(); if (state.retained) throw Error('观察等待期间已停链'); return result; }
  catch (reason) { preserve(owner, state); throw reason; }
  finally { state.pending--; }
}
/** 主体finally先核专用任务，afterEach还核主体/观察均已结束；关闭标志不能替代此前任务证明。 */
export async function assertForeignKeysUiSettled(owner: ForeignKeysUiOwner, state: ForeignKeysUiState, readTasks: () => Promise<unknown>, afterEach = false): Promise<void> {
  try {
    owner.assertCurrent(true);
    if (state.retained) throw Error('复合外键验收已停链保留现场');
    if (state.pending || afterEach && state.active) throw Error('复合外键验收主体或观察尚未终态，保留现场');
    if (owner.closed()) { if (!state.tasksVerified) throw Error('复合外键验收缺少关闭前任务证明'); return; }
    const tasks = await observeForeignKeysUi(owner, state, readTasks);
    if (!Array.isArray(tasks) || tasks.some((task: Task) => !task || typeof task.kind !== 'string' || typeof task.status !== 'string' || (task.kind.startsWith('schema.tableCreate.') || task.kind.startsWith('schema.databaseCreate.')) && (task.kind.endsWith('.apply') ? task.status !== 'completed' : !['completed', 'failed', 'cancelled'].includes(task.status)))) throw Error('新建表或建库任务未确认终态，保留现场');
    state.tasksVerified = true;
  } catch (reason) { preserve(owner, state); throw reason; }
}
