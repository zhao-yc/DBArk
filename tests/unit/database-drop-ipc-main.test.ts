import { readFileSync } from 'node:fs';
import { runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { mainColumnsHarness, deferred } from './main-columns-owner-harness';
import { databaseDropAcknowledgements, databaseDropIdentifier } from '../../src/shared/databaseDrop';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';

const prefix = 'schema.databaseDrop.';
const token = (id: number) => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
const target = { connectionId: 'trusted', database: '中文`库' };
const counts = { tables: 1, views: 2, procedures: 1, functions: 1, triggers: 1, events: 1 };
/** 只推进原Promise，不启动额外测试进程或真实数据库操作。 */
async function flush() { for (let index = 0; index < 12; index++) await Promise.resolve(); }

/** 提取生产Main能力函数和真实IPC入口，仅broker/Electron/持久化是RAM端口。 */
function fixture() {
  const f = mainColumnsHarness(), source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), parts: string[] = [];
  const names = ['assertDatabaseDropRecord', 'removeDatabaseDropRecord', 'sweepDatabaseDropCapabilities', 'beginDatabaseDrop', 'assertDatabaseDropBeforeSend', 'databaseDropResponse', 'databaseDropResponseCounts', 'databaseDropResponseStrings', 'publishDatabaseDrop', 'assertDatabaseDropPublication', 'rejectDatabaseDropPublication', 'taskEvent', 'persistAuxiliary'];
  for (const statement of tree.statements) {
    if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(item => ['databaseDropCapabilities', 'databaseDropRetired', 'databaseDropReservations', 'databaseDropStale'].includes(item.name.getText(tree)))) parts.push(statement.getText(tree));
    if (ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text ?? '')) parts.push(statement.getText(tree));
  }
  if (parts.length !== names.length + 4) throw Error('未提取完整删除数据库Main能力实现');
  const emitted: any[] = [], persisted: any[] = [], afterEvent = { action: undefined as (() => void) | undefined };
  Object.assign(f.context, { Object, databaseDropAcknowledgements, databaseDropIdentifier, persistedTaskMessage, lastPersist: new Map(), lastStorageWarning: 0 });
  f.context.store.saveTask = vi.fn((record: any) => persisted.push(structuredClone(record))); f.context.store.addHistory = vi.fn();
  f.context.window.webContents.send = (_channel: string, event: any) => { emitted.push(event); afterEvent.action?.(); };
  runInContext(ts.transpileModule(parts.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, f.context);
  let issued = 0, task = 0;
  const read = (id = token(++issued)) => ({ target: { ...target }, snapshotId: id, expiresAt: new Date(Date.now() + 120000).toISOString(), catalogDigest: 'a'.repeat(64), counts: { ...counts }, charset: 'utf8mb4', collation: 'utf8mb4_bin', writable: true, reasons: [], warnings: [], serverVersion: '8.4.11' });
  const plan = (id = token(++issued)) => ({ target: { ...target }, previewToken: id, expiresAt: new Date(Date.now() + 120000).toISOString(), catalogDigest: 'a'.repeat(64), counts: { ...counts }, sql: 'DROP DATABASE ' + databaseDropIdentifier(target.database) + ';', requiredAcknowledgements: [...databaseDropAcknowledgements], warnings: [] });
  const applied = () => ({ target: { ...target }, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, after: { databaseAbsent: true }, warnings: [] });
  const reply = (command: string) => command === prefix + 'get' ? read() : command === prefix + 'preview' ? plan() : command === prefix + 'apply' ? applied() : undefined;
  f.request.mockImplementation(async command => reply(command));
  const getInput = () => ({ ...target, taskId: 'drop-get-' + ++task });
  const previewInput = (snapshotId: string) => ({ snapshotId, taskId: 'drop-preview-' + ++task });
  const applyInput = (previewToken: string) => ({ previewToken, confirmation: target.database, acknowledgements: [...databaseDropAcknowledgements], taskId: 'drop-apply-' + ++task });
  const get = () => f.run(prefix + 'get', getInput()), preview = (snapshotId: string) => f.run(prefix + 'preview', previewInput(snapshotId));
  const navigate = () => f.context.window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  return { ...f, emitted, persisted, afterEvent, getInput, previewInput, applyInput, read, plan, applied, reply, get, preview, navigate };
}

