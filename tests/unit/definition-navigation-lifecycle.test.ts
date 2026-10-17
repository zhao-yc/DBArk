import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { closeMysqlConnection } from '../../src/engine/connection';

/** 执行正式helper原函数；仅注入main、框架时钟及内存流，禁止启动桌面或连接服务器。 */
function fixture(options: { notify?: 'throw' | 'noop'; nativeClose?: (native: any) => Promise<void> } = {}) {
  let now = 100, retained = false;
  const info: any = { _startWallTime: 0, timeout: 90000, status: 'passed' };
  const original = vi.fn(async (_event: unknown, payload: any) => payload.response);
  const handlers = new Map([['dbark:request', original as any]]), notify = vi.fn(() => { if (options.notify === 'throw') throw Error('通知失败'); if (options.notify !== 'noop') retained = true; });
  const sandbox: any = { exports: {}, Date: { now: () => now }, process: { platform: 'win32', env: {} }, require(name: string) {
    if (name === 'node:fs' || name === 'node:crypto' || name.endsWith('/zh-CN') || name.endsWith('/databaseCreate.zh-CN') || name.endsWith('/tableDefaultEncodingTarget')) return {};
    if (name === 'mysql2/promise') return { createConnection() { throw Error('纯端口禁止数据库'); } };
    if (name.endsWith('/engine/connection')) return { closeMysqlConnection: options.nativeClose ?? closeMysqlConnection };
    if (name === './desktop-fixture') return { retainOwnedDesktopResources: notify };
    throw Error('未授权模块：' + name);
  } };
  const context = vm.createContext(sandbox), source = readFileSync(resolve('tests/e2e/definition-navigation-live.ts'), 'utf8');
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText + '\nexports.watch = watchCreate; exports.close = closeDefinitionObserver;', context);
  const owner: any = { page: {}, assertCurrent: vi.fn(), desktop: { browserWindow: async () => ({ evaluate: async () => 101, dispose: async () => {} }), evaluate: async (callback: Function, input: unknown) => callback({ ipcMain: { _invokeHandlers: handlers } }, input) } };
  const send = (command: string, input: any, response: any, senderId = 101) => handlers.get('dbark:request')!({ sender: { id: senderId } }, { command, input, response });
  return { api: sandbox.exports, owner, info, notify, retained: () => retained, handlers, original, setNow: (value: number) => { now = value; }, send,
    phase: () => vm.runInContext('globalThis.__dbarkDefinitionCreate?.phase', context), safe: () => vm.runInContext('globalThis.__dbarkDefinitionCreate?.safe', context), restore: () => vm.runInContext('globalThis.__dbarkDefinitionCreate.restore()', context) };
}
const preview = { ok: true, result: { target: { connectionId: 'c' }, name: '本例库', previewToken: '本例令牌' } };
const ack = { ok: true, result: { name: '本例库', ddlSubmitted: true, ddlCompleted: true, definitionVerified: true } };
const apply = { previewToken: '本例令牌', confirmation: '本例库' };

describe('W03本地永久停链与原期限', () => {
  it.each(['throw', 'noop'] as const)('通知%s也先落本地永久锁，不能因共享状态未变化恢复', notify => {
    const f = fixture({ notify }), state = f.api.beginDefinitionNavigationCase(f.info); state.retain(); expect(state.retained).toBe(true); expect(f.retained()).toBe(false); expect(() => state.check()).toThrow('已停链'); expect(f.notify).toHaveBeenCalledOnce();
  });
  it('从框架开始时间计算原90秒，不能从helper启动时重新给足90秒', () => {
    const f = fixture(); f.setNow(89999); const state = f.api.beginDefinitionNavigationCase(f.info); expect(state.deadline).toBe(90000); state.check(); f.setNow(90000); expect(() => state.check()).toThrow('原期限'); f.setNow(1); expect(() => state.check()).toThrow();
  });
  it.each(['timedOut', 'interrupted', 'skipped'])('框架终态%s先阻断，即使共享owner仍有效', status => {
    const f = fixture(), state = f.api.beginDefinitionNavigationCase(f.info); f.info.status = status; expect(() => state.check()).toThrow(); f.info.status = 'passed'; expect(() => state.check()).toThrow();
  });
  it('afterEach先终止仍活动的body，迟到finally不能恢复；同TestInfo不能重开', () => {
    const f = fixture(), state = f.api.beginDefinitionNavigationCase(f.info); expect(() => f.api.finishDefinitionNavigationCase(f.info)).toThrow(); expect(state.active).toBe(false); expect(f.api.beginDefinitionNavigationCase(f.info)).toBe(state); expect(() => state.check()).toThrow();
  });
  it('缺框架原始起点时明确停链，不以当前时间补造期限', () => {
    const f = fixture(); delete f.info._startWallTime; const state = f.api.beginDefinitionNavigationCase(f.info); expect(() => state.check()).toThrow(); expect(state.retained).toBe(true);
  });
  it('正常已知断言失败不自动视为命令未知，完成活动后允许afterEach确认', () => {
    const f = fixture(), state = f.api.beginDefinitionNavigationCase(f.info); f.info.status = 'failed'; state.check(); state.active = false; expect(() => f.api.finishDefinitionNavigationCase(f.info)).not.toThrow(); expect(state.retained).toBe(false);
  });
});

