import { describe, expect, it, vi } from 'vitest';
import { cleanupSpecialIndexFixture, type SpecialIndexCleanupActions } from '../integration/helpers/special-index-cleanup';

/** 自主收尾动作仅验证顺序与失败传播，不冒充数据库或真实连接已经释放。 */
function actions(): { value: SpecialIndexCleanupActions; calls: string[] } {
  const calls: string[] = [];
  const mark = (name: string) => vi.fn(async () => { calls.push(name); });
  return { calls, value: { databaseAttempted: true, closeAll: mark('closeAll'), closeTracked: mark('closeTracked'), verifyThreadsGone: mark('verifyThreadsGone'), dropOwnDatabase: mark('dropOwnDatabase'), verifyDatabaseGone: mark('verifyDatabaseGone'), restoreObservation: mark('restoreObservation'), closeObserverStrict: mark('closeObserverStrict') } };
}

describe('特殊索引实库收尾的纯控制流', () => {
  it('先关闭及逐ID查证，再删库并查证不存在，最后恢复包装和严格关观察连接', async () => {
    const { value, calls } = actions(); await cleanupSpecialIndexFixture(value);
    expect(calls).toEqual(['closeAll', 'closeTracked', 'verifyThreadsGone', 'dropOwnDatabase', 'verifyDatabaseGone', 'restoreObservation', 'closeObserverStrict']);
  });
  it('线程未清零或查询无权限时保留随机库，finally仍执行', async () => {
    const { value, calls } = actions(), denied = new Error('逐ID查证失败'); value.verifyThreadsGone = vi.fn(async () => { throw denied; });
    await expect(cleanupSpecialIndexFixture(value)).rejects.toBe(denied);
    expect(value.dropOwnDatabase).not.toHaveBeenCalled(); expect(value.verifyDatabaseGone).not.toHaveBeenCalled(); expect(calls.slice(-2)).toEqual(['restoreObservation', 'closeObserverStrict']);
  });
  it('closeAll失败仍尝试关闭和查证，已证清零可以清库且保留原错误', async () => {
    const { value } = actions(), first = new Error('原closeAll失败'); value.closeAll = vi.fn(async () => { throw first; });
    await expect(cleanupSpecialIndexFixture(value)).rejects.toBe(first); expect(value.closeTracked).toHaveBeenCalledOnce(); expect(value.verifyThreadsGone).toHaveBeenCalledOnce(); expect(value.dropOwnDatabase).toHaveBeenCalledOnce();
  });
  it('迟到连接关闭和逐ID查证均失败时不删库，最初关闭错误仍为首因', async () => {
    const { value } = actions(), first = new Error('迟到连接未收尾'), second = new Error('线程集合不能确认完整');
    value.closeTracked = vi.fn(async () => { throw first; }); value.verifyThreadsGone = vi.fn(async () => { throw second; });
    let caught: unknown; try { await cleanupSpecialIndexFixture(value); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AggregateError); expect((caught as AggregateError).cause).toBe(first); expect((caught as AggregateError).errors).toEqual([first, second]);
    expect(value.dropOwnDatabase).not.toHaveBeenCalled(); expect(value.restoreObservation).toHaveBeenCalledOnce(); expect(value.closeObserverStrict).toHaveBeenCalledOnce();
  });
  it('DROP失败仍查证库和严格关闭；后续finally失败以AggregateError保留首因', async () => {
    const { value } = actions(), first = new Error('原DROP失败'), final = new Error('观察连接关闭失败');
    value.dropOwnDatabase = vi.fn(async () => { throw first; }); value.closeObserverStrict = vi.fn(async () => { throw final; });
    let caught: unknown; try { await cleanupSpecialIndexFixture(value); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AggregateError); expect((caught as AggregateError).cause).toBe(first); expect((caught as AggregateError).errors).toEqual([first, final]); expect(value.verifyDatabaseGone).toHaveBeenCalledOnce();
  });
  it('恢复观察包装失败不能跳过严格关闭，未尝试建库时不执行DROP', async () => {
    const { value } = actions(), failed = new Error('恢复失败'); value.databaseAttempted = false; value.restoreObservation = () => { throw failed; };
    await expect(cleanupSpecialIndexFixture(value)).rejects.toBe(failed); expect(value.closeObserverStrict).toHaveBeenCalledOnce(); expect(value.dropOwnDatabase).not.toHaveBeenCalled();
  });
});
