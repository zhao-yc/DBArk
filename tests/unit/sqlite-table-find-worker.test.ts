import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteDraftRow } from '../../src/renderer/sqliteTableEditor';
import { runSqliteTableFindInWorker, sqliteFindLimits as limits, sqliteFindMessages as text, type SqliteFindOptions } from '../../src/renderer/sqliteTableFind';
import { SqliteTableFindWorkerClient, sqliteTextReplacementPlanPreview, sqliteTextReplacementPlanValues, type SqliteFindWorkerPort, type SqliteFindReadyResult, type SqliteTextReplacementPlan } from '../../src/renderer/sqliteTableFindWorkerClient';

afterEach(() => vi.useRealTimers());
const options = (patch: Partial<SqliteFindOptions> = {}): SqliteFindOptions => ({ kind: 'text', query: 'a', caseSensitive: true, wholeCell: false, ...patch });
/** RAM端口只验证真实Client握手/计时/终止/能力，算法调用明确不是浏览器CPU线程隔离证据。 */
function fixture(count = 2) {
  const values = Array.from({ length: count }, () => [{ kind: 'text' as const, value: 'aa' }, { kind: 'integer' as const, value: '9223372036854775807' }]);
  const page: SqliteTablePage = { schemaKey: 'owned-schema', target: { connectionId: 'owned', database: 'main', table: 'subject', kind: 'table' }, columns: [{ name: 'text', declaredType: 'TEXT', generated: false }, { name: 'number', declaredType: 'INTEGER', generated: false }], result: { columns: [], rows: values.map(() => ({})), truncated: false, elapsedMs: 0, statement: '' }, offset: 0, limit: 100, hasMore: false, edit: { kind: 'editable', snapshotId: 'owned-snapshot', expiresAt: '2030-01-01T00:00:00Z', columns: [{ name: 'text', declaredType: 'TEXT', generated: false, nullable: true, hasDefault: false }, { name: 'number', declaredType: 'INTEGER', generated: false, nullable: true, hasDefault: false }], rows: structuredClone(values), locator: { kind: 'rowid', columns: [] } } };
  const rows: SqliteDraftRow[] = values.map((values, index) => ({ id: 'row-' + index, index, values, deleted: false }));
  const ports: (SqliteFindWorkerPort & { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>; ready(): void; complete(): void; respond(result: unknown, id?: number): void })[] = [];
  const create = vi.fn(() => {
    const port = { onmessage: null, onerror: null, onmessageerror: null, postMessage: vi.fn(), terminate: vi.fn(async () => { await Promise.resolve(); }), ready() { port.onmessage?.({ data: { type: 'dbark-sqlite-table-find-ready', version: 1 } } as MessageEvent); }, complete() { const posted = port.postMessage.mock.calls.at(-1)?.[0]; port.onmessage?.({ data: { id: posted.id, result: runSqliteTableFindInWorker(posted.request) } } as MessageEvent); }, respond(result: unknown, id?: number) { const posted = port.postMessage.mock.calls.at(-1)?.[0]; port.onmessage?.({ data: { id: id ?? posted?.id, result } } as MessageEvent); } } as SqliteFindWorkerPort & { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>; ready(): void; complete(): void; respond(result: unknown, id?: number): void }; ports.push(port); return port;
  });
  const client = new SqliteTableFindWorkerClient(create);
  /** 仅排空已创建的Promise微任务，不推进真实时钟、不启动额外请求。 */
  const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
  const find = async (query = options()) => { const pending = client.find(page, rows, query); await flush(); const port = ports.at(-1)!; port.ready(); port.complete(); const value = await pending; if (value.status !== 'ready') throw Error(value.message); return value; };
  const preview = async (found: SqliteFindReadyResult, replacement = 'b', only = undefined as SqliteFindReadyResult['occurrences'][number] | undefined) => { const pending = client.preview(found, replacement, only); await flush(); const port = ports.at(-1)!; port.ready(); port.complete(); const value = await pending; if (value.status !== 'ready') throw Error(value.message); return value.plan; };
  return { page, rows, client, ports, create, flush, find, preview };
}

