import { describe, expect, it, vi } from 'vitest';
import { ImportPreflightController, importPreflightExportData, validateImportPreflightReport, type ImportPreflightServices, type ImportPreflightSource } from '../../src/renderer/importPreflight';
import type { FileImportPreflightInput, FileImportPreflightReport } from '../../src/shared/fileImportPreflight';

const source = (): ImportPreflightSource => ({ identity: {}, input: { connectionId: '连接', database: '库', table: '表', fileToken: '不导出的令牌', format: 'csv', encoding: 'utf8', mapping: { a: '甲', b: '乙' } } });
/** 合成第21条以后的错误，不依赖真实文件、数据库或导入操作。 */
function report(input: FileImportPreflightInput, count = 0): FileImportPreflightReport {
  return { taskId: input.taskId, target: { connectionId: input.connectionId, database: input.database, table: input.table }, format: input.format, encoding: input.encoding, checkedRecords: 30, validRecords: count ? 29 : 30, invalidRecords: count ? 1 : 0, issueCount: count,
    issues: Array.from({ length: Math.min(count, 200) }, (_, index) => ({ record: 25, source: index % 2 ? 'b' : 'a', target: index % 2 ? '乙' : '甲', code: 'invalid-value', message: '原值SECRET与C:/路径不可泄露' })), complete: true, termination: 'complete', truncated: count > 200, sourceFingerprint: 'a'.repeat(64), schemaFingerprint: 'b'.repeat(64), sourceBytes: 123, warnings: ['不信任的驱动信息'] };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  const pending = deferred<FileImportPreflightReport>(), activity = vi.fn(), published = vi.fn(); let input!: FileImportPreflightInput;
  const services: ImportPreflightServices = { run: vi.fn(value => { input = value; return pending.promise; }), cancel: vi.fn(async () => {}), chooseReport: vi.fn(async () => ({ token: '导出令牌', name: '报告.json' })), exportReport: vi.fn(async value => ({ rows: value.result.rows.length })), uid: vi.fn(() => '任务') };
  const controller = new ImportPreflightController(services, activity, vi.fn(), published), origin = source(); controller.setSource(origin);
  return { controller, services, activity, published, pending, origin, input: () => input };
}

