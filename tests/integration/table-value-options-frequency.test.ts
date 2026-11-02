import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import type { CellValue, NetworkConnectionProfile } from '../../src/shared/contracts';
import { splitSql } from '../../src/engine/sql';
import { decodeTableValueOption } from '../../src/engine/tableValueOptions';
import { tableValueFrequencyReadOnlyCases } from '../helpers/tableValueFrequencyReadOnlyCases';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_VALUE_FREQUENCY_READONLY === '1';
describe.runIf(enabled)('服务器次数排序只读派生语义（不创建资源）', () => {
  it('十五向量在五种严格模式核全集排序、上限与精度，原线程明确释放', async () => {
    const env = process.env, host = env.DBARK_TEST_HOST ?? '', port = Number(env.DBARK_TEST_PORT);
    if (!['192.168.31.200', 'deve-server.yinzon.com'].includes(host) || ![13357, 13380, 13384, 13310, 13311, 13484].includes(port) || !env.DBARK_TEST_USER || !env.DBARK_TEST_EXPECTED_HOSTNAME || !env.DBARK_TEST_EXPECTED_VERSION || !env.DBARK_TEST_EXPECTED_SERVER_ID) throw Error('次数排序只读专项缺少准确测试实例身份');
    if (port === 13484 && (env.DBARK_TEST_TLS !== '1' || !env.DBARK_TEST_CA)) throw Error('13484必须严格TLS');
    const profile: NetworkConnectionProfile = { id: randomUUID(), name: '次数排序只读语义', dialect: 'mysql', group: '', color: '#123456', host, port, user: env.DBARK_TEST_USER, password: env.DBARK_TEST_PASSWORD ?? '', ...(port === 13484 ? { tls: { enabled: true, rejectUnauthorized: true, caPath: env.DBARK_TEST_CA } } : {}) };
    let managed: ManagedConnection | undefined, observer: ManagedConnection | undefined;
    try {
      managed = await connect(profile); const own = managed;
      const identity = (await execute<Record<string, unknown>[]>(own, 'SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,VERSION() AS version,@@session.sql_mode AS mode')).rows[0];
      expect(identity.hostname).toBe(env.DBARK_TEST_EXPECTED_HOSTNAME); expect(String(identity.port)).toBe('3306'); expect(identity.version).toBe(env.DBARK_TEST_EXPECTED_VERSION); expect(String(identity.serverId)).toBe(env.DBARK_TEST_EXPECTED_SERVER_ID);
      if (env.DBARK_TEST_EXPECTED_SERVER_UUID) expect((await execute<Record<string, unknown>[]>(own, 'SELECT @@server_uuid AS uuid')).rows[0].uuid).toBe(env.DBARK_TEST_EXPECTED_SERVER_UUID);
      const cases = tableValueFrequencyReadOnlyCases(); expect(cases).toHaveLength(15);
      const modes = [String(identity.mode), '', 'ANSI_QUOTES', 'NO_BACKSLASH_ESCAPES', 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES'].map(mode => [...new Set([...mode.split(',').filter(Boolean), 'ONLY_FULL_GROUP_BY'])].join(','));
      for (const mode of modes) {
        // 仅配置当前独占会话；源为常量派生表，不读取业务表，不创建库表或用户。
        await execute(own, 'SET SESSION sql_mode=?', [mode]);
        const actual = new Set(String((await execute<Record<string, unknown>[]>(own, 'SELECT @@session.sql_mode AS mode')).rows[0].mode).split(','));
        expect(actual.has('ONLY_FULL_GROUP_BY')).toBe(true); for (const flag of ['ANSI_QUOTES', 'NO_BACKSLASH_ESCAPES']) expect(actual.has(flag)).toBe(mode.split(',').includes(flag));
        await execute(own, 'START TRANSACTION READ ONLY');
        for (const vector of cases) {
          expect(splitSql(vector.sql, mode.includes('NO_BACKSLASH_ESCAPES'), mode.includes('ANSI_QUOTES'))).toHaveLength(1);
          const rows = (await execute<Record<string, CellValue>[]>(own, vector.sql)).rows;
          expect(rows.map(row => decodeTableValueOption(vector.plan, vector.plan.aliases.map(alias => row[alias]))), vector.name).toEqual(vector.expected);
          expect((await execute<unknown[]>(own, 'SHOW WARNINGS LIMIT 1')).rows, vector.name).toEqual([]);
        }
        await execute(own, 'ROLLBACK AND NO CHAIN NO RELEASE');
      }
      observer = await connect(profile); const thread = own.connection.threadId; await own.close(); managed = undefined;
      expect((await execute<unknown[]>(observer, 'SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [thread])).rows).toEqual([]); await observer.close(); observer = undefined;
      console.info(JSON.stringify({ port, selects: 75, cases: 15, modes: 5, warningsChecked: true, originalThreadAbsent: true, schemaWrites: 0, derivedFixture: true }));
    } finally { if (managed) await managed.close(); if (observer) await observer.close(); }
  }, 60000);
});
