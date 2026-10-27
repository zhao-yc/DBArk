import { describe, expect, it } from 'vitest';
import {
  createDesktopQuitDiagnostics, desktopQuitDiagnosticLimits,
  type DesktopQuitDiagnosticEvent, type DesktopQuitDiagnosticOwner, type DesktopQuitDiagnosticPayload,
} from '../helpers/desktopQuitDiagnostics';

const owner: DesktopQuitDiagnosticOwner = { token: 'c8b7af92-743e-46a5-aa91-25a8287d2fc0', generation: 1, mainPid: 4120 };
const nextToken = '21975dfb-709f-46c0-aa93-3a12559d9a99';

describe('退出诊断记录器只保留固定归属和原始小事实', () => {
  it('记录退出阶段、保存结果、对话框分类及原进程事件，快照可结构化克隆', () => {
    let now = 100;
    const recorder = createDesktopQuitDiagnostics(owner, () => now++);
    const entries: Array<[DesktopQuitDiagnosticEvent, DesktopQuitDiagnosticPayload | undefined]> = [
      ['observer-armed', { ok: true }], ['quit-requested', { method: 'app', closed: false, pageClosed: false }],
      ['before-quit', undefined], ['app-quit', undefined], ['settings-save-started', undefined], ['settings-save-finished', { ok: true }],
      ['dialog-response', { dialogKind: 'pending-work', response: 1 }], ['will-quit', undefined], ['page-close', { pageClosed: true }],
      ['close-wait-started', { closed: false }], ['desktop-close-started', { pageClosed: true }],
      ['process-exit', { exitCode: 0, signal: null }], ['process-close', { exitCode: 0, signal: null }],
      ['application-close', { closed: true }], ['desktop-close-resolved', { ok: true }], ['close-wait-resolved', { closed: true }],
      ['process-pids-gone', { ok: true, processCount: 0 }],
    ];
    for (const [event, payload] of entries) expect(recorder.record(owner.token, event, payload)).toBe(true);
    const snapshot = recorder.snapshot();
    expect(snapshot).toMatchObject({ version: 1, owner, incomplete: false, disposed: false });
    expect(snapshot.events.map(item => item.event)).toEqual(entries.map(item => item[0]));
    expect(snapshot.events.map(item => item.seq)).toEqual(entries.map((_, index) => index + 1));
    expect(snapshot.events.every((item, index) => index === 0 || item.elapsedMs >= snapshot.events[index - 1].elapsedMs)).toBe(true);
    expect(structuredClone(snapshot)).toEqual(snapshot);
  });
  it('快照、原owner和原payload均无共享可变引用', () => {
    const source = { ...owner }, detail: DesktopQuitDiagnosticPayload = { ok: true }, recorder = createDesktopQuitDiagnostics(source, () => 1);
    expect(recorder.record(owner.token, 'settings-save-finished', detail)).toBe(true);
    source.mainPid = 999; source.generation = 9; source.token = nextToken; detail.ok = false;
    const snapshot = recorder.snapshot(); snapshot.owner.mainPid = 888; snapshot.events[0].ok = false; snapshot.events.length = 0; snapshot.incomplete = true;
    expect(recorder.snapshot()).toMatchObject({ owner, incomplete: false, events: [{ event: 'settings-save-finished', ok: true }] });
  });
  it('迟到旧owner和旧代次不能污染后来启动的记录器', () => {
    const old = createDesktopQuitDiagnostics(owner, () => 1), freshOwner = { token: nextToken, generation: 2, mainPid: 5200 };
    const fresh = createDesktopQuitDiagnostics(freshOwner, () => 1);
    old.dispose(); const before = fresh.snapshot();
    expect(fresh.record(owner.token, 'application-close', { closed: true })).toBe(false);
    expect(fresh.record(owner.token, '未知事件' as never, { sql: '不读取' } as never)).toBe(false);
    expect(fresh.snapshot()).toEqual(before); expect(old.record(owner.token, 'process-close', { exitCode: 0 })).toBe(false);
    expect(fresh.record(nextToken, 'observer-armed', { ok: true })).toBe(true); expect(fresh.snapshot().owner).toEqual(freshOwner);
  });
});

