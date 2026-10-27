import { describe, expect, it, vi } from 'vitest';
import { ExternalObjectUris, type ExternalObjectUriPorts } from '../../src/main/externalObjectUris';
import { externalObjectUriEmptySchema, externalObjectUriIdSchema, externalObjectUriLimits, type ExternalObjectUriRequest } from '../../src/shared/externalObjectUris';
import { externalObjectUrisZh as text } from '../../src/shared/externalObjectUris.zh-CN';
import { objectUri, type WorkbenchTarget } from '../../src/shared/workbench';

type Owner = { document: symbol };
const target = (name = '原始表'): WorkbenchTarget => ({ connectionId: '合成连接', database: '库.名/ 🚢', kind: 'table', name });

/** 只控制原始 Promise 的真实收尾时刻，不用取消假装结束底层操作。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** 文档身份与配置修订彼此独立，模拟同一窗口的导航及配置 ABA。 */
function fixture(initialRevision: number | undefined = 1) {
  let revision: number | undefined = initialRevision;
  let live: Owner = { document: Symbol('初始文档') };
  let sequence = 0;
  const resolve = vi.fn<ExternalObjectUriPorts<Owner>['resolve']>(async (value, assertCurrent) => { assertCurrent(); return value; });
  const notify = vi.fn<ExternalObjectUriPorts<Owner>['notify']>();
  const queue = new ExternalObjectUris<Owner>({
    revision: () => revision,
    assertOwner: owner => { if (owner.document !== live.document) throw new Error('底层文档错误含 secret'); },
    sameOwner: (left, right) => left.document === right.document,
    resolve, notify,
    uid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  });
  return {
    queue, resolve, notify,
    owner: () => ({ document: live.document }),
    navigate: () => { live = { document: Symbol('新文档') }; return { document: live.document }; },
    revision: (value: number | undefined) => { revision = value; },
  };
}

/** 领取帮助仅确认正式返回值，不访问状态机内部字段。 */
function take(f: ReturnType<typeof fixture>, owner = f.owner()): ExternalObjectUriRequest {
  const request = f.queue.take(owner);
  if (!request) throw new Error('应有待处理请求');
  return request;
}

