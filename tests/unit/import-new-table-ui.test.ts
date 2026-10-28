import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ImportFileInspectOutput } from '../../src/shared/importNewTable';
import type { TableCreateApplyOutput } from '../../src/shared/tableCreate';
import { ImportNewTableController, importNewTableDesign, type ImportNewTableServices } from '../../src/renderer/importNewTableUi';

/** 手工控制原Promise顺序，断言取消ACK与终态事件不能替代扫描真实结束。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const output = (): ImportFileInspectOutput => ({ columns: ['id', '后续字段'], rows: [{ id: '9007199254740993' }], records: 21, source: { sha256: 'a'.repeat(64), bytes: 1024 }, sampleOmitted: true });
const receipt = (patch: Partial<TableCreateApplyOutput> = {}): TableCreateApplyOutput => ({ target: { connectionId: 'c', database: '库', table: '用户修改后的表' }, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, resourcesReleased: true, warnings: [], ...patch });
function fixture() {
  let valid = true, scopeThrows = false;
  const services: ImportNewTableServices = { choose: vi.fn().mockResolvedValue({ token: randomUUID(), name: '原文件.csv' }), inspect: vi.fn().mockResolvedValue(output()), cancel: vi.fn().mockResolvedValue(undefined), uid: randomUUID };
  const publish = vi.fn(), close = vi.fn(), created = vi.fn(), controller = new ImportNewTableController({ connectionId: 'c', database: '库', version: 5 }, services, () => { if (scopeThrows) throw Error('来源读取失败'); return valid; }, publish, close, created);
  controller.mount();
  return { controller, services, publish, close, created, versionChanged() { valid = false; controller.invalidate(); valid = true; }, scopeFailure(value: boolean) { scopeThrows = value; } };
}
async function design(f: ReturnType<typeof fixture>) {
  const c = f.controller; await c.scan(c.state); c.name(c.state, '待审新表'); c.review(c.state, true); const lease = c.design(c.state); expect(lease).toBeDefined(); return lease!;
}

describe('文件到新表两阶段向导协调器', () => {
  it('全文件字段均建议可空LONGTEXT，安全保留原名并稳定回退大小写冲突/非法/原型名称', () => {
    const sources = ['正常', 'A', 'a', '', '__proto__', 'constructor', 'column_4', 'x'.repeat(65), '结尾 ', '换\n行'];
    const first = importNewTableDesign('库', '新表', sources), second = importNewTableDesign('库', '新表', sources);
    expect(first).toEqual(second); expect(first.design.columns.slice(0, 2).map(value => value.name)).toEqual(['正常', 'A']);
    expect(first.design.columns[6].name).toBe('column_4'); expect(new Set(first.design.columns.map(value => value.name.toLowerCase())).size).toBe(sources.length);
    expect(first.design.columns.every(value => value.type === 'LONGTEXT' && value.nullable && !value.autoIncrement && !Object.hasOwn(value, 'defaultValue'))).toBe(true);
    expect(Object.hasOwn(first.mapping, '__proto__')).toBe(true); expect(Object.getPrototypeOf(first.mapping)).toBe(Object.prototype);
    expect(first.mapping.__proto__).not.toBe('__proto__'); expect(first.design.indexes).toEqual([]);
  });

  it('明确扫描完整文件并绑定原选项/指纹/全部源字段，未确认名称不得进入设计', async () => {
    const f = fixture(), c = f.controller; c.change(c.state, { csvDelimiter: ';', csvHasHeader: false, encoding: 'gb18030' });
    await c.scan(c.state); expect(f.services.choose).toHaveBeenCalledWith({ purpose: 'import', format: 'csv' });
    expect(f.services.inspect).toHaveBeenCalledWith(expect.objectContaining({ csvDelimiter: ';', csvHasHeader: false, encoding: 'gb18030', taskId: expect.any(String) }));
    expect(c.design(c.state)).toBeUndefined(); expect(c.state.stage).toBe('source');
    c.name(c.state, '准确新表'); c.review(c.state, true); c.design(c.state);
    expect(c.state.seed).toMatchObject({ format: 'csv', encoding: 'gb18030', csvDelimiter: ';', csvHasHeader: false, columns: ['id', '后续字段'], expectedSource: output().source, mapping: { id: 'id', 后续字段: '后续字段' } });
    expect(c.state.design?.columns.map(value => value.name)).toEqual(['id', '后续字段']); expect(f.created).not.toHaveBeenCalled();
  });

  it('旧渲染的选项/扫描事件被同步消费，A→B→A不复活旧扫描结果', async () => {
    const f = fixture(), c = f.controller, old = c.state;
    c.change(old, { format: 'json' }); await c.scan(old); c.change(old, { format: 'csv' }); expect(f.services.choose).not.toHaveBeenCalled(); expect(c.state.options.format).toBe('json');
    const scan = deferred<ImportFileInspectOutput>(); vi.mocked(f.services.inspect).mockReturnValue(scan.promise);
    const pending = c.scan(c.state); await Promise.resolve(); await Promise.resolve(); f.versionChanged(); scan.resolve(output()); await pending;
    expect(c.state.invalid).toBe(true); expect(c.state.inspection).toBeUndefined(); expect(f.services.cancel).toHaveBeenCalledTimes(1); expect(f.created).not.toHaveBeenCalled();
  });

  it('换文件或解释选项清除旧人工审阅，新来源必须重新核对名称', async () => {
    const f = fixture(), c = f.controller;
    await c.scan(c.state); c.name(c.state, '准确新表'); c.review(c.state, true); expect(c.state.reviewed).toBe(true);
    await c.scan(c.state); expect(c.state.reviewed).toBe(false); expect(c.design(c.state)).toBeUndefined(); expect(c.state.stage).toBe('source');
    c.review(c.state, true); c.change(c.state, { csvHasHeader: false }); expect(c.state.reviewed).toBe(false); expect(c.state.inspection).toBeUndefined();
    await c.scan(c.state); expect(c.design(c.state)).toBeUndefined(); c.review(c.state, true); expect(c.design(c.state)).toBeDefined();
  });

  it('作用域检查抛错永久失效并取消原扫描，关闭仍等原扫描与取消真实终态', async () => {
    const f = fixture(), c = f.controller, scan = deferred<ImportFileInspectOutput>(), cancel = deferred<unknown>(); vi.mocked(f.services.inspect).mockReturnValue(scan.promise); vi.mocked(f.services.cancel).mockReturnValue(cancel.promise);
    const pending = c.scan(c.state); await Promise.resolve(); await Promise.resolve(); f.scopeFailure(true);
    const taskId = vi.mocked(f.services.inspect).mock.calls[0][0].taskId;
    expect(() => c.progress({ taskId, status: 'running', progress: 10, message: '读取' })).not.toThrow(); expect(c.state.invalid).toBe(true);
    f.scopeFailure(false); const closing = c.close(c.state); await Promise.resolve(); expect(f.services.cancel).toHaveBeenCalledTimes(1); expect(f.close).not.toHaveBeenCalled();
    scan.resolve(output()); await Promise.resolve(); await Promise.resolve(); expect(f.close).not.toHaveBeenCalled(); cancel.resolve(undefined);
    await Promise.all([pending, closing]); expect(f.close).toHaveBeenCalledTimes(1); expect(c.state.inspection).toBeUndefined(); expect(c.state.invalid).toBe(true);
  });

  it('取消和关闭等待原扫描及原cancel两种结算顺序，任务完成事件不能提前解锁', async () => {
    for (const order of ['read-first', 'cancel-first']) {
      const f = fixture(), c = f.controller, scan = deferred<ImportFileInspectOutput>(), cancel = deferred<unknown>(); vi.mocked(f.services.inspect).mockReturnValue(scan.promise); vi.mocked(f.services.cancel).mockReturnValue(cancel.promise);
      const pending = c.scan(c.state); await Promise.resolve(); await Promise.resolve();
      const closing = c.close(c.state); c.cancel(); await Promise.resolve(); expect(f.services.cancel).toHaveBeenCalledTimes(1);
      const taskId = vi.mocked(f.services.inspect).mock.calls[0][0].taskId;
      c.progress({ taskId, status: 'completed', progress: 100, message: '完成' });
      if (order === 'read-first') scan.resolve(output()); else cancel.resolve(undefined);
      await Promise.resolve(); await Promise.resolve(); expect(f.close).not.toHaveBeenCalled(); expect(c.state.busy).toBe(true);
      if (order === 'read-first') cancel.resolve(undefined); else scan.resolve(output());
      await Promise.all([pending, closing]); expect(f.close).toHaveBeenCalledTimes(1); expect(c.state.inspection).toBeUndefined();
    }
  });

  it('选择文件期间关闭仅等原chooser，迟到文件不发扫描；卸载重挂不发布旧Promise', async () => {
    const f = fixture(), c = f.controller, chooser = deferred<{ token: string; name: string } | null>(); vi.mocked(f.services.choose).mockReturnValue(chooser.promise);
    const pending = c.scan(c.state); await Promise.resolve(); const closing = c.close(c.state); expect(f.services.cancel).not.toHaveBeenCalled();
    chooser.resolve({ token: randomUUID(), name: '迟到.csv' }); await Promise.all([pending, closing]); expect(f.services.inspect).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledTimes(1);
    const g = fixture(), read = deferred<ImportFileInspectOutput>(); vi.mocked(g.services.inspect).mockReturnValue(read.promise); const scanning = g.controller.scan(g.controller.state); await Promise.resolve(); await Promise.resolve(); g.controller.dispose(); g.controller.mount(); read.resolve(output()); await scanning;
    expect(g.controller.state.inspection).toBeUndefined(); expect(g.services.cancel).toHaveBeenCalledTimes(1);
  });

  it('原准确ACK先通知刷新但继续挂设计器，只有原onClose后才允许显式进入导入', async () => {
    const f = fixture(), c = f.controller, lease = await design(f), frozenSeed = c.state.seed;
    c.receiveCreated(lease, receipt(), 5); expect(f.created).toHaveBeenCalledWith(receipt(), 5); expect(c.state.stage).toBe('design');
    c.continue(c.state); expect(c.state.stage).toBe('design'); expect(f.close).not.toHaveBeenCalled();
    c.schemaClosed(lease); expect(c.state.stage).toBe('created'); c.receiveCreated(lease, receipt(), 5); expect(f.created).toHaveBeenCalledTimes(1);
    const createdState = c.state; c.continue(createdState); expect(c.state.stage).toBe('import'); expect(c.state.created?.target.table).toBe('用户修改后的表'); expect(c.state.seed).toBe(frozenSeed);
    c.continue(createdState); expect(c.state.stage).toBe('import'); expect(f.services.inspect).toHaveBeenCalledTimes(1);
    c.importClosed(c.childLease!); expect(f.close).toHaveBeenCalledTimes(1);
  });

  it('未核验/未释放ACK不继续或重建；错误目标/修订/旧子回调不能刷新或导入', async () => {
    for (const patch of [{ definitionVerified: false }, { resourcesReleased: false }]) {
      const f = fixture(), c = f.controller, lease = await design(f); c.receiveCreated(lease, receipt(patch), 5); c.schemaClosed(lease); c.continue(c.state);
      expect(c.state.stage).toBe('created'); expect(c.design(c.state)).toBeUndefined(); expect(f.created).toHaveBeenCalledTimes(1); await c.close(c.state); expect(f.close).toHaveBeenCalledTimes(1);
    }
    const f = fixture(), c = f.controller, lease = await design(f);
    c.receiveCreated(lease, receipt(), 6); c.receiveCreated(lease, receipt({ target: { connectionId: '其它', database: '库', table: '表' } }), 5); expect(f.created).not.toHaveBeenCalled();
    f.versionChanged(); c.receiveCreated(lease, receipt(), 5); expect(c.state.created).toEqual(receipt()); expect(c.state.error).toContain('不要重复创建'); expect(c.state.stage).toBe('design');
    c.schemaClosed(lease); expect(f.created).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledTimes(1);
  });

  it('取消前未建表可退出，已有ACK退出保留表且不调用任何删除/导入服务', async () => {
    const f = fixture(), c = f.controller, lease = await design(f); c.schemaClosed(lease); expect(f.close).toHaveBeenCalledTimes(1); expect(f.created).not.toHaveBeenCalled();
    const g = fixture(), otherLease = await design(g); g.controller.receiveCreated(otherLease, receipt(), 5); g.controller.schemaClosed(otherLease); expect(g.controller.dirty).toBe(true); await g.controller.close(g.controller.state);
    expect(g.close).toHaveBeenCalledTimes(1); expect(g.services.inspect).toHaveBeenCalledTimes(1); expect(g.created).toHaveBeenCalledTimes(1);
  });

  it('子阶段守卫绑定父租约/阶段/挂载，失效与卸载重挂均单向撤销旧子入口', async () => {
    const f = fixture(), c = f.controller, lease = await design(f);
    expect(c.isChildCurrent(lease, 'design')).toBe(true); expect(c.isChildCurrent({}, 'design')).toBe(false); expect(c.isChildCurrent(lease, 'import')).toBe(false);
    c.receiveCreated(lease, receipt(), 5); c.schemaClosed(lease); c.continue(c.state); const importing = c.childLease!;
    expect(c.isChildCurrent(lease, 'design')).toBe(false); expect(c.isChildCurrent(importing, 'import')).toBe(true);
    f.versionChanged(); expect(c.isChildCurrent(importing, 'import')).toBe(false); c.dispose(); c.mount(); expect(c.isChildCurrent(importing, 'import')).toBe(false);
    const g = fixture(), old = await design(g); g.controller.dispose(); g.controller.mount(); expect(g.controller.isChildCurrent(old, 'design')).toBe(false);
  });
});
