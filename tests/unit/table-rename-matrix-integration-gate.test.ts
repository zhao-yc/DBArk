import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import {
  bindTableRenameMatrixTarget, tableRenameMatrixGate, watchTableRenameMatrixConnection,
  proveTableRenameMdlTerminal, assertTableRenameMatrixReleased, type TableRenameMatrixLifetime,
} from '../helpers/tableRenameMatrixIntegration';

/** RAM配置仅检验新门，不载入Engine、访问认证文件或连接数据库。 */
function config(): Record<string, string | undefined> {
  return {
    DBARK_INTEGRATION_ENABLED: '1', [tableRenameMatrixGate]: '1', DBARK_TEST_HOST: '192.168.31.200',
    DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'ram', DBARK_TEST_PASSWORD: '',
    DBARK_TEST_EXPECTED_SERVER_HOSTNAME: 'server-200-ram', DBARK_TEST_EXPECTED_SERVER_ID: '1',
    DBARK_TEST_EXPECTED_SERVER_PORT: '3306', DBARK_TEST_EXPECTED_SERVER_UUID: '12345678-1234-1234-1234-123456789abc',
  };
}

describe('表重命名兼容实库独立双门', () => {
  it('只绑定本轮显式目标，空密码不能被默认值替换', () => {
    const env = config(), binding = bindTableRenameMatrixTarget(() => env, 'ram');
    expect(binding.profile).toMatchObject({ host: '192.168.31.200', port: 13384, password: '' });
    expect(Object.isFrozen(binding.profile)).toBe(true); binding.assertCurrent();
  });
  it.each(Object.keys(config()))('缺少%s拒绝实库绑定', key => {
    const env = config(); delete env[key]; expect(() => bindTableRenameMatrixTarget(() => env, 'ram')).toThrow();
  });
  it.each(['DBARK_INTEGRATION_ENABLED', tableRenameMatrixGate])('%s必须明确为1', key => {
    for (const value of ['0', '2', '', undefined]) expect(() => bindTableRenameMatrixTarget(() => ({ ...config(), [key]: value }), 'ram')).toThrow();
  });
  it.each([
    ['13357', 'mysql', '5.7.44'], ['13380', 'mysql', '8.0.46'], ['13384', 'mysql', '8.4.11'],
    ['13310', 'mariadb', '10.11.19'], ['13311', 'mariadb', '11.4.13'], ['13484', 'mysql', '8.4.11'],
  ])('端口%s有明确方言版本，不预拒旧版', (port, dialect, version) => {
    const env = { ...config(), DBARK_TEST_PORT: port, DBARK_TEST_TLS: port === '13484' ? '1' : '0', ...(port === '13484' ? { DBARK_TEST_CA: 'ram-ca.pem' } : {}) };
    const binding = bindTableRenameMatrixTarget(() => env, 'ram');
    expect(binding.profile.port).toBe(Number(port)); expect(binding.dialect).toBe(dialect); expect(binding.version).toBe(version);
    expect(binding.profile.tls?.rejectUnauthorized).toBe(port === '13484' ? true : undefined);
  });
  it.each(['DBARK_DATABASE_DEFAULT_ENCODING_TEST', 'DBARK_TABLE_RENAME_TEST'])('拒绝混入旧用途门%s', key => {
    for (const value of ['1', '0', undefined]) expect(() => bindTableRenameMatrixTarget(() => ({ ...config(), [key]: value }), 'ram')).toThrow();
  });
  it('任意端口或缺失严格TLS准备不得放行', () => {
    expect(() => bindTableRenameMatrixTarget(() => ({ ...config(), DBARK_TEST_PORT: '3306' }), 'ram')).toThrow();
    expect(() => bindTableRenameMatrixTarget(() => ({ ...config(), DBARK_TEST_PORT: '13484', DBARK_TEST_TLS: '1' }), 'ram')).toThrow();
    expect(() => bindTableRenameMatrixTarget(() => ({ ...config(), DBARK_TEST_PORT: '13484', DBARK_TEST_TLS: '0', DBARK_TEST_CA: 'ram-ca.pem' }), 'ram')).toThrow();
  });
  it.each(['DBARK_TEST_SSH', 'DBARK_TEST_CERT', 'DBARK_TEST_KEY', 'DBARK_TEST_DATABASE', 'NODE_OPTIONS'])('拒绝配置旁路%s', key => {
    expect(() => bindTableRenameMatrixTarget(() => ({ ...config(), [key]: 'other' }), 'ram')).toThrow();
  });
  it.each(['DBARK_TEST_HOST', 'DBARK_INTEGRATION_ENABLED', tableRenameMatrixGate])('%s漂移后恢复原值仍拒绝', key => {
    const env = config(), before = env[key], binding = bindTableRenameMatrixTarget(() => env, 'ram');
    env[key] = 'changed'; expect(binding.assertCurrent).toThrow(); env[key] = before; expect(binding.assertCurrent).toThrow();
  });
});