describe('系统对象链接的有界接收与交付', () => {
  it('握手仅接受空对象，确认参数仅接受 UUID 且禁止追加字段', () => {
    expect(externalObjectUriEmptySchema.parse({})).toEqual({});
    expect(externalObjectUriIdSchema.parse({ id: '00000000-0000-4000-8000-000000000001' })).toEqual({ id: '00000000-0000-4000-8000-000000000001' });
    expect(() => externalObjectUriEmptySchema.parse({ url: 'secret' })).toThrow();
    expect(() => externalObjectUriIdSchema.parse({ id: '任意路径' })).toThrow();
    expect(() => externalObjectUriIdSchema.parse({ id: '00000000-0000-4000-8000-000000000001', sql: 'SELECT 1' })).toThrow();
  });

  it('冷启动先接收且不访问数据库，修订可用后首次绑定并完成一次交付', async () => {
    const f = fixture(), owner = f.owner();
    f.revision(undefined);
    f.queue.receiveUrl(objectUri(target()));
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.queue.ready(owner)).toEqual({ pending: true, active: false });
    expect(() => f.queue.take(owner)).toThrow(text.notReady);
    f.revision(7);
    f.queue.ready(f.owner());
    const request = take(f, owner);
    expect(request).toMatchObject({ kind: 'target', target: target() });
    expect(await f.queue.resolve(owner, request.id)).toEqual(target());
    expect(f.queue.commit(owner, request.id)).toEqual({ committed: true });
    expect(f.queue.finish(owner, request.id)).toEqual({ pending: false, active: false });
    expect(f.resolve).toHaveBeenCalledTimes(1);
  });

  it('按原始对象身份核验，领取的可变副本不能修改主进程目标', async () => {
    const f = fixture(), owner = f.owner();
    const original = target('constructor/ %?#');
    f.queue.receiveUrl(objectUri(original)); f.queue.ready(owner);
    const request = take(f, owner);
    if (request.kind !== 'target') throw new Error('应为对象请求');
    request.target.database = '伪造库';
    expect(await f.queue.resolve(owner, request.id)).toEqual(original);
    expect(f.resolve.mock.calls[0][0]).toEqual(original);
  });

  it.each([
    'https://example.invalid/?password=secret',
    'javascript:secret',
    'DBARK://object/v1/c/database/d',
    'dbark://user:secret@object/v1/c/database/d',
    'dbark://object/v1/c/database/d?sql=secret',
    'dbark://object/v1/c/table/d/%2fsecret',
    'dbark://object/v1/c/table/d/%00secret',
    'dbark://object/v1/c/database/d#secret',
  ])('规范解析失败只返回固定错误，不回显系统输入：%s', uri => {
    const f = fixture(), owner = f.owner();
    f.queue.receiveUrl(uri); f.queue.ready(owner);
    const request = take(f, owner);
    expect(request).toMatchObject({ kind: 'error', code: 'invalid' });
    expect(JSON.stringify(request)).not.toContain('secret');
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.queue.finish(owner, request.id)).toEqual({ pending: false, active: false });
  });

  it('扫描整个 argv，普通参数和末尾 Chromium 参数不影响唯一规范链接', () => {
    const f = fixture(), owner = f.owner();
    f.queue.receiveArgv(['C:\\应用\\DBArk.exe', '--flag', objectUri(target()), '--original-process-start-time=1']);
    f.queue.ready(owner);
    expect(take(f, owner)).toMatchObject({ kind: 'target', target: target() });
    expect(f.resolve).not.toHaveBeenCalled();
  });

  it('无协议候选的 argv 不占槽、不覆盖已有系统请求', () => {
    const f = fixture(), owner = f.owner();
    f.queue.receiveUrl(objectUri(target()));
    f.queue.receiveArgv(['DBArk.exe', '--url=https://example.invalid', '--other=dbark://secret']);
    f.queue.ready(owner);
    expect(take(f, owner)).toMatchObject({ kind: 'target', target: target() });
  });

  it('多个候选使整次 argv 拒绝，不能挑选其中一个有效链接执行', () => {
    for (const candidates of [[objectUri(target()), objectUri(target('另一个'))], [objectUri(target()), 'DBARK:secret']]) {
      const f = fixture(), owner = f.owner();
      f.queue.receiveArgv(['DBArk.exe', ...candidates]); f.queue.ready(owner);
      const request = take(f, owner);
      expect(request).toMatchObject({ kind: 'error', code: 'multiple' });
      expect(JSON.stringify(request)).not.toContain('secret');
      expect(f.resolve).not.toHaveBeenCalled();
    }
  });

  it('参数数量、总字符和单个 URI 均有预算，超限没有隐式截断成功路径', () => {
    for (const argv of [
      Array.from({ length: externalObjectUriLimits.argvItems + 1 }, () => '--flag'),
      ['x'.repeat(externalObjectUriLimits.argvCharacters), objectUri(target())],
      ['dbark:' + 'x'.repeat(externalObjectUriLimits.uriCharacters)],
    ]) {
      const f = fixture(), owner = f.owner();
      f.queue.receiveArgv(argv); f.queue.ready(owner);
      expect(take(f, owner)).toMatchObject({ kind: 'error', code: 'invalid' });
      expect(f.resolve).not.toHaveBeenCalled();
    }
  });

  it('未开始请求只有最新一项，旧编号完成通知不能消费新 pending', () => {
    const f = fixture(), owner = f.owner();
    f.queue.receiveUrl(objectUri(target())); f.queue.ready(owner);
    const old = take(f, owner);
    f.queue.receiveUrl(objectUri(target('最新')));
    expect(f.queue.finish(owner, old.id)).toEqual({ pending: true, active: false });
    expect(take(f, owner)).toMatchObject({ kind: 'target', target: target('最新') });
  });

  it('错误也只有一个待处理槽，不把原始输入积累成无界错误列表', () => {
    const f = fixture(), owner = f.owner();
    for (let index = 0; index < 50; index++) f.queue.receiveUrl('dbark:secret' + index);
    f.queue.ready(owner);
    const request = take(f, owner);
    expect(request).toMatchObject({ kind: 'error', code: 'invalid' });
    expect(f.queue.take(owner)).toBeNull();
    expect(f.queue.finish(owner, request.id)).toEqual({ pending: false, active: false });
    expect(f.queue.take(owner)).toBeNull();
  });
});

