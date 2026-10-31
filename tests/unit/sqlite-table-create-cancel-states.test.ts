import { expect, it, vi } from 'vitest';
import type { TaskEvent } from '../../src/shared/contracts';
import type { SqliteTableCreateFact } from '../../src/shared/sqliteTableCreate';
import { TaskCancelStates } from '../../src/renderer/taskCancelStates';

/** 手动控制原读取承诺，不运行计时器/GUI或伪造取消成功。 */
function fixture() {
  let listener!: (event: TaskEvent) => void, resolve!: (value: unknown) => void;
  const changed = vi.fn(), read = vi.fn(() => new Promise<unknown>(yes => { resolve = yes; }));
  const controller = new TaskCancelStates({ subscribe: fn => { listener = fn; return () => {}; }, read, changed });
  return { controller, read, changed, resolve: (value: unknown) => resolve(value), event: (value: TaskEvent) => listener(value), state: () => changed.mock.calls.at(-1)![0].get('create') };
}
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
const pending: SqliteTableCreateFact = { operationId: 'original-operation', target: { connectionId: 'c', database: 'main', table: 't' }, phase: 'commit-pending', requestedStatements: 2, completedStatements: 2, commitMayHaveBeenSent: true, commitAcknowledged: false, rollbackAcknowledged: false };
const event = (fact: SqliteTableCreateFact): TaskEvent => ({ taskId: 'create', status: 'running', progress: 0, message: '', sqliteCreateOperation: 'apply', sqliteCreate: fact });

it('SQLite COMMIT事件先到，迟到allowed快照不能恢复取消或再次读取已锁任务', async () => {
  const f = fixture(); f.controller.start(['create']); await settle(); f.event(event(pending)); f.resolve([{ taskId: 'create', state: 'allowed' }]); await settle(); expect(f.state()).toBe('confirming'); expect(f.controller.canCancel('create')).toBe(false); expect(f.read).toHaveBeenCalledOnce(); f.controller.stop();
});
it('原已allowed的旧按钮遇COMMIT/未知后立即锁住，迟到普通事件不重新授权', async () => {
  const f = fixture(), cancel = vi.fn(); f.controller.start(['create']); await settle(); f.resolve([{ taskId: 'create', state: 'allowed' }]); await settle(); expect(f.controller.canCancel('create')).toBe(true); const click = () => { if (f.controller.canCancel('create')) cancel(); };
  f.event(event({ ...pending, phase: 'unknown', commitMayHaveBeenSent: false })); f.event({ taskId: 'create', status: 'running', progress: 0, message: '迟到普通事件' }); click(); await settle(); expect(f.state()).toBe('confirming'); expect(cancel).not.toHaveBeenCalled(); f.controller.stop();
});
it('提交确认后普通failed/allowed也不能恢复取消；新建表之外的普通任务原allowed保持', async () => {
  const f = fixture(); f.controller.start(['create']); await settle(); f.event(event({ ...pending, phase: 'committed', commitAcknowledged: true })); f.event({ taskId: 'create', status: 'failed', progress: 0, message: '迟到失败' }); f.resolve([{ taskId: 'create', state: 'allowed' }]); await settle(); expect(f.controller.canCancel('create')).toBe(false); expect(f.state()).toBe('finished'); f.controller.stop();
  const ordinary = fixture(); ordinary.controller.start(['create']); await settle(); ordinary.resolve([{ taskId: 'create', state: 'allowed' }]); await settle(); expect(ordinary.controller.canCancel('create')).toBe(true); ordinary.controller.stop();
});