describe('未知事件或载荷不进入退出证据', () => {
  it.each(['sql-text', '路径C:\\private', '', 1, null, undefined, {}, Symbol('秘密事件')])('未知event第%#项只留固定invalid，不保留原值', event => {
    const recorder = createDesktopQuitDiagnostics(owner, () => 1);
    expect(recorder.record(owner.token, event as never)).toBe(false);
    expect(recorder.snapshot()).toMatchObject({ incomplete: true, events: [{ seq: 1, event: 'invalid' }] });
    expect(Object.keys(recorder.snapshot().events[0]).sort()).toEqual(['elapsedMs', 'event', 'seq']);
  });
  it.each([
    ['settings-save-finished', { ok: true, sql: '不可记录秘密' }], ['quit-requested', { method: '不可记录秘密' }],
    ['process-close', { exitCode: '0', signal: null }], ['process-exit', { exitCode: 1n }], ['process-exit', { signal: '不可记录秘密' }],
    ['settings-save-finished', { ok: 1 }], ['will-quit', { closed: true }], ['application-close', { pageClosed: true }],
    ['dialog-response', { dialogKind: '不可记录秘密', response: 1 }], ['dialog-response', { response: -1 }], ['dialog-response', { response: 33 }],
    ['process-pids-gone', { processCount: -1 }], ['process-pids-gone', { processCount: 129 }], ['process-pids-gone', { processCount: 1.5 }],
    ['quit-failed', { error: Error('不可记录秘密') }], ['settings-save-started', ['不可记录秘密']], ['settings-save-finished', null],
  ])('未知载荷第%#项整条丢弃，不借有效字段夹带原文', (event, payload) => {
    const recorder = createDesktopQuitDiagnostics(owner, () => 1);
    expect(recorder.record(owner.token, event as DesktopQuitDiagnosticEvent, payload as unknown as DesktopQuitDiagnosticPayload)).toBe(false);
    const snapshot = recorder.snapshot(); expect(snapshot.events).toHaveLength(1); expect(snapshot.events[0].event).toBe('invalid');
    expect(snapshot.incomplete).toBe(true); expect(JSON.stringify(snapshot)).not.toContain('不可记录秘密'); expect(snapshot.events[0]).not.toHaveProperty('ok');
  });
  it('getter、toJSON、继承字段及隐藏字段均不执行或复制', () => {
    let calls = 0;
    const getter = Object.defineProperty({}, 'ok', { enumerable: true, get() { calls++; return true; } });
    const toJSON = { ok: true, toJSON() { calls++; return '秘密正文'; } };
    const hidden = Object.defineProperty({ ok: true }, 'path', { value: '秘密路径' });
    const prototype = Object.assign(Object.create({ error: '秘密正文' }), { ok: true });
    for (const input of [getter, toJSON, hidden, prototype, { ok: true, [Symbol('秘密字段')]: '秘密正文' }]) {
      const recorder = createDesktopQuitDiagnostics(owner, () => 1);
      expect(recorder.record(owner.token, 'settings-save-finished', input)).toBe(false); expect(JSON.stringify(recorder.snapshot())).not.toContain('秘密');
    }
    expect(calls).toBe(0);
  });
  it('observer不可用及显式invalid标不完整，退出失败本身仍可记录成完整原始事实', () => {
    const recorder = createDesktopQuitDiagnostics(owner, () => 1);
    expect(recorder.record(owner.token, 'quit-failed', { closed: false, pageClosed: false, ok: false })).toBe(true);
    expect(recorder.snapshot().incomplete).toBe(false);
    expect(recorder.record(owner.token, 'observer-unavailable', { ok: false })).toBe(true); expect(recorder.snapshot().incomplete).toBe(true);
    expect(recorder.record(owner.token, 'invalid')).toBe(true); expect(recorder.snapshot().events.at(-1)?.event).toBe('invalid');
  });
});

describe('诊断预算和时间异常不能改变退出结果', () => {
  it('最多128事件、完整快照64KiB，溢出只标不完整且不抛错', () => {
    const recorder = createDesktopQuitDiagnostics(owner, () => Number.MAX_SAFE_INTEGER);
    for (let index = 0; index < 128; index++) expect(recorder.record(owner.token, 'force-stop-finished', { ok: false, closed: false, pageClosed: false, processCount: 128 })).toBe(true);
    expect(recorder.snapshot().events).toHaveLength(desktopQuitDiagnosticLimits.events); expect(recorder.snapshot().incomplete).toBe(false);
    expect(() => { for (let index = 0; index < 1000; index++) expect(recorder.record(owner.token, 'will-quit')).toBe(false); }).not.toThrow();
    const snapshot = recorder.snapshot(); expect(snapshot.events).toHaveLength(128); expect(snapshot.incomplete).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength).toBeLessThanOrEqual(desktopQuitDiagnosticLimits.bytes);
    expect(snapshot.events.at(-1)?.seq).toBe(128); expect(() => recorder.dispose()).not.toThrow(); expect(recorder.snapshot().disposed).toBe(true);
  });
  it('时钟回退、非有限值和异常都钳到上一时间，不记录错误正文', () => {
    const times: Array<number | Error> = [100, 105, 102, 110, NaN, Infinity, -1, Error('秘密时钟错误'), 111];
    const recorder = createDesktopQuitDiagnostics(owner, () => { const value = times.shift()!; if (value instanceof Error) throw value; return value; });
    for (let index = 0; index < 8; index++) expect(recorder.record(owner.token, 'will-quit')).toBe(true);
    const snapshot = recorder.snapshot(); expect(snapshot.events.map(event => event.elapsedMs)).toEqual([5, 5, 10, 10, 10, 10, 10, 11]);
    expect(snapshot.incomplete).toBe(true); expect(JSON.stringify(snapshot)).not.toContain('秘密时钟错误');
  });
  it('创建时时钟异常仍能记录，dispose幂等且晚到事件不再触碰时钟或快照', () => {
    let calls = 0; const recorder = createDesktopQuitDiagnostics(owner, () => { calls++; throw Error('原时钟不可用'); });
    expect(recorder.record(owner.token, 'will-quit')).toBe(true); recorder.dispose(); const before = recorder.snapshot(), seen = calls;
    recorder.dispose(); expect(recorder.record(owner.token, 'application-close', { closed: true })).toBe(false);
    expect(recorder.snapshot()).toEqual(before); expect(calls).toBe(seen); expect(before.incomplete).toBe(true); expect(before.disposed).toBe(true); expect(before.events.at(-1)?.event).toBe('disposed');
  });
  it.each([{ token: '非UUID秘密' }, { generation: 0 }, { generation: 1.5 }, { mainPid: 0 }, { mainPid: '4120' }, { path: '不可记录' }, { sql: '不可记录' }])('不合法owner第%#项拒绝并只返回固定错误', patch => {
    expect(() => createDesktopQuitDiagnostics({ ...owner, ...patch } as unknown as DesktopQuitDiagnosticOwner)).toThrow('退出诊断owner必须为本次UUID、启动代次和原主进程正整数PID');
  });
});
