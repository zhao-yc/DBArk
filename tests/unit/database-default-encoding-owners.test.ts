import { describe, expect, it, vi } from 'vitest';
import { DatabaseDefaultEncodingOwners } from '../../src/main/databaseDefaultEncodingOwners';
import type { ColumnsInvocation } from '../../src/main/columnsMainCapabilities';
import { databaseDefaultEncodingAcknowledgements } from '../../src/shared/databaseDefaultEncoding';

const pair = { charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' };
const selected = { charset: 'utf8mb4', collation: 'utf8mb4_bin' };
const target = { connectionId: '00000000-0000-4000-8000-000000000001', database: '隔离库' };
const token = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const getInput = () => ({ ...target, taskId: token(900) });
const previewInput = (snapshotId: string) => ({ snapshotId, ...selected, taskId: token(901) });
const applyInput = (previewToken: string) => ({ previewToken, confirmation: target.database, acknowledgements: [...databaseDefaultEncodingAcknowledgements], taskId: token(902) });
/** 可控Promise只暴露原任务完成，不靠超时判断已停止。 */
function deferred() { let resolve!: () => void, reject!: (error: unknown) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
/** 假owner保留文档对象identity，数字编号/同URL不参与授权。 */
function fixture() {
  let now = Date.parse('2026-10-22T01:00:00.000Z'), current = {};
  const document = () => current;
  const owner = (identity = current) => ({ owner: { document: identity } }) as ColumnsInvocation;
  const assert = vi.fn((invocation: ColumnsInvocation) => { if (!invocation || invocation.owner.document !== current) throw Error('来源已换代'); });
  const same = vi.fn((left: ColumnsInvocation, right: ColumnsInvocation) => { assert(left); assert(right); return left.owner.document === right.owner.document; });
  const release = vi.fn(async (_input: { snapshotId?: string; previewToken?: string }): Promise<unknown> => undefined);
  const subject = new DatabaseDefaultEncodingOwners({ assert, same, release }, () => now);
  const snapshot = (id = token(1)) => ({ target: { ...target }, snapshotId: id, expiresAt: new Date(now + 120000).toISOString(), definitionHash: 'a'.repeat(64), catalogDigest: 'b'.repeat(64), current: { ...pair }, candidates: [{ ...pair }, { ...selected }], writable: true, reasons: [], warnings: [], serverVersion: '8.4.11' });
  const preview = (id = token(2)) => ({ target: { ...target }, previewToken: id, expiresAt: new Date(now + 120000).toISOString(), definitionHash: 'a'.repeat(64), catalogDigest: 'b'.repeat(64), before: { ...pair }, after: { ...selected }, sql: 'ALTER DATABASE `隔离库` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', warnings: [], requiredAcknowledgements: [...databaseDefaultEncodingAcknowledgements] });
  async function get(id = token(1)) { const invocation = owner(), input = getInput(), result = snapshot(id); subject.before('get', input, invocation); await subject.after('get', input, result, invocation); subject.assertPublication('get', result, invocation); return result; }
  async function prepare(snapshotId = token(1), id = token(2)) { const invocation = owner(), input = previewInput(snapshotId), result = preview(id); subject.before('preview', input, invocation); await subject.after('preview', input, result, invocation); subject.assertPublication('preview', result, invocation); return result; }
  return { subject, owner, snapshot, preview, get, prepare, release, document, rotate: () => { current = {}; }, advance: (ms: number) => { now += ms; } };
}

describe('数据库默认编码真实文档能力登记', () => {
  it('同一文档不同IPC可读、反复预览、一次提交；apply在首个await之前消费', async () => {
    const f = fixture(), snapshot = await f.get(), preview = await f.prepare(snapshot.snapshotId);
    await f.prepare(snapshot.snapshotId, token(3));
    const invocation = f.owner(), input = applyInput(preview.previewToken);
    f.subject.before('apply', input, invocation);
    expect(() => f.subject.before('apply', input, f.owner())).toThrow('能力已失效');
    const result = { target, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, before: pair, after: selected, warnings: [] };
    await f.subject.after('apply', input, result, invocation); f.subject.assertPublication('apply', result, invocation);
    expect(f.release).not.toHaveBeenCalled();
  });

  it('引擎apply拒绝也不复活；失败清理占位不重授权', async () => {
    const f = fixture(); await f.get(); await f.prepare();
    const owner = f.owner(), input = applyInput(token(2)); f.subject.before('apply', input, owner);
    await expect(f.subject.rejectPublication('apply', undefined, owner, Error('执行已失败'))).rejects.toThrow('执行已失败');
    expect(() => f.subject.before('apply', input, f.owner())).toThrow('能力已失效');
    expect(f.release).not.toHaveBeenCalled();
  });

  it('同URL新文档与ABA返回原编号都不能使用旧snapshot/preview', async () => {
    const f = fixture(), original = f.document(); await f.get(); await f.prepare(); f.rotate();
    for (const invocation of [f.owner(), f.owner(original)]) {
      expect(() => f.subject.before('preview', previewInput(token(1)), invocation)).toThrow();
      expect(() => f.subject.before('apply', applyInput(token(2)), invocation)).toThrow();
      expect(() => f.subject.before('release', { snapshotId: token(1) }, invocation)).toThrow();
    }
    expect(f.release).not.toHaveBeenCalled();
  });

  it('伪造其它用途或未登记release令牌、空release、组合一项非法均无部分撤销', async () => {
    const f = fixture(); await f.get(); await f.prepare();
    for (const input of [{}, { snapshotId: token(7) }, { previewToken: token(7) }, { snapshotId: token(1), previewToken: token(7) }]) expect(() => f.subject.before('release', input, f.owner())).toThrow();
    expect(() => f.subject.before('apply', applyInput(token(2)), f.owner())).not.toThrow();
    expect(f.release).not.toHaveBeenCalled();
  });

  it('release父快照立即撤销所有已有预览，原异步release收尾允许文档关闭', async () => {
    const f = fixture(); await f.get(); await f.prepare(); await f.prepare(token(1), token(3));
    const owner = f.owner(), input = { snapshotId: token(1) }; f.subject.before('release', input, owner);
    expect(() => f.subject.before('apply', applyInput(token(2)), f.owner())).toThrow();
    expect(() => f.subject.before('apply', applyInput(token(3)), f.owner())).toThrow();
    f.rotate(); await f.subject.after('release', input, undefined, owner);
    expect(() => f.subject.assertPublication('release', undefined, owner)).not.toThrow();
  });

  it.each(['get', 'preview'] as const)('迟到%s先等待新令牌精确清理，原请求未settle前不结束', async command => {
    const f = fixture(); if (command === 'preview') await f.get();
    const owner = f.owner(), input = command === 'get' ? getInput() : previewInput(token(1)), result = command === 'get' ? f.snapshot() : f.preview();
    f.subject.before(command, input, owner); f.rotate();
    const wait = deferred(); f.release.mockImplementationOnce(() => wait.promise); let done = false;
    const operation = f.subject.after(command, input, result, owner).finally(() => { done = true; });
    const assertion = expect(operation).rejects.toThrow('来源已换代');
    await Promise.resolve(); await Promise.resolve(); expect(done).toBe(false);
    expect(f.release).toHaveBeenCalledExactlyOnceWith(command === 'get' ? { snapshotId: token(1) } : { previewToken: token(2) });
    wait.resolve(); await assertion;
  });

  it('最终IPC门导航失效时精确撤销，重复catch不重复release且保留清理失败', async () => {
    const f = fixture(), owner = f.owner(), input = getInput(), result = f.snapshot();
    f.subject.before('get', input, owner); await f.subject.after('get', input, result, owner); f.rotate();
    let original!: unknown; try { f.subject.assertPublication('get', result, owner); } catch (error) { original = error; }
    const diskError = Error('清理失败'); f.release.mockRejectedValueOnce(diskError);
    const first = f.subject.rejectPublication('get', result, owner, original);
    await expect(first).rejects.toMatchObject({ errors: [original, diskError] });
    expect(f.subject.rejectPublication('get', result, owner, Error('外层'))).toBe(first);
    await expect(first).rejects.toThrow('清理失败'); expect(f.release).toHaveBeenCalledTimes(1);
  });

  it('父release仍等待时迟到preview不可登记，只有它的新令牌被cleanup', async () => {
    const f = fixture(); await f.get(); const owner = f.owner(), input = previewInput(token(1));
    f.subject.before('preview', input, owner); f.subject.before('release', { snapshotId: token(1) }, f.owner());
    await expect(f.subject.after('preview', input, f.preview(), owner)).rejects.toThrow('能力已失效');
    expect(f.release).toHaveBeenCalledExactlyOnceWith({ previewToken: token(2) });
  });

  it('预览按原snapshot对象绑定，不能换目标、原定义、目录或本次选择', async () => {
    for (const mutation of ['target', 'before', 'after', 'definitionHash', 'catalogDigest'] as const) {
      const f = fixture(); await f.get(); const owner = f.owner(), input = previewInput(token(1)), result = f.preview();
      if (mutation === 'target') result.target.database = '另一个库';
      else if (mutation === 'before' || mutation === 'after') result[mutation].collation = 'utf8mb4_general_ci';
      else result[mutation] = 'c'.repeat(64);
      f.subject.before('preview', input, owner);
      await expect(f.subject.after('preview', input, result, owner), mutation).rejects.toThrow();
      expect(f.release).toHaveBeenCalledExactlyOnceWith({ previewToken: token(2) });
      expect(() => f.subject.before('apply', applyInput(token(2)), f.owner())).toThrow();
    }
  });

  it('恶意重复snapshotId不能撤销原已登记能力', async () => {
    const f = fixture(); await f.get(); const owner = f.owner(), input = getInput(); f.subject.before('get', input, owner);
    await expect(f.subject.after('get', input, f.snapshot(), owner)).rejects.toThrow('身份无效');
    expect(f.release).not.toHaveBeenCalled(); await expect(f.prepare()).resolves.toMatchObject({ previewToken: token(2) });
  });

  it('过期和超过两分钟响应拒绝；过期父不会被后到preview延长', async () => {
    const f = fixture(); await f.get(); const owner = f.owner(), input = previewInput(token(1)); f.subject.before('preview', input, owner); f.advance(120000);
    await expect(f.subject.after('preview', input, f.preview(), owner)).rejects.toThrow();
    expect(() => f.subject.before('preview', previewInput(token(1)), f.owner())).toThrow();
    const another = fixture(), invocation = another.owner(), value = another.snapshot(); value.expiresAt = '2026-10-22T01:02:00.001Z';
    const read = getInput(); another.subject.before('get', read, invocation); await expect(another.subject.after('get', read, value, invocation)).rejects.toThrow('期限无效');
  });

  it('预览期限以父剩余时间为上限，最终门检查时钟到期', async () => {
    const f = fixture(); await f.get(); f.advance(100000); const owner = f.owner(), input = previewInput(token(1)), result = f.preview();
    f.subject.before('preview', input, owner); await f.subject.after('preview', input, result, owner); f.advance(20000);
    expect(() => f.subject.assertPublication('preview', result, owner)).toThrow();
  });

  it('64项包括未返回读取与过期释放合同，失败或精确释放后才能归还名额', async () => {
    const f = fixture(), pending: ColumnsInvocation[] = [];
    for (let index = 0; index < 64; index++) { const owner = f.owner(); f.subject.before('get', getInput(), owner); pending.push(owner); }
    expect(() => f.subject.before('get', getInput(), f.owner())).toThrow('64项');
    f.subject.failed(pending[0]); expect(() => f.subject.before('get', getInput(), f.owner())).not.toThrow();
    const full = fixture(); for (let index = 1; index <= 64; index++) await full.get(token(index));
    expect(() => full.subject.before('get', getInput(), full.owner())).toThrow('64项'); full.advance(120001);
    expect(() => full.subject.before('get', getInput(), full.owner())).toThrow('64项');
    full.subject.before('release', { snapshotId: token(1) }, full.owner());
    await expect(full.get(token(100))).resolves.toMatchObject({ snapshotId: token(100) });
  });

  it('超过TTL仅剩同文档精确释放能力，先释放preview再snapshot的窗口关闭合同仍有效', async () => {
    const f = fixture(); await f.get(); await f.prepare(); f.advance(120001);
    expect(() => f.subject.before('preview', previewInput(token(1)), f.owner())).toThrow('能力已失效');
    expect(() => f.subject.before('apply', applyInput(token(2)), f.owner())).toThrow('能力已失效');
    const previewOwner = f.owner(), previewRelease = { previewToken: token(2) };
    f.subject.before('release', previewRelease, previewOwner); await f.subject.after('release', previewRelease, undefined, previewOwner); f.subject.assertPublication('release', undefined, previewOwner);
    const snapshotOwner = f.owner(), snapshotRelease = { snapshotId: token(1) };
    f.subject.before('release', snapshotRelease, snapshotOwner); await f.subject.after('release', snapshotRelease, undefined, snapshotOwner); f.subject.assertPublication('release', undefined, snapshotOwner);
    expect(() => f.subject.before('release', { previewToken: token(2) }, f.owner())).toThrow('能力已失效');
    expect(() => f.subject.before('release', { snapshotId: token(1) }, f.owner())).toThrow('能力已失效'); expect(f.release).not.toHaveBeenCalled();
  });

  it('到期不允许异文档释放或原窗口复活；最终发布门仍拒绝已过期新结果', async () => {
    const f = fixture(); await f.get(); await f.prepare(); f.advance(120001); f.rotate();
    expect(() => f.subject.before('release', { previewToken: token(2) }, f.owner())).toThrow();
    expect(() => f.subject.before('release', { snapshotId: token(1) }, f.owner())).toThrow();
    const late = fixture(), owner = late.owner(), input = getInput(), result = late.snapshot(); late.subject.before('get', input, owner);
    await late.subject.after('get', input, result, owner); late.advance(120001);
    expect(() => late.subject.assertPublication('get', result, owner)).toThrow('能力已失效');
  });

  it.each(['missing', 'unknown', 'target', 'uuid', 'hash', 'pair', 'sparse', 'duplicate', 'warnings', 'getter', 'prototype'] as const)('完整get响应验证拒绝%s且不会调用getter', async mutation => {
    const f = fixture(), owner = f.owner(), input = getInput(), result: any = f.snapshot(), getter = vi.fn(() => '8.4.11');
    if (mutation === 'missing') delete result.current;
    if (mutation === 'unknown') result.unexpected = true;
    if (mutation === 'target') result.target.table = '不能冒充表';
    if (mutation === 'uuid') result.snapshotId = '不是UUID';
    if (mutation === 'hash') result.definitionHash = '短hash';
    if (mutation === 'pair') result.current.charset = 'utf8;DROP';
    if (mutation === 'sparse') result.candidates = new Array(2);
    if (mutation === 'duplicate') result.candidates = [pair, pair];
    if (mutation === 'warnings') result.warnings = Array(129).fill('警告');
    if (mutation === 'getter') Object.defineProperty(result, 'serverVersion', { enumerable: true, get: getter });
    if (mutation === 'prototype') Object.setPrototypeOf(result, { extra: true });
    f.subject.before('get', input, owner); await expect(f.subject.after('get', input, result, owner)).rejects.toThrow(); expect(getter).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledTimes(mutation === 'uuid' ? 0 : 1);
  });

  it('调用after必须是本请求同input且一次，外部替换不能签发', async () => {
    const f = fixture(), owner = f.owner(), input = getInput(); f.subject.before('get', input, owner);
    await expect(f.subject.after('get', { ...input }, f.snapshot(), owner)).rejects.toThrow('能力已失效');
    expect(f.release).toHaveBeenCalledExactlyOnceWith({ snapshotId: token(1) });
    expect(() => f.subject.assertPublication('get', f.snapshot(), owner)).toThrow();
  });

  it('未知owner的错误清理不撤销任何engine能力，重复after也不撤销已发布旧能力', async () => {
    const f = fixture();
    await expect(f.subject.rejectPublication('get', f.snapshot(), f.owner(), Error('未登记'))).rejects.toThrow('未登记');
    expect(f.release).not.toHaveBeenCalled();
    const owner = f.owner(), input = getInput(), result = f.snapshot(); f.subject.before('get', input, owner);
    await f.subject.after('get', input, result, owner); f.subject.assertPublication('get', result, owner);
    await expect(f.subject.after('get', input, result, owner)).rejects.toThrow();
    expect(f.release).not.toHaveBeenCalled(); await expect(f.prepare()).resolves.toMatchObject({ previewToken: token(2) });
  });

  it('release预览不撤销父与兄弟预览，结果发布前父被release仍拒绝', async () => {
    const f = fixture(); await f.get(); await f.prepare(); await f.prepare(token(1), token(3));
    f.subject.before('release', { previewToken: token(2) }, f.owner());
    expect(() => f.subject.before('apply', applyInput(token(2)), f.owner())).toThrow();
    expect(() => f.subject.before('apply', applyInput(token(3)), f.owner())).not.toThrow();
    const owner = f.owner(), input = previewInput(token(1)), result = f.preview(token(4));
    f.subject.before('preview', input, owner); await f.subject.after('preview', input, result, owner);
    f.subject.before('release', { snapshotId: token(1) }, f.owner());
    expect(() => f.subject.assertPublication('preview', result, owner)).toThrow();
  });

  it('执行回执不能替换已消费预览目标或宣称未提交后重新执行', async () => {
    const f = fixture(); await f.get(); await f.prepare();
    const owner = f.owner(), input = applyInput(token(2)); f.subject.before('apply', input, owner);
    await expect(f.subject.after('apply', input, { target: { ...target, database: '另一个库' }, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, before: pair, after: selected, warnings: [] }, owner)).rejects.toThrow('结果可能已经提交');
    expect(() => f.subject.before('apply', input, f.owner())).toThrow(); expect(f.release).not.toHaveBeenCalled();
  });

  it('目录读取失败保留只读快照；空digest不能冒充可写或无原因响应', async () => {
    for (const mode of ['readonly', 'writable', 'no-reason'] as const) {
      const f = fixture(), owner = f.owner(), input = getInput();
      const result = { ...f.snapshot(), catalogDigest: '', writable: mode === 'writable', reasons: mode === 'no-reason' ? [] : ['无法完整核对编码目录'], candidates: [] };
      f.subject.before('get', input, owner);
      if (mode === 'readonly') { await expect(f.subject.after('get', input, result, owner)).resolves.toBeUndefined(); f.subject.assertPublication('get', result, owner); expect(f.release).not.toHaveBeenCalled(); }
      else await expect(f.subject.after('get', input, result, owner)).rejects.toThrow('响应身份无效');
    }
  });

  it.each([false, true])('实际后核配对不同只允许definitionVerified=%s为false的已提交回执', async verified => {
    const f = fixture(); await f.get(); await f.prepare();
    const owner = f.owner(), input = applyInput(token(2)), result = { target, ddlSubmitted: true, ddlCompleted: true, definitionVerified: verified, before: pair, after: { ...selected, collation: 'utf8mb4_general_ci' }, warnings: ['实际值与计划不同'], verificationError: '后核值不同' };
    f.subject.before('apply', input, owner);
    if (verified) await expect(f.subject.after('apply', input, result, owner)).rejects.toThrow('结果可能已经提交');
    else { await expect(f.subject.after('apply', input, result, owner)).resolves.toBeUndefined(); f.subject.assertPublication('apply', result, owner); }
    expect(() => f.subject.before('apply', input, f.owner())).toThrow(); expect(f.release).not.toHaveBeenCalled();
  });
});
