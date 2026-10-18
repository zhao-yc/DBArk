import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { observeNativeStartupWire, attachNativeStartupWires } from '../e2e/editor-native-startup-wire';
import { observeNativeStartup, createNativeStartupWaits, attachNativeStartupDiagnostics } from '../e2e/editor-native-startup-diagnostics';
import { bindEditorIndentNativeCase } from '../e2e/editor-indentation-native-gate';
import { nativeStartupSdkCollector } from '../fixtures/native-startup-sdk-collector';

/** 只抽取固定SDK的实际日志缓存类，所有端口均RAM，不加载Playwright运行时或建立连接。 */
const Collector = nativeStartupSdkCollector();

/** 原child、SDK缓存与console是三种实际读入路径，只有SDK映射/进程对象由RAM提供。 */
function port(active = () => true, early: string[] = [], patch: Record<string, unknown> = {}) {
  const child = { pid: 101, stdout: new EventEmitter(), stderr: new EventEmitter() }, app = {}, collector = new Collector();
  early.forEach(value => collector.log(value));
  const implementation = { _process: child, _browserContext: { _browser: { options: { name: 'electron', browserLogsCollector: collector } } } };
  const load = vi.fn(() => ({ version: '1.64.0', implementation, ...patch }));
  const wire = observeNativeStartupWire(app, child, active, load);
  return { wire, child, collector, load };
}

it('真实SDK重放早于console挂接的原stdout/stderr，之后原流和console仍能分别留固定标记', () => {
  const f = port(() => true, ['[pid=101][out] DBARK_STARTUP_V1:30', '[pid=101][err] DBARK_STARTUP_V1:31', '[pid=999][out] DBARK_STARTUP_V1:33', '[pid=101][out] SELECT 密码']);
  expect(f.wire.data.events).toEqual([[1, 30], [2, 31]]); expect(f.wire.data.earlyCoverage).toBe(1);
  f.collector.log('[pid=101][out] DBARK_STARTUP_V1:32'); f.child.stdout.emit('data', Buffer.from('DBARK_STARTUP_V1:32\n')); f.child.stdout.emit('data', Buffer.from('DBARK_STARTUP_')); f.child.stdout.emit('data', Buffer.from('V1:1\r\n'));
  f.child.stderr.emit('data', Buffer.from('DBARK_STARTUP_V1:2\n')); f.wire.console('DBARK_STARTUP_V1:8');
  expect(f.wire.data.events).toEqual([[1, 30], [2, 31], [3, 32], [3, 1], [4, 2], [5, 8]]);
  expect(JSON.stringify(f.wire.data)).not.toMatch(/SELECT|密码|pid|路径/); f.wire.stop();
});

it('关闭或已失效入口不读SDK/流端口；无标记只表示未观察，附件不宣称没有调用', async () => {
  const forbidden = new Proxy({}, { get() { throw Error('不许读取原生端口'); } }), load = vi.fn(() => { throw Error('不能读取版本文件'); });
  const wire = observeNativeStartupWire(forbidden, forbidden, () => false, load); expect(load).not.toHaveBeenCalled(); expect(wire.data.stopped).toBe(true);
  const attach = vi.fn(async () => {}); await attachNativeStartupWires({ attach }, { owners: [] }); expect(attach).not.toHaveBeenCalled();
  const active = port(); await attachNativeStartupWires({ attach }, { owners: [{ startupWire: active.wire }] });
  expect(JSON.parse((attach.mock.calls[0] as any)[1].body.toString()).missingMarkerMeansNotCalled).toBe(false); active.wire.stop();
});

it.each(['1.63.0', '1.65.0'])('SDK版本%s拒绝早期覆盖且收集失败不带原错误内容', async version => {
  const f = port(() => true, [], { version }), attach = vi.fn(async () => {});
  expect(f.wire.data).toMatchObject({ failed: true, earlyCoverage: 0 });
  await expect(attachNativeStartupWires({ attach }, { owners: [{ startupWire: f.wire }] })).rejects.toThrow('收集失败'); expect(attach).toHaveBeenCalledOnce(); f.wire.stop();
});

it('同版本SDK实现或映射漂移不能领取原生操作权限，也不能伪造已覆盖早期日志', () => {
  const bad = { _process: {}, _browserContext: { _browser: { options: { name: 'electron' } } } };
  const f = port(() => true, [], { implementation: bad }); expect(f.wire.data).toMatchObject({ failed: true, earlyCoverage: 0 }); f.wire.stop();
  const child = { pid: 1, stdout: new EventEmitter(), stderr: new EventEmitter() };
  const wire = observeNativeStartupWire({}, child, () => true, () => ({ version: '1.64.0', implementation: { _process: child, _browserContext: { _browser: { options: { name: 'electron', browserLogsCollector: { onMessage() {}, recentLogs() { return []; } } } } } } }));
  expect(wire.data).toMatchObject({ failed: true, earlyCoverage: 0 }); wire.stop();
});