/** RAM原事件端口复现驱动两条结算路径；事实始终由真正旁观器采集，不手写成功trace或pending。 */
class TerminalNative extends EventEmitter {
  readonly stream = Object.assign(new EventEmitter(), { readableEnded: false, closed: false });
  _closing: unknown = undefined;
  _command: EventEmitter | undefined;
  callback?: (error: Error | null, rows?: unknown) => unknown;
  constructor(readonly threadId: number) {
    super();
    this.stream.on('end', () => this.emit('end'));
    // 与原驱动相同：未主动closing的远端close才通知仍等待的原回调。
    this.stream.on('close', () => {
      if (this._closing || !this._command) return;
      this.callback?.(Object.assign(new Error('RAM远端连接关闭'), { code: 'PROTOCOL_CONNECTION_LOST' })); this._command = undefined;
    });
  }
  /** 返回真实同一个事件对象，旁观器须保留其身份与原回调。 */
  query(_sql: string, callback: (error: Error | null, rows?: unknown) => unknown) {
    this._command = new EventEmitter(); this.callback = callback; return this._command;
  }
  /** 本例没有预处理语义，仅保持原接口供旁观器包装。 */
  execute(sql: string, _values: unknown[], callback: (error: Error | null, rows?: unknown) => unknown) { return this.query(sql, callback); }
  /** local destroy不补查询回调，保留真实B分支的未回调状态。 */
  destroy() { this._closing = true; }
  /** 远端可读FIN与本地close独立可控，不用sleep伪造事件顺序。 */
  remoteFin(readable = true) { this.stream.readableEnded = readable; this.stream.emit('end'); }
  /** 原流只发一次close，不把重复managed.close伪装成新物理对象。 */
  closeStream() { if (!this.stream.closed) { this.stream.closed = true; this.stream.emit('close'); } }
  /** mysql2成功命令的end先于nextTick回调，模拟同样的可观察先后关系。 */
  acknowledge(error: Error | null = null) {
    this._command?.emit('end'); this._command = undefined; this.callback?.(error, error ? undefined : { affectedRows: 0, warningStatus: 0, serverStatus: 2 });
  }
}

