import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectionProfile } from '../../src/shared/contracts';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import { readServerMonitor } from '../../src/engine/serverMonitor';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1';
const profile: ConnectionProfile = { id: randomUUID(), name: '服务器监控隔离验收', group: '', color: '#123456', dialect: 'mysql', host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 13384), user: process.env.DBARK_TEST_USER ?? '', password: process.env.DBARK_TEST_PASSWORD, ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}) };
let monitor: ManagedConnection | undefined, probe: ManagedConnection | undefined, commands = 0;
/** 使用真正驱动命令边界，仅记录并行数量，不记录原始 SQL 或账号凭据。 */
function context(): StructureTaskContext { return { managed: monitor!, checkCancelled() {}, report() {}, commandStarted() { commands++; expect(commands).toBe(1); return () => { commands--; }; } }; }
describe.skipIf(!enabled)('200 隔离实例：服务器监控只读快照', () => {
  beforeAll(async () => {
    if (profile.host !== '192.168.31.200' || ![13357, 13380, 13384, 13310, 13311, 13484].includes(profile.port)) throw new Error('仅允许已核对的 200 隔离实例');
    monitor = await connect(profile); probe = await connect({ ...profile, id: randomUUID() });
  }, 30000);
  afterAll(async () => { await probe?.close({ strict: true }); await monitor?.close({ strict: true }); });
  it('真实服务器读出固定状态与会话，驱动命令完整收尾', async () => {
    const snapshot = await readServerMonitor(context(), { connectionId: profile.id, taskId: randomUUID(), sessionLimit: 100 });
    expect(snapshot.summary.status).toBe('available'); expect(snapshot.globalStatus.status).toBe('available'); expect(snapshot.sessions.status).toBe('available'); expect(commands).toBe(0);
    if (snapshot.globalStatus.status === 'available') expect(snapshot.globalStatus.value.some(item => item.name === 'Uptime' && /^\d+$/.test(item.value))).toBe(true);
    if (snapshot.sessions.status === 'available') { expect(snapshot.sessions.value.rows.length).toBeLessThanOrEqual(100); expect(snapshot.sessions.value.visibility).toBe('account-visible-unconfirmed'); }
    expect(Buffer.byteLength(JSON.stringify(snapshot))).toBe(snapshot.bytes);
  });
  it('真实长 SQL 在服务器端投影，保留长度且不改变旁观会话', async () => {
    const id = (await execute<{ id: string }[]>(probe!, 'SELECT CAST(CONNECTION_ID() AS CHAR) AS id')).rows[0].id;
    const sql = `SELECT SLEEP(3) /*${'监控隔离探针'.repeat(2000)}*/`;
    const pending = execute(probe!, sql);
    try {
      const snapshot = await readServerMonitor(context(), { connectionId: profile.id, taskId: randomUUID(), sessionLimit: 100 });
      expect(snapshot.sessions.status).toBe('available');
      if (snapshot.sessions.status === 'available') {
        const row = snapshot.sessions.value.rows.find(item => item.id === id);
        expect(row !== undefined, '测试探针应位于当前账号可见范围内').toBe(true);
        expect(row?.sqlTruncated).toBe(true); expect(row?.sqlLength).toBe(String([...sql].length)); expect([...(row?.sql ?? '')].length).toBeLessThanOrEqual(512);
      }
    } finally { await pending; }
    expect((await execute<{ id: string }[]>(probe!, 'SELECT CAST(CONNECTION_ID() AS CHAR) AS id')).rows[0].id).toBe(id);
  }, 15000);
});
