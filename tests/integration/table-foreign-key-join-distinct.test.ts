import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';
import { splitSql } from '../../src/engine/sql';
import { namedParameterTokens } from '../../src/shared/queryParameters';
import { foreignKeyJoinDistinctReadOnlyCases } from '../helpers/foreignKeyJoinDistinctReadOnlyCases';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_JOIN_DISTINCT_READONLY === '1';
describe.runIf(enabled)('JOIN去重只读实库语义（不创建资源）', () => {
  it('十二固定向量在五种严格模式下核完整结果及原线程收尾', async () => {
    const env = process.env, host = env.DBARK_TEST_HOST ?? '', port = Number(env.DBARK_TEST_PORT);
    if (!['192.168.31.200', 'deve-server.yinzon.com'].includes(host) || ![13357, 13380, 13384, 13310, 13311, 13484].includes(port) || !env.DBARK_TEST_USER || !env.DBARK_TEST_EXPECTED_HOSTNAME || !env.DBARK_TEST_EXPECTED_VERSION || !env.DBARK_TEST_EXPECTED_SERVER_ID) throw Error('去重只读专项缺少预核实例身份');
    if (port === 13484 && (env.DBARK_TEST_TLS !== '1' || !env.DBARK_TEST_CA)) throw Error('13484必须严格TLS');
    const profile: NetworkConnectionProfile = { id: randomUUID(), name: 'JOIN去重只读语义', dialect: 'mysql', group: '', color: '#123456', host, port, user: env.DBARK_TEST_USER, password: env.DBARK_TEST_PASSWORD ?? '', ...(port === 13484 ? { tls: { enabled: true, rejectUnauthorized: true, caPath: env.DBARK_TEST_CA } } : {}) };
    let managed: ManagedConnection | undefined, observer: ManagedConnection | undefined;
    try {
      managed = await connect(profile); const own = managed;
      const identity = (await execute<Record<string, unknown>[]>(own, 'SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,VERSION() AS version,@@session.sql_mode AS mode')).rows[0];
      expect(identity.hostname).toBe(env.DBARK_TEST_EXPECTED_HOSTNAME); expect(String(identity.port)).toBe('3306'); expect(identity.version).toBe(env.DBARK_TEST_EXPECTED_VERSION); expect(String(identity.serverId)).toBe(env.DBARK_TEST_EXPECTED_SERVER_ID);
      if (env.DBARK_TEST_EXPECTED_SERVER_UUID) expect((await execute<Record<string, unknown>[]>(own, 'SELECT @@server_uuid AS uuid')).rows[0].uuid).toBe(env.DBARK_TEST_EXPECTED_SERVER_UUID);
      const cases = foreignKeyJoinDistinctReadOnlyCases(); expect(cases).toHaveLength(12);
      const modes = [String(identity.mode), '', 'ANSI_QUOTES', 'NO_BACKSLASH_ESCAPES', 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES'].map(mode => [...new Set([...mode.split(',').filter(Boolean), 'ONLY_FULL_GROUP_BY'])].join(','));
      for (const mode of modes) {
        // 只改独占会话；不读业务表，不关闭优化器，不改全局或建立任何库表。
        await execute(own, 'SET SESSION sql_mode=?', [mode]);
        const actual = new Set(String((await execute<Record<string, unknown>[]>(own, 'SELECT @@session.sql_mode AS mode')).rows[0].mode).split(','));
        expect(actual.has('ONLY_FULL_GROUP_BY')).toBe(true);
        for (const flag of ['ANSI_QUOTES', 'NO_BACKSLASH_ESCAPES']) expect(actual.has(flag)).toBe(mode.split(',').includes(flag));
        for (const test of cases) {
          expect(splitSql(test.sql, actual.has('NO_BACKSLASH_ESCAPES'), actual.has('ANSI_QUOTES'))).toHaveLength(1);
          expect(namedParameterTokens(test.sql, { ansiQuotes: actual.has('ANSI_QUOTES'), noBackslashEscapes: actual.has('NO_BACKSLASH_ESCAPES') })).toEqual([]);
          expect((await execute<Record<string, unknown>[]>(own, test.sql)).rows.map(row => ({ ...row })), test.name).toEqual(test.expected);
          expect((await execute<unknown[]>(own, 'SHOW WARNINGS LIMIT 1')).rows, test.name).toEqual([]);
        }
      }
      observer = await connect(profile); const thread = own.connection.threadId; await own.close(); managed = undefined;
      expect((await execute<unknown[]>(observer, 'SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [thread])).rows).toEqual([]); await observer.close(); observer = undefined;
      console.info(JSON.stringify({ port, selects: 60, cases: 12, modes: 5, warningsChecked: true, originalThreadAbsent: true, schemaWrites: 0, derivedFixture: true }));
    } finally { if (managed) await managed.close(); if (observer) await observer.close(); }
  }, 60000);
});