describe('W03准确CREATE回包旁观（真实handler控制流、仅RAM传输）', () => {
  it('绑定原窗口、预览目标、令牌、名称及真实成功回包；完整返回原响应对象', async () => {
    const f = fixture(); await f.api.watch(f.owner, 'c', '本例库'); expect(f.phase()).toBe('absent');
    expect(await f.send('schema.databaseCreate.preview', {}, preview)).toBe(preview); expect(await f.send('schema.databaseCreate.apply', apply, ack)).toBe(ack); expect(f.phase()).toBe('confirmed'); f.restore(); expect(f.handlers.get('dbark:request')).toBe(f.original);
  });
  it.each(['其它窗口', '其它连接', '其它库', '其它令牌', '其它确认名', '失败信封', '未完成ACK', '未核验ACK'])('%s不得授予清理权限，仍返回原始响应', async fault => {
    const f = fixture(); await f.api.watch(f.owner, 'c', '本例库');
    const response = structuredClone(preview), input = { ...apply }, result = structuredClone(ack);
    if (fault === '其它连接') response.result.target.connectionId = '另一连接'; if (fault === '其它库') response.result.name = '另一库';
    await f.send('schema.databaseCreate.preview', {}, response, fault === '其它窗口' ? 202 : 101);
    if (fault === '其它令牌') input.previewToken = '另一令牌'; if (fault === '其它确认名') input.confirmation = '另一库';
    if (fault === '失败信封') result.ok = false; if (fault === '未完成ACK') result.result.ddlCompleted = false; if (fault === '未核验ACK') result.result.definitionVerified = false;
    expect(await f.send('schema.databaseCreate.apply', input, result)).toBe(result); expect(f.phase()).toBe('unknown');
  });
  it('重复apply不会借第一次成功状态授予第二次清理权限', async () => {
    const f = fixture(); await f.api.watch(f.owner, 'c', '本例库'); await f.send('schema.databaseCreate.preview', {}, preview); await f.send('schema.databaseCreate.apply', apply, ack); await f.send('schema.databaseCreate.apply', apply, ack); expect(f.phase()).toBe('confirmed'); expect(f.safe()).toBe(false);
  });
  it('处理器被替换时拒绝恢复覆盖，保留其它处理器', async () => {
    const f = fixture(); await f.api.watch(f.owner, 'c', '本例库'); const replacement = vi.fn(); f.handlers.set('dbark:request', replacement); expect(() => f.restore()).toThrow('处理器已变化'); expect(f.handlers.get('dbark:request')).toBe(replacement);
  });
});

/** 同一原生流模拟真实QUIT回调、写入结束及close事件，不替换严格关闭函数。 */
function nativeConnection() {
  const emitter = new EventEmitter();
  const stream = { closed: false, once: emitter.once.bind(emitter), removeListener: emitter.removeListener.bind(emitter), end(callback: () => void) { callback(); queueMicrotask(() => { stream.closed = true; emitter.emit('close'); }); }, destroy() {} };
  const native = { stream, end(callback: () => void) { queueMicrotask(callback); }, destroy() {} };
  return { raw: { connection: native }, native, stream };
}
describe('W03同一观察连接原生流关闭证明', () => {
  it('正常对照使用实际严格关闭函数，QUIT及写完成后等待同一stream close', async () => {
    const f = fixture(), value = nativeConnection(); await f.api.close(value.raw, value.native, value.stream, f.owner, 90000); expect(value.stream.closed).toBe(true); expect(f.owner.assertCurrent).toHaveBeenCalledTimes(2);
  });
  it.each(['无原生流', '替换连接', '替换流', 'Promise解析但流未关'])('%s不得宣称收尾完整', async fault => {
    const close = vi.fn(async () => {}), f = fixture({ nativeClose: close }), value = nativeConnection();
    if (fault === '无原生流') (value.native as any).stream = undefined; if (fault === '替换连接') value.raw.connection = { ...value.native }; if (fault === '替换流') value.native.stream = { ...value.stream };
    await expect(f.api.close(value.raw, value.native, value.stream, f.owner, 90000)).rejects.toThrow(); expect(close).toHaveBeenCalledTimes(fault === 'Promise解析但流未关' ? 1 : 0);
  });
});
