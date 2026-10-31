import { describe, expect, it } from 'vitest';
import { publicCommands } from '../../src/shared/commands';
import { commandSchemas, validateCommand } from '../../src/shared/validation';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { recoverSqliteImportTask, sqliteImportTaskMessage } from '../../src/shared/sqliteTableImportFact';
import type { TaskRecord } from '../../src/shared/contracts';

const inspect = { connectionId: 'owned', database: 'main' as const, fileToken: 'selected', format: 'csv' as const, encoding: 'utf8' as const, csvHasHeader: false, taskId: 'source-check' }, release = { sourceId: 'original-cap' }, privateValue = 'PRIVATE_SOURCE_TASK_913 D:/private/source.csv SELECT secret sha256';
describe('SQLite无表来源公开命令与任务隐私', () => {
  it('真实预加载白名单与validation接入两个来源命令，公开参数不能携带内部路径/回调/摘要', () => {
    expect(publicCommands['sqlite.importSource.inspect']).toBe(true); expect(publicCommands['sqlite.importSource.release']).toBe(true); expect(validateCommand('sqlite.importSource.inspect', inspect)).toEqual(inspect); expect(validateCommand('sqlite.importSource.release', release)).toEqual(release);
    for (const key of ['filePath', 'profile', 'assertCurrent', 'expectedSource', 'source', 'table', 'sql', 'sourceId']) expect(commandSchemas['sqlite.importSource.inspect'].safeParse({ ...inspect, [key]: privateValue }).success).toBe(false);
    for (const key of ['fileToken', 'connectionId', 'inspectionId', 'table', 'path']) expect(commandSchemas['sqlite.importSource.release'].safeParse({ ...release, [key]: privateValue }).success).toBe(false);
  });

  it.each(['running', 'completed', 'failed', 'cancelled'] as const)('来源%s任务使用固定只读消息，既不保存原文也不借用导入事务措辞', status => {
    const message = persistedTaskMessage('sqlite.importSource.inspect', { taskId: 'task', sqliteImportOperation: 'source', status, progress: 20, message: privateValue }); expect(message).toBe(sqliteImportTaskMessage('sqlite.importSource.inspect', status)); expect(message).toContain('尚未创建表或写入'); for (const marker of ['PRIVATE_SOURCE_TASK', 'source.csv', 'SELECT secret', 'sha256']) expect(message).not.toContain(marker);
    expect(persistedTaskMessage('sqlite.importSource.release', { taskId: 'task', status, progress: 0, message: privateValue })).toBe(message);
  });

  it.each(['running', 'completed', 'failed', 'cancelled'] as const)('来源%s恢复只保基础字段，不恢复样本/哈希/令牌/原错误或嫁接的写ACK', status => {
    const original: TaskRecord & Record<string, unknown> = { id: 'source-task', kind: 'sqlite.importSource.inspect', status, progress: 20, startedAt: '2026-11-01T00:00:00Z', message: privateValue, errors: [privateValue], filePath: privateValue, sample: [{ value: privateValue }], source: { sha256: 'a'.repeat(64), bytes: 200 }, sourceId: 'original-cap', sqliteWrite: { operationId: '11111111-1111-4111-8111-111111111111', target: { connectionId: 'owned', database: 'main', table: '不应借来的目标' }, phase: 'committed', requestedRows: 1, appliedRows: 1, commitMayHaveBeenSent: true, commitAcknowledged: true, rollbackAcknowledged: false } }, restored = recoverSqliteImportTask(original);
    expect(restored).toMatchObject({ id: original.id, kind: original.kind, status: status === 'running' ? 'failed' : status, message: sqliteImportTaskMessage(original.kind, status === 'running' ? 'failed' : status) });
    for (const key of ['errors', 'filePath', 'sample', 'source', 'sourceId', 'sqliteWrite']) expect(restored).not.toHaveProperty(key); expect(JSON.stringify(restored)).not.toContain('PRIVATE_SOURCE_TASK'); expect(recoverSqliteImportTask(restored)).toEqual(restored);
  });
});
