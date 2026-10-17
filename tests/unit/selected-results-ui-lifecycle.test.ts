import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, it, expect, vi } from 'vitest';
import { bindSelectedResultsTarget, selectedResultsTargetKeys, SelectedResultsUiLifecycle, probeSelectedResultsTarget } from '../helpers/selectedResultsExportUi';

/** 所有身份与连接均在RAM中构造，不读实跑环境、私有配置或启动桌面。 */
function config() {
  return { DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '内存用户', DBARK_TEST_PASSWORD: '', DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001' } as Record<string, string | undefined>;
}
function target() { const raw = config(), helper = { ...raw }; return { raw, helper, binding: bindSelectedResultsTarget(() => raw, helper) }; }
const terminalTasks = () => [{ id: '查询一', kind: 'query.execute', status: 'completed' }, { id: '导出', kind: 'files.exportResult', status: 'completed' }, { id: '查询二', kind: 'query.execute', status: 'completed' }];
function lifecycle() {
  let closed = false, current = true;
  const retain = vi.fn(), exit = vi.fn(async () => { closed = true; });
  const owner = { assertCurrent(allowClosed = false) { if (!current || closed && !allowClosed) throw Error('所有者已改变'); }, closed: () => closed, retain, confirmExit: exit };
  const state = new SelectedResultsUiLifecycle(owner);
  return { state, owner, retain, exit, close: () => { closed = true; }, changeOwner: () => { current = false; } };
}
function probe() {
  const stream = { closed: false, once: vi.fn(), removeListener: vi.fn(), destroy: vi.fn(), end: vi.fn() };
  const native = { stream, end: vi.fn(), destroy: vi.fn() };
  const query = vi.fn(async (_sql: string): Promise<unknown> => [[{ version: '8.4.11', os: 'Linux', names: 0, uuid: config().DBARK_TEST_EXPECTED_SERVER_UUID }], []]);
  const observer = { connection: native, query }, connect = vi.fn(async () => observer);
  const close = vi.fn(async (connection: unknown) => { expect(connection).toBe(native); stream.closed = true; });
  return { stream, native, observer, query, connect, close };
}

describe('勾选行专项显式RAM目标', () => {
  it('只接受一致的200明文8.4.11目标，空密码也必须显式提供', () => {
    const { binding } = target(); expect(binding.target.port).toBe(13384); binding.assertCurrent();
    const raw = config(); delete raw.DBARK_TEST_PASSWORD;
    expect(() => bindSelectedResultsTarget(() => raw, { ...raw })).toThrow('显式一致配置');
  });
  it.each(selectedResultsTargetKeys.slice(0, 6))('raw/helper的%s不一致即拒绝', key => {
    const raw = config(), helper = { ...raw, [key]: '不同' };
    expect(() => bindSelectedResultsTarget(() => raw, helper)).toThrow('显式一致配置');
  });
  it.each([{ DBARK_TEST_HOST: '127.0.0.1' }, { DBARK_TEST_PORT: '13357' }, { DBARK_TEST_TLS: '1' }, { DBARK_TEST_USER: '' }, { DBARK_TEST_EXPECTED_SERVER_UUID: '' }, { DBARK_TEST_SSH: '1' }, { DBARK_TEST_DATABASE: '不允许默认库' }, { DBARK_TEST_CA: '不允许CA文件' }])('不接受额外连接范围 %j', patch => {
    const raw = { ...config(), ...patch }; expect(() => bindSelectedResultsTarget(() => raw, { ...raw })).toThrow('专用目标');
  });
  it.each(['raw', 'helper'] as const)('%s改变后再恢复也不能复活', side => {
    const { binding, raw, helper } = target(), environment = side === 'raw' ? raw : helper;
    environment.DBARK_TEST_PORT = '13357'; expect(() => binding.assertCurrent()).toThrow('已变化');
    environment.DBARK_TEST_PORT = '13384'; expect(() => binding.assertCurrent()).toThrow('已变化');
  });
  it('原来不存在的可选配置出现也永久停链', () => {
    const { binding, raw } = target(); raw.DBARK_TEST_SSH = '0'; expect(() => binding.assertCurrent()).toThrow('已变化');
    delete raw.DBARK_TEST_SSH; expect(() => binding.assertCurrent()).toThrow('已变化');
  });
});

describe('勾选行专项本例生命周期', () => {
  it('所有真实任务终态后只退出本例一次，再核afterEach', async () => {
    const { state, exit, retain } = lifecycle();
    await state.observe(async () => 1); await state.finish(async () => terminalTasks()); state.endBody(); state.afterEach();
    expect(exit).toHaveBeenCalledTimes(1); expect(retain).not.toHaveBeenCalled(); expect(state.state.exited).toBe(true);
  });
  it('保留通知抛错仍先设置本地sticky，原始失败保持不变', async () => {
    const { state, owner, exit } = lifecycle(), original = Error('原始失败');
    owner.retain.mockImplementation(() => { expect(state.state.retained).toBe(true); throw Error('通知失败'); });
    await expect(state.observe(async () => { throw original; })).rejects.toBe(original);
    await expect(state.observe(async () => 1)).rejects.toThrow('停链');
    expect(owner.retain).toHaveBeenCalledTimes(1); expect(exit).not.toHaveBeenCalled();
  });
  it('观察未返回时afterEach先保留，迟到完成不能继续或退出下一例', async () => {
    const { state, changeOwner, exit, retain } = lifecycle();
    let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
    const observation = state.observe(() => waiting), rejected = expect(observation).rejects.toThrow('停链');
    expect(state.state.pending).toBe(1); expect(() => state.afterEach()).toThrow('尚未确认');
    changeOwner(); release(); await rejected;
    state.endBody(); await expect(state.finish(async () => terminalTasks())).rejects.toThrow('停链');
    expect(state.state.pending).toBe(0); expect(retain).toHaveBeenCalledTimes(1); expect(exit).not.toHaveBeenCalled();
  });
  it('归属改变立即保留，已关闭也不能替代任务证明', async () => {
    const changed = lifecycle(); changed.changeOwner(); await expect(changed.state.observe(async () => 1)).rejects.toThrow('所有者');
    expect(changed.retain).toHaveBeenCalledTimes(1); expect(changed.exit).not.toHaveBeenCalled();
    const closed = lifecycle(); closed.close(); closed.state.endBody(); expect(() => closed.state.afterEach()).toThrow('尚未确认');
    expect(closed.exit).not.toHaveBeenCalled();
  });
  it.each([undefined, {}, [], [{ id: '未知', kind: 'query.execute', status: 'running' }], [...terminalTasks(), { id: '另任务', kind: '其他', status: 'running' }], terminalTasks().slice(0, 2)])('未知或不完整任务证据拒绝退出 %j', async tasks => {
    const { state, exit, retain } = lifecycle(); await expect(state.finish(async () => tasks)).rejects.toThrow();
    state.endBody(); expect(() => state.afterEach()).toThrow('停链'); expect(exit).not.toHaveBeenCalled(); expect(retain).toHaveBeenCalledTimes(1);
  });
  it('退出调用迟到不能在超时后发放退出证明', async () => {
    const { state, owner, close, exit } = lifecycle(); let release!: () => void;
    owner.confirmExit.mockImplementation(() => new Promise<void>(resolve => { release = () => { close(); resolve(); }; }));
    const finishing = state.finish(async () => terminalTasks()), rejected = expect(finishing).rejects.toThrow('停链');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(exit).toHaveBeenCalledTimes(1); expect(() => state.afterEach()).toThrow('尚未确认'); release(); await rejected;
    state.endBody(); expect(state.state.exited).toBe(false); expect(() => state.afterEach()).toThrow('停链');
  });
  it('退出函数返回但未closed，不能证明退出成功', async () => {
    const { state, owner } = lifecycle(); owner.confirmExit.mockResolvedValue(undefined);
    await expect(state.finish(async () => terminalTasks())).rejects.toThrow('退出未确认'); expect(state.state.retained).toBe(true);
  });
});

describe('勾选行专项只读身份及同流关闭', () => {
  it('只执行固定只读身份SELECT并严格关闭同一原生流', async () => {
    const p = probe(), { binding } = target(); await probeSelectedResultsTarget(binding, () => {}, p.connect, p.close);
    expect(p.query).toHaveBeenCalledExactlyOnceWith('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid');
    expect(p.close).toHaveBeenCalledTimes(1); expect(p.native.stream).toBe(p.stream); expect(p.stream.closed).toBe(true);
  });
  it.each(['version', 'os', 'names', 'uuid'])('身份%s不符仍严格关闭本连接，失败不放行UI', async key => {
    const p = probe(), { binding } = target(); p.query.mockResolvedValue([[{ version: '8.4.11', os: 'Linux', names: 0, uuid: binding.target.uuid, [key]: '不符' }], []]);
    await expect(probeSelectedResultsTarget(binding, () => {}, p.connect, p.close)).rejects.toThrow('身份不符'); expect(p.close).toHaveBeenCalledTimes(1);
  });
  it('查询失败保留原始对象，关闭也失败则以原始对象为cause', async () => {
    const p = probe(), { binding } = target(), original = Error('原查询失败'), closing = Error('原关闭失败'); p.query.mockRejectedValue(original);
    await expect(probeSelectedResultsTarget(binding, () => {}, p.connect, p.close)).rejects.toBe(original);
    p.close.mockRejectedValue(closing); const combined = await probeSelectedResultsTarget(binding, () => {}, p.connect, p.close).catch(reason => reason);
    expect(combined).toBeInstanceOf(AggregateError); expect(combined.cause).toBe(original); expect(combined.errors).toEqual([original, closing]);
  });
  it.each(['缺原生连接', '缺原始流', '缺流方法'])('%s不降级使用Promise.end', async kind => {
    const p = probe(), { binding } = target(); const observer = kind === '缺原生连接' ? { query: p.query } : { query: p.query, connection: kind === '缺原始流' ? { end() {}, destroy() {} } : { end() {}, destroy() {}, stream: {} } };
    await expect(probeSelectedResultsTarget(binding, () => {}, async () => observer, p.close)).rejects.toThrow('原生连接和流'); expect(p.query).not.toHaveBeenCalled(); expect(p.close).not.toHaveBeenCalled();
  });
  it('查询期间换流不能关闭另一个流或放行', async () => {
    const p = probe(), { binding } = target(); p.query.mockImplementation(async () => { p.native.stream = { ...p.stream }; return [[{ version: '8.4.11', os: 'Linux', names: 0, uuid: binding.target.uuid }], []]; });
    await expect(probeSelectedResultsTarget(binding, () => {}, p.connect, p.close)).rejects.toThrow('流已改变'); expect(p.close).not.toHaveBeenCalled();
  });
  it.each(['未closed', '关闭中换流'])('严格关闭返回后%s也不放行', async kind => {
    const p = probe(), { binding } = target(); p.close.mockImplementation(async () => { if (kind === '关闭中换流') p.native.stream = { ...p.stream, closed: true }; });
    await expect(probeSelectedResultsTarget(binding, () => {}, p.connect, p.close)).rejects.toThrow('严格关闭未确认');
  });
  it('连接返回时已超时，只关闭捕获原生流，不发SELECT或退出桌面', async () => {
    const p = probe(), { binding } = target(), { state, exit } = lifecycle(); let release!: () => void;
    const connection = new Promise<typeof p.observer>(resolve => { release = () => resolve(p.observer); });
    const pending = state.observe(() => probeSelectedResultsTarget(binding, () => state.assertCurrent(), () => connection, p.close));
    const rejected = expect(pending).rejects.toThrow('停链'); expect(() => state.afterEach()).toThrow('尚未确认'); release(); await rejected;
    expect(p.query).not.toHaveBeenCalled(); expect(p.close).toHaveBeenCalledTimes(1); expect(exit).not.toHaveBeenCalled();
  });
});

describe('勾选行专项默认关闭包装器', () => {
  const code = ts.transpileModule(readFileSync(resolve('tests/e2e/query-selected-results-export.spec.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  /** 只在VM运行包装器，require和环境均由RAM端口提供，不加载Playwright桌面fixture。 */
  function wrapper(integration: string, selected: string, listing = false, explicit?: Record<string, string | undefined>) {
    const skip = vi.fn(), register = vi.fn(), loads: string[] = [], env = new Proxy({ DBARK_INTEGRATION_ENABLED: integration, DBARK_SELECTED_RESULTS_EXPORT_UI: selected, ...explicit }, { get(object, key: string) { if (key.startsWith('DBARK_TEST_') && !explicit) throw Error('禁止读取认证'); return (object as Record<string, string | undefined>)[key]; } });
    runInNewContext(code, { exports: {}, process: { argv: listing ? ['node', '--list'] : ['node'], env }, require(name: string) { loads.push(name); if (name === '@playwright/test') return { test: { skip } }; if (name === '../helpers/selectedResultsExportUi') return { bindSelectedResultsTarget, selectedResultsTargetKeys }; if (name === './query-selected-results-export-live') return { registerSelectedResultsExport: register }; throw Error('禁止加载其它模块'); } });
    return { skip, register, loads };
  }
  it.each([['0', '0'], ['0', '1'], ['1', '0']])('默认双门%s/%s短路且不读认证', (integration, selected) => {
    const result = wrapper(integration, selected); expect(result.skip).toHaveBeenCalledTimes(1); expect(result.loads).toEqual(['@playwright/test']); expect(result.register).not.toHaveBeenCalled();
  });
  it.each([['0', '0'], ['0', '1'], ['1', '0'], ['1', '1']])('列表双门%s/%s先短路且不读认证', (integration, selected) => {
    const result = wrapper(integration, selected, true); expect(result.skip).toHaveBeenCalledTimes(1); expect(result.loads).toEqual(['@playwright/test']);
  });
  it('双门启用仍必须在live加载之前绑定显式一致RAM目标', () => {
    expect(() => wrapper('1', '1', false, {})).toThrow('显式一致配置');
    const result = wrapper('1', '1', false, config()); expect(result.skip).not.toHaveBeenCalled(); expect(result.register).toHaveBeenCalledTimes(1);
    expect(result.loads).toEqual(['@playwright/test', '../helpers/selectedResultsExportUi', './query-selected-results-export-live']);
  });
});