describe('删除数据库严格IPC与真实Main能力', () => {
  it('四公开命令拒绝额外SQL、修订和目标，确认文字保留Unicode/反引号且不trim', async () => {
    const f = fixture(), valid = { get: f.getInput(), preview: f.previewInput(token(1)), apply: f.applyInput(token(2)), release: { snapshotId: token(1) } };
    for (const kind of ['get', 'preview', 'apply', 'release'] as const) {
      expect(publicCommands[prefix + kind as keyof typeof publicCommands]).toBe(true);
      for (const addition of [{ sql: 'DROP DATABASE 他库' }, { connectionRevision: 99 }, { target }]) expect((await f.invoke(prefix + kind, { ...valid[kind], ...addition })).ok).toBe(false);
    }
    expect(validateCommand(prefix + 'get', valid.get)).toMatchObject(target);
    expect(() => validateCommand(prefix + 'apply', { ...valid.apply, confirmation: target.database + ' ' })).toThrow();
    expect((await f.invoke(prefix + 'apply', { ...valid.apply, acknowledgements: Array(4).fill(databaseDropAcknowledgements[0]) })).ok).toBe(false);
    expect((await f.invoke(prefix + 'release', {})).ok).toBe(false); expect(f.request).not.toHaveBeenCalled();
  });

  it('原目标/修订真实get→preview→apply，首个broker等待前消费父和全部兄弟能力', async () => {
    const f = fixture(), snapshot = await f.get(), first = await f.preview(snapshot.snapshotId), second = await f.preview(snapshot.snapshotId);
    const waiting = deferred(); f.request.mockImplementation(async command => command === prefix + 'apply' ? waiting.promise : f.reply(command));
    const operation = f.invoke(prefix + 'apply', f.applyInput(first.previewToken)); await flush();
    expect(f.tokens.has(snapshot.snapshotId)).toBe(false); expect(f.tokens.has(first.previewToken)).toBe(false); expect(f.tokens.has(second.previewToken)).toBe(false);
    expect((await f.invoke(prefix + 'apply', f.applyInput(second.previewToken))).ok).toBe(false);
    waiting.resolve(f.applied()); expect((await operation).ok).toBe(true);
    expect(f.request.mock.calls.filter(([command]) => command === prefix + 'apply')).toHaveLength(1);
    expect(f.request.mock.calls.every(([, input]) => input.connectionRevision === 7)).toBe(true); expect(f.context.store.addHistory).not.toHaveBeenCalled();
  });

  it('准确库名差一个空格/大小写不能领取，旧数据库或其它用途能力不授予删除权', async () => {
    const f = fixture(), snapshot = await f.get(), plan = await f.preview(snapshot.snapshotId);
    expect((await f.invoke(prefix + 'apply', { ...f.applyInput(plan.previewToken), confirmation: ' ' + target.database })).ok).toBe(false);
    expect(f.tokens.has(plan.previewToken)).toBe(false);
    expect((await f.invoke(prefix + 'apply', f.applyInput(plan.previewToken))).ok).toBe(false);
    f.tokens.set(token(900), { purpose: 'tableDrop', kind: 'snapshot', connectionId: 'trusted', expires: Date.now() + 120000 });
    for (const kind of ['preview', 'release']) expect((await f.invoke(prefix + kind, kind === 'preview' ? f.previewInput(token(900)) : { snapshotId: token(900) })).ok).toBe(false);
    expect(f.tokens.has(token(900))).toBe(true); expect(f.request).toHaveBeenCalledTimes(2);
  });

  it.each(['revision', 'document'] as const)('%s换代后旧snapshot和preview不能继续使用', async mode => {
    const f = fixture(), snapshot = await f.get(), plan = await f.preview(snapshot.snapshotId);
    if (mode === 'revision') f.setRevision(8); else f.navigate();
    expect((await f.invoke(prefix + 'preview', f.previewInput(snapshot.snapshotId))).ok).toBe(false);
    expect((await f.invoke(prefix + 'apply', f.applyInput(plan.previewToken))).ok).toBe(false); expect(f.request.mock.calls.filter(([command]) => command === prefix + 'apply')).toHaveLength(0);
  });

  it.each(['get', 'preview'] as const)('迟到%s不能发布，等待精确release完成且不清理其它窗口', async kind => {
    const f = fixture(), snapshot = kind === 'preview' ? await f.get() : undefined, pending = deferred(), cleanup = deferred();
    const result = kind === 'get' ? f.read() : f.plan();
    f.request.mockImplementation(async command => command === prefix + kind ? pending.promise : command === prefix + 'release' ? cleanup.promise : f.reply(command));
    let done = false; const operation = f.invoke(prefix + kind, kind === 'get' ? f.getInput() : f.previewInput(snapshot.snapshotId)).then(value => { done = true; return value; });
    await flush(); f.setRevision(8); pending.resolve(result); await flush(); expect(done).toBe(false);
    expect(f.request).toHaveBeenLastCalledWith(prefix + 'release', 'snapshotId' in result ? { snapshotId: result.snapshotId } : { previewToken: result.previewToken });
    cleanup.resolve(undefined); expect((await operation).ok).toBe(false); expect(f.tokens.size).toBe(snapshot ? 1 : 0);
  });

  it('父释放期间在途preview不得复活，不能触发任何删除', async () => {
    const f = fixture(), snapshot = await f.get(), pending = deferred(), cleanup = deferred();
    f.request.mockImplementation(async (command, input) => command === prefix + 'preview' ? pending.promise : command === prefix + 'release' && input.snapshotId ? cleanup.promise : f.reply(command));
    const previewing = f.invoke(prefix + 'preview', f.previewInput(snapshot.snapshotId)); await flush();
    const releasing = f.invoke(prefix + 'release', { snapshotId: snapshot.snapshotId }); await flush();
    const result = f.plan(); pending.resolve(result); expect((await previewing).ok).toBe(false);
    cleanup.resolve(undefined); expect((await releasing).ok).toBe(true); expect(f.tokens.size).toBe(0);
    expect((await f.invoke(prefix + 'apply', f.applyInput(result.previewToken))).ok).toBe(false);
  });

  it.each(['target', 'digest', 'counts', 'sql', 'acks'] as const)('预览%s与真实get不同则拒绝并只释放本次返回能力', async mode => {
    const f = fixture(), snapshot = await f.get(), result = f.plan();
    if (mode === 'target') result.target.database = '他库';
    if (mode === 'digest') result.catalogDigest = 'b'.repeat(64);
    if (mode === 'counts') result.counts.views++;
    if (mode === 'sql') result.sql += 'DROP DATABASE 其他库;';
    if (mode === 'acks') result.requiredAcknowledgements = [databaseDropAcknowledgements[0]];
    f.request.mockImplementation(async command => command === prefix + 'preview' ? result : f.reply(command));
    expect((await f.invoke(prefix + 'preview', f.previewInput(snapshot.snapshotId))).ok).toBe(false);
    expect(f.request).toHaveBeenLastCalledWith(prefix + 'release', { previewToken: result.previewToken }); expect(f.tokens.has(snapshot.snapshotId)).toBe(true);
  });

  it('重复能力不覆盖其它用途，也不能借拒绝清理其它用途', async () => {
    const f = fixture(), id = token(900), original = { purpose: 'indexes', kind: 'snapshot', connectionId: 'elsewhere', expires: Date.now() + 120000 };
    f.tokens.set(id, original); f.request.mockResolvedValueOnce(f.read(id));
    expect((await f.invoke(prefix + 'get', f.getInput())).ok).toBe(false); expect(f.tokens.get(id)).toBe(original); expect(f.request).toHaveBeenCalledTimes(1);
  });

  it('最终发布前导航换代，已登记get仍必须精确回收', async () => {
    const f = fixture(); f.afterEvent.action = () => f.navigate();
    expect((await f.invoke(prefix + 'get', f.getInput())).ok).toBe(false);
    expect(f.request.mock.calls.map(([command]) => command)).toEqual([prefix + 'get', prefix + 'release']); expect(f.tokens.size).toBe(0);
  });

  it('执行成功但后核失败仍保留DDL完成回执，能力不可重试', async () => {
    const f = fixture(), snapshot = await f.get(), plan = await f.preview(snapshot.snapshotId);
    const result = { ...f.applied(), definitionVerified: false, after: undefined, warnings: ['后核失败'], verificationError: '网络断开' };
    f.request.mockResolvedValueOnce(result); expect(await f.run(prefix + 'apply', f.applyInput(plan.previewToken))).toEqual(result);
    expect((await f.invoke(prefix + 'apply', f.applyInput(plan.previewToken))).ok).toBe(false);
  });

  it('apply完成后原preview/snapshot及兄弟可幂等精确release，原文档未知/其它用途仍拒绝', async () => {
    const f = fixture(), snapshot = await f.get(), first = await f.preview(snapshot.snapshotId), sibling = await f.preview(snapshot.snapshotId);
    await f.run(prefix + 'apply', f.applyInput(first.previewToken));
    for (const input of [{ previewToken: first.previewToken }, { snapshotId: snapshot.snapshotId }, { previewToken: sibling.previewToken }, { previewToken: first.previewToken }, { snapshotId: snapshot.snapshotId, previewToken: sibling.previewToken }]) expect((await f.invoke(prefix + 'release', input)).ok).toBe(true);
    expect(f.tokens.size).toBe(0);
    expect((await f.invoke(prefix + 'release', { snapshotId: token(990) })).ok).toBe(false);
    f.navigate(); expect((await f.invoke(prefix + 'release', { snapshotId: snapshot.snapshotId })).ok).toBe(false);
    expect(f.request.mock.calls.filter(([command]) => command === prefix + 'apply')).toHaveLength(1);
  });

  it('准确确认失败也消费父及兄弟，但原cleanup凭证仍可真实回收', async () => {
    const f = fixture(), snapshot = await f.get(), first = await f.preview(snapshot.snapshotId), sibling = await f.preview(snapshot.snapshotId);
    expect((await f.invoke(prefix + 'apply', { ...f.applyInput(first.previewToken), confirmation: 'x' + target.database })).ok).toBe(false);
    expect(f.tokens.size).toBe(0);
    expect((await f.invoke(prefix + 'apply', f.applyInput(sibling.previewToken))).ok).toBe(false);
    expect((await f.invoke(prefix + 'preview', f.previewInput(snapshot.snapshotId))).ok).toBe(false);
    for (const input of [{ previewToken: first.previewToken }, { snapshotId: snapshot.snapshotId }, { previewToken: sibling.previewToken }]) expect((await f.invoke(prefix + 'release', input)).ok).toBe(true);
    expect(f.request.mock.calls.filter(([command]) => command === prefix + 'apply')).toHaveLength(0);
  });

  it('真实Main领取器的ACK语义检查失败同样消费；公开IPC仍先严格拒绝非法schema', async () => {
    const f = fixture(), snapshot = await f.get(), first = await f.preview(snapshot.snapshotId), sibling = await f.preview(snapshot.snapshotId);
    const owner = f.capabilities.capture(f.event());
    // 只直接调用生产领取器验证纵深语义门，真实IPC输入仍由Zod先校验且不允许跳过。
    expect(() => f.context.beginDatabaseDrop(prefix + 'apply', { ...f.applyInput(first.previewToken), acknowledgements: [] }, owner)).toThrow('原预览已消费');
    expect(f.tokens.size).toBe(0); expect((await f.invoke(prefix + 'apply', f.applyInput(sibling.previewToken))).ok).toBe(false);
    expect((await f.invoke(prefix + 'release', { snapshotId: snapshot.snapshotId })).ok).toBe(true);
    expect(f.request.mock.calls.filter(([command]) => command === prefix + 'apply')).toHaveLength(0);
  });

  it('snapshot先release后兄弟重复release不重授执行能力，真实Engine失败不能伪装成功', async () => {
    const f = fixture(), snapshot = await f.get(), first = await f.preview(snapshot.snapshotId), second = await f.preview(snapshot.snapshotId);
    expect((await f.invoke(prefix + 'release', { snapshotId: snapshot.snapshotId })).ok).toBe(true);
    const pending = deferred(); f.request.mockImplementation(async (command, input) => command === prefix + 'release' && input.previewToken === first.previewToken ? pending.promise : f.reply(command));
    let done = false; const releasing = f.invoke(prefix + 'release', { previewToken: first.previewToken }).then(value => { done = true; return value; });
    await flush(); expect(done).toBe(false); pending.reject(Error('真实Engine回收失败')); expect((await releasing).ok).toBe(false);
    f.request.mockImplementation(async command => f.reply(command));
    expect((await f.invoke(prefix + 'release', { previewToken: first.previewToken })).ok).toBe(true);
    expect((await f.invoke(prefix + 'release', { previewToken: second.previewToken })).ok).toBe(true);
    expect((await f.invoke(prefix + 'apply', f.applyInput(second.previewToken))).ok).toBe(false);
  });

  it.each(['expired', 'document', 'revision'] as const)('64项预算在%s失效后真实回收再准入，不复用旧能力', async mode => {
    vi.useFakeTimers();
    try {
      const f = fixture(), originals = [];
      for (let index = 0; index < 64; index++) originals.push(await f.get());
      expect((await f.invoke(prefix + 'get', f.getInput())).ok).toBe(false);
      if (mode === 'expired') vi.setSystemTime(Date.now() + 120001); else if (mode === 'document') f.navigate(); else f.setRevision(8);
      const fresh = await f.get(); expect(f.tokens.size).toBe(1); expect(f.tokens.has(fresh.snapshotId)).toBe(true);
      expect(f.request.mock.calls.filter(([command]) => command === prefix + 'release')).toHaveLength(64);
      expect((await f.invoke(prefix + 'preview', f.previewInput(originals[0].snapshotId))).ok).toBe(false);
      if (mode === 'document') expect((await f.invoke(prefix + 'release', { snapshotId: originals[0].snapshotId })).ok).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('旧能力精确回收等待期间连接再变更，新get不能继续发到Engine', async () => {
    const f = fixture(), old = await f.get(), waiting = deferred(); f.setRevision(8);
    f.request.mockImplementation(async command => command === prefix + 'release' ? waiting.promise : f.reply(command));
    const operation = f.invoke(prefix + 'get', f.getInput()); await flush(); f.setRevision(9); waiting.resolve(undefined);
    expect((await operation).ok).toBe(false); expect(f.request.mock.calls.filter(([command]) => command === prefix + 'get')).toHaveLength(1);
    expect(f.tokens.has(old.snapshotId)).toBe(false);
  });

  it('Engine退出后迟到get不能重建能力，原新token精确回收后才失败', async () => {
    const f = fixture(), waiting = deferred(), result = f.read();
    f.request.mockImplementation(async command => command === prefix + 'get' ? waiting.promise : f.reply(command));
    const operation = f.invoke(prefix + 'get', f.getInput()); await flush(); f.context.actual.engineExited(); waiting.resolve(result);
    expect((await operation).ok).toBe(false); expect(f.tokens.size).toBe(0);
    expect(f.request).toHaveBeenLastCalledWith(prefix + 'release', { snapshotId: result.snapshotId });
  });

  it('进度及引擎退出均保留databaseDrop未知/已完成事实，原SQL错误不入任务盘记录', async () => {
    const f = fixture(), taskId = 'drop-exit', secret = '私有库名和SQL不落盘';
    f.tasks.set(taskId, { id: taskId, kind: prefix + 'apply', status: 'running', progress: 40, startedAt: new Date().toISOString() });
    f.context.taskEvent({ taskId, status: 'running', progress: 40, message: secret, databaseDrop: { phase: 'executing', ddlSubmitted: true, ddlCompleted: false, definitionVerified: false, outcome: 'unknown' } });
    f.context.actual.engineExited(); expect(f.emitted.at(-1)).toMatchObject({ databaseDrop: { ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' } });
    expect(f.emitted.at(-1).columnPatch).toBeUndefined(); expect(JSON.stringify(f.persisted)).not.toContain(secret);
    expect(f.persisted.at(-1).message).toContain('结构变更可能已执行');
  });

  it('退出或到期仍允许原文档精确释放；无owner的手工Map记录不能释放', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(), snapshot = await f.get(), plan = await f.preview(snapshot.snapshotId); vi.setSystemTime(Date.now() + 120001); f.context.shuttingDown = true;
      expect((await f.invoke(prefix + 'release', { previewToken: plan.previewToken })).ok).toBe(true);
      expect((await f.invoke(prefix + 'release', { snapshotId: snapshot.snapshotId })).ok).toBe(true); expect(f.tokens.size).toBe(0);
      f.tokens.set(token(999), { purpose: 'databaseDrop', kind: 'snapshot', connectionId: 'trusted', expires: Date.now() + 1000 });
      expect((await f.invoke(prefix + 'release', { snapshotId: token(999) })).ok).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