/** 每条用例独占原对象/一次凭证；所有网络与库读取仍是RAM端口，绝不接触实库。 */
async function terminalFixture(options: { branch?: 'A' | 'B'; localFirst?: boolean; omitFin?: boolean; unreadFin?: boolean; wrongQuery?: boolean; unknownClosing?: boolean; ack?: 'missing' | 'error'; abortBeforeAck?: boolean } = {}) {
  const owner = { check: vi.fn(), stop: vi.fn() } as unknown as TableRenameMatrixLifetime, controller = new AbortController();
  const original = new TerminalNative(41), control = new TerminalNative(42), sql = 'RENAME TABLE `ram`.`before` TO `ram`.`after`;';
  /** close方法只操作原流，严格次数由基类旁观器计数。 */
  const managed = (native: TerminalNative, signal?: AbortSignal) => {
    const value = { connection: native, signal, broken: false, close: async () => { native.destroy(); native.closeStream(); } } as unknown as ManagedConnection;
    native.on('end', () => { value.broken = true; }); signal?.addEventListener('abort', () => native.destroy(), { once: true }); return value;
  };
  const originalManaged = managed(original, controller.signal), controlManaged = managed(control);
  const source = watchTableRenameMatrixConnection(originalManaged, 'original', owner, () => sql, () => 41);
  const killer = watchTableRenameMatrixConnection(controlManaged, 'control', owner, () => sql, () => 41);
  const received = vi.fn(), killReceived = vi.fn(); original.query(sql, received); control.query('KILL CONNECTION 41', killReceived);
  if (options.localFirst) original.destroy(); if (options.unknownClosing) original._closing = 'unknown';
  if (options.wrongQuery) original._command = new EventEmitter();
  if (!options.omitFin) original.remoteFin(!options.unreadFin);
  if (options.branch === 'A') original.closeStream();
  if (options.abortBeforeAck) controller.abort();
  if (options.ack !== 'missing') control.acknowledge(options.ack === 'error' ? Object.assign(new Error('RAM控制错误'), { errno: 1094 }) : null);
  controller.abort(); await originalManaged.close({ strict: true }); await controlManaged.close({ strict: true });
  const reader = vi.fn(async (_ids: readonly number[]) => [] as unknown[]);
  return { source, killer, original, control, originalManaged, controlManaged, owner, received, killReceived, reader,
    prove: () => proveTableRenameMdlTerminal(source, killer, owner, reader),
    release: () => assertTableRenameMatrixReleased([source, killer], true) };
}

