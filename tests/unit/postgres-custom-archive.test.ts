import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { inspectPostgresArchive } from '../../src/engine/postgres/customArchive';
import { postgresArchiveExportSchema } from '../../src/shared/postgresArchive';
import { postgresDatabaseBackupChooseSchema } from '../../src/shared/postgresDatabaseBackup';

const token = '1618e886-931a-4c26-aed4-e321ba43a6bd';

it('归档命令仅接受能力令牌与导出范围，不能从 renderer 传数据库、路径和参数', () => {
  const input = { operationId: token, toolToken: token, sourceToken: token, content: 'schema', portable: true };
  expect(postgresArchiveExportSchema.parse(input)).toEqual(input);
  for (const extra of [{ database: '目标库' }, { path: '/tmp/archive.dump' }, { args: ['--clean'] }, { toolPath: '/tmp/pg_restore' }])
    expect(postgresArchiveExportSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  expect(postgresDatabaseBackupChooseSchema.safeParse({
    connectionId: '来源', database: '数据库', toolToken: token, format: 'custom', portable: true,
  }).success).toBe(false);
});

it('授权读取前核验普通文件及 PGDMP 标记，拒绝纯文本与链接', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tabrelio-pg-archive-test-'));
  const path = join(directory, 'source.dump');
  try {
    await writeFile(path, '-- SQL');
    await expect(inspectPostgresArchive(path, () => {})).rejects.toThrow('归档标记');
    await writeFile(path, 'PGDMP测试');
    expect((await inspectPostgresArchive(path, () => {})).stamp.size).toBe(11n);
    if (process.platform !== 'win32') {
      const linked = join(directory, 'linked.dump');
      await symlink(path, linked);
      await expect(inspectPostgresArchive(linked, () => {})).rejects.toThrow('普通 PostgreSQL 自定义归档');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
