import { describe, expect, it } from 'vitest';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { persistedQueryError, persistedTaskMessage } from '../../src/main/taskPrivacy';
import { ExportReservations } from '../../src/main/exportReservations';
import type { TaskEvent } from '../../src/shared/contracts';

describe('完整导出持久化与目标互斥', () => {
  it.each(['running','completed','failed','cancelled'] as const)('数据搜索%s概要不保存搜索词、命中或错误，完成也提醒范围限制',status=>{
    const message=persistedTaskMessage('search.dataStart',{taskId:'搜索',status,progress:50,message:'敏感搜索内容'});
    expect(message).not.toContain('敏感搜索内容');expect(message).toContain('搜索值');if(status==='completed')expect(message).toContain('范围完成情况');
  });
  it.each(['running', 'completed', 'failed', 'cancelled'] as const)('外键%s事件只保存可信执行阶段，不保存名称、定义与服务器原错误', status => {
    const secret = '自主夹具-含原值的服务器错误';
    for (const phase of ['before', 'submitted', 'completed'] as const) {
      const event: TaskEvent = { taskId: 'foreign-key-task', status, progress: 0, message: secret, foreignKeyPatch: { phase: 'verifying', ddlSubmitted: phase !== 'before', ddlCompleted: phase === 'completed', definitionVerified: false, outcome: phase === 'completed' ? 'succeeded' : phase === 'submitted' ? 'unknown' : 'not-sent' } };
      const message = persistedTaskMessage('schema.foreignKeys.apply', event);
      expect(message).not.toContain(secret);
      expect(message).toContain(phase === 'completed' ? '已收到成功响应' : phase === 'submitted' ? '可能已执行' : '尚未确认发送');
    }
  });
  it('没有外键进度或只有其它编辑器进度时，不从服务器原错误推断DDL已完成', () => {
    const event: TaskEvent = { taskId: 'foreign-key-read', status: 'failed', progress: 0, message: '任意原字段内容', indexPatch: { phase: 'verifying', ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' } };
    expect(persistedTaskMessage('schema.foreignKeys.get', event)).toContain('尚未确认发送');
    expect(persistedTaskMessage('schema.foreignKeys.get', event)).not.toContain(event.message);
  });
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