describe('重命名MDL专用原生终态证明', () => {
  it('A保留原失败回调与pending0，并在原线程0后登记同一原对象', async () => {
    const test = await terminalFixture({ branch: 'A' }), receipt = await test.prove();
    expect(receipt).toEqual({ branch: 'failed-callback', originalThreadId: 41, controlThreadId: 42, rawCallbackCount: 1, rawPending: 0, serverThreadsRemaining: 0 });
    expect(test.received).toHaveBeenCalledTimes(1); expect(test.source.pending).toBe(0); expect(test.reader).toHaveBeenCalledTimes(1); expect(test.reader).toHaveBeenCalledWith([41, 42]);
    test.release(); expect(Object.isFrozen(receipt)).toBe(true);
  });
  it('B原FIN早于本地销毁，仍保留callback0/pending1和空失败数组', async () => {
    const test = await terminalFixture();
    expect(() => test.release()).toThrow(); const receipt = await test.prove();
    expect(receipt).toEqual({ branch: 'remote-fin', originalThreadId: 41, controlThreadId: 42, rawCallbackCount: 0, rawPending: 1, serverThreadsRemaining: 0 });
    expect(test.received).not.toHaveBeenCalled(); expect(test.source.pending).toBe(1); expect(test.source.renameFailed).toEqual([]); expect(test.source.renameErrors).toEqual([]);
    test.release(); expect(test.source.pending).toBe(1); expect(test.reader).toHaveBeenCalledTimes(1); expect(test.reader).toHaveBeenCalledWith([41, 42]);
    await expect(test.prove()).rejects.toThrow('不能重复签发');
  });
  it('普通原回调已结算的连接仍可直接使用基类严格释放门', async () => {
    const test = await terminalFixture({ branch: 'A' }); test.release(); expect(test.reader).not.toHaveBeenCalled(); expect(test.source.pending).toBe(0);
  });
  it('非原生空行数组的线程响应不能被当作零残留', async () => {
    const test = await terminalFixture(); await expect(proveTableRenameMdlTerminal(test.source, test.killer, test.owner, async () => ({ length: 0 }))).rejects.toThrow('原线程仍存在');
  });
  it.each([
    ['本地destroy先于FIN', { localFirst: true }], ['只有close没有FIN', { omitFin: true }], ['可读端尚未结束', { unreadFin: true }],
    ['不同原Query身份', { wrongQuery: true }], ['未知closing状态', { unknownClosing: true }], ['没有真实KILL ACK', { ack: 'missing' }],
    ['KILL错误响应', { ack: 'error' }], ['本地abort先于KILL ACK', { abortBeforeAck: true }],
  ] as const)('%s不能获得B凭证', async (_label, options) => {
    const test = await terminalFixture(options); await expect(test.prove()).rejects.toThrow(); expect(test.reader).not.toHaveBeenCalled();
  });
  it('准确原线程仍在服务端时拒绝，且不能改用第二次读取签收', async () => {
    const test = await terminalFixture(); test.reader.mockResolvedValueOnce([{ ID: 41 }]);
    await expect(test.prove()).rejects.toThrow('原线程仍存在'); expect(test.source.pending).toBe(1); expect(() => test.release()).toThrow();
    await expect(test.prove()).rejects.toThrow('不能重复签发'); expect(test.reader).toHaveBeenCalledTimes(1);
  });
  it('控制线程仍在服务端也不能释放原观察器锁', async () => {
    const test = await terminalFixture(); test.reader.mockResolvedValueOnce([{ ID: 42 }]); await expect(test.prove()).rejects.toThrow('原线程仍存在');
  });
  it('错KILL目标和额外控制投递不是准确取消证据', async () => {
    const test = await terminalFixture(); test.killer.killConnections[0] = 99; await expect(test.prove()).rejects.toThrow('准确原线程KILL');
    expect(() => test.control.query('KILL CONNECTION 99', vi.fn())).toThrow('精确许可');
  });
  it.each(['missing', 'order', 'replace', 'overflow'] as const)('事件%s破坏完整性时不能签收', async kind => {
    const test = await terminalFixture();
    if (kind === 'missing') test.source.trace.splice(1, 1);
    else if (kind === 'order') test.source.trace.reverse();
    else if (kind === 'replace') test.source.trace[0] = { ...test.source.trace[0] };
    else { for (let i = 0; i < 257; i++) test.original.emit('end'); expect(test.source.trace.length).toBeLessThanOrEqual(256); expect(test.source.traceOverflow).toBe(true); test.source.traceOverflow = false; }
    await expect(test.prove()).rejects.toThrow('完整有界事件'); expect(test.reader).not.toHaveBeenCalled();
  });
  it('重复close不能冒充一次严格收尾', async () => {
    const test = await terminalFixture(); await test.originalManaged.close({ strict: true }); expect(test.source.closeCalls).toBe(2); await expect(test.prove()).rejects.toThrow();
  });
  it('原线程读取期间的迟到成功回调使证明失败，原计数由真实回调自然变化', async () => {
    const test = await terminalFixture(); test.reader.mockImplementationOnce(async () => { test.original.callback!(null, { affectedRows: 0, warningStatus: 0 }); return []; });
    await expect(test.prove()).rejects.toThrow(); expect(test.received).toHaveBeenCalledTimes(1); expect(test.source.pending).toBe(0); expect(() => test.release()).toThrow('未成功签收');
  });
  it('已签B凭证后迟到成功回调不能继续复用，绝不将它隐藏为callback0', async () => {
    const test = await terminalFixture(); await test.prove(); test.original.callback!(null, { affectedRows: 0, warningStatus: 0 });
    expect(test.source.renameCallbackCount).toBe(1); expect(test.source.pending).toBe(0); expect(() => test.release()).toThrow();
  });
  it.each(['query', 'trace', 'strict', 'copy'] as const)('凭证后%s变化或伪造副本被拒绝', async kind => {
    const test = await terminalFixture(); await test.prove();
    if (kind === 'query') test.original._command = new EventEmitter();
    else if (kind === 'trace') test.source.trace = [...test.source.trace];
    else if (kind === 'strict') test.source.strict = false;
    else { expect(() => assertTableRenameMatrixReleased([{ ...test.source, pending: 0 }], true)).toThrow('复制事实'); return; }
    expect(() => test.release()).toThrow();
  });
});
