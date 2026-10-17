import { expect, it } from 'vitest';
import { deferred, mainColumnsHarness } from './main-columns-owner-harness';

const getInput = () => ({ connectionId: 'trusted', database: 'db', table: 't', taskId: 'late-get' });
const previewInput = (snapshotId: string) => ({ snapshotId, patches: [{ kind: 'alter', columnRef: 'note-ref', changes: { comment: 'RAM反例' } }], taskId: 'late-preview' });
const envelope = (kind: 'get' | 'preview', token: string, expiresAt = new Date(Date.now() + 120000).toISOString()) => ({ [kind === 'get' ? 'snapshotId' : 'previewToken']: token, target: { connectionId: 'trusted' }, expiresAt });
/** 只排空Promise队列，不用定时等待掩盖IPC时序。 */
async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }

it('O1 真实IPC正常闭环及store修订，直接缺owner调用不能启动columns', async () => {
  const f = await mainColumnsHarness(), snapshot = await f.get(), preview = await f.preview(snapshot.snapshotId);
  expect(f.tokens.get(snapshot.snapshotId)).toMatchObject({ purpose: 'columns', kind: 'snapshot' });
  expect(f.tokens.get(preview.previewToken)).toMatchObject({ purpose: 'columns', kind: 'preview', snapshotId: snapshot.snapshotId });
  expect(f.request.mock.calls.slice(0, 2).map(([, input]) => input.connectionRevision)).toEqual([7, 7]);
  await expect(f.context.actual.dispatch('schema.columns.get', getInput())).rejects.toThrow('真实字段请求来源');
  expect(f.request).toHaveBeenCalledTimes(2);
  expect((await f.invoke('schema.columns.get', { ...getInput(), connectionRevision: 99 })).ok).toBe(false);
  expect(f.request).toHaveBeenCalledTimes(2);
});

it('O2 真wrapper拒错误sender/frame/URL和销毁对象，broker调用零', async () => {
  for (const change of ['sender', 'child', 'null', 'detached', 'url', 'window', 'contents']) {
    const f = await mainColumnsHarness(), event = f.event();
    if (change === 'sender') event.sender = {};
    if (change === 'child') event.senderFrame = { ...event.senderFrame };
    if (change === 'null') event.senderFrame = null;
    if (change === 'detached') event.senderFrame.detached = true;
    if (change === 'url') event.senderFrame.url = 'app://other';
    if (change === 'window') f.context.window.destroyWindow();
    if (change === 'contents') f.context.window.destroyContents();
    const value = await f.invoke('schema.columns.get', getInput(), event);
    expect(value.ok, change).toBe(false); expect(f.request).not.toHaveBeenCalled();
  }
});

it('O3 get及preview等待中修订/保存锁变化，先等待精确清理再失败', async () => {
  for (const kind of ['get', 'preview'] as const) for (const change of ['revision', 'saving']) {
    const f = await mainColumnsHarness(), snapshot = kind === 'preview' ? await f.get() : undefined;
    const pending = deferred(), entered = deferred(), cleanup = deferred();
    f.request.mockClear(); f.request.mockImplementation(async (command, input) => {
      if (command === 'schema.columns.' + kind) { entered.resolve(undefined); return pending.promise; }
      if (command === 'schema.columns.release') return cleanup.promise;
      return f.reply(command, input);
    });
    let finished = false;
    const operation = f.invoke('schema.columns.' + kind, kind === 'get' ? getInput() : previewInput(snapshot!.snapshotId)).then(value => { finished = true; return value; });
    await entered.promise;
    if (change === 'revision') f.setRevision(8); else f.setBlocked(true);
    pending.resolve(envelope(kind, 'late-capability')); await flush();
    expect(f.request).toHaveBeenLastCalledWith('schema.columns.release', kind === 'get' ? { snapshotId: 'late-capability' } : { previewToken: 'late-capability' });
    expect(f.tokens.has('late-capability')).toBe(false); expect(finished).toBe(false);
    cleanup.resolve(undefined); const value = await operation; expect(value.ok).toBe(false);
  }
});