it('所有chunk切分、超长/秘密/非ASCII行只保留白名单，64事件与1024丢弃封顶', () => {
  const text = 'DBARK_STARTUP_V1:24\n';
  for (let at = 0; at <= text.length; at++) { const f = port(); f.child.stdout.emit('data', Buffer.from(text.slice(0, at))); f.child.stdout.emit('data', Buffer.from(text.slice(at))); expect(f.wire.data.events).toEqual([[3, 24]]); f.wire.stop(); }
  const f = port();
  for (const text of ['SELECT password=秘密 DBARK_STARTUP_V1:30\n', 'DBARK_STARTUP_V1:30 extra\n', 'DBARK_STARTUP_V1:09\n', 'DBARK_STARTUP_V1:98\n', '/绝对路径/DBARK_STARTUP_V1:30\n', 'DBARK_STARTUP_V1:30\0\n']) f.child.stderr.emit('data', Buffer.from(text));
  f.child.stdout.emit('data', Buffer.alloc(1000000, 65)); f.child.stdout.emit('data', Buffer.from('\nDBARK_STARTUP_V1:1\n'));
  for (let index = 0; index < 3000; index++) f.wire.console('DBARK_STARTUP_V1:24');
  expect(f.wire.data.events).toHaveLength(64); expect(f.wire.data.events[0]).toEqual([3, 1]); expect(f.wire.data.dropped).toBe(1024); expect(JSON.stringify(f.wire.data)).not.toMatch(/password|秘密|绝对路径|extra/); f.wire.stop();
});

it('原TestInfo替换/保留后永久封存，迟到SDK重放或原流不能污染下一owner，不增加时钟/权限调用', () => {
  const original = { startTime: new Date(1000), timeout: 120000, status: 'passed' }; let current = original;
  const clock = vi.fn(() => 1020), environment = { assertCurrent: vi.fn() }, scope = bindEditorIndentNativeCase(original, environment, () => current, clock); scope.assertCurrent();
  const reads = clock.mock.calls.length, gates = environment.assertCurrent.mock.calls.length, f = port(scope.observationActive);
  f.child.stdout.emit('data', Buffer.from('DBARK_STARTUP_V1:1\n')); expect(clock).toHaveBeenCalledTimes(reads); expect(environment.assertCurrent).toHaveBeenCalledTimes(gates);
  current = { ...original }; f.collector.log('[pid=101][out] DBARK_STARTUP_V1:2'); current = original;
  const before = JSON.stringify(f.wire.data); f.child.stderr.emit('data', Buffer.from('DBARK_STARTUP_V1:3\n')); f.wire.console('DBARK_STARTUP_V1:4'); f.collector.log('[pid=101][out] DBARK_STARTUP_V1:5');
  expect(JSON.stringify(f.wire.data)).toBe(before); expect(f.wire.data.stopped).toBe(true); expect(f.child.stdout.listenerCount('data')).toBe(0); expect(f.child.stderr.listenerCount('error')).toBe(0);
  const next = port(); expect(next.wire.data.events).toEqual([]); next.wire.stop();
});

it('两个owner饱和记录独占小于2KiB；旧最坏8106字节正文不变，原断言与来源均不删减', async () => {
  const a = port(), b = port(); for (let index = 0; index < 1088; index++) { a.wire.console('DBARK_STARTUP_V1:33'); b.wire.console('DBARK_STARTUP_V1:33'); }
  const app = new EventEmitter() as any, context = new EventEmitter() as any, pages = Array.from({ length: 4 }, () => Object.assign(new EventEmitter(), { url: () => 'devtools://不能记录' }));
  context.pages = () => pages; app.context = () => context; const observed = observeNativeStartup(app, () => {}, 'RAM-marker', () => 119999); observed.firstWindow(pages[3] as any); observed.statusbar();
  for (let i = 0; i < 1056; i++) pages[i % 4].emit('console', { type: () => 'error' });
  const n = Number.MAX_SAFE_INTEGER, source = { phase: '已准备来源', complete: false, expected: { launcherPid: n, mainPid: n, platform: 'darwin', relation: '启动器父进程', window: { id: n, contents: n } }, observed: { mainPid: n, parentPid: n, platform: 'darwin', metrics: Array(64).fill(n), window: { id: n, contents: n, renderer: n, destroyed: false } } };
  const owner = { startupDiagnostics: observed.data, sourceDiagnostics: Array(12).fill(source) } as any, waits = createNativeStartupWaits(() => 119999, () => true); for (let i = 0; i < 1088; i++) waits.record((i % 8) as any, 8);
  const baseline = vi.fn(async (_name: string, _options: any) => {}); await attachNativeStartupDiagnostics({ attach: baseline, errors: [] }, { owners: [owner, owner], startupWaits: waits });
  const attach = vi.fn(async (_name: string, _options: any) => {}); await attachNativeStartupDiagnostics({ attach, errors: [] }, { owners: [{ ...owner, startupWire: a.wire }, { ...owner, startupWire: b.wire }], startupWaits: waits });
  expect(attach.mock.calls.map(call => call[0])).toEqual(['原生启动有界观察', '原生启动固定标记']); expect(attach.mock.calls[0][1].body).toEqual(baseline.mock.calls[0][1].body); expect(attach.mock.calls[0][1].body.byteLength).toBe(8106); expect(attach.mock.calls[1][1].body.byteLength).toBeLessThanOrEqual(2048);
  expect(JSON.parse(attach.mock.calls[0][1].body).waits.points).toHaveLength(64); expect(a.wire.data.stopped).toBe(true); expect(b.wire.data.stopped).toBe(true);
});

