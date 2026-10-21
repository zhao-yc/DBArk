import { writeFile } from 'node:fs/promises';
import { basename, isAbsolute, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine';
import * as driver from '../../src/engine/connection';
import { identifier } from '../../src/engine/sql';
import type { ConnectionProfile } from '../../src/shared/contracts';
import type { TableColumnApplyOutput, TableColumnGetOutput, TableColumnPreviewOutput } from '../../src/shared/tableColumnPatches';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_JSON_COLUMNS_INTEGRATION === '1';
describe.skipIf(!enabled)('真实JSON字段新增、类型投影和服务器校验', () => {
  it('普通／二进制表排序规则均完整预览、单次执行及独立读回；失败保留随机库', async () => {
    expect(process.env.DBARK_TEST_HOST).toBe('192.168.31.200'); expect(['13357', '13380', '13384', '13310', '13311', '13484']).toContain(process.env.DBARK_TEST_PORT);
    const port = Number(process.env.DBARK_TEST_PORT), tls = port === 13484;
    const evidenceFile = process.env.DBARK_JSON_EVIDENCE_PATH; expect(evidenceFile && isAbsolute(evidenceFile) && resolve(evidenceFile).startsWith(resolve(process.cwd(), '.cache') + sep) && basename(evidenceFile) === 'evidence.json').toBe(true);
    expect(process.env.DBARK_TEST_TLS).toBe(tls ? '1' : '0'); expect(process.env.DBARK_TEST_USER).toBe('root'); expect(process.env.DBARK_TEST_PASSWORD).toBeTruthy(); expect(process.env.DBARK_JSON_TEST_HOSTNAME).toMatch(/^[a-zA-Z0-9_.-]{1,255}$/);
    if (tls) expect(process.env.DBARK_TEST_CA).toBeTruthy();
    const profile: ConnectionProfile = { id: randomUUID(), name: 'JSON字段隔离验收', group: '', color: '#123456', dialect: 'mysql', host: process.env.DBARK_TEST_HOST!, port, user: process.env.DBARK_TEST_USER!, password: process.env.DBARK_TEST_PASSWORD!, ...(tls ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA! } } : {}) };
    const database = 'dbark_jsoncol_' + randomUUID().replaceAll('-', ''), db = identifier(database), observed: driver.ManagedConnection[] = [], engine = new Engine();
    const actualConnect = driver.connect;
    // 只旁观真实驱动工厂分配，原参数、原函数、真实网络与返回句柄均不替换。
    const observer = vi.spyOn(driver, 'connect').mockImplementation(async (...args) => { const managed = await actualConnect(...args); observed.push(managed); return managed; });
    let admin: driver.ManagedConnection | undefined, verify: driver.ManagedConnection | undefined, created = false, completed = false;
    /** 仅操作本例随机库；SQL和JSON常量不包含凭据或业务数据。 */
    const sql = async (statement: string) => (await driver.execute(admin!, statement)).rows as Record<string, unknown>[];
    try {
      admin = await driver.connect(profile); const identity = await sql('SELECT @@hostname AS hostname'); expect(identity[0].hostname).toBe(process.env.DBARK_JSON_TEST_HOSTNAME);
      const status = await engine.handle('connections.open', { id: profile.id, profile }); const expected = port === 13357 ? ['mysql', '5.7'] : port === 13380 ? ['mysql', '8.0'] : port === 13310 ? ['mariadb', '10.11'] : port === 13311 ? ['mariadb', '11.4'] : ['mysql', '8.4']; expect(status.dialect).toBe(expected[0]); expect(status.version.replace(/^5\.5\.5-/, '').startsWith(expected[1] + '.')).toBe(true);
      await sql('CREATE DATABASE ' + db + ' CHARACTER SET utf8mb4'); created = true;
      for (const collation of ['utf8mb4_general_ci', 'utf8mb4_bin']) {
        const table = collation === 'utf8mb4_bin' ? 'json_bin' : 'json_general', qualified = db + '.' + identifier(table), target = { connectionId: profile.id, database, table };
        await sql('CREATE TABLE ' + qualified + ' (id INT NOT NULL PRIMARY KEY,note VARCHAR(30)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=' + collation);
        await sql("INSERT INTO " + qualified + " VALUES(1,'原行一'),(2,'原行二')"); const original = await sql('SELECT * FROM ' + qualified + ' ORDER BY id');
        const snapshot: TableColumnGetOutput = await engine.handle('schema.columns.get', { ...target, taskId: randomUUID(), connectionRevision: 1 });
        const patch = { kind: 'add' as const, clientKey: randomUUID(), name: 'doc', type: { kind: 'json' as const }, nullable: true, default: { kind: 'none' as const }, comment: 'JSON字段', position: { kind: 'last' as const } };
        const before = await sql('SHOW CREATE TABLE ' + qualified);
        await expect(engine.handle('schema.columns.preview', { snapshotId: snapshot.snapshotId, patches: [{ ...patch, default: { kind: 'literal', valueType: 'text', value: '{}' } }], taskId: randomUUID(), connectionRevision: 1 })).rejects.toThrow('JSON');
        expect(await sql('SHOW CREATE TABLE ' + qualified)).toEqual(before);
        const preview: TableColumnPreviewOutput = await engine.handle('schema.columns.preview', { snapshotId: snapshot.snapshotId, patches: [patch], taskId: randomUUID(), connectionRevision: 1 }); expect(preview.sql).toContain('`doc` JSON NULL'); expect(await sql('SHOW CREATE TABLE ' + qualified)).toEqual(before);
        const result: TableColumnApplyOutput = await engine.handle('schema.columns.apply', { previewToken: preview.previewToken, acknowledgements: preview.requiredAcknowledgements, taskId: randomUUID(), connectionRevision: 1 }); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true }); expect(result.after?.columns.find(column => column.name === 'doc')?.editableType).toEqual({ kind: 'json' });
        expect(await sql('SELECT id,note FROM ' + qualified + ' ORDER BY id')).toEqual(original); expect((await sql('SELECT doc FROM ' + qualified)).every(row => row.doc === null)).toBe(true);
        const reread: TableColumnGetOutput = await engine.handle('schema.columns.get', { ...target, taskId: randomUUID(), connectionRevision: 1 }); expect(reread.columns.find(column => column.name === 'doc')?.editableType).toEqual({ kind: 'json' });
        await sql("INSERT INTO " + qualified + " VALUES(3,'有效JSON','{\"wide\":18446744073709551615,\"exact\":\"0.12345678901234567890\",\"null\":null}')");
        const values = await sql("SELECT CAST(JSON_EXTRACT(doc,'$.wide') AS CHAR) AS wide,JSON_UNQUOTE(JSON_EXTRACT(doc,'$.exact')) AS exact FROM " + qualified + ' WHERE id=3'); expect(values).toEqual([{ wide: '18446744073709551615', exact: '0.12345678901234567890' }]);
        await expect(sql("INSERT INTO " + qualified + " VALUES(4,'非法JSON','not-json')")).rejects.toThrow(); expect(String((await sql('SELECT COUNT(*) AS n FROM ' + qualified + ' WHERE id=4'))[0].n)).toBe('0');
      }
      await engine.closeAll(); expect(observed.length).toBeGreaterThanOrEqual(12); expect(observed.filter(value => value !== admin).every(value => value.resources?.snapshot().confirmedClosed === true)).toBe(true); expect((await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=' + "'" + database + "'"))).toEqual([]);
      expect(/^dbark_jsoncol_[a-f0-9]{32}$/.test(database)).toBe(true); await sql('DROP DATABASE ' + db); await admin.close({ strict: true });
      verify = await driver.connect(profile); const absent = (await driver.execute(verify, "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='" + database + "'")).rows; expect(absent).toEqual([]);
      const ids = observed.filter(value => value !== verify).map(value => value.connection.threadId); expect(ids.every(id => Number.isSafeInteger(id))).toBe(true);
      const remaining = (await driver.execute(verify, 'SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (' + ids.join(',') + ')')).rows; expect(remaining).toEqual([]); await verify.close({ strict: true });
      expect(observed.length).toBeGreaterThanOrEqual(13); expect(observed.every(value => value.resources?.snapshot().confirmedClosed === true)).toBe(true); completed = true;
      // 仅白名单运行事实落入忽略目录，绝不序列化含认证的profile或ManagedConnection。
      await writeFile(evidenceFile!, JSON.stringify({ 端口: port, 版本: status.version, 方言: status.dialect, 严格TLS: tls, 隔离库: database, 表数: 2, JSON后核验: true, 原行保持: true, 无效JSON拒绝: true, 独立核库缺席: true, 原线程缺席: true, 真实资源全部关闭: true, 连接数: observed.length, 资源: observed.map(value => ({ 原线程: value.connection.threadId, 状态: value.resources!.snapshot() })) }, null, 2), { flag: 'wx' });
    } finally {
      if (!completed) { console.info(JSON.stringify({ 端口: port, 保留库: created ? database : null, 自动删库: false })); await engine.closeAll().catch(() => undefined); await admin?.close({ strict: true }).catch(() => undefined); await verify?.close({ strict: true }).catch(() => undefined); }
      observer.mockRestore();
    }
  });
});