it('O4 父release的ACK仍等待时，Main已撤销父与关联，晚preview不复活', async () => {
  const f = await mainColumnsHarness(), snapshot = await f.get(), earlier = await f.preview(snapshot.snapshotId);
  const previewWait = deferred(), entered = deferred(), releaseWait = deferred();
  f.request.mockClear(); f.request.mockImplementation(async (command, input) => {
    if (command === 'schema.columns.preview') { entered.resolve(undefined); return previewWait.promise; }
    if (command === 'schema.columns.release' && input.snapshotId) return releaseWait.promise;
    return f.reply(command, input);
  });
  const operation = f.invoke('schema.columns.preview', previewInput(snapshot.snapshotId)); await entered.promise;
  const release = f.invoke('schema.columns.release', { snapshotId: snapshot.snapshotId });
  expect(f.tokens.has(snapshot.snapshotId)).toBe(false); expect(f.tokens.has(earlier.previewToken)).toBe(false);
  previewWait.resolve(envelope('preview', 'late-preview')); const value = await operation;
  expect(value.ok).toBe(false); expect(f.tokens.has('late-preview')).toBe(false);
  expect(f.request).toHaveBeenLastCalledWith('schema.columns.release', { previewToken: 'late-preview' });
  releaseWait.resolve(undefined); expect((await release).ok).toBe(true);
});

it('O5 父snapshot同ID替换或等待中过期均拒晚preview', async () => {
  for (const change of ['replace', 'expire']) {
    const f = await mainColumnsHarness(), snapshot = await f.get(), original = f.tokens.get(snapshot.snapshotId);
    const wait = deferred(), entered = deferred();
    f.request.mockImplementation(async (command, input) => { if (command === 'schema.columns.preview') { entered.resolve(undefined); return wait.promise; } return f.reply(command, input); });
    const operation = f.invoke('schema.columns.preview', previewInput(snapshot.snapshotId)); await entered.promise;
    if (change === 'replace') f.tokens.set(snapshot.snapshotId, { ...original }); else original.expires = Date.now() - 1;
    wait.resolve(envelope('preview', 'late-preview'));
    expect((await operation).ok, change).toBe(false); expect(f.tokens.has('late-preview')).toBe(false);
    expect(f.request).toHaveBeenLastCalledWith('schema.columns.release', { previewToken: 'late-preview' });
  }
});

it('O6 原窗口/contents/frame及同URL主文档代次与崩溃失效均阻断回包', async () => {
  for (const change of ['window', 'contents', 'frame', 'start', 'commit', 'gone', 'destroyed']) {
    const f = await mainColumnsHarness(), wait = deferred(), entered = deferred();
    f.request.mockImplementation(async (command, input) => { if (command === 'schema.columns.get') { entered.resolve(undefined); return wait.promise; } return f.reply(command, input); });
    const operation = f.invoke('schema.columns.get', getInput()); await entered.promise;
    const original = f.context.window;
    if (change === 'window') await f.context.actual.createWindow();
    if (change === 'contents') { await f.context.actual.createWindow(); const replacement = f.context.window.webContents; f.context.window = original; original.webContents = replacement; }
    if (change === 'frame') original.webContents.mainFrame = { ...original.webContents.mainFrame };
    if (change === 'start') original.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    if (change === 'commit') original.webContents.emit('did-navigate');
    if (change === 'gone') original.webContents.emit('render-process-gone');
    if (change === 'destroyed') original.destroyContents();
    wait.resolve(envelope('get', 'late-snapshot'));
    expect((await operation).ok, change).toBe(false); expect(f.tokens.has('late-snapshot')).toBe(false);
    expect(f.request).toHaveBeenLastCalledWith('schema.columns.release', { snapshotId: 'late-snapshot' });
  }
});

it('O7 dispatch登记后至真实wrapper恢复间再核owner/revision/parent/退出', async () => {
  for (const change of ['owner', 'revision', 'parent', 'shutdown']) {
    const f = await mainColumnsHarness(), snapshot = change === 'parent' ? await f.get() : undefined;
    f.request.mockClear(); f.afterTask(() => queueMicrotask(() => {
      f.afterTask();
      if (change === 'owner') f.context.window.webContents.emit('did-navigate');
      if (change === 'revision') f.setRevision(8);
      if (change === 'parent') f.tokens.delete(snapshot!.snapshotId);
      if (change === 'shutdown') f.context.shuttingDown = true;
    }));
    const value = await f.invoke('schema.columns.' + (snapshot ? 'preview' : 'get'), snapshot ? previewInput(snapshot.snapshotId) : getInput());
    expect(value.ok, change).toBe(false);
    expect(f.request.mock.calls.at(-1)?.[0]).toBe('schema.columns.release');
    expect([...f.tokens.values()].filter(record => record.kind === 'preview')).toHaveLength(0);
    if (!snapshot) expect(f.tokens.size).toBe(0);
  }
});