describe('整文件预检来源和原任务生命周期', () => {
  it('来源失效后仍能取消原扫描，扫描先结束也须等待原取消IPC终态', async () => {
    const f = fixture(), cancel = deferred<void>(); vi.mocked(f.services.cancel).mockReturnValue(cancel.promise);
    const running = f.controller.run(f.controller.state.generation); f.controller.setSource(source());
    const generation = f.controller.state.generation, cancelling = f.controller.cancel(generation);
    await Promise.resolve(); expect(f.services.cancel).toHaveBeenCalledExactlyOnceWith('任务');
    await f.controller.cancel(generation); f.pending.resolve(report(f.input())); await Promise.resolve(); await Promise.resolve();
    expect(f.activity.mock.calls).toEqual([[1]]); expect(f.controller.state.phase).toBe('cancelling');
    cancel.resolve(); await cancelling; await running;
    expect(f.controller.state.phase).toBe('idle'); expect(f.controller.state.report).toBeNull(); expect(f.activity.mock.calls).toEqual([[1], [-1]]);
  });
  it('只显式运行一次，未自动导入，错误与记录计数分别保留', async () => {
    const f = fixture(), generation = f.controller.state.generation;
    const run = f.controller.run(generation); await f.controller.run(generation);
    expect(f.services.run).toHaveBeenCalledTimes(1); expect(f.controller.state.report).toBeNull();
    f.pending.resolve(report(f.input(), 22)); await run;
    expect(f.controller.state.report).toMatchObject({ invalidRecords: 1, issueCount: 22 });
    expect(f.controller.state.report?.issues[21]).toMatchObject({ record: 25, source: 'b', target: '乙' });
    expect(f.activity.mock.calls).toEqual([[1], [-1]]);
  });
  it('取消失败不释放占用且旧回包不发布，原run结束才解锁', async () => {
    const f = fixture(); vi.mocked(f.services.cancel).mockRejectedValue(Error('秘密'));
    const generation = f.controller.state.generation, running = f.controller.run(generation);
    await f.controller.cancel(generation); await f.controller.cancel(generation); await f.controller.run(generation);
    expect(f.services.cancel).toHaveBeenCalledTimes(1); expect(f.services.run).toHaveBeenCalledTimes(1); expect(f.activity.mock.calls).toEqual([[1]]);
    f.pending.resolve(report(f.input())); await running;
    expect(f.controller.state.report).toBeNull(); expect(f.controller.state.phase).toBe('idle'); expect(f.activity.mock.calls).toEqual([[1], [-1]]);
  });
  it('父层获取占用失败不留下owner，也不发送不存在的负回调', async () => {
    const services: ImportPreflightServices = { run: vi.fn(), cancel: vi.fn(), chooseReport: vi.fn(), exportReport: vi.fn(), uid: () => '任务' }, activity = vi.fn(() => { throw Error('父层忙'); });
    const controller = new ImportPreflightController(services, activity, vi.fn()); controller.setSource(source());
    await controller.run(controller.state.generation); await controller.run(controller.state.generation);
    expect(controller.state.phase).toBe('idle'); expect(services.run).not.toHaveBeenCalled(); expect(activity.mock.calls).toEqual([[1], [1]]);
  });
  it('来源ABA、卸载和旧按钮不能复活报告或新任务', async () => {
    const f = fixture(), generation = f.controller.state.generation, running = f.controller.run(generation);
    f.controller.setSource(source()); f.controller.setSource(f.origin); await f.controller.run(generation);
    f.pending.resolve(report(f.input())); await running;
    expect(f.controller.state.report).toBeNull(); expect(f.services.run).toHaveBeenCalledTimes(1);
    const g = fixture(), done = g.controller.run(g.controller.state.generation); g.controller.dispose(); g.pending.resolve(report(g.input())); await done;
    expect(g.published.mock.calls.filter(([, value]) => value !== null)).toHaveLength(0); expect(g.activity.mock.calls).toEqual([[1], [-1]]);
  });
  it('选文件双击不重入，来源ABA后迟到文件选择不能写出', async () => {
    const f = fixture(), running = f.controller.run(f.controller.state.generation); f.pending.resolve(report(f.input())); await running;
    const choice = deferred<{ token: string; name: string } | null>(); vi.mocked(f.services.chooseReport).mockReturnValue(choice.promise);
    const generation = f.controller.state.generation, value = f.controller.state.report!, exporting = f.controller.export(generation, value);
    await f.controller.export(generation, value); f.controller.setSource(source()); f.controller.setSource(f.origin);
    choice.resolve({ token: '旧', name: '旧' }); await exporting;
    expect(f.services.chooseReport).toHaveBeenCalledTimes(1); expect(f.services.exportReport).not.toHaveBeenCalled(); expect(f.activity.mock.calls).toEqual([[1], [-1], [1], [-1]]);
  });
  it('导出等待写入终态，卸载仍精确释放原占用', async () => {
    const f = fixture(), running = f.controller.run(f.controller.state.generation); f.pending.resolve(report(f.input())); await running;
    const write = deferred<{ rows: number }>(); vi.mocked(f.services.exportReport).mockReturnValue(write.promise);
    const exporting = f.controller.export(f.controller.state.generation, f.controller.state.report!); await Promise.resolve();
    f.controller.dispose(); expect(f.activity.mock.calls).toEqual([[1], [-1], [1]]); write.resolve({ rows: 1 }); await exporting;
    expect(f.activity.mock.calls).toEqual([[1], [-1], [1], [-1]]);
  });
});

describe('整文件报告校验和白名单导出', () => {
  const input = { ...source().input, taskId: '任务' };
  it('汇总和错误列集完全一致，不导出值、路径、令牌、SQL或任意驱动消息', () => {
    const value = validateImportPreflightReport(input, report(input, 22)), data = importPreflightExportData(value), keys = data.columns.map(column => column.key);
    expect(data.rows).toHaveLength(23); for (const row of data.rows) expect(Object.keys(row)).toEqual(keys);
    expect(data.rows[0]).toMatchObject({ kind: 'summary', formatVersion: 1, sourceSHA256: 'a'.repeat(64), checkedRecords: 30, issueCount: 22, retainedIssues: 22 });
    expect(JSON.stringify(data)).not.toMatch(/SECRET|路径|令牌|SQL|驱动/);
    expect(importPreflightExportData(validateImportPreflightReport(input, report(input))).rows).toHaveLength(1);
  });
  it('身份、完整性、计数、明细预算未知时一律拒绝', () => {
    for (const patch of [{ taskId: '旧' }, { format: 'json' }, { encoding: 'gb18030' }, { target: { connectionId: '其他', database: '库', table: '表' } }, { checkedRecords: 99 }, { issueCount: -1 }, { complete: false }, { sourceFingerprint: null }, { schemaFingerprint: '未知' }, { issues: new Array(1), issueCount: 1 }]) expect(() => validateImportPreflightReport(input, { ...report(input), ...patch } as FileImportPreflightReport)).toThrow();
  });
  it('解析失败只能报告已检查范围，200明细截断也明确导出范围', () => {
    const partial = { ...report(input), complete: false, termination: 'parse-error' as const, sourceFingerprint: null, issueCount: 1, issues: [{ code: 'parse-error' as const, message: '原始路径' }] };
    expect(validateImportPreflightReport(input, partial).complete).toBe(false);
    const large = { ...report(input, 201), checkedRecords: 300, validRecords: 299 };
    const data = importPreflightExportData(validateImportPreflightReport(input, large)); expect(data.rows).toHaveLength(201); expect(data.rows[0]).toMatchObject({ issueCount: 201, retainedIssues: 200, truncated: true });
  });
});
