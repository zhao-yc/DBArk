import { describe, expect, it, vi } from 'vitest';
import { execute, type ManagedConnection } from '../../src/engine/connection';

/** 通过驱动回调替身检验协议选择，避免为了兼容性在失败后重放写操作。 */
function connection(error: Error | null = null): ManagedConnection {
  const done = (...args: unknown[]) => (args.at(-1) as Function)(error, { affectedRows: 1 }, []);
  return { broken: false, connection: { query: vi.fn(done), execute: vi.fn(done) } } as unknown as ManagedConnection;
}

describe('数据库协议选择', () => {
  it.each(['START TRANSACTION', 'COMMIT', 'ROLLBACK', 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'])('无参数控制语句 %s 使用文本协议', async sql => {
    const managed = connection(); await execute(managed, sql);
    expect(managed.connection.query).toHaveBeenCalledOnce(); expect(managed.connection.execute).not.toHaveBeenCalled();
  });
  it('含参数语句保留预处理，不依赖服务器反斜线转义模式', async () => {
    const managed = connection(); await execute(managed, 'UPDATE t SET title=? WHERE id=?', ["引用'与\\", 1]);
    expect(managed.connection.execute).toHaveBeenCalledOnce(); expect(managed.connection.query).not.toHaveBeenCalled();
  });
  it('写操作失败后不会降级重放', async () => {
    const managed = connection(new Error('连接中断'));
    await expect(execute(managed, 'UPDATE t SET title=?', ['新值'])).rejects.toThrow('连接中断');
    expect(managed.connection.execute).toHaveBeenCalledOnce(); expect(managed.connection.query).not.toHaveBeenCalled();
  });
});
