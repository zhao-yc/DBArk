import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { inspectPostgresDumpTool } from '../../src/engine/postgres/databaseBackup';
import { postgresDatabaseBackupExecuteSchema, postgresDatabaseBackupToolSchema } from '../../src/shared/postgresDatabaseBackup';

it('备份 IPC 只接受来源和能力令牌，拒绝命令行、工具路径和凭据注入', () => {
  const fileToken = 'e2e2662b-9a3b-4606-a3e5-e18f53310020', toolToken = '7674d54f-8ab7-4718-a3d1-df39314bdfbb';
  const request = { connectionId: '已保存连接', database: '来源数据库', portable: false, fileToken, toolToken, taskId: '原任务' };
  expect(postgresDatabaseBackupExecuteSchema.parse(request)).toEqual(request);
  expect(postgresDatabaseBackupToolSchema.safeParse({ path: '/tmp/pg_dump' }).success).toBe(false);
  for (const extra of [{ filePath: '/tmp/output.sql' }, { tool: { path: '/tmp/pg_dump' } }, { args: ['--file=output'] }, { password: '凭据' }])
    expect(postgresDatabaseBackupExecuteSchema.safeParse({ ...request, ...extra }).success).toBe(false);
});

it('只选择对应系统的 pg_dump 普通文件，并观察工具文件修改代次', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tabrelio-pg-tool-test-'));
  try {
    const tool = join(directory, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump');
    await writeFile(tool, '版本甲', { mode: 0o700 });
    const original = await inspectPostgresDumpTool(tool);
    await writeFile(tool, '版本乙文件已变');
    expect((await inspectPostgresDumpTool(tool)).version).not.toBe(original.version);
    const other = join(directory, 'other.exe');
    await writeFile(other, '其它文件', { mode: 0o700 });
    await expect(inspectPostgresDumpTool(other)).rejects.toThrow('pg_dump');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