describe('SQLite查找Worker Client与opaque替换计划', () => {
  it('握手前不发原文，每次find/preview独立Worker且terminate完成后才交付冻结结果', async () => {
    const f = fixture(), pending = f.client.find(f.page, f.rows, options()); await f.flush(); const port = f.ports[0]; expect(port.postMessage).not.toHaveBeenCalled(); port.ready(); expect(port.postMessage).toHaveBeenCalledTimes(1); port.complete(); const found = await pending; expect(port.terminate).toHaveBeenCalledTimes(1); expect(found.status).toBe('ready'); if (found.status !== 'ready') throw Error('未查到'); expect(Object.isFrozen(found)).toBe(true); expect(Object.isFrozen(found.matches[0])).toBe(true); const plan = await f.preview(found); expect(f.ports).toHaveLength(2); expect(f.ports[1].terminate).toHaveBeenCalledTimes(1); expect(plan).toEqual({ changedCells: 2, changedRows: 2 });
    expect(sqliteTextReplacementPlanPreview(plan, f.page, f.rows)).toEqual([{ rowId: 'row-0', column: 0, before: 'aa', after: 'bb' }, { rowId: 'row-1', column: 0, before: 'aa', after: 'bb' }]);
  });
  it('完整计数与前10预览分离，Values一次消费且返回独立clone', async () => {
    const f = fixture(12), found = await f.find(), plan = await f.preview(found); const preview = sqliteTextReplacementPlanPreview(plan, f.page, f.rows); expect(preview).toHaveLength(10); preview[0].after = '篡改'; expect(plan.changedCells).toBe(12); const patches = sqliteTextReplacementPlanValues(plan, f.page, f.rows); expect(patches).toHaveLength(12); expect(patches[0].after).toBe('bb'); expect(() => sqliteTextReplacementPlanValues(plan, f.page, f.rows)).toThrow(text.stale); expect(() => sqliteTextReplacementPlanPreview(plan, f.page, f.rows)).toThrow(text.stale);
  });
  it('伪造find、克隆plan、其它Client及伪造单处occurrence都不能签发或消费替换', async () => {
    const f = fixture(), found = await f.find(); expect((await f.client.preview({ ...found }, 'x')).status).toBe('blocked'); const other = new SqliteTableFindWorkerClient(f.create); expect((await other.preview(found, 'x')).status).toBe('blocked'); expect((await f.client.preview(found, 'x', { ...found.occurrences[0] })).status).toBe('blocked'); const plan = await f.preview(found); expect(() => sqliteTextReplacementPlanValues({ ...plan }, f.page, f.rows)).toThrow(text.stale); expect(() => sqliteTextReplacementPlanValues(plan, structuredClone(f.page), f.rows)).toThrow(text.stale); expect(() => sqliteTextReplacementPlanValues(plan, f.page, [...f.rows])).toThrow(text.stale);
  });
  it('单处只替换已确认的准确range；不能从单处偷偷扩大为整格或全部记录', async () => {
    const f = fixture(), found = await f.find(), plan = await f.preview(found, 'x', found.occurrences[1]); expect(sqliteTextReplacementPlanValues(plan, f.page, f.rows)).toEqual([{ rowId: 'row-0', column: 0, before: 'aa', after: 'ax' }]);
  });
  it.each(['schema', 'row', 'values', 'side-cell', 'deleted', 'metadata', 'options'] as const)('原%s变化使原find/plan永久失效，非替换格也不能漏过', async change => {
    const f = fixture(), query = options(), found = await f.find(query), plan = await f.preview(found);
    switch (change) { case 'schema': f.page.schemaKey = 'changed'; break; case 'row': f.rows[0] = { ...f.rows[0] }; break; case 'values': f.rows[0].values = [...f.rows[0].values]; break; case 'side-cell': f.rows[0].values[1] = { kind: 'integer', value: '1' }; break; case 'deleted': f.rows[0].deleted = true; break; case 'metadata': if (f.page.edit?.kind === 'editable') f.page.edit.columns[0].generated = true; break; case 'options': query.query = 'changed'; break; }
    expect(() => sqliteTextReplacementPlanValues(plan, f.page, f.rows)).toThrow(text.stale); if (change === 'schema') { f.page.schemaKey = 'owned-schema'; expect(() => sqliteTextReplacementPlanValues(plan, f.page, f.rows)).toThrow(text.stale); }
  });
  it('取消/销毁即使已有ready结果也永久撤销，后继预览令旧plan失效', async () => {
    const f = fixture(), found = await f.find(), first = await f.preview(found), second = await f.preview(found, 'c'); expect(() => sqliteTextReplacementPlanPreview(first, f.page, f.rows)).toThrow(text.stale); await f.client.cancel(); expect(() => sqliteTextReplacementPlanValues(second, f.page, f.rows)).toThrow(text.stale); expect((await f.client.preview(found, 'x')).status).toBe('blocked'); await f.client.dispose(); const before = f.create.mock.calls.length; expect((await f.client.find(f.page, f.rows, options())).status).toBe('blocked'); expect(f.create).toHaveBeenCalledTimes(before);
  });
  it('readonly页仍可find但不能preview，编辑快照过期后不能靠旧plan暂存', async () => {
    const f = fixture(); f.page.edit = { kind: 'readonly', reason: '只读' }; const found = await f.find(); expect(found.matches.every(match => !match.replaceable)).toBe(true); expect((await f.client.preview(found, 'x')).status).toBe('blocked');
    const g = fixture(), searched = await g.find(), plan = await g.preview(searched); if (g.page.edit?.kind === 'editable') g.page.edit.expiresAt = '2000-01-01T00:00:00Z'; expect(() => sqliteTextReplacementPlanValues(plan, g.page, g.rows)).toThrow(text.stale);
  });
});