it('O8 退出保存中release仍可用，整批用途kindowner校验且未知ID幂等', async () => {
  const f = await mainColumnsHarness(), snapshot = await f.get(), preview = await f.preview(snapshot.snapshotId);
  const before = f.tasks.size; f.context.shuttingDown = true; f.setBlocked(true);
  expect((await f.invoke('schema.columns.release', { snapshotId: snapshot.snapshotId })).ok).toBe(true);
  expect(f.tokens.size).toBe(0); expect(f.tasks.size).toBe(before);
  expect((await f.invoke('schema.columns.release', { previewToken: 'unknown-token' })).ok).toBe(true);
  for (const change of ['purpose', 'kind', 'owner']) {
    const next = await mainColumnsHarness(), s = await next.get(), p = await next.preview(s.snapshotId);
    next.request.mockClear();
    let input: any = { snapshotId: s.snapshotId, previewToken: p.previewToken };
    if (change === 'purpose') { next.tokens.set('index-preview', { purpose: 'indexes', kind: 'preview', expires: Date.now() + 10000, connectionId: 'trusted' }); input.previewToken = 'index-preview'; }
    if (change === 'kind') input = { snapshotId: p.previewToken };
    if (change === 'owner') next.context.window.webContents.emit('did-navigate');
    expect((await next.invoke('schema.columns.release', input)).ok, change).toBe(false);
    expect(next.tokens.has(s.snapshotId)).toBe(true); expect(next.tokens.has(p.previewToken)).toBe(true);
    expect(next.request).not.toHaveBeenCalled();
  }
});

it('O9 清理错可见，容量或无效expires结果不发布也不清空其他用途', async () => {
  for (const reason of ['cleanup', 'capacity', 'expires', 'collision']) {
    const f = await mainColumnsHarness(), wait = deferred(), entered = deferred();
    f.request.mockImplementation(async (command, input) => {
      if (command === 'schema.columns.get') { entered.resolve(undefined); return wait.promise; }
      if (command === 'schema.columns.release' && reason === 'cleanup') throw Error('RAM回收拒绝');
      return f.reply(command, input);
    });
    const operation = f.invoke('schema.columns.get', getInput()); await entered.promise;
    if (reason === 'cleanup') f.setRevision(8);
    if (reason === 'capacity') for (let index = 0; index < 128; index++) f.tokens.set('index-' + index, { purpose: 'indexes', kind: 'snapshot', expires: Date.now() + 10000, connectionId: 'other' });
    const existing = { purpose: 'indexes', kind: 'snapshot', expires: Date.now() + 10000, connectionId: 'other' };
    if (reason === 'collision') f.tokens.set('late-capability', existing);
    wait.resolve(envelope('get', 'late-capability', reason === 'expires' ? 'invalid-date' : undefined));
    const value = await operation; expect(value.ok, reason).toBe(false);
    if (reason === 'collision') { expect(f.tokens.get('late-capability')).toBe(existing); expect(f.request).toHaveBeenCalledTimes(1); continue; }
    expect(f.tokens.has('late-capability')).toBe(false);
    if (reason === 'cleanup') expect(value.error).toContain('精确释放尚未确认：RAM回收拒绝');
    if (reason === 'capacity') expect(f.tokens.size).toBe(128);
    expect(f.request).toHaveBeenLastCalledWith('schema.columns.release', { snapshotId: 'late-capability' });
  }
});

it('O10 apply首await前一次领取，发送后owner修订变化不倒写OK或未知证据', async () => {
  for (const outcome of ['ok', 'unknown']) {
    const f = await mainColumnsHarness(), snapshot = await f.get(), preview = await f.preview(snapshot.snapshotId), wait = deferred(), entered = deferred();
    f.request.mockClear(); f.request.mockImplementation(async (command, input) => { if (command === 'schema.columns.apply') { entered.resolve(undefined); return wait.promise; } return f.reply(command, input); });
    const input = { previewToken: preview.previewToken, acknowledgements: [], taskId: 'apply-first' };
    const first = f.invoke('schema.columns.apply', input); await entered.promise;
    expect(f.tokens.has(preview.previewToken)).toBe(false);
    expect((await f.invoke('schema.columns.apply', { ...input, taskId: 'apply-second' })).ok).toBe(false);
    expect(f.request).toHaveBeenCalledTimes(1);
    f.setRevision(8); f.context.window.webContents.emit('did-navigate');
    if (outcome === 'ok') wait.resolve(f.reply('schema.columns.apply', input));
    else { f.progress.set(input.taskId, { phase: 'executing', ddlSubmitted: true, ddlCompleted: false, definitionVerified: false, outcome: 'unknown' }); wait.reject(Error('原命令断线')); }
    const value = await first;
    if (outcome === 'ok') expect(value).toMatchObject({ ok: true, result: { ddlSubmitted: true, ddlCompleted: true, definitionVerified: true } });
    else { expect(value.ok).toBe(false); expect(f.events.at(-1).columnPatch).toMatchObject({ ddlSubmitted: true, outcome: 'unknown' }); }
    expect(f.request).toHaveBeenCalledTimes(1);
  }
});
