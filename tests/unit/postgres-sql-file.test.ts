import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { PostgresConnection } from '../../src/engine/postgres/connection';
import { executePostgresSqlFile, inspectPostgresSqlFile, postgresRestoreDatabaseCommand,
  readPostgresRestoreDatabaseOid } from '../../src/engine/postgres/sqlFile';
import { postgresRestoreDatabaseName, postgresSqlFileExecuteSchema } from '../../src/shared/postgresSqlFile';

async function fixture(sql: string | Buffer, action: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'tabrelio-postgres-file-'));
  try {
    const path = join(directory, '测试.sql');
    await writeFile(path, sql);
    await action(path);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

function connection(onQuery?: (sql: string) => Promise<void>, loResult?: (sql: string) => string | undefined) {
  const calls: string[] = [];
  const copies: { sql: string; data: Buffer[] }[] = [];
  let open = false;
  const fake = {
    standardStrings: true,
    error: (reason: unknown) => reason,
    state: () => ({ transactionKnown: true, transactionOpen: open, transactionFailed: false }),
    async copyIn(sql: string, data: Readable) {
      const copy = { sql, data: [] as Buffer[] };
      copies.push(copy);
      for await (const chunk of data) copy.data.push(chunk);
    },
    async query(sql: string, _params: unknown, _budget: unknown, _progress: unknown, protocol: string) {
      expect(protocol).toBe('extended');
      calls.push(sql);
      if (sql === 'BEGIN') open = true;
      if (sql === 'ROLLBACK' || sql === 'COMMIT') open = false;
      await onQuery?.(sql);
      if (sql.trim() === "SET standard_conforming_strings = off") fake.standardStrings = false;
      const c0 = loResult?.(sql.trim());
      return c0 === undefined ? { postgresCommand: sql } : { postgresCommand: 'SELECT', rows: [{ c0 }] };
    },
  };
  const control = { check() {}, cancelled: () => false, active() {}, protect() {}, async settleCancel() {}, progress() {} };
  return { calls, copies, connection: fake as unknown as PostgresConnection, control };
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
    ["SELECT 1; COPY sample FROM PROGRAM 'example';", 'command'],
    ["SELECT 1; COPY sample FROM '/tmp/input';", 'command'],
    ['SELECT 1; COPY sample TO STDOUT;', 'command'],
    ['SELECT 1; COPY sample FROM STDIN WITH (FORMAT binary);', 'command'],
    ['SELECT 1; BEGIN; SELECT 2; COMMIT;', 'command'],
    ["SELECT 1; COPY sample FROM STDIN WITH (ENCODING 'LATIN1');", 'command'],
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

  it('大对象块复用文件事务，并核对描述符及实际写入长度', async () => {
    const data = "SELECT pg_catalog.lo_open('65001', 131072);\nSELECT pg_catalog.lowrite(0, '\\x0011');\n" +
      'SELECT pg_catalog.lo_close(0);';
    await fixture('SELECT 1; BEGIN;\n' + data + '\nCOMMIT; SELECT 2;', async path => {
      const report = (sql: string) => sql.includes('lowrite(') ? '2' : sql.includes('pg_catalog.lo_') ? '0' : undefined;
      const successful = connection(undefined, report);
      const source = await inspectPostgresSqlFile(path);
      await expect(executePostgresSqlFile(successful.connection, source, successful.control))
        .resolves.toMatchObject({ outcome: 'committed', completed: 5 });
      expect(successful.calls.filter(sql => ['BEGIN', 'COMMIT'].includes(sql.trim()))).toEqual(['BEGIN', 'COMMIT']);
      const shortWrite = connection(undefined, sql => sql.includes('lowrite(') ? '1' : report(sql));
      await expect(executePostgresSqlFile(shortWrite.connection, source, shortWrite.control))
        .resolves.toMatchObject({ outcome: 'rolled-back', completed: 2, failure: { reason: 'transaction', statement: 3 } });
      expect(shortWrite.calls.at(-1)).toBe('ROLLBACK');
    });
  });

  it.each([0, 1, 2, 3])('跨块读取文本和 CSV，保留 Unicode 与 SQL 字样的记录并继续执行尾部', async split => {
    const start = '\\' + 'restrict T2026\r\n-- 原生转储\r\nCOPY public."表""名" ("编号", note) FROM STDIN;\r\n';
    const prefix = 'a'.repeat(128 * 1024 - Buffer.byteLength(start) - split - 2) + '\r\n';
    const marker = '\\.\r\n';
    const csv = 'id,note\r\n1,"甲;\r\nSELECT 2;""引号"""\r\n2,"\\."\r\n';
    await fixture(start + prefix + marker + "COPY public.csv FROM STDIN WITH (FORMAT csv, HEADER, DELIMITER ','); -- CSV\r\n" +
      csv + marker + 'SELECT 1;\r\n\\unrestrict T2026\r\n-- 末尾', async path => {
      const { connection: session, control, calls, copies } = connection();
      const result = await executePostgresSqlFile(session, await inspectPostgresSqlFile(path), control);
      expect(result).toMatchObject({ outcome: 'committed', completed: 3 });
      expect(copies.map(copy => Buffer.concat(copy.data).toString())).toEqual([prefix, csv]);
      expect(calls).toEqual(['BEGIN', 'SELECT 1', 'COMMIT']);
    });
  });

  it.each([
    ['COPY target FROM STDIN;\n123\n', 0, 'syntax'],
    ['COPY target FROM STDIN; SELECT 7;\n\\.\n', 0, 'syntax'],
    ['COPY target FROM STDIN;\n123\r\\.\r456\n\\.\n', 0, 'syntax'],
    ['\\restrict One\nSELECT 1;\n\\unrestrict Two\n', 1, 'command'],
    ['\\restrict One\nSELECT 1;\n', 1, 'command'],
    ['\\restrict One\nSELECT 1;\n\\unrestrict One\nSELECT 7;', 1, 'command'],
    ['\\restrict One\nSELECT 1;\n\\! ls\n\\unrestrict One\n', 1, 'command'],
  ] as const)('拒绝截断的数据或不成对的备份标记并回滚', async (sql, completed, reason) => {
    await fixture(sql, async path => {
      const { connection: session, control, calls } = connection();
      await expect(executePostgresSqlFile(session, await inspectPostgresSqlFile(path), control))
        .resolves.toMatchObject({ outcome: 'rolled-back', completed, failure: { reason } });
      expect(calls.at(-1)).toBe('ROLLBACK');
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

  it('接受可精确引用的新库名称，拒绝可能截断或被替换的字节', () => {
    expect(postgresRestoreDatabaseName.parse('备份 恢复"库')).toBe('备份 恢复"库');
    expect(postgresRestoreDatabaseName.safeParse('库'.repeat(21)).success).toBe(true);
    for (const name of ['库'.repeat(22), ' 前置', '含\n换行', '\uD800'])
      expect(postgresRestoreDatabaseName.safeParse(name).success).toBe(false);
  });

  it('在服务器核对名称及两次库身份时分别保留独立结果预算', async () => {
    const target = '恢复"库';
    const session = { async query(sql: string, values: unknown[], budget: { rows: number }) {
      expect(values).toEqual([target]);
      expect(budget.rows--).toBe(1);
      return { rows: [{ c0: sql.includes('max_identifier_length') ? 't' : '16400' }] };
    } } as unknown as PostgresConnection;
    expect(await postgresRestoreDatabaseCommand(session, target)).toBe('CREATE DATABASE "恢复""库" WITH TEMPLATE template0');
    expect(await readPostgresRestoreDatabaseOid(session, target)).toBe('16400');
    expect(await readPostgresRestoreDatabaseOid(session, target)).toBe('16400');
  });
});
