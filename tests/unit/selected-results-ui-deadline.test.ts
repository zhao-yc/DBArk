import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import ts from 'typescript';
import { describe, it, expect, vi } from 'vitest';
import { SelectedResultsUiLifecycle, bindSelectedResultsTarget, probeSelectedResultsTarget } from '../../tests/helpers/selectedResultsExportUi';
import { closeMysqlConnection } from '../../src/engine/connection';

const terminal = () => [{ id: 'q1', kind: 'query.execute', status: 'completed' }, { id: 'q2', kind: 'query.execute', status: 'completed' }, { id: 'file', kind: 'files.exportResult', status: 'completed' }];
/** 提取真实正式入口的owner对象；共享owner保持有效，原TestInfo时间和状态独立推进。 */
function fixture(notification: 'normal' | 'throw' | 'noop' = 'normal', started = Date.now()) {
  const source = ts.createSourceFile('live.ts', readFileSync(new URL('../../tests/e2e/query-selected-results-export-live.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  let object = ''; function visit(node: ts.Node) { if (ts.isNewExpression(node) && node.expression.getText(source) === 'SelectedResultsUiLifecycle') object = node.getText(source); node.forEachChild(visit); } visit(source);
  if (!object) throw Error('缺少真实owner');
  const page = {}, application = {}, info = { _startWallTime: started, timeout: 120000, status: 'passed' }; let closed = false;
  const notify = vi.fn(() => { if (notification === 'throw') throw Error('合成共享通知失败'); });
  const exit = vi.fn(async () => { closed = true; });
  const state = runInNewContext(ts.transpileModule(object + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    SelectedResultsUiLifecycle, Date, binding: { assertCurrent() {} }, info, page, application,
    ownedDesktopResources: () => ({ page, application, closed }), retainOwnedDesktopResources: notify, confirmOwnedDesktopExit: exit,
  }) as SelectedResultsUiLifecycle;
  return { state, info, notify, exit };
}

describe('员工4独立勾选行原期限与结束活动围栏（仅RAM）', () => {
  it('正常原owner与真实任务终态允许本例退出，afterEach确认完整', async () => {
    const f = fixture(); await f.state.observe(async () => 1); await f.state.finish(async () => terminal()); f.state.endBody(); f.state.afterEach();
    expect(f.exit).toHaveBeenCalledOnce(); expect(f.notify).not.toHaveBeenCalled();
  });
  it('原120秒已到且共享owner仍有效，afterEach前不得迟到发起confirmExit', async () => {
    vi.useFakeTimers(); try {
      vi.setSystemTime(119999); const f = fixture('normal', 0); vi.setSystemTime(120000); f.info.status = 'timedOut';
      const result = await f.state.finish(async () => terminal()).then(() => 'completed', () => 'blocked');
      expect({ result, exitCalls: f.exit.mock.calls.length }, '原TestInfo期限已到，不得从helper重计或只等afterEach').toEqual({ result: 'blocked', exitCalls: 0 });
    } finally { vi.useRealTimers(); }
  });
  it('原120秒前发起的观察在期限到达后返回，不能继续释放成功结果', async () => {
    vi.useFakeTimers(); try {
      vi.setSystemTime(119999); const f = fixture('normal', 0); let release!: () => void; const pending = f.state.observe(() => new Promise<void>(yes => { release = yes; })).then(() => 'completed', () => 'blocked');
      vi.setSystemTime(120000); f.info.status = 'timedOut'; release(); expect(await pending, '未调用afterEach的原超时窗口仍必须拒绝迟到返回').toBe('blocked');
    } finally { vi.useRealTimers(); }
  });
  it('endBody已结束活动，即使原owner尚未关闭，也不得发起新观察', async () => {
    const f = fixture(), action = vi.fn(async () => 1); f.state.endBody();
    const result = await f.state.observe(action).then(() => 'completed', () => 'blocked');
    expect({ result, actions: action.mock.calls.length }).toEqual({ result: 'blocked', actions: 0 });
  });
  it.each(['throw', 'noop'] as const)('共享通知%s时本地sticky仍阻断后续动作', async notification => {
    const f = fixture(notification), failure = Error('独立原始失败');
    await expect(f.state.observe(async () => { throw failure; })).rejects.toBe(failure);
    const action = vi.fn(async () => 1); await expect(f.state.observe(action)).rejects.toThrow('停链');
    expect(action).not.toHaveBeenCalled(); expect(f.exit).not.toHaveBeenCalled(); expect(f.notify).toHaveBeenCalledOnce();
  });
});

/** 显式合成配置，不读取当前进程的认证或私有文件。 */
function target() { const raw: Record<string, string | undefined> = { DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'RAM账户', DBARK_TEST_PASSWORD: '', DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001' }; const helper = { ...raw }; return { raw, helper, binding: bindSelectedResultsTarget(() => raw, helper) }; }
describe('员工4独立目标与同流正常对照（仅RAM）', () => {
  it('可选配置的存在性变化再恢复仍不可复活', () => {
    const f = target(); f.helper.DBARK_TEST_DATABASE = ''; expect(() => f.binding.assertCurrent()).toThrow('配置已变化'); delete f.helper.DBARK_TEST_DATABASE; expect(() => f.binding.assertCurrent()).toThrow('配置已变化');
  });
  it('固定只读SELECT通过身份门后，以真实严格关闭函数等待同一流close', async () => {
    const f = target(), emitter = new EventEmitter();
    const stream = { closed: false, once: emitter.once.bind(emitter), removeListener: emitter.removeListener.bind(emitter), end(callback: () => void) { callback(); queueMicrotask(() => { stream.closed = true; emitter.emit('close'); }); }, destroy() {} };
    const native = { stream, end(callback: () => void) { queueMicrotask(callback); }, destroy() {} };
    const query = vi.fn(async () => [[{ version: '8.4.11', os: 'Linux', names: 0, uuid: f.binding.target.uuid }]]);
    await probeSelectedResultsTarget(f.binding, () => {}, async () => ({ connection: native, query }), value => closeMysqlConnection(value as any, true));
    expect(query).toHaveBeenCalledExactlyOnceWith('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid'); expect(stream.closed).toBe(true);
  });
});
