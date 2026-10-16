import { describe, expect, it, vi } from 'vitest';
import { CsvExportFieldsController, csvExportContextKey, type CsvExportContext, type CsvExportFieldState } from '../../src/renderer/csvExportFields';
import type { CsvExportFieldsOutput } from '../../src/shared/csvExportFields';
const context: CsvExportContext = { connectionId: 'c', database: 'db', table: 't', version: 1 };
const output = (id = 'catalog'): CsvExportFieldsOutput => ({ target: { connectionId: 'c', database: 'db', table: 't' }, catalogId: id, expiresAt: new Date(10000).toISOString(), columns: [{ name: '__proto__', type: 'text' }, { name: '金额,原值', type: 'decimal(30,6)' }, { name: 'id', type: 'bigint' }] });
/** RAM目录端口仅控制回包顺序，协调器不持有或读取数据库行值。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function harness(read = vi.fn(async () => output())) {
  const states: CsvExportFieldState[] = [], release = vi.fn(async (_id: string) => {}), errors = vi.fn(); let now = 1;
  const controller = new CsvExportFieldsController({ read, release, taskId: () => 'read', cleanupError: errors }, state => states.push(state), () => now);
  return { controller, read, release, errors, states, advance: (time: number) => { now = time; } };
}
describe('CSV字段目录和顺序草稿纯边界', () => {
  it('仅选真实字段并按显式顺序消费一次，不改变服务端目录或精确名称', async () => {
    const value = harness(); await value.controller.prepare(context);
    value.controller.select(context, '金额,原值', false); value.controller.move(context, 'id', -1);
    expect(value.controller.take(context)).toEqual({ catalogId: 'catalog', columns: ['id', '__proto__'] });
    expect(() => value.controller.take(context)).toThrow('读取'); expect(output().columns.map(column => column.name)).toEqual(['__proto__', '金额,原值', 'id']); expect(value.read).toHaveBeenCalledTimes(1);
  });
  it('空选择不能消费或导出，重新加入放末尾；未知字段要求重读', async () => {
    const value = harness(); await value.controller.prepare(context); for (const { name } of output().columns) value.controller.select(context, name, false);
    expect(() => value.controller.take(context)).toThrow('非空'); value.controller.select(context, 'id', true); value.controller.select(context, '__proto__', true);
    expect(value.controller.ready(context)?.selected).toEqual(['id', '__proto__']); value.controller.select(context, 'missing', true); expect(value.controller.ready(context)).toBeNull(); expect(value.states.at(-1)).toMatchObject({ status: 'failed', error: expect.stringContaining('重新读取') });
  });
  it('目标或修订改变同步不可执行，到期立即要求重读', async () => {
    const value = harness(); await value.controller.prepare(context);
    for (const next of [{ ...context, version: 2 }, { ...context, connectionId: 'other' }, { ...context, table: 'T' }]) expect(value.controller.ready(next)).toBeNull();
    value.advance(10000); expect(value.controller.ready(context)).toBeNull(); expect(() => value.controller.take(context)).toThrow('读取');
    expect(csvExportContextKey({ ...context, database: 'a/b', table: 'c' })).not.toBe(csvExportContextKey({ ...context, database: 'a', table: 'b/c' }));
  });
  it('迟到旧目录只释放旧令牌，不覆盖新目标或清理新目录', async () => {
    const old = deferred<CsvExportFieldsOutput>(), read = vi.fn(async () => output('new')).mockImplementationOnce(() => old.promise), value = harness(read);
    const pending = value.controller.prepare(context); await Promise.resolve(); await value.controller.prepare({ ...context, version: 2 }); old.resolve(output('old')); await pending;
    expect(value.controller.ready({ ...context, version: 2 })?.catalog.catalogId).toBe('new'); expect(value.release).toHaveBeenCalledWith('old'); expect(value.release).not.toHaveBeenCalledWith('new');
  });
  it('目录失败、目标响应不符或卸载均不产生默认全列导出能力', async () => {
    const value = harness(vi.fn(async () => ({ ...output(), target: { ...output().target, table: 'other' } }))); await value.controller.prepare(context);
    expect(value.controller.ready(context)).toBeNull(); expect(value.release).toHaveBeenCalledWith('catalog');
    const pending = deferred<CsvExportFieldsOutput>(), late = harness(vi.fn(async () => pending.promise)); const request = late.controller.prepare(context); await Promise.resolve(); late.controller.cancel(); pending.resolve(output('late')); await request;
    expect(late.release).toHaveBeenCalledWith('late'); expect(late.controller.ready(context)).toBeNull();
  });
  it('清理失败保留责任，后续明确重读仍重试释放，不影响其他目录', async () => {
    const value = harness(); value.release.mockRejectedValueOnce(Error('清理失败')); await value.controller.prepare(context); await value.controller.prepare(context); expect(value.errors).toHaveBeenCalledOnce();
    value.controller.cancel(); await Promise.resolve(); await Promise.resolve(); expect(value.release.mock.calls.filter(([id]) => id === 'catalog').length).toBeGreaterThanOrEqual(2);
  });
});
