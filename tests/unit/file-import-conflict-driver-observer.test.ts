import { describe, expect, it, vi } from 'vitest';
import { observeConflictExecuteCall } from '../helpers/fileImportConflictDriverObservation';

describe('冲突导入原driver Promise只读旁观', () => {
  it('原this、参数、callback及Promise原样透传，只记录原Command对应服务器errno', async () => {
    let reject!: (error: unknown) => void;
    const promise = new Promise<never>((_, fail) => { reject = fail; }), owner = {}, args = [{ id: 1 }, 'INSERT 固定合成语句', [7], () => {}] as const;
    let captured: object | undefined, serverError = false;
    const original = vi.fn(function (this: unknown, ...input: unknown[]) { expect(this).toBe(owner); expect(input).toEqual(args); captured = {}; return promise; });
    const errno = vi.fn(), wrapped = observeConflictExecuteCall(original, () => () => captured ? { command: captured, serverErrorObserved: () => serverError, recordErrno: errno } : undefined);
    const result = Reflect.apply(wrapped, owner, args); expect(result).toBe(promise); expect(original).toHaveBeenCalledTimes(1);
    const error = Object.assign(Error('不得进入诊断正文'), { errno: 1062 }); serverError = true; const failure = expect(result).rejects.toBe(error); reject(error); await failure;
    expect(errno.mock.calls).toEqual([[1062]]); expect(JSON.stringify(errno.mock.calls)).not.toContain(error.message);
  });
  it('没有原Command的本地preflight失败不能被正整数errno伪装成serverERR', async () => {
    const error = Object.assign(Error('本地错误'), { errno: 1062 }), promise = Promise.reject(error), errno = vi.fn();
    const wrapped = observeConflictExecuteCall(() => promise, () => () => undefined);
    expect(wrapped()).toBe(promise); await expect(promise).rejects.toBe(error); expect(errno).not.toHaveBeenCalled();
  });
  it('原Command没有同代session-error时，网络或本地错误不填errno', async () => {
    const error = Object.assign(Error('本地或网络错误'), { errno: 1062 }), promise = Promise.reject(error), errno = vi.fn();
    const wrapped = observeConflictExecuteCall(() => promise, () => () => ({ command: {}, serverErrorObserved: () => false, recordErrno: errno }));
    expect(wrapped()).toBe(promise); await expect(promise).rejects.toBe(error); expect(errno).not.toHaveBeenCalled();
  });
  it('捕获原Command而不是后来last索引，迟到拒绝不能归到新命令', async () => {
    const commands: { id: number; server: boolean; errno?: number }[] = []; let reject!: (error: unknown) => void;
    const first = new Promise<never>((_, fail) => { reject = fail; });
    const wrapped = observeConflictExecuteCall(() => { commands.push({ id: 1, server: true }); return first; }, () => { const offset = commands.length; return () => { const command = commands[offset]; return { command, serverErrorObserved: () => command.server, recordErrno: errno => { command.errno = errno; } }; }; });
    const result = wrapped(); commands.push({ id: 2, server: true }); const error = Object.assign(Error('原服务器错误'), { errno: 1317 }); const failure = expect(result).rejects.toBe(error); reject(error); await failure;
    expect(commands).toEqual([{ id: 1, server: true, errno: 1317 }, { id: 2, server: true }]);
  });
  it('诊断捕获或记录抛错不改变原结果，同步原异常不转换为Promise', async () => {
    const promise = Promise.resolve(7), fail = () => { throw Error('旁听故障'); };
    const capture = observeConflictExecuteCall(() => promise, fail); expect(capture()).toBe(promise); await expect(promise).resolves.toBe(7);
    const error = Object.assign(Error('原错误'), { errno: 1062 }), rejected = Promise.reject(error);
    const record = observeConflictExecuteCall(() => rejected, () => () => ({ command: {}, serverErrorObserved: () => true, recordErrno: fail })); expect(record()).toBe(rejected); await expect(rejected).rejects.toBe(error);
    const original = observeConflictExecuteCall((): Promise<never> => { throw error; }, () => undefined); expect(() => original()).toThrow(error);
  });
});
