import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { installQueryResultColumnsAudit, queryResultColumnsSql } from '../helpers/queryResultColumnsUi';

/** 仅隔离RAM原处理器与延迟回包；不启动Electron、不调用真实IPC或数据库。 */
function fixture() {
  const waiting: Array<(reply: any) => void> = [];
  const original = vi.fn((_event: any, payload: any): Promise<any> => payload.command === 'sessions.open'
    ? new Promise(resolve => waiting.push(resolve)) : Promise.resolve({ ok: true, result: {} }));
  const handlers = new Map([['dbark:request', original]]);
  const context: any = { Date: { now: () => 1000 }, ipcMain: { _invokeHandlers: handlers }, target: { senderId: 71, profileId: 'ram-profile', tabId: 'ram-tab', sql: queryResultColumnsSql, deadline: 121000 } };
  runInNewContext(`(${installQueryResultColumnsAudit.toString()})({ipcMain}, target)`, context);
  const wrapped = handlers.get('dbark:request')!;
  const call = (command = 'sessions.open', input: any = { connectionId: 'ram-profile' }) => wrapped({ sender: { id: 71 } }, { command, input });
  return { waiting, original, handlers, wrapped, call, state: context.__dbarkQueryResultColumnsAudit };
}

describe('结果列审计session单次领取修复（最小RAM对照）', () => {
  it('正常首次回包原样返回并绑定一次；顺序重复不委托且保留原session', async () => {
    const f = fixture(), pending = f.call(), reply = { ok: true, result: { sessionId: 'original-session' } };
    expect(f.original).toHaveBeenCalledOnce(); expect(f.state.pending).toBe(1);
    f.waiting[0](reply); await expect(pending).resolves.toBe(reply);
    expect(f.state.session).toBe('original-session'); expect(f.state.pending).toBe(0);
    await expect(f.call()).rejects.toThrow('永久'); expect(f.original).toHaveBeenCalledOnce();
    expect(f.state.session).toBe('original-session'); expect(f.state.invalid).toBe(true);
  });

  it('未决窗口的并发重复先停链且不委托；迟到原回包留存但不能成为活动session', async () => {
    const f = fixture(), first = f.call(), second = f.call(), settled = Promise.allSettled([first, second]);
    const reply = { ok: true, result: { sessionId: 'late-original-session' } };
    // 原a7会委托第二个；先给第二回包，再给首个，稳定复现倒序覆盖。
    if (f.waiting[1]) f.waiting[1]({ ok: true, result: { sessionId: 'newer-session' } });
    await Promise.resolve(); await Promise.resolve(); f.waiting[0](reply);
    const results = await settled;
    expect({ delegated: f.original.mock.calls.length, states: results.map(item => item.status), session: f.state.session, invalid: f.state.invalid, pending: f.state.pending }).toEqual({ delegated: 1, states: ['rejected', 'rejected'], session: '', invalid: true, pending: 0 });
    const claim = f.state.sessionClaim; expect(claim.response).toBe(reply); expect(claim.returnedSessionId).toBe('late-original-session');
    await expect(f.call()).rejects.toThrow('永久'); expect(f.state.sessionClaim).toBe(claim); expect(f.original).toHaveBeenCalledOnce();
  });

  it('原handler失去归属后的迟到回包保留原引用；恢复handler也不能领取或补关资源', async () => {
    const f = fixture(), pending = f.call(), rejected = expect(pending).rejects.toThrow('永久');
    f.handlers.set('dbark:request', f.original); const reply = { ok: true, result: { sessionId: 'retained-session' } };
    f.waiting[0](reply); await rejected;
    expect(f.state.session).toBe(''); expect(f.state.pending).toBe(0); expect(f.state.invalid).toBe(true);
    const claim = f.state.sessionClaim; expect(claim?.response).toBe(reply); expect(claim.returnedSessionId).toBe('retained-session');
    f.handlers.set('dbark:request', f.wrapped); await expect(f.call()).rejects.toThrow('永久');
    expect(f.state.sessionClaim).toBe(claim); expect(f.original).toHaveBeenCalledOnce();
    expect(f.original.mock.calls.map(([, payload]) => payload.command)).toEqual(['sessions.open']);
  });
});
