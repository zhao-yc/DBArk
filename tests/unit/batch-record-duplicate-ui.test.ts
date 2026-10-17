import { expect, it, vi } from 'vitest';
import { bindBatchDuplicateTarget, batchDuplicateTargetKeys, BatchDuplicateLifecycle, BatchDuplicatePreparation, batchDuplicateDigest } from '../helpers/batchRecordDuplicateUi';

/** 全部参数和所有者均为内存哨兵；不读取实际环境或认证。 */
function parameters() { return { DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '内存账号', DBARK_TEST_PASSWORD: '', DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001', DBARK_BATCH_DUPLICATE_DATABASE: 'dbark_batch_ram', DBARK_BATCH_DUPLICATE_TABLE: 'subject', DBARK_BATCH_DUPLICATE_DDL_SHA256: 'a'.repeat(64), DBARK_BATCH_DUPLICATE_ROWS_SHA256: 'b'.repeat(64) } as Record<string, string | undefined>; }
function fixture() {
  let now = 10, current = true, closed = false;
  const info = { _startWallTime: 0, timeout: 120000, status: 'passed' }, retain = vi.fn(), confirmExit = vi.fn(async () => { closed = true; });
  const owner = { assertCurrent(allowClosed = false) { if (!current || closed && !allowClosed) throw Error('内存owner失效'); }, closed: () => closed, retain, confirmExit };
  const state = new BatchDuplicateLifecycle(owner, info, () => now);
  return { state, info, retain, confirmExit, owner, time: (value: number) => { now = value; }, change: () => { current = false; }, close: () => { closed = true; } };
}
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

it('只接收既有隔离表的显式参数和显式空密码，不生成或回填认证', () => {
  const raw = parameters(), helper = { ...raw }, binding = bindBatchDuplicateTarget(() => raw, helper); binding.assertCurrent();
  expect(binding.target.password).toBe(''); expect(binding.target.database).toBe('dbark_batch_ram'); expect(Object.isFrozen(binding.target)).toBe(true);
  delete raw.DBARK_TEST_PASSWORD; expect(() => bindBatchDuplicateTarget(() => raw, { ...raw })).toThrow('显式一致');
});
it.each(batchDuplicateTargetKeys.slice(0, 10))('%s缺少自有值、两份不一致或访问器均拒绝', key => {
  const raw = parameters(), helper = { ...raw, [key]: '不同' }; expect(() => bindBatchDuplicateTarget(() => raw, helper)).toThrow();
  const inherited = { ...raw }; delete inherited[key]; Object.setPrototypeOf(inherited, { [key]: raw[key] }); expect(() => bindBatchDuplicateTarget(() => inherited, { ...inherited })).toThrow();
  const getter = vi.fn(() => raw[key]); Object.defineProperty(raw, key, { enumerable: true, get: getter }); expect(() => bindBatchDuplicateTarget(() => raw, helper)).toThrow(); expect(getter).not.toHaveBeenCalled();
});
it.each([{ DBARK_TEST_HOST: '127.0.0.1' }, { DBARK_TEST_PORT: '13484' }, { DBARK_TEST_TLS: '1' }, { DBARK_BATCH_DUPLICATE_DATABASE: 'business' }, { DBARK_BATCH_DUPLICATE_TABLE: 'bad`table' }, { DBARK_BATCH_DUPLICATE_ROWS_SHA256: '' }, { DBARK_TEST_DATABASE: '旧默认库' }, { DBARK_TEST_SSH: '1' }, { DBARK_TEST_CA: '不允许证书' }, { DBARK_DEV_URL: '' }, { DBARK_EXECUTABLE_PATH: '' }])('拒绝非专项目标或不完整安装模式 %j', patch => {
  const raw = { ...parameters(), ...patch }; expect(() => bindBatchDuplicateTarget(() => raw, { ...raw })).toThrow();
});
it.each(['raw', 'helper'] as const)('%s中任一资源/认证绑定变化再恢复均永久失效', side => {
  for (const key of batchDuplicateTargetKeys) {
    const raw = parameters(), helper = { ...raw }, binding = bindBatchDuplicateTarget(() => raw, helper), value = side === 'raw' ? raw : helper, existed = Object.hasOwn(value, key), original = value[key];
    value[key] = '漂移'; expect(() => binding.assertCurrent()).toThrow('已变化'); if (existed) value[key] = original; else delete value[key]; expect(() => binding.assertCurrent()).toThrow('已变化');
  }
});
it('原始JSON文字/数字文本和字节快照摘要不经过解析或数值折叠', () => { expect(batchDuplicateDigest([{ number: '9007199254740993', doc: '{ "n":1 }', bytes: '00FF' }])).not.toBe(batchDuplicateDigest([{ number: '9007199254740992', doc: '{"n":1}', bytes: '00FF' }])); });
it('本例零持久任务、只读后核完成及真实退出后才可结算', async () => {
  const f = fixture(); await f.state.observe(async () => undefined); f.state.markReadOnlyVerified(); await f.state.finish(async () => []); f.state.endBody(); f.state.afterEach(); expect(f.confirmExit).toHaveBeenCalledTimes(1); expect(f.retain).not.toHaveBeenCalled();
});
it('没有只读后核、出现持久写任务或退出未闭合均保留，不借空列表证明隐藏读取', async () => {
  const missing = fixture(); await expect(missing.state.finish(async () => [])).rejects.toThrow('后核'); expect(missing.confirmExit).not.toHaveBeenCalled();
  const task = fixture(); task.state.markReadOnlyVerified(); await expect(task.state.finish(async () => [{ id: '写', kind: 'table.apply', status: 'completed' }])).rejects.toThrow('持久任务'); expect(task.confirmExit).not.toHaveBeenCalled();
  const close = fixture(); close.confirmExit.mockImplementation(async () => {}); close.state.markReadOnlyVerified(); await expect(close.state.finish(async () => [])).rejects.toThrow('退出未确认'); expect(close.retain).toHaveBeenCalledTimes(1);
});
it.each(['超时', '框架失败', '预算被改', '时钟倒退', 'owner漂移', '提前关闭'] as const)('%s永久停链，不能恢复后发起退出', async mode => {
  const f = fixture(); f.state.assertCurrent();
  if (mode === '超时') f.time(120000); if (mode === '框架失败') f.info.status = 'timedOut'; if (mode === '预算被改') f.info.timeout = 240000; if (mode === '时钟倒退') f.time(9); if (mode === 'owner漂移') f.change(); if (mode === '提前关闭') f.close();
  expect(() => f.state.assertCurrent()).toThrow(); f.time(11); f.info.status = 'passed'; f.info.timeout = 120000; await expect(f.state.finish(async () => [])).rejects.toThrow(); expect(f.confirmExit).not.toHaveBeenCalled(); expect(f.retain).toHaveBeenCalledTimes(1);
});
it('缺少TestInfo原起点不从body建立新120秒', () => { const f = fixture(); const state = new BatchDuplicateLifecycle(f.owner, { timeout: 120000, status: 'passed' }, () => 10); expect(() => state.assertCurrent()).toThrow('原期限'); });
it('超时afterEach先保留，原动作迟到落定也不能继续或退出', async () => {
  const f = fixture(), pending = gate(), operation = f.state.observe(() => pending.promise); f.time(120000); expect(() => f.state.afterEach()).toThrow(); pending.resolve(); await expect(operation).rejects.toThrow(); expect(f.confirmExit).not.toHaveBeenCalled(); expect(f.retain).toHaveBeenCalledTimes(1);
});
it('共享保留通知失败仍保持本地锁定；原操作异常不被通知异常替代', async () => {
  const f = fixture(), error = Error('原合成失败'); f.retain.mockImplementation(() => { throw Error('通知失败'); }); await expect(f.state.observe(async () => { throw error; })).rejects.toBe(error); await expect(f.state.finish(async () => [])).rejects.toThrow(); expect(f.retain).toHaveBeenCalledTimes(1);
});
it('退出或最后task读取跨await发生owner变化时不得结算', async () => {
  const f = fixture(); f.state.markReadOnlyVerified(); await expect(f.state.finish(async () => { f.change(); return []; })).rejects.toThrow(); expect(f.confirmExit).not.toHaveBeenCalled();
  const g = fixture(); g.state.markReadOnlyVerified(); g.confirmExit.mockImplementation(async () => { g.change(); g.close(); }); await expect(g.state.finish(async () => [])).rejects.toThrow(); g.state.endBody(); expect(() => g.state.afterEach()).toThrow();
});
it.each(['到期', '回退', '原起点变化'] as const)('P2 afterEach：body已完成后%s仍按原时钟永久保留', async mode => {
  const f = fixture(); f.state.markReadOnlyVerified(); await f.state.finish(async () => []); f.state.endBody();
  if (mode === '到期') f.time(120000); if (mode === '回退') f.time(9); if (mode === '原起点变化') f.info._startWallTime = 100000;
  expect(() => f.state.afterEach()).toThrow('原期限'); f.time(11); f.info._startWallTime = 0; expect(() => f.state.afterEach()).toThrow(); expect(f.retain).toHaveBeenCalledTimes(1); expect(f.confirmExit).toHaveBeenCalledTimes(1);
});
it('P2 启动准备：首次绑定原起点，通知保留和恢复参数均不能复活', () => {
  let now = 1; const info = { _startWallTime: 0, status: 'passed', timeout: 120000 }, state = new BatchDuplicatePreparation(info, () => now);
  state.assertCurrent(); now = 120000; expect(() => state.assertCurrent()).toThrow('原TestInfo'); now = 2; expect(() => state.assertCurrent()).toThrow();
  const retained = new BatchDuplicatePreparation(info, () => 2); retained.assertCurrent(); retained.preserve(); expect(() => retained.assertCurrent()).toThrow();
});
