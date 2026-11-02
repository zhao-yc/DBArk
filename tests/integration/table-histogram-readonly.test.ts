import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import type { CellValue, NetworkConnectionProfile } from '../../src/shared/contracts';
import { splitSql } from '../../src/engine/sql';
import { planTableStatistics, decodeTableStatistics } from '../../src/engine/tableStatistics';
import { planTableHistogramBounds, planTableHistogramCounts, decodeTableHistogramBounds, decodeTableHistogramCounts } from '../../src/engine/tableHistogram';
import { tableHistogramReadOnlyCases } from '../helpers/tableHistogramReadOnlyCases';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_HISTOGRAM_READONLY === '1';
describe.runIf(enabled)('全表分布只读派生语义（不创建资源）', () => {
  it('三十三向量在五种严格模式核精确/近似边界、NULL、筛选及原线程释放', async () => {
    const env = process.env, host = env.DBARK_TEST_HOST ?? '', port = Number(env.DBARK_TEST_PORT);
    if (!['192.168.31.200', 'deve-server.yinzon.com'].includes(host) || ![13357, 13380, 13384, 13310, 13311, 13484].includes(port) || !env.DBARK_TEST_USER || !env.DBARK_TEST_EXPECTED_HOSTNAME || !env.DBARK_TEST_EXPECTED_VERSION || !env.DBARK_TEST_EXPECTED_SERVER_ID) throw Error('分布只读专项缺少准确测试实例身份');
    if (port === 13484 && (env.DBARK_TEST_TLS !== '1' || !env.DBARK_TEST_CA)) throw Error('13484必须严格TLS');
    const profile: NetworkConnectionProfile = { id: randomUUID(), name: '数值分布只读语义', dialect: 'mysql', group: '', color: '#123456', host, port, user: env.DBARK_TEST_USER, password: env.DBARK_TEST_PASSWORD ?? '', ...(port === 13484 ? { tls: { enabled: true, rejectUnauthorized: true, caPath: env.DBARK_TEST_CA } } : {}) };
    let managed: ManagedConnection | undefined, observer: ManagedConnection | undefined, selects = 0;
    try {
      managed = await connect(profile); const own = managed;
      const identity = (await execute<Record<string, unknown>[]>(own, 'SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,VERSION() AS version,@@session.sql_mode AS mode')).rows[0];
      expect(identity.hostname).toBe(env.DBARK_TEST_EXPECTED_HOSTNAME); expect(String(identity.port)).toBe('3306'); expect(identity.version).toBe(env.DBARK_TEST_EXPECTED_VERSION); expect(String(identity.serverId)).toBe(env.DBARK_TEST_EXPECTED_SERVER_ID);
      if (env.DBARK_TEST_EXPECTED_SERVER_UUID) expect((await execute<Record<string, unknown>[]>(own, 'SELECT @@server_uuid AS uuid')).rows[0].uuid).toBe(env.DBARK_TEST_EXPECTED_SERVER_UUID);
      const cases = tableHistogramReadOnlyCases(); expect(cases).toHaveLength(33);
      const modes = [String(identity.mode), '', 'ANSI_QUOTES', 'NO_BACKSLASH_ESCAPES', 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES'].map(mode => [...new Set([...mode.split(',').filter(Boolean), 'ONLY_FULL_GROUP_BY'])].join(','));
      await execute(own, 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      for (const mode of modes) {
        await execute(own, 'SET SESSION sql_mode=?', [mode]); const actual = String((await execute<Record<string, unknown>[]>(own, 'SELECT @@session.sql_mode AS mode')).rows[0].mode).split(','); expect(actual).toContain('ONLY_FULL_GROUP_BY');
        await execute(own, 'START TRANSACTION READ ONLY');
        for (const vector of cases) {
          /** 与产品相同使用binary结果；FLOAT转CHAR或text协议都可能遗漏原有效位。 */
          const read = async (plan: { sql: string; aliases: string[] }): Promise<CellValue[]> => {
            const sql = vector.derived(plan.sql); expect(splitSql(sql, mode.includes('NO_BACKSLASH_ESCAPES'), mode.includes('ANSI_QUOTES'))).toHaveLength(1); selects++;
            const rows = await new Promise<Record<string, CellValue>[]>((yes, no) => { own.connection.execute(sql, [], (error, rows) => error ? no(error) : yes(rows as Record<string, CellValue>[])); });
            expect(rows, vector.name).toHaveLength(1); expect(Object.keys(rows[0])).toEqual(plan.aliases); expect((await execute<unknown[]>(own, 'SHOW WARNINGS LIMIT 1')).rows, vector.name).toEqual([]); return plan.aliases.map(alias => rows[0][alias]);
          };
          const stats = planTableStatistics(vector.source, vector.input), rowCount = decodeTableStatistics(stats, await read(stats)).rowCount;
          expect(rowCount, vector.name).toBe((BigInt(vector.nonNull) + BigInt(vector.nulls)).toString());
          let histogram = decodeTableHistogramBounds(vector.source, vector.input.histogram!, await read(planTableHistogramBounds(vector.source, vector.input)), rowCount);
          if (histogram.nonNull !== '0') histogram = decodeTableHistogramCounts(histogram, await read(planTableHistogramCounts(vector.source, vector.input, histogram)), rowCount);
          expect(histogram.ranges.map(range => range.count), vector.name).toEqual(vector.expected); expect(histogram.nonNull).toBe(vector.nonNull); expect(histogram.nulls).toBe(vector.nulls);
          if (vector.min !== undefined) expect(histogram.min, vector.name).toBe(vector.min); if (vector.max !== undefined) expect(histogram.max, vector.name).toBe(vector.max);
        }
        await execute(own, 'ROLLBACK AND NO CHAIN NO RELEASE');
      }
      observer = await connect(profile); const observed = (await execute<Record<string, unknown>[]>(observer, 'SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,VERSION() AS version')).rows[0]; expect(observed).toMatchObject({ hostname: identity.hostname, port: identity.port, serverId: identity.serverId, version: identity.version });
      if (env.DBARK_TEST_EXPECTED_SERVER_UUID) expect((await execute<Record<string, unknown>[]>(observer, 'SELECT @@server_uuid AS uuid')).rows[0].uuid).toBe(env.DBARK_TEST_EXPECTED_SERVER_UUID);
      const thread = own.connection.threadId; await own.close(); managed = undefined; expect((await execute<unknown[]>(observer, 'SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [thread])).rows).toEqual([]); await observer.close(); observer = undefined;
      console.info(JSON.stringify({ port, selects, cases: 33, modes: 5, warningsChecked: true, originalThreadAbsent: true, schemaWrites: 0, derivedFixture: true, physicalMetadataVerified: false }));
    } finally { if (managed) await managed.close(); if (observer) await observer.close(); }
  });
});