it('日志/附件失败不会改写原失败对象，原附件失败后仍尝试新附件，且只封存本地观察', async () => {
  const f = port(), original = { message: '原120秒失败' }; f.child.stderr.emit('error', Error('秘密凭据')); const attach = vi.fn(async (_name: string, _options: any) => {});
  await expect(attachNativeStartupDiagnostics({ attach, errors: [original] }, { owners: [{ startupWire: f.wire }] as any })).rejects.toMatchObject({ cause: original, errors: [original, { message: '启动固定标记收集失败，原用例结果与资源权限保持' }] });
  expect(JSON.stringify(f.wire.data)).not.toContain('秘密');
  const g = port(), failed = Error('原附件错误'), writes: string[] = [], broken = vi.fn(async (name: string) => { writes.push(name); throw failed; });
  const startupDiagnostics = { version: 1, coverage: 'launch-returned-to-prepare-done', preloadCoverage: 'hook-forward-only', pages: 0, events: [], dropped: 0, prepared: false };
  await expect(attachNativeStartupDiagnostics({ attach: broken, errors: [original] }, { owners: [{ startupWire: g.wire, startupDiagnostics }] as any })).rejects.toMatchObject({ errors: [{ cause: original, errors: [original, failed] }, failed] });
  expect(writes).toEqual(['原生启动有界观察', '原生启动固定标记']); expect(g.wire.data.stopped).toBe(true);
});

it('stream挂接中途失败仍登记本观察清理，stop不遗留半个监听或触碰其他消费者', () => {
  const f = port(); f.wire.stop(); const stdout = new EventEmitter(), stderr = new EventEmitter(), previous = () => {};
  stdout.on('data', previous); const original = stdout.on; stdout.on = function (name, listener) { if (name === 'error') throw Error('合成挂接错误'); return original.call(this, name, listener); };
  const child = { pid: 101, stdout, stderr }, collector = new Collector();
  const wire = observeNativeStartupWire({}, child, () => true, () => ({ version: '1.64.0', implementation: { _process: child, _browserContext: { _browser: { options: { name: 'electron', browserLogsCollector: collector } } } } }));
  expect(wire.data.failed).toBe(true); wire.stop(); expect(stdout.listeners('data')).toEqual([previous]); expect(stderr.listenerCount('data')).toBe(0);
});

it('版本读取或早期重放期间原scope失效时不再写coverage或接流，ABA也不能恢复', () => {
  let active = true; const child = { pid: 101, stdout: new EventEmitter(), stderr: new EventEmitter() }, collector = new Collector();
  const implementation = { _process: child, _browserContext: { _browser: { options: { name: 'electron', browserLogsCollector: collector } } } };
  const wire = observeNativeStartupWire({}, child, () => active, () => { active = false; return { version: '1.64.0', implementation }; });
  expect(wire.data).toMatchObject({ stopped: true, earlyCoverage: 0, events: [] }); expect(child.stdout.listenerCount('data')).toBe(0);
  active = true; const before = JSON.stringify(wire.data); wire.console('DBARK_STARTUP_V1:30'); expect(JSON.stringify(wire.data)).toBe(before);
  let checks = 0; collector.log('[pid=101][out] DBARK_STARTUP_V1:30');
  const replay = observeNativeStartupWire({}, child, () => ++checks < 3, () => ({ version: '1.64.0', implementation }));
  expect(replay.data).toMatchObject({ stopped: true, earlyCoverage: 0, events: [] }); expect(child.stderr.listenerCount('data')).toBe(0);
});
