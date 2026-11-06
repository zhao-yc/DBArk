import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PostgresConnection } from '../../src/engine/postgres/connection';
import { executePostgresSqlFile, inspectPostgresSqlFile } from '../../src/engine/postgres/sqlFile';
import { postgresSqlFileExecuteSchema } from '../../src/shared/postgresSqlFile';

async function fixture(sql: string | Buffer, action: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'tabrelio-postgres-file-'));
  try {
    const path = join(directory, '测试.sql');
    await writeFile(path, sql);
    await action(path);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

function connection(onQuery?: (sql: string) => Promise<void>) {
  const calls: string[] = [];
  let open = false;
  const fake = {
    standardStrings: true,
    state: () => ({ transactionKnown: true, transactionOpen: open, transactionFailed: false }),
    async query(sql: string, _params: unknown, _budget: unknown, _progress: unknown, protocol: string) {
      expect(protocol).toBe('extended');
      calls.push(sql);
      if (sql === 'BEGIN') open = true;
      if (sql === 'ROLLBACK' || sql === 'COMMIT') open = false;
      await onQuery?.(sql);
      if (sql.trim() === "SET standard_conforming_strings = off") fake.standardStrings = false;
      return { postgresCommand: sql };
    },
  };
  const control = { check() {}, cancelled: () => false, active() {}, protect() {}, async settleCancel() {}, progress() {} };
  return { calls, connection: fake as unknown as PostgresConnection, control };
}

describe('PostgreSQL SQL 文件流式执行', () => {
  it('跨块保留 UTF-8、嵌套注释及 dollar-quote，并按真实字符串模式继续', async () => {
    const embedded = '甲;'.repeat(65_560);
    const body = "\nDO $body$ BEGIN RAISE NOTICE '" + embedded + "'; END $body$";
    const oldStyle = "\nSELECT '反斜线\\';仍在字面量'";
    const text = "\ufeff/* 前缀 /* 嵌套 */ */ BEGIN;\nSET standard_conforming_strings = off;" +
      body + ';' + oldStyle + ';\nCOMMIT /* 只识别外壳 */; -- 尾注释';
    await fixture(text, async path => {
      const { connection: session, control, calls } = connection();
      const result = await executePostgresSqlFile(session, await inspectPostgresSqlFile(path), control);
      expect(result).toMatchObject({ outcome: 'committed', completed: 3 });
      expect(calls).toEqual(['BEGIN', "\nSET standard_conforming_strings = off", body, oldStyle, 'COMMIT']);
    });
  });

  it.each([
    ['BEGIN; SELECT 1; COMMIT; SELECT 2;', 'command'],
    ['BEGIN; SELECT 1; -- 丢失结尾', 'command'],
    ['SELECT 1; COMMIT;', 'command'],
    ['SELECT 1; COPY sample FROM STDIN;', 'command'],
    ['SELECT 1; \\i sample.sql', 'command'],
    ['SELECT 1; SELECT $$截断', 'syntax'],
  ] as const)('拒绝无效事务或客户端指令，并确认回滚', async (sql, reason) => {
    await fixture(sql, async path => {
      const { connection: session, control, calls } = connection();
      const result = await executePostgresSqlFile(session, await inspectPostgresSqlFile(path), control);
      expect(result).toMatchObject({ outcome: 'rolled-back', completed: 1, failure: { reason } });
      expect(calls.map(sql => sql.trim())).toEqual(['BEGIN', 'SELECT 1', 'ROLLBACK']);
    });
  });

  it('选中后文件变化时不开始事务，非 UTF-8 输入也不投递用户 SQL', async () => {
    await fixture('SELECT 1;', async path => {
      const { connection: session, control, calls } = connection();
      const source = await inspectPostgresSqlFile(path);
      await writeFile(path, 'SELECT 222222;');
      await expect(executePostgresSqlFile(session, source, control)).resolves.toMatchObject({ outcome: 'not-started', failure: { reason: 'file' } });
      expect(calls).toEqual([]);
      await writeFile(path, Buffer.from([0xff, 0xfe, 0x41]));
      await expect(executePostgresSqlFile(session, await inspectPostgresSqlFile(path), control))
        .resolves.toMatchObject({ outcome: 'rolled-back', completed: 0, failure: { reason: 'encoding' } });
      expect(calls).toEqual(['BEGIN', 'ROLLBACK']);
    });
  });

  it('执行中替换来源时，读完也不能提交旧文件', async () => {
    await fixture('SELECT 1;', async path => {
      const { connection: session, control, calls } = connection(async sql => {
        if (sql === 'SELECT 1') await writeFile(path, 'SELECT 10000;');
      });
      await expect(executePostgresSqlFile(session, await inspectPostgresSqlFile(path), control))
        .resolves.toMatchObject({ outcome: 'rolled-back', completed: 1, failure: { reason: 'file' } });
      expect(calls).toEqual(['BEGIN', 'SELECT 1', 'ROLLBACK']);
    });
  });

  it('提交回包丢失且没有明确的服务端错误时只返回未知', async () => {
    await fixture('SELECT 1;', async path => {
      const { connection: session, control, calls } = connection(async sql => {
        if (sql === 'COMMIT') throw Error('模拟提交回包丢失');
      });
      await expect(executePostgresSqlFile(session, await inspectPostgresSqlFile(path), control))
        .resolves.toMatchObject({ outcome: 'unknown', completed: 1, failure: { reason: 'transaction' } });
      expect(calls).toEqual(['BEGIN', 'SELECT 1', 'COMMIT']);
    });
  });

  it('只接受目标连接、数据库、任务号和一次性文件令牌', () => {
    const input = { connectionId: '已保存', database: '目标库', taskId: '任务', fileToken: 'f0fa0d30-5367-48ca-b920-c2a7fe9f155d' };
    expect(postgresSqlFileExecuteSchema.parse(input)).toEqual(input);
    for (const field of [{ path: '/tmp/file.sql' }, { sql: 'SELECT 1' }, { source: {} }])
      expect(postgresSqlFileExecuteSchema.safeParse({ ...input, ...field }).success).toBe(false);
  });
});
