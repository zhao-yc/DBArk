import { describe, expect, it } from 'vitest';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { persistedQueryError, persistedTaskMessage } from '../../src/main/taskPrivacy';
import { ExportReservations } from '../../src/main/exportReservations';
import type { TaskEvent } from '../../src/shared/contracts';

describe('完整导出持久化与目标互斥', () => {
  it('服务端展开错误不落入任务与历史，保留可信进度而不是参数原值', () => {
    const secret = '实际绑定值-不应落盘';
    const event: TaskEvent = { taskId: 'test', status: 'failed', progress: 0, message: `Duplicate entry '${secret}'`, queryExport: { phase: 'executing', statementsCompleted: 2, rowsWritten: 31, bytesWritten: 1024, fileCommitted: false, sqlMayHaveExecuted: true, transactionKnown: false } };
    const message = persistedTaskMessage('query.exportStream', event);
    expect(message).toContain('2 条 SQL'); expect(message).toContain('31 行'); expect(message).not.toContain(secret);
    expect(persistedQueryError('query.exportStream', event.message)).not.toContain(secret); expect(persistedTaskMessage('query.executeParameterized', event)).not.toContain(secret);
    expect(persistedQueryError('query.execute', '普通错误')).toBe('普通错误');
  });
  it('并发不同入口同目标只允许一个，失败释放后可重新授权执行', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dbark-export-lock-')); const reservations = new ExportReservations();
    try {
      const path = join(directory, 'result'); const results = await Promise.allSettled([reservations.acquire(path), reservations.acquire(join(directory, '.', 'result'))]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1); expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
      for (const result of results) if (result.status === 'fulfilled') { result.value(); result.value(); }
      const release = await reservations.acquire(path); release();
    } finally { await rmdir(directory); }
  });
});
