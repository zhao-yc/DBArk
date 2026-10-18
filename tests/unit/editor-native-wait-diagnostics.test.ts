import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { bindEditorIndentNativeCase } from '../e2e/editor-indentation-native-gate';
import { createNativeStartupWaits, observeNativeStartup, attachNativeStartupDiagnostics, type NativeStartupWaitStage } from '../e2e/editor-native-startup-diagnostics';

it('等待轨迹只取原guard验证的相对时点缓存，不新增时钟读取或延长120秒', () => {
  const start = 1700000000000, info = { startTime: new Date(start), timeout: 120000, status: 'passed' }; let time = start + 10;
  const now = vi.fn(() => time), scope = bindEditorIndentNativeCase(info, { assertCurrent() {} }, () => info, now);
  const waits = createNativeStartupWaits(scope.elapsedMs, () => true);
  scope.assertCurrent(); const reads = now.mock.calls.length; waits.record(0, 1); waits.record(1, 1);
  expect(now).toHaveBeenCalledTimes(reads); expect(waits.data.points).toEqual([[0, 1, 10], [1, 1, 10]]);
  time = start + 30; scope.assertCurrent(); const next = now.mock.calls.length; waits.record(2, 1);
  expect(now).toHaveBeenCalledTimes(next); expect(waits.data.points.at(-1)).toEqual([2, 1, 30]);
  const before = JSON.stringify(waits.data); scope.retain();
  expect(() => { scope.assertCurrent(); waits.record(3, 1); }).toThrow(); expect(JSON.stringify(waits.data)).toBe(before);
  expect(before).not.toContain(String(start)); expect(info.timeout).toBe(120000);
});

it('等待轨迹固定64条和1024丢弃上限，墓碑或封存后不再取缓存或写旧case', () => {
  let alive = true; const elapsed = vi.fn(() => 119999), waits = createNativeStartupWaits(elapsed, () => alive);
  for (let index = 0; index < 4096; index++) waits.record((index % 8) as NativeStartupWaitStage, index % 8 + 1);
  expect(waits.data.points).toHaveLength(64); expect(waits.data.dropped).toBe(1024);
  const before = JSON.stringify(waits.data); alive = false; waits.record(0, 1); const calls = elapsed.mock.calls.length;
  alive = true; waits.record(1, 1); expect(elapsed).toHaveBeenCalledTimes(calls); expect(JSON.stringify(waits.data)).toBe(before);
  const empty = createNativeStartupWaits(undefined, () => true); empty.record(0, 1); expect(empty.data.points).toEqual([]);
  const sealed = createNativeStartupWaits(elapsed, () => true); sealed.seal(); sealed.record(0, 1); expect(elapsed).toHaveBeenCalledTimes(calls);
});

it('零owner的原扫描等待也可附纯内存，先封存再写附件，原超时与附件失败共同保留', async () => {
  const waits = createNativeStartupWaits(() => 40, () => true); waits.record(0, 1); waits.record(1, 1);
  const before = JSON.stringify(waits.data), original = { message: '原120秒超时' }, failure = Error('本地附件失败');
  const attach = vi.fn(async (_name: string, value: { body?: string | Buffer; contentType?: string } = {}) => {
    expect(JSON.parse(String(value.body))).toMatchObject({ owners: [], waits: { points: [[0, 1, 40], [1, 1, 40]] } });
    waits.record(2, 1); throw failure;
  });
  await expect(attachNativeStartupDiagnostics({ attach, errors: [original] }, { owners: [], startupWaits: waits })).rejects.toMatchObject({ errors: [original, failure], cause: original });
  expect(JSON.stringify(waits.data)).toBe(before);
  const silent = vi.fn(async () => {});
  await attachNativeStartupDiagnostics({ attach: silent, errors: [] }, { owners: [] });
  await attachNativeStartupDiagnostics({ attach: silent, errors: [] }, { owners: [], startupWaits: createNativeStartupWaits(undefined, () => true) });
  expect(silent).not.toHaveBeenCalled();
});

it('双owner各32事件与完整数字来源再加64条等待轨迹，仍在原8KiB总附件上限内', async () => {
  const app = new EventEmitter() as any, context = new EventEmitter() as any;
  const pages = Array.from({ length: 4 }, () => Object.assign(new EventEmitter(), { url: () => 'devtools://不应记录的路径?token=合成秘密' }));
  context.pages = () => pages; app.context = () => context;
  const observed = observeNativeStartup(app, () => {}, 'RAM-marker', () => 119999);
  // 组合所有较长字段：devtools分类、console-error、1024丢弃及prepared=false，不削减旧来源。
  observed.firstWindow(pages[3] as any); observed.statusbar();
  for (let index = 0; index < 1056; index++) pages[index % 4].emit('console', { type: () => 'error', text: () => { throw Error('正文不应记录'); } });
  const n = Number.MAX_SAFE_INTEGER, source = { phase: '已准备来源', complete: false, expected: { launcherPid: n, mainPid: n, platform: 'darwin', relation: '启动器父进程', window: { id: n, contents: n } }, observed: { mainPid: n, parentPid: n, platform: 'darwin', metrics: Array(64).fill(n), window: { id: n, contents: n, renderer: n, destroyed: false } } };
  const owner = { startupDiagnostics: observed.data, sourceDiagnostics: Array(12).fill(source) } as any;
  const waits = createNativeStartupWaits(() => 119999, () => true); for (let index = 0; index < 1088; index++) waits.record((index % 8) as NativeStartupWaitStage, 8);
  const attach = vi.fn(async (_name: string, _options?: { body?: Buffer | string; contentType?: string }) => {});
  await attachNativeStartupDiagnostics({ attach, errors: [] }, { owners: [owner, owner], startupWaits: waits });
  const body = attach.mock.calls[0][1]!.body as Buffer, value = JSON.parse(body.toString());
  expect(body.byteLength).toBeLessThanOrEqual(8192); expect(value.waits.points).toHaveLength(64); expect(value.owners.map((item: any) => item.startup.events.length)).toEqual([32, 32]);
  expect(value.owners.map((item: any) => item.startup.dropped)).toEqual([1024, 1024]); expect(value.owners.every((item: any) => item.startup.prepared === false)).toBe(true);
  expect(value.waits.dropped).toBe(1024);
  expect(body.toString()).not.toMatch(/不应记录|合成秘密/);
  // 额外注入不可能由正常32事件上限产生的过大形状，原字节守卫仍必须在IO前拒绝。
  const original = { message: '原用例失败' }, blocked = vi.fn(async () => {});
  const oversized = { ...owner, startupDiagnostics: { ...observed.data, events: Array(64).fill(observed.data.events[0]) } };
  await expect(attachNativeStartupDiagnostics({ attach: blocked, errors: [original] }, { owners: [oversized, owner], startupWaits: waits })).rejects.toMatchObject({ cause: original, errors: [original, { message: '启动观察附件超过固定字节上限' }] });
  expect(blocked).not.toHaveBeenCalled();
});

it('附件序列化失败也保留原错误，不让新增轨迹覆盖原用例失败', async () => {
  const original = { message: '原失败' }, diagnostic: any = {}; diagnostic.self = diagnostic;
  const attach = vi.fn(async () => {});
  await expect(attachNativeStartupDiagnostics({ attach, errors: [original] }, { owners: [{ startupDiagnostics: diagnostic } as any] })).rejects.toMatchObject({ cause: original, errors: [original, expect.any(Error)] });
  expect(attach).not.toHaveBeenCalled();
});