describe('系统对象链接的原始操作、租约与提交边界', () => {
  it('同文档重复 ready 幂等，原始核验仅一次，不能重复领取或重复 resolve', async () => {
    const f = fixture(), owner = f.owner(), wait = deferred<WorkbenchTarget>();
    f.resolve.mockImplementationOnce(() => wait.promise);
    f.queue.receiveUrl(objectUri(target())); f.queue.ready(owner);
    const request = take(f, owner);
    const resolving = f.queue.resolve(owner, request.id);
    expect(f.queue.ready(f.owner())).toEqual({ pending: false, active: true });
    expect(f.queue.take(f.owner())).toBeNull();
    await expect(f.queue.resolve(f.owner(), request.id)).rejects.toThrow(text.alreadyResolved);
    expect(f.resolve).toHaveBeenCalledTimes(1);
    wait.resolve(target()); await resolving;
    expect(f.queue.commit(f.owner(), request.id)).toEqual({ committed: true });
    expect(() => f.queue.commit(owner, request.id)).toThrow(text.notResolved);
  });

  it('新意图永久撤销旧核验，但真实 Promise 收尾前始终不释放操作槽', async () => {
    const f = fixture(), owner = f.owner(), wait = deferred<WorkbenchTarget>();
    f.resolve.mockImplementationOnce(() => wait.promise);
    f.queue.receiveUrl(objectUri(target())); f.queue.ready(owner);
    const old = take(f, owner);
    const resolving = f.queue.resolve(owner, old.id);
    const rejected = expect(resolving).rejects.toThrow(text.changed);
    f.queue.receiveUrl(objectUri(target('中间')));
    f.queue.receiveUrl(objectUri(target()));
    expect(f.queue.ready(owner)).toEqual({ pending: true, active: true });
    expect(f.queue.take(owner)).toBeNull();
    expect(f.queue.finish(owner, old.id)).toEqual({ pending: true, active: true });
    expect(f.resolve).toHaveBeenCalledTimes(1);
    wait.resolve(target()); await rejected;
    expect(f.queue.ready(owner)).toEqual({ pending: true, active: false });
    const latest = take(f, owner);
    expect(latest.id).not.toBe(old.id);
    expect(latest).toMatchObject({ kind: 'target', target: target() });
  });

  it('提前 finish 只放弃投影，不制造下一次数据库核验并发', async () => {
    const f = fixture(), owner = f.owner(), wait = deferred<WorkbenchTarget>();
    f.resolve.mockImplementationOnce(() => wait.promise);
    f.queue.receiveUrl(objectUri(target())); f.queue.ready(owner);
    const request = take(f, owner), resolving = f.queue.resolve(owner, request.id);
    const rejected = expect(resolving).rejects.toThrow(text.changed);
    expect(f.queue.finish(owner, request.id)).toEqual({ pending: false, active: true });
    f.queue.receiveUrl(objectUri(target('下一项')));
    expect(f.queue.take(owner)).toBeNull();
    wait.resolve(target()); await rejected;
    expect(take(f, owner)).toMatchObject({ kind: 'target', target: target('下一项') });
  });

  it('页面换代及旧文档 ack 不释放未收尾核验，finally 唤醒新文档', async () => {
    const f = fixture(), oldOwner = f.owner(), wait = deferred<WorkbenchTarget>();
    f.resolve.mockImplementationOnce(() => wait.promise);
    f.queue.receiveUrl(objectUri(target())); f.queue.ready(oldOwner);
    const old = take(f, oldOwner), resolving = f.queue.resolve(oldOwner, old.id);
    const rejected = expect(resolving).rejects.toThrow(text.changed);
    const nextOwner = f.navigate();
    f.queue.receiveUrl(objectUri(target('新文档对象')));
    expect(f.queue.ready(nextOwner)).toEqual({ pending: true, active: true });
    expect(() => f.queue.finish(oldOwner, old.id)).toThrow(text.changed);
    expect(f.queue.take(nextOwner)).toBeNull();
    f.notify.mockClear();
    wait.resolve(target()); await rejected;
    expect(f.notify).toHaveBeenCalledWith(nextOwner);
    const next = take(f, nextOwner);
    expect(next).toMatchObject({ kind: 'target', target: target('新文档对象') });
    expect(() => f.queue.commit(oldOwner, old.id)).toThrow(text.changed);
    expect(f.queue.finish(nextOwner, old.id)).toEqual({ pending: false, active: true });
  });

  it('挂起后即使同文档重新握手也不能复活旧结果或重放原始请求', async () => {
    const f = fixture(), owner = f.owner(), wait = deferred<WorkbenchTarget>();
    f.resolve.mockImplementationOnce(() => wait.promise);
    f.queue.receiveUrl(objectUri(target())); f.queue.ready(owner);
    const old = take(f, owner), resolving = f.queue.resolve(owner, old.id);
    const rejected = expect(resolving).rejects.toThrow(text.changed);
    f.queue.suspend();
    expect(f.queue.ready(owner)).toEqual({ pending: false, active: true });
    wait.resolve(target()); await rejected;
    expect(f.queue.take(owner)).toBeNull();
    expect(f.resolve).toHaveBeenCalledTimes(1);
  });

  it('未启动 pending 可换到新文档，但回到同一窗口也不能让旧 owner 冒充新文档', () => {
    const f = fixture(), oldOwner = f.owner();
    f.queue.receiveUrl(objectUri(target())); f.queue.ready(oldOwner);
    const middleOwner = f.navigate(); f.queue.ready(middleOwner);
    const lastOwner = f.navigate(); f.queue.ready(lastOwner);
    expect(() => f.queue.ready(oldOwner)).toThrow(text.changed);
    expect(() => f.queue.take(middleOwner)).toThrow(text.changed);
    expect(take(f, lastOwner)).toMatchObject({ kind: 'target', target: target() });
  });

  it('已知配置在接收时绑定，配置 ABA 的新修订拒绝且不发起连接', () => {
    const f = fixture(), owner = f.owner();
    f.queue.receiveUrl(objectUri(target()));
    f.revision(2); f.revision(3);
    f.queue.ready(owner);
    expect(take(f, owner)).toMatchObject({ kind: 'error', code: 'changed' });
    expect(f.resolve).not.toHaveBeenCalled();
  });

  it('冷启动绑定只发生一次，后续 ready 不能用新修订重新授权同一 pending', () => {
    const f = fixture(), owner = f.owner();
    f.revision(undefined);
    f.queue.receiveUrl(objectUri(target()));
    f.revision(10); f.queue.ready(owner);
    f.revision(11); f.queue.ready(f.owner());
    expect(take(f, owner)).toMatchObject({ kind: 'error', code: 'changed' });
    expect(f.resolve).not.toHaveBeenCalled();
  });

  it('核验端口的中间检查捕获配置变化，不执行后续元数据动作', async () => {
    const f = fixture(), owner = f.owner(), wait = deferred<void>(), after = vi.fn();
    f.resolve.mockImplementationOnce(async (value, assertCurrent) => { await wait.promise; assertCurrent(); after(); return value; });
    f.queue.receiveUrl(objectUri(target())); f.queue.ready(owner);
    const request = take(f, owner), resolving = f.queue.resolve(owner, request.id);
    const rejected = expect(resolving).rejects.toThrow(text.changed);
    f.revision(2); wait.resolve(undefined); await rejected;
    expect(after).not.toHaveBeenCalled();
    expect(f.queue.ready(owner)).toEqual({ pending: false, active: false });
  });

  it('核验成功至 commit 之间的配置变化仍拒绝 UI 投影', async () => {
    const f = fixture(), owner = f.owner();
    f.queue.receiveUrl(objectUri(target())); f.queue.ready(owner);
    const request = take(f, owner); await f.queue.resolve(owner, request.id);
    f.revision(2);
    expect(() => f.queue.commit(owner, request.id)).toThrow(text.changed);
    expect(f.queue.finish(owner, request.id)).toEqual({ pending: false, active: false });
  });

  it('commit 前新请求使已完成结果失效，commit 后新请求仅排队等待 finish', async () => {
    const f = fixture(), owner = f.owner();
    f.queue.receiveUrl(objectUri(target())); f.queue.ready(owner);
    const first = take(f, owner); await f.queue.resolve(owner, first.id);
    f.queue.receiveUrl(objectUri(target('第二个')));
    expect(() => f.queue.commit(owner, first.id)).toThrow(text.changed);
    const second = take(f, owner); await f.queue.resolve(owner, second.id);
    expect(f.queue.commit(owner, second.id)).toEqual({ committed: true });
    f.queue.receiveUrl(objectUri(target('第三个')));
    expect(f.queue.ready(owner)).toEqual({ pending: true, active: true });
    expect(f.queue.take(owner)).toBeNull();
    expect(f.queue.finish(owner, first.id)).toEqual({ pending: true, active: true });
    expect(f.queue.finish(owner, second.id)).toEqual({ pending: true, active: false });
    expect(take(f, owner)).toMatchObject({ kind: 'target', target: target('第三个') });
  });

  it('无成功核验的对象或错误请求均不能 commit，也不允许错误请求发起查询', async () => {
    const f = fixture(), owner = f.owner();
    f.queue.receiveUrl(objectUri(target())); f.queue.ready(owner);
    const request = take(f, owner);
    expect(() => f.queue.commit(owner, request.id)).toThrow(text.notResolved);
    f.queue.finish(owner, request.id);
    f.queue.receiveUrl('dbark:secret');
    const error = take(f, owner);
    expect(() => f.queue.commit(owner, error.id)).toThrow(text.notResolved);
    await expect(f.queue.resolve(owner, error.id)).rejects.toThrow(text.notResolved);
    expect(f.resolve).not.toHaveBeenCalled();
  });

  it('未知连接或端口失败只核验原目标，不泄漏底层错误且收尾释放原槽', async () => {
    const f = fixture(), owner = f.owner();
    f.resolve.mockRejectedValueOnce(new Error('unknown profile: password=secret /private/key'));
    f.queue.receiveUrl(objectUri(target())); f.queue.ready(owner);
    const request = take(f, owner);
    await expect(f.queue.resolve(owner, request.id)).rejects.toThrow(text.resolveFailed);
    expect(f.resolve).toHaveBeenCalledTimes(1);
    expect(f.resolve.mock.calls[0][0]).toEqual(target());
    expect(f.queue.finish(owner, request.id)).toEqual({ pending: false, active: false });
  });

  it('原核验失败或完成时没有 pending 就不唤醒，避免通知把原始错误投影作废', async () => {
    const f = fixture(), owner = f.owner();
    f.resolve.mockRejectedValueOnce(new Error('原连接不可达 secret'));
    f.queue.receiveUrl(objectUri(target())); f.queue.ready(owner);
    const failed = take(f, owner);
    f.notify.mockClear();
    await expect(f.queue.resolve(owner, failed.id)).rejects.toThrow(text.resolveFailed);
    expect(f.notify).not.toHaveBeenCalled();
    expect(f.queue.finish(owner, failed.id)).toEqual({ pending: false, active: false });
    expect(f.notify).not.toHaveBeenCalled();
    f.queue.receiveUrl(objectUri(target('成功对象')));
    const successful = take(f, owner);
    await f.queue.resolve(owner, successful.id); f.queue.commit(owner, successful.id);
    f.notify.mockClear();
    expect(f.queue.finish(owner, successful.id)).toEqual({ pending: false, active: false });
    expect(f.notify).not.toHaveBeenCalled();
  });

  it('端口不得把原目标替换成其他对象后获得提交授权', async () => {
    const f = fixture(), owner = f.owner();
    f.resolve.mockResolvedValueOnce(target('替换对象'));
    f.queue.receiveUrl(objectUri(target())); f.queue.ready(owner);
    const request = take(f, owner);
    await expect(f.queue.resolve(owner, request.id)).rejects.toThrow(text.resolveFailed);
    expect(() => f.queue.commit(owner, request.id)).toThrow(text.changed);
  });

  it('通知投递失败仍保留请求，页面主动领取可以恢复', () => {
    const f = fixture(), owner = f.owner();
    f.notify.mockImplementation(() => { throw new Error('窗口已销毁 secret'); });
    expect(() => f.queue.ready(owner)).not.toThrow();
    expect(() => f.queue.receiveUrl(objectUri(target()))).not.toThrow();
    expect(take(f, owner)).toMatchObject({ kind: 'target', target: target() });
  });

  it('尚未 ready 的有效文档不能领取，旧编号也不能授权 resolve 或 commit', async () => {
    const f = fixture(), owner = f.owner();
    f.queue.receiveUrl(objectUri(target()));
    expect(() => f.queue.take(owner)).toThrow(text.notReady);
    f.queue.ready(owner);
    const request = take(f, owner);
    const wrong = '00000000-0000-4000-8000-000000999999';
    await expect(f.queue.resolve(owner, wrong)).rejects.toThrow(text.changed);
    expect(() => f.queue.commit(owner, wrong)).toThrow(text.changed);
    expect(f.queue.finish(owner, wrong)).toEqual({ pending: false, active: true });
    expect(await f.queue.resolve(owner, request.id)).toEqual(target());
  });

  it('close 禁止新交付且不重放；正在运行的原 Promise 仍独立收尾', async () => {
    const f = fixture(), owner = f.owner(), wait = deferred<WorkbenchTarget>();
    f.resolve.mockImplementationOnce(() => wait.promise);
    f.queue.receiveUrl(objectUri(target())); f.queue.ready(owner);
    const request = take(f, owner), resolving = f.queue.resolve(owner, request.id);
    const rejected = expect(resolving).rejects.toThrow(text.changed);
    f.queue.receiveUrl(objectUri(target('未开始')));
    f.queue.close(); f.notify.mockClear();
    expect(() => f.queue.receiveUrl(objectUri(target('关闭后')))).not.toThrow();
    expect(() => f.queue.receiveArgv([objectUri(target('关闭后参数'))])).not.toThrow();
    expect(() => f.queue.ready(owner)).toThrow(text.closed);
    expect(() => f.queue.take(owner)).toThrow(text.closed);
    expect(() => f.queue.commit(owner, request.id)).toThrow(text.closed);
    expect(f.resolve).toHaveBeenCalledTimes(1);
    wait.resolve(target()); await rejected;
    expect(f.notify).not.toHaveBeenCalled();
  });
});