describe('SQLite查找硬时限、取消顺序及恶意回包', () => {
  it('1500ms执行和8000ms启动硬门不扩大，超时真实terminate且不交付伪ready', async () => {
    vi.useFakeTimers(); const f = fixture(), waiting = f.client.find(f.page, f.rows, options()); await f.flush(); await vi.advanceTimersByTimeAsync(limits.startupMs - 1); expect(f.ports[0].terminate).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1); expect(await waiting).toMatchObject({ status: 'blocked', reason: 'timeout' }); expect(f.ports[0].terminate).toHaveBeenCalledTimes(1);
    const active = f.client.find(f.page, f.rows, options()); await f.flush(); f.ports[1].ready(); await vi.advanceTimersByTimeAsync(limits.timeoutMs - 1); expect(f.ports[1].terminate).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1); expect(await active).toMatchObject({ status: 'blocked', reason: 'timeout' }); expect(() => new SqliteTableFindWorkerClient(f.create, limits.timeoutMs + 1)).toThrow(); expect(() => new SqliteTableFindWorkerClient(f.create, 0)).toThrow(); expect(() => new SqliteTableFindWorkerClient(f.create, 1, limits.startupMs + 1)).toThrow();
  });
  it('原terminate未完成不resolve或开后继Worker，旧handler/id不能接管新任务', async () => {
    const f = fixture(), first = f.client.find(f.page, f.rows, options()); await f.flush(); const old = f.ports[0], oldHandler = old.onmessage!; old.ready(); let release!: () => void; old.terminate.mockImplementationOnce(() => new Promise<void>(yes => { release = yes; })); const second = f.client.find(f.page, f.rows, options({ query: 'aa' })); await f.flush(); expect(f.create).toHaveBeenCalledTimes(1); oldHandler({ data: { id: 999, result: { status: 'ready', operation: 'find', matches: [] } } } as MessageEvent); release(); expect(await first).toMatchObject({ status: 'blocked', reason: 'cancelled' }); await f.flush(); const next = f.ports[1]; next.ready(); oldHandler({ data: { id: next.postMessage.mock.calls[0][0].id, result: { status: 'ready', operation: 'find', matches: [] } } } as MessageEvent); next.complete(); const result = await second; expect(result.status).toBe('ready'); if (result.status === 'ready') expect(result.matches[0].ranges).toEqual([{ start: 0, end: 2 }]);
  });
  it('错误range、越界字段、generated资格或before/未知patch不能从回包伪造替换', async () => {
    const f = fixture(), pending = f.client.find(f.page, f.rows, options()); await f.flush(); const port = f.ports[0]; port.ready(); port.respond({ status: 'ready', operation: 'find', matches: [{ rowId: 'row-0', column: 0, replaceable: true, ranges: [{ start: 0, end: 999 }] }] }); expect((await pending).status).toBe('blocked');
    const found = await f.find(), preview = f.client.preview(found, 'x'); await f.flush(); const worker = f.ports.at(-1)!; worker.ready(); const request = worker.postMessage.mock.calls[0][0], result = runSqliteTableFindInWorker(request.request); if (result.status !== 'ready' || result.operation !== 'preview') throw Error('夹具回包无效'); worker.respond({ ...result, patches: [{ rowId: 'row-0', column: 1, before: '9223372036854775807', after: 'fake' }] }); expect((await preview).status).toBe('blocked');
  });
  it('原页在运行期间改变时，即使收到原id合法回包也不能授权，terminate失败永久停用Client', async () => {
    const f = fixture(), pending = f.client.find(f.page, f.rows, options()); await f.flush(); f.ports[0].ready(); f.rows[0].values[0] = { kind: 'text', value: 'changed' }; f.ports[0].complete(); expect(await pending).toMatchObject({ status: 'blocked', message: text.stale });
    const g = fixture(), failing = g.client.find(g.page, g.rows, options()); await g.flush(); g.ports[0].terminate.mockRejectedValueOnce(Error('PRIVATE_TERM')); g.ports[0].ready(); g.ports[0].complete(); expect(await failing).toMatchObject({ status: 'blocked', message: text.worker }); const created = g.create.mock.calls.length; expect((await g.client.find(g.page, g.rows, options())).status).toBe('blocked'); expect(g.create).toHaveBeenCalledTimes(created);
  });
});
