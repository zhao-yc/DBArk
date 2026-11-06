import { randomUUID } from 'node:crypto';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';
import { tableCopyDataMode } from '../../src/shared/tableCopyData';

const enabled = process.env.DBARK_MYSQL_TABLE_COPY_CROSS_TEST === '1';
describe.skipIf(!enabled)('MySQL 同连接跨库整表复制', () => {
  it('核对两个库的独立表身份、完整数据及目标目录竞争', async () => {
    const user = process.env.DBARK_COPY_USER ?? '', password = process.env.DBARK_COPY_PASSWORD ?? '';
    const port = Number(process.env.DBARK_COPY_PORT), database = user + '_src', destination = user + '_dst';
    const version = process.env.DBARK_COPY_VERSION ?? '';
    if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['8.4.11', '8.0.46'].includes(version) || !/^tabrelio_copy_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('只允许本例的隔离回环 MySQL');
    const profile: NetworkConnectionProfile = { id: randomUUID(), name: 'MySQL 跨库测试', group: '', color: '#123456', dialect: 'mysql', host: '127.0.0.1', port, user, password, database, rememberPassword: false };
    const connection = await mysql.createConnection({ host: profile.host, port, user, password });
    const engine = new Engine(), key = { connectionId: profile.id, database, table: 'orders', connectionRevision: 1 };
    const task = () => ({ connectionRevision: 1, taskId: randomUUID() });
    const names = (db: string, name: string) => '`' + db + '`.`' + name + '`';
    const existing = async (name: string) => (await connection.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [destination, name]))[0];
    const getStructure = () => engine.handle('schema.tableCopyStructure.get', { ...key, ...task() });
    const previewStructure = async (name: string, newDatabase = destination) => engine.handle('schema.tableCopyStructure.preview', { snapshotId: (await getStructure()).snapshotId, newName: name, newDatabase, ...task() });
    try {
      const [facts] = await connection.query<RowDataPacket[]>('SELECT @@version AS version, @@lower_case_table_names AS names');
      expect(facts[0].version).toBe(version); expect(facts[0].names).toBe(0);
      await engine.handle('connections.open', { id: profile.id, profile });
      const structure = await previewStructure('orders_empty');
      expect(structure.sql).toBe('CREATE TABLE ' + names(destination, 'orders_empty') + ' LIKE ' + names(database, 'orders') + ';');
      expect(await existing('orders_empty')).toEqual([]);
      const applyStructure = (plan: typeof structure) => engine.handle('schema.tableCopyStructure.apply', { previewToken: plan.previewToken, confirmation: `${destination}.${plan.newName}`, acknowledgements: plan.requiredAcknowledgements, ...task() });
      expect(await applyStructure(structure)).toMatchObject({ definitionVerified: true, newTarget: { database: destination, table: 'orders_empty' }, counter: { state: 'matched', actualValue: '1' } });
      expect((await connection.query<RowDataPacket[]>('SELECT count(*) AS n FROM ' + names(destination, 'orders_empty')))[0][0].n).toBe(0);
      await expect(previewStructure('orders_empty')).rejects.toThrow('占用');
      await expect(previewStructure('never_created', user + '_missing')).rejects.toThrow('目标数据库不存在');
      const raced = await previewStructure('raced');
      await connection.query('CREATE VIEW ' + names(destination, 'raced') + ' AS SELECT 1 AS marker');
      await expect(applyStructure(raced)).rejects.toThrow('占用');
      const changed = await previewStructure('changed');
      await connection.query('ALTER DATABASE `' + destination + '` COLLATE utf8mb4_0900_ai_ci');
      await expect(applyStructure(changed)).rejects.toThrow('目录选项已变化');
      expect(await existing('changed')).toEqual([]);

      const source = await engine.handle('schema.tableCopyData.get', { ...key, mode: tableCopyDataMode, ...task() });
      if (version === '8.0.46') {
        expect(source.writable).toBe(false);
        expect(await existing('orders')).toEqual([]);
        return;
      }
      expect(source.writable, source.reasons.join('\n')).toBe(true);
      const plan = await engine.handle('schema.tableCopyData.preview', { snapshotId: source.snapshotId, newName: 'orders', newDatabase: destination, mode: tableCopyDataMode, ...task() });
      expect(plan.sql).toContain('INSERT INTO ' + names(destination, 'orders'));
      expect(plan.sql).toContain('FROM ' + names(database, 'orders'));
      expect(await existing('orders')).toEqual([]);
      const result = await engine.handle('schema.tableCopyData.apply', { previewToken: plan.previewToken, confirmation: `${destination}.orders`, acknowledgements: plan.requiredAcknowledgements, mode: tableCopyDataMode, ...task() });
      expect(result).toMatchObject({ dataCompleted: true, definitionVerified: true, affectedRows: '3', newTarget: { database: destination, table: 'orders' } });
      const read = async (db: string) => (await connection.query<RowDataPacket[]>(`SELECT CAST(id AS CHAR) AS id, CAST(amount AS CHAR) AS amount, HEX(payload) AS payload, note FROM ${names(db, 'orders')} ORDER BY orders.id`))[0];
      expect(await read(destination)).toEqual(await read(database));
      expect((await read(destination)).map(row => row.id)).toEqual(['0', '9007199254740993', '18446744073709551614']);
    } finally { await engine.closeAll(); await connection.end(); }
  }, 60000);
});
