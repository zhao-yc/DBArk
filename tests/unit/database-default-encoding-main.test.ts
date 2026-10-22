import { readFileSync } from 'node:fs';
import { runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { mainColumnsHarness, deferred } from './main-columns-owner-harness';
import { DatabaseDefaultEncodingOwners } from '../../src/main/databaseDefaultEncodingOwners';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { databaseDefaultEncodingAcknowledgements } from '../../src/shared/databaseDefaultEncoding';
import { publicCommands } from '../../src/shared/commands';

const prefix = 'schema.databaseDefaultEncoding.';
const token = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const target = { connectionId: 'trusted', database: 'db' };
const current = { charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' };
const selection = { charset: 'utf8mb4', collation: 'utf8mb4_bin' };
/** 清空微任务只观察原Promise进度，不启动定时器或新请求。 */
async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
/** 附加真实Main声明与记录器；dispatch、IPC、Window和capability仍由既有AST夹具提取生产原文。 */
function fixture() {
  const f = mainColumnsHarness(), source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), parts: string[] = [];
  for (const statement of tree.statements) {
    if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(item => item.name.getText(tree) === 'databaseEncodingOwners')) parts.push(statement.getText(tree));
    if (ts.isFunctionDeclaration(statement) && ['taskEvent', 'persistAuxiliary', 'releaseDatabaseEncoding'].includes(statement.name?.text ?? '')) parts.push(statement.getText(tree));
  }
  if (parts.length !== 4) throw Error('缺少真实数据库编码owner、释放或任务记录入口');
  const emitted: any[] = [], persisted: any[] = [], afterEvent = { action: undefined as (() => void) | undefined };
  Object.assign(f.context, { DatabaseDefaultEncodingOwners, persistedTaskMessage, lastPersist: new Map(), lastStorageWarning: 0 });
  f.context.store.saveTask = vi.fn((record: any) => persisted.push(structuredClone(record)));
  f.context.store.addHistory = vi.fn();
  f.context.window.webContents.send = (_channel: string, event: any) => { emitted.push(event); afterEvent.action?.(); };
  runInContext(ts.transpileModule(parts.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, f.context);
  const owners = runInContext('databaseEncodingOwners', f.context) as DatabaseDefaultEncodingOwners;
  let issued = 0, tasks = 0;
  const read = (id = token(++issued)) => ({ target: { ...target }, snapshotId: id, expiresAt: new Date(Date.now() + 120000).toISOString(), definitionHash: 'a'.repeat(64), catalogDigest: 'b'.repeat(64), current: { ...current }, candidates: [{ ...current }, { ...selection }], writable: true, reasons: [], warnings: [], serverVersion: '8.4.11' });
  const plan = (id = token(++issued)) => ({ target: { ...target }, previewToken: id, expiresAt: new Date(Date.now() + 120000).toISOString(), definitionHash: 'a'.repeat(64), catalogDigest: 'b'.repeat(64), before: { ...current }, after: { ...selection }, sql: 'ALTER DATABASE `db` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', warnings: [], requiredAcknowledgements: [...databaseDefaultEncodingAcknowledgements] });
  const reply = (command: string) => command === prefix + 'get' ? read() : command === prefix + 'preview' ? plan() : command === prefix + 'apply' ? { target, before: current, after: selection, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, warnings: [] } : undefined;
  f.request.mockImplementation(async command => reply(command));
  const getInput = () => ({ ...target, taskId: 'db-default-get-' + ++tasks });
  const previewInput = (snapshotId: string) => ({ snapshotId, ...selection, taskId: 'db-default-preview-' + ++tasks });
  const applyInput = (previewToken: string) => ({ previewToken, confirmation: target.database, acknowledgements: [...databaseDefaultEncodingAcknowledgements], taskId: 'db-default-apply-' + ++tasks });
  const get = () => f.run(prefix + 'get', getInput());
  const preview = (snapshotId: string) => f.run(prefix + 'preview', previewInput(snapshotId));
  const navigate = () => f.context.window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  return { ...f, read, plan, reply, owners, emitted, persisted, afterEvent, getInput, previewInput, applyInput, get, preview, navigate };
}

describe('数据库默认编码真实Main入口', () => {
  it('四IPC有白名单与严格schema，拒绝注入target/revision/SQL及空释放', async () => {
    const f = fixture();
    const valid = { get: f.getInput(), preview: f.previewInput(token(1)), apply: f.applyInput(token(2)), release: { snapshotId: token(1) } };
    for (const command of ['get', 'preview', 'apply', 'release'] as const) {
      expect(publicCommands[prefix + command as keyof typeof publicCommands]).toBe(true);
      for (const addition of [{ connectionRevision: 99 }, { sql: 'ALTER DATABASE 注入' }, { target: { ...target, database: '他库' } }]) {
        expect((await f.invoke(prefix + command, { ...valid[command], ...addition })).ok).toBe(false);
      }
    }
    expect((await f.invoke(prefix + 'release', {})).ok).toBe(false);
    expect((await f.invoke(prefix + 'apply', { ...valid.apply, acknowledgements: ['ddl-implicit-commit'] })).ok).toBe(false);
    expect((await f.invoke(prefix + 'notPublic', {})).ok).toBe(false); expect(f.request).not.toHaveBeenCalled();
  });

  it('真实get→preview→apply注入Main修订，登记数据库用途及原目标，消费不复活', async () => {
    const f = fixture(), snapshot = await f.get(), preview = await f.preview(snapshot.snapshotId);
    expect(f.tokens.get(snapshot.snapshotId)).toMatchObject({ purpose: 'databaseDefaultEncoding', kind: 'snapshot', connectionId: target.connectionId });
    expect(f.tokens.get(preview.previewToken)).toMatchObject({ purpose: 'databaseDefaultEncoding', kind: 'preview', snapshotId: snapshot.snapshotId });
    const input = f.applyInput(preview.previewToken), result = await f.run(prefix + 'apply', input);
    expect(result).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true });
    expect(f.request.mock.calls.slice(0, 3).map(([, input]) => input.connectionRevision)).toEqual([7, 7, 7]);
    expect(f.tokens.has(preview.previewToken)).toBe(false);
    expect((await f.invoke(prefix + 'apply', f.applyInput(preview.previewToken))).ok).toBe(false);
    expect(f.request).toHaveBeenCalledTimes(3); expect(f.context.store.addHistory).not.toHaveBeenCalled();
  });

  it('原窗口/主frame/URL/文档不能由数字ID或同URL新窗口冒充', async () => {
    for (const change of ['sender', 'child', 'null', 'detached', 'url', 'window', 'contents']) {
      const f = fixture(), event = f.event();
      if (change === 'sender') event.sender = {};
      if (change === 'child') event.senderFrame = { ...event.senderFrame };
      if (change === 'null') event.senderFrame = null;
      if (change === 'detached') event.senderFrame.detached = true;
      if (change === 'url') event.senderFrame.url = 'app://other';
      if (change === 'window') f.context.window.destroyWindow();
      if (change === 'contents') f.context.window.destroyContents();
      expect((await f.invoke(prefix + 'get', f.getInput(), event)).ok, change).toBe(false); expect(f.request).not.toHaveBeenCalled();
    }
    const f = fixture(), snapshot = await f.get(), preview = await f.preview(snapshot.snapshotId); f.navigate();
    for (const [command, input] of [['preview', f.previewInput(snapshot.snapshotId)], ['apply', f.applyInput(preview.previewToken)], ['release', { snapshotId: snapshot.snapshotId }]] as const) expect((await f.invoke(prefix + command, input)).ok).toBe(false);
    expect(f.request).toHaveBeenCalledTimes(2);
  });

  it('旧snapshot连接修订变更后也拒绝，不仅检查本次owner捕获的修订', async () => {
    const f = fixture(), snapshot = await f.get(); f.setRevision(8);
    expect((await f.invoke(prefix + 'preview', f.previewInput(snapshot.snapshotId))).ok).toBe(false);
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  it('手工通用Map记录不能当本用途能力，别的用途与未知release不发broker', async () => {
    const f = fixture();
    f.tokens.set(token(7), { purpose: 'databaseDefaultEncoding', kind: 'snapshot', connectionId: target.connectionId, expires: Date.now() + 120000 });
    f.tokens.set(token(8), { purpose: 'tableDefaultEncoding', kind: 'snapshot', connectionId: target.connectionId, expires: Date.now() + 120000 });
    for (const id of [token(7), token(8), token(9)]) {
      expect((await f.invoke(prefix + 'preview', f.previewInput(id))).ok).toBe(false);
      expect((await f.invoke(prefix + 'release', { snapshotId: id })).ok).toBe(false);
    }
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each(['get', 'preview'] as const)('迟到%s导航失效，精确清理等待完成且Main缓存无残留', async command => {
    const f = fixture(), snapshot = command === 'preview' ? await f.get() : undefined, wait = deferred(), cleanup = deferred();
    const input = command === 'get' ? f.getInput() : f.previewInput(snapshot.snapshotId), result = command === 'get' ? f.read() : f.plan();
    const id = 'snapshotId' in result ? result.snapshotId : result.previewToken;
    f.request.mockImplementation(async name => name === prefix + command ? wait.promise : name === prefix + 'release' ? cleanup.promise : f.reply(name));
    let done = false; const operation = f.invoke(prefix + command, input).then(value => { done = true; return value; });
    await flush(); f.navigate(); wait.resolve(result); await flush();
    expect(done).toBe(false); expect(f.request).toHaveBeenLastCalledWith(prefix + 'release', command === 'get' ? { snapshotId: id } : { previewToken: id });
    cleanup.resolve(undefined); expect((await operation).ok).toBe(false);
    expect(f.tokens.has(id)).toBe(false);
  });

  it('成功登记后最终发布门文档换代，原after只调用一次，IPC拒绝且精确回收', async () => {
    const f = fixture(), actual = f.owners.after.bind(f.owners);
    vi.spyOn(f.owners, 'after').mockImplementation(async (...args) => { await actual(...args); f.navigate(); });
    const result = await f.invoke(prefix + 'get', f.getInput());
    expect(result.ok).toBe(false); expect(f.request.mock.calls.map(([command]) => command)).toEqual([prefix + 'get', prefix + 'release']); expect(f.tokens.size).toBe(0);
  });

  it('父release等待中晚到preview不能复活，全部derivedMain登记均撤销', async () => {
    const f = fixture(), snapshot = await f.get(), earlier = await f.preview(snapshot.snapshotId), pending = deferred(), releaseWait = deferred();
    f.request.mockImplementation(async (command, input) => command === prefix + 'preview' ? pending.promise : command === prefix + 'release' && input.snapshotId ? releaseWait.promise : f.reply(command));
    const preview = f.invoke(prefix + 'preview', f.previewInput(snapshot.snapshotId)); await flush();
    const releasing = f.invoke(prefix + 'release', { snapshotId: snapshot.snapshotId }); await flush();
    expect((await f.invoke(prefix + 'apply', f.applyInput(earlier.previewToken))).ok).toBe(false);
    const late = f.plan(); pending.resolve(late); expect((await preview).ok).toBe(false); releaseWait.resolve(undefined); expect((await releasing).ok).toBe(true);
    expect(f.tokens.has(snapshot.snapshotId)).toBe(false); expect(f.tokens.has(earlier.previewToken)).toBe(false); expect(f.tokens.has(late.previewToken)).toBe(false);
  });

  it('新的进度/错误原文只送当前窗口，任务盘记录不包含SQL、库名或服务器错误', async () => {
    const f = fixture(), secret = 'RAM绝不落盘的服务器SQL及库名';
    f.request.mockImplementationOnce(async () => { f.context.taskEvent({ taskId: 'privacy-task', status: 'running', progress: 20, message: secret, databaseDefaultEncoding: { phase: 'executing', ddlSubmitted: true, ddlCompleted: false, definitionVerified: false, outcome: 'unknown' } }); throw Error(secret); });
    const result = await f.invoke(prefix + 'get', { ...f.getInput(), taskId: 'privacy-task' });
    expect(result.ok).toBe(false); expect(result.error).toContain(secret);
    expect(f.emitted.some(event => event.databaseDefaultEncoding?.ddlSubmitted)).toBe(true);
    expect(JSON.stringify(f.persisted)).not.toContain(secret); expect(f.persisted.at(-1).message).toContain('结构变更可能已执行'); expect(f.persisted.at(-1).status).toBe('failed');
    expect(f.progress.has('privacy-task')).toBe(false);
  });

  it('Engine退出按新用途保留未知DDL进度，不能降级为旧columnPatch', async () => {
    const f = fixture(), taskId = 'engine-exit';
    f.tasks.set(taskId, { id: taskId, kind: prefix + 'apply', status: 'running', progress: 55, startedAt: new Date().toISOString() });
    f.progress.set(taskId, { phase: 'executing', ddlSubmitted: true, ddlCompleted: false, definitionVerified: false, outcome: 'unknown' });
    f.context.actual.engineExited();
    expect(f.emitted.at(-1)).toMatchObject({ taskId, status: 'failed', databaseDefaultEncoding: { ddlSubmitted: true, outcome: 'unknown' } });
    expect(f.emitted.at(-1).columnPatch).toBeUndefined(); expect(JSON.stringify(f.persisted)).not.toContain('ALTER DATABASE');
  });

  it.each(['get', 'preview'] as const)('通用结构Map128项满时%s只精确回收本次新令牌，不丢旧cap', async command => {
    const f = fixture(), snapshot = command === 'preview' ? await f.get() : undefined;
    for (let index = f.tokens.size; index < 128; index++) f.tokens.set(token(1000 + index), { purpose: 'indexes', connectionId: target.connectionId, kind: 'snapshot', expires: Date.now() + 120000 });
    const result = command === 'get' ? f.read() : f.plan(), id = 'snapshotId' in result ? result.snapshotId : result.previewToken;
    f.request.mockImplementation(async name => name === prefix + command ? result : f.reply(name));
    expect((await f.invoke(prefix + command, command === 'get' ? f.getInput() : f.previewInput(snapshot.snapshotId))).ok).toBe(false);
    expect(f.request).toHaveBeenLastCalledWith(prefix + 'release', command === 'get' ? { snapshotId: id } : { previewToken: id });
    expect(f.tokens.size).toBe(128); if (snapshot) expect(f.tokens.has(snapshot.snapshotId)).toBe(true);
  });

  it.each(['get', 'preview'] as const)('引擎%s等待中连接修订变化，精确释放后才结束且不登记通用Map', async command => {
    const f = fixture(), snapshot = command === 'preview' ? await f.get() : undefined, waiting = deferred(), cleanup = deferred();
    const result = command === 'get' ? f.read() : f.plan(), id = 'snapshotId' in result ? result.snapshotId : result.previewToken;
    f.request.mockImplementation(async name => name === prefix + command ? waiting.promise : name === prefix + 'release' ? cleanup.promise : f.reply(name));
    let done = false; const operation = f.invoke(prefix + command, command === 'get' ? f.getInput() : f.previewInput(snapshot.snapshotId)).then(result => { done = true; return result; });
    await flush(); f.setRevision(8); waiting.resolve(result); await flush(); expect(done).toBe(false);
    expect(f.request).toHaveBeenLastCalledWith(prefix + 'release', command === 'get' ? { snapshotId: id } : { previewToken: id });
    cleanup.resolve(undefined); expect((await operation).ok).toBe(false); expect(f.tokens.has(id)).toBe(false);
  });

  it('退出期间仍允许原文档精确释放，不能由于开始新任务门留下engine能力', async () => {
    const f = fixture(), snapshot = await f.get(); f.context.shuttingDown = true;
    const result = await f.invoke(prefix + 'release', { snapshotId: snapshot.snapshotId });
    expect(result.ok).toBe(true); expect(f.request).toHaveBeenLastCalledWith(prefix + 'release', { snapshotId: snapshot.snapshotId }); expect(f.tokens.has(snapshot.snapshotId)).toBe(false);
  });

  it('目录权限不足的只读get能交付真实原因，不把只读结果当IPC格式失败', async () => {
    const f = fixture(), result = { ...f.read(), catalogDigest: '', candidates: [], writable: false, reasons: ['编码目录权限不足'] };
    f.request.mockResolvedValueOnce(result);
    expect(await f.get()).toMatchObject({ writable: false, reasons: ['编码目录权限不足'], catalogDigest: '' }); expect(f.request).toHaveBeenCalledTimes(1);
  });

  it.each(['own', 'other-purpose'] as const)('重复%s令牌不能在owner最终验证之前覆盖通用Map旧记录', async mode => {
    const f = fixture(), id = mode === 'own' ? (await f.get()).snapshotId : token(700);
    if (mode === 'other-purpose') f.tokens.set(id, { purpose: 'indexes', connectionId: 'other-trusted', kind: 'snapshot', expires: Date.now() + 120000 });
    const original = f.tokens.get(id); f.request.mockResolvedValueOnce(f.read(id));
    const result = await f.invoke(prefix + 'get', f.getInput());
    expect(result.ok).toBe(false); expect(f.tokens.get(id)).toBe(original);
    expect(f.request.mock.calls.filter(([command]) => command === prefix + 'release')).toHaveLength(0);
  });

  it('get回包的库目标偏移被拒绝且只清理本次，原快照与权限记录保持', async () => {
    const f = fixture(), original = await f.get(), result = { ...f.read(), target: { ...target, database: '另外的库' } };
    f.request.mockResolvedValueOnce(result); expect((await f.invoke(prefix + 'get', f.getInput())).ok).toBe(false);
    expect(f.request).toHaveBeenLastCalledWith(prefix + 'release', { snapshotId: result.snapshotId });
    expect(f.tokens.has(result.snapshotId)).toBe(false); expect(f.tokens.has(original.snapshotId)).toBe(true);
  });

  it('已提交而后核不同的实际值仍能交付人工核对，令牌保持消费', async () => {
    const f = fixture(), snapshot = await f.get(), preview = await f.preview(snapshot.snapshotId), result = { target, before: current, after: { charset: 'utf8mb4', collation: 'utf8mb4_general_ci' }, ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: ['实际配对与计划不同'], verificationError: '后核不同' };
    f.request.mockResolvedValueOnce(result); expect(await f.run(prefix + 'apply', f.applyInput(preview.previewToken))).toEqual(result);
    expect((await f.invoke(prefix + 'apply', f.applyInput(preview.previewToken))).ok).toBe(false);
  });

  it('真实Main超过两分钟拒绝预览执行，UI按preview→snapshot释放后可关闭并清通用Map', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(), snapshot = await f.get(), preview = await f.preview(snapshot.snapshotId); vi.setSystemTime(Date.now() + 120001);
      expect((await f.invoke(prefix + 'preview', f.previewInput(snapshot.snapshotId))).ok).toBe(false);
      expect((await f.invoke(prefix + 'apply', f.applyInput(preview.previewToken))).ok).toBe(false);
      expect(f.request).toHaveBeenCalledTimes(2); expect(f.tokens.has(snapshot.snapshotId)).toBe(true); expect(f.tokens.has(preview.previewToken)).toBe(true);
      expect((await f.invoke(prefix + 'release', { previewToken: preview.previewToken })).ok).toBe(true); expect(f.tokens.has(preview.previewToken)).toBe(false); expect(f.tokens.has(snapshot.snapshotId)).toBe(true);
      expect((await f.invoke(prefix + 'release', { snapshotId: snapshot.snapshotId })).ok).toBe(true); expect(f.tokens.size).toBe(0);
      expect(f.request.mock.calls.slice(2)).toEqual([[prefix + 'release', { previewToken: preview.previewToken }], [prefix + 'release', { snapshotId: snapshot.snapshotId }]]);
    } finally { vi.useRealTimers(); }
  });

  it('到期get迟到响应仍不发布并精确回收，另一新文档不能借过期获得release能力', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(), snapshot = await f.get(), preview = await f.preview(snapshot.snapshotId), waiting = deferred(), result = f.read();
      f.request.mockImplementationOnce(async () => waiting.promise); const pending = f.invoke(prefix + 'get', f.getInput()); await flush(); vi.setSystemTime(Date.now() + 120001); waiting.resolve(result);
      expect((await pending).ok).toBe(false); expect(f.request).toHaveBeenLastCalledWith(prefix + 'release', { snapshotId: result.snapshotId }); expect(f.tokens.has(result.snapshotId)).toBe(false);
      const calls = f.request.mock.calls.length; f.navigate();
      expect((await f.invoke(prefix + 'release', { previewToken: preview.previewToken })).ok).toBe(false); expect((await f.invoke(prefix + 'release', { snapshotId: snapshot.snapshotId })).ok).toBe(false); expect(f.request).toHaveBeenCalledTimes(calls);
    } finally { vi.useRealTimers(); }
  });
});
