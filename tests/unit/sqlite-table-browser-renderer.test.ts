import { describe, expect, it, vi } from 'vitest';
import type { SqliteTablePage, SqliteTablePageInput } from '../../src/shared/sqliteTableBrowse';
import { sqliteTableBrowseLimits } from '../../src/shared/sqliteTableBrowse';
import { SqliteTableBrowser, sqliteTableDraft, type SqliteTableScope, type SqliteTableQuery, type SqliteTableView, type SqliteFilterDraft } from '../../src/renderer/sqliteTableBrowser';

const query = (): SqliteTableQuery => ({ limit: 10, mode: 'and', filters: [], sort: [] });
/** 每个原读取与取消确认分别控制终态，不以固定超时或取消 ACK 冒充原任务已结束。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function result(input: SqliteTablePageInput, marker = 1): SqliteTablePage { return { schemaKey: 'a'.repeat(64), target: { connectionId: input.connectionId, database: 'main', table: input.table, kind: 'table' }, columns: [{ name: 'id', declaredType: 'INTEGER' }], offset: input.offset, limit: input.limit, hasMore: true, result: { columns: [{ key: 'c0', name: 'id', type: 'SQLITE' }], rows: [{ c0: marker }], elapsedMs: 1, statement: '只读分页合成语句', truncated: false } }; }
function fixture() {
  const tab = {}, profile = {}, scope: SqliteTableScope = { tab, profile, connectionId: 'sqlite', database: 'main', table: '真实表', version: 0, present: true, active: true, sqlite: true }, listeners = new Set<() => void>(), states: SqliteTableView[] = [];
  const reads: Array<{ input: SqliteTablePageInput; pending: ReturnType<typeof deferred<SqliteTablePage>> }> = [], cancels: Array<{ id: string; pending: ReturnType<typeof deferred<void>> }> = [];
  let sequence = 0, owner = 0, busy = false, releases = 0;
  const acquire = vi.fn(() => { if (busy) throw Error('其他作业仍在占用'); busy = true; const lease = ++owner; const owns = () => busy && owner === lease; return { owns, release() { if (!owns()) return false; busy = false; releases++; return true; } }; });
  const controller = new SqliteTableBrowser({ scope: () => scope, acquire, read: input => { const pending = deferred<SqliteTablePage>(); reads.push({ input, pending }); return pending.promise; }, cancel: id => { const pending = deferred<void>(); cancels.push({ id, pending }); return pending.promise; }, id: () => 'read-' + ++sequence, changed: view => states.push(view), subscribe: changed => { listeners.add(changed); return () => listeners.delete(changed); } });
  controller.activate();
  return { controller, scope, states, reads, cancels, acquire, get busy() { return busy; }, get releases() { return releases; }, view: () => states.at(-1)!, emit() { [...listeners].forEach(listener => listener()); }, otherJob() { owner++; busy = true; [...listeners].forEach(listener => listener()); } };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

describe('SQLite 只读表浏览的明确条件与服务端分页', () => {
  it('文本2和整数2保留不同绑定类型；NULL完全省略值，64位整数和十六进制不经Number转换', () => {
    const filters: SqliteFilterDraft[] = [
      { id: '1', column: 'mixed', operator: 'eq', kind: 'text', value: '2' }, { id: '2', column: 'mixed', operator: 'eq', kind: 'integer', value: '2' },
      { id: '3', column: 'nullable', operator: 'isNull', kind: 'text', value: '不提交的旧值' }, { id: '4', column: 'payload', operator: 'eq', kind: 'blob', value: '00ff42' }, { id: '5', column: 'exact_int', operator: 'gte', kind: 'integer', value: '9223372036854775807' },
    ];
    const draft = sqliteTableDraft({ connectionId: 'c', database: 'main', table: '表' }, 10, 'or', filters, [{ id: 's1', column: 'rank', direction: 'desc' }, { id: 's2', column: 'id', direction: 'asc' }]);
    expect(draft.mode).toBe('or'); expect(draft.filters[0].value).toEqual({ kind: 'text', value: '2' }); expect(draft.filters[1].value).toEqual({ kind: 'integer', value: '2' }); expect(draft.filters[2]).toEqual({ column: 'nullable', operator: 'isNull' }); expect(draft.filters[3].value).toEqual({ kind: 'blob', value: '00ff42' }); expect(draft.filters[4].value?.value).toBe('9223372036854775807'); expect(draft.sort).toEqual([{ column: 'rank', direction: 'desc' }, { column: 'id', direction: 'asc' }]);
  });
  it('错误类型、超限条件、重复排序和非法分页均在读取及busy占用前拒绝', async () => {
    const filter: SqliteFilterDraft = { id: 'f', column: 'id', operator: 'eq', kind: 'integer', value: '9223372036854775808' }, target = { connectionId: 'c', database: 'main', table: '表' };
    expect(() => sqliteTableDraft(target, 10, 'and', [filter], [])).toThrow(); expect(() => sqliteTableDraft(target, 10, 'and', [{ ...filter, kind: 'blob', value: '0', operator: 'eq' }], [])).toThrow(); expect(() => sqliteTableDraft(target, 10, 'and', Array(33).fill({ ...filter, kind: 'text', value: '' }), [])).toThrow(); expect(() => sqliteTableDraft(target, 10, 'and', [], [{ id: 'a', column: 'id', direction: 'asc' }, { id: 'b', column: 'id', direction: 'desc' }])).toThrow();
    const f = fixture(); await f.controller.load({ ...query(), limit: sqliteTableBrowseLimits.pageSize + 1 }, 0); await f.controller.load(query(), sqliteTableBrowseLimits.offset + 1); expect(f.reads).toHaveLength(0); expect(f.acquire).not.toHaveBeenCalled(); expect(f.busy).toBe(false); f.controller.dispose();
  });
  it('初次读取只传有界分页，原值与动态类型原样显示；下一页不请求COUNT或查询会话', async () => {
    const f = fixture(), pending = f.controller.load(query(), 0); expect(f.reads).toHaveLength(1); expect(f.reads[0].input).toMatchObject({ offset: 0, limit: 10, filters: [], sort: [], database: 'main' });
    const page = result(f.reads[0].input); page.result.rows = [{ c0: '9223372036854775807' }]; f.reads[0].pending.resolve(page); await pending; expect(f.view().page).toBe(page); expect(f.controller.pageCurrent(page)).toBe(true); expect(page.result.columns[0].type).toBe('SQLITE'); expect(page.result.rows[0].c0).toBe('9223372036854775807'); expect(f.releases).toBe(1); f.controller.dispose();
  });
});

describe('SQLite 原表请求串行与准确生命周期', () => {
  it('取消ACK先到仍等原读取终态，旧结果不交付后才开始新页', async () => {
    const f = fixture(), first = f.controller.load(query(), 0), second = f.controller.load(query(), 10); expect(f.cancels.map(value => value.id)).toEqual(['read-1']); f.cancels[0].pending.resolve(); await flush(); expect(f.reads).toHaveLength(1); expect(f.busy).toBe(true); expect(f.releases).toBe(0);
    f.reads[0].pending.resolve(result(f.reads[0].input, 1)); await first; await flush(); expect(f.reads).toHaveLength(2); expect(f.view().page).toBeUndefined(); f.reads[1].pending.resolve(result(f.reads[1].input, 2)); await second; expect(f.view().page?.result.rows).toEqual([{ c0: 2 }]); expect(f.view().page?.offset).toBe(10); expect(f.acquire).toHaveBeenCalledTimes(2); f.controller.dispose();
  });
  it('连续三次意图只发送原读取及最新读取，不能取消别人的task', async () => {
    const f = fixture(), first = f.controller.load(query(), 0), middle = f.controller.load(query(), 10), latest = f.controller.load(query(), 20); expect(f.cancels).toHaveLength(1); expect(f.cancels[0].id).toBe(f.reads[0].input.taskId); f.cancels[0].pending.resolve(); f.reads[0].pending.resolve(result(f.reads[0].input)); await first; await middle; await flush(); expect(f.reads.map(value => value.input.offset)).toEqual([0, 20]); f.reads[1].pending.resolve(result(f.reads[1].input, 3)); await latest; expect(f.view().page?.result.rows).toEqual([{ c0: 3 }]); f.controller.dispose();
  });
  it('取消失败也不能提前释放占用或启动下一次读取', async () => {
    const f = fixture(), first = f.controller.load(query(), 0), second = f.controller.load(query(), 10); f.cancels[0].pending.reject(Error('取消传输失败')); await flush(); expect(f.reads).toHaveLength(1); expect(f.busy).toBe(true); f.reads[0].pending.reject(Error('原读取已真实结束')); await first; await flush(); expect(f.reads).toHaveLength(2); f.reads[1].pending.resolve(result(f.reads[1].input)); await second; expect(f.busy).toBe(false); f.controller.dispose();
  });
  it.each(['version', 'profile', 'tab', 'active', 'present'] as const)('%s变化再恢复原值也不能复活旧页', async field => {
    const f = fixture(), original = f.scope[field], pending = f.controller.load(query(), 0);
    Object.assign(f.scope, { [field]: field === 'version' ? 1 : field === 'active' || field === 'present' ? false : {} }); f.emit(); Object.assign(f.scope, { [field]: original }); f.emit(); expect(f.cancels).toHaveLength(1); f.cancels[0].pending.resolve(); f.reads[0].pending.resolve(result(f.reads[0].input)); await pending; expect(f.view().page).toBeUndefined(); expect(f.busy).toBe(false);
    // 原意图失效后只能通过新的明确读取恢复；ABA 返回原值不会自动重放旧任务。
    expect(f.reads).toHaveLength(1); const retry = f.controller.load(query(), 0); expect(f.reads).toHaveLength(2); f.reads[1].pending.resolve(result(f.reads[1].input, 2)); await retry; expect(f.view().page?.result.rows).toEqual([{ c0: 2 }]); expect(f.busy).toBe(false); f.controller.dispose();
  });
  it('其他作业接管busy后旧finally不清理其占用', async () => {
    const f = fixture(), pending = f.controller.load(query(), 0); f.otherJob(); expect(f.cancels[0].id).toBe('read-1'); f.cancels[0].pending.resolve(); f.reads[0].pending.resolve(result(f.reads[0].input)); await pending; expect(f.busy).toBe(true); expect(f.releases).toBe(0); expect(f.view().page).toBeUndefined(); f.controller.dispose();
  });
  it('停止和卸载仅取消原任务，真实终态前均不释放busy或显示晚回页', async () => {
    for (const dispose of [false, true]) {
      const f = fixture(), pending = f.controller.load(query(), 0), stopping = dispose ? (f.controller.dispose(), Promise.resolve()) : f.controller.stop(); f.cancels[0].pending.resolve(); await flush(); expect(f.busy).toBe(true); expect(f.releases).toBe(0); const writes = f.states.length; f.reads[0].pending.resolve(result(f.reads[0].input)); await pending; await stopping; expect(f.busy).toBe(false); expect(f.releases).toBe(1); if (dispose) expect(f.states).toHaveLength(writes); else expect(f.view().page).toBeUndefined(); f.controller.dispose();
    }
  });
  it('错目标和错页回包不能交付，失败保留可重试状态', async () => {
    const f = fixture(), pending = f.controller.load(query(), 0), page = result(f.reads[0].input); page.target.table = '其他表'; f.reads[0].pending.resolve(page); await pending; expect(f.view().page).toBeUndefined(); expect(f.view().error).toContain('不匹配'); expect(f.busy).toBe(false); f.controller.dispose();
  });
});
