import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import { loadDatabaseEncodingModules, bindDatabaseEncodingTarget, databaseEncodingLifetime, watchDatabaseEncodingConnection, assertDatabaseEncodingReleased, closeDatabaseEncodingObserver, type DatabaseEncodingConnectionFact, type DatabaseEncodingLifetime } from '../helpers/databaseDefaultEncodingIntegration';

const port = vi.hoisted(() => ({ connect: vi.fn(), check: undefined as undefined | (() => void), watch: undefined as undefined | ((managed: ManagedConnection, scope: string) => void), scope: '' }));
/** 与实库夹具相同的异步importOriginal旁观入口；底层仅此RAM端口替代网络。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => {
    if (!port.check || !port.watch || !port.scope) throw Error('RAM旁观owner缺失');
    port.check(); const scope = port.scope, managed = await port.connect(...args) as ManagedConnection; port.watch(managed, scope); return managed;
  } };
});

it('实库同一顺序loader的observer、真实Engine.open/get共享connect旁观端口，原回调和close原样透传', async () => {
  const env = { DBARK_INTEGRATION_ENABLED: '1', DBARK_DATABASE_DEFAULT_ENCODING_TEST: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'ram-only', DBARK_TEST_PASSWORD: 'ram-only', DBARK_TEST_EXPECTED_SERVER_HOSTNAME: 'ram', DBARK_TEST_EXPECTED_SERVER_ID: '7', DBARK_TEST_EXPECTED_SERVER_PORT: '3306', DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001' };
  const binding = bindDatabaseEncodingTarget(() => env, 'observer-ram');
  const context = { task: { id: 'observer-ram', timeout: 120000, retry: 0, repeats: 0, concurrent: false, result: { startTime: Date.now(), state: 'run', retryCount: 0, repeatCount: 0 } } };
  const owner: DatabaseEncodingLifetime = databaseEncodingLifetime(context, binding, () => undefined), facts: DatabaseEncodingConnectionFact[] = [];
  port.check = owner.check; port.watch = (managed, scope) => { facts.push(watchDatabaseEncodingConnection(managed, scope, owner, () => undefined)); };
  let nextId = 0; const originalCloses: { id: number; strict: boolean }[] = [], originalQueries: { id: number; sql: string }[] = [];
  const originalRows = [{ value: '原返回对象' }], originalFields = [{ name: '原字段对象' }];
  port.connect.mockImplementation(async () => {
    const connection = new EventEmitter(), stream = Object.assign(new EventEmitter(), { closed: false }), id = ++nextId;
    const query = (sql: string, ...args: unknown[]) => {
      const callback = args.at(-1) as (this: unknown, error: Error | null, rows: unknown, fields: unknown) => void; originalQueries.push({ id, sql });
      queueMicrotask(() => {
        let rows: unknown;
        if (sql.startsWith('SELECT @@hostname')) rows = [{ hostname: 'ram', port: 3306, serverId: 7, currentUser: 'ram@host', sqlMode: '', lowerNames: 0 }];
        else if (sql.startsWith('SELECT @@server_uuid')) rows = [{ uuid: env.DBARK_TEST_EXPECTED_SERVER_UUID }];
        else if (sql.startsWith('SELECT SCHEMA_NAME')) rows = [{ name: 'dbark_ram', charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
        else if (sql.startsWith('SHOW CREATE DATABASE')) rows = [{ Database: 'dbark_ram', 'Create Database': 'CREATE DATABASE `dbark_ram` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin */' }];
        else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME')) rows = [{ charset: 'utf8mb4', collation: 'utf8mb4_bin', compiled: 'Yes' }, { charset: 'latin1', collation: 'latin1_swedish_ci', compiled: 'Yes' }];
        else if (sql === 'SELECT ram_callback') rows = originalRows;
        else { callback.call(connection, Error('RAM端口未声明SQL'), undefined, undefined); return; }
        callback.call(connection, null, rows, originalFields);
      });
      return { originalQuery: id };
    };
    Object.assign(connection, { threadId: id, stream, query, execute: query, end() {}, destroy() {} });
    Object.assign(stream, { end() {}, destroy() {} });
    return { connection, profile: binding.profile, broken: false, status: { dialect: 'mysql', version: '8.4.11', connectionId: id }, close: async (options?: { strict?: boolean }) => { originalCloses.push({ id, strict: options?.strict === true }); stream.closed = true; stream.emit('close'); } } as unknown as ManagedConnection;
  });
  let observer: ManagedConnection | undefined, engine: import('../../src/engine/index').Engine | undefined;
  try {
    const modules = await owner.step(loadDatabaseEncodingModules);
    port.scope = 'observer'; observer = await owner.step(() => modules.connection.connect(binding.profile));
    const callback = await owner.step(() => new Promise<{ self: unknown; rows: unknown; fields: unknown; returned: unknown }>(resolve => {
      let returned: unknown; returned = observer!.connection.query('SELECT ram_callback', function (this: unknown, error, rows, fields) { expect(error).toBeNull(); resolve({ self: this, rows, fields, returned }); });
    }));
    expect(callback.self).toBe(observer.connection); expect(callback.rows).toBe(originalRows); expect(callback.fields).toBe(originalFields); expect(callback.returned).toEqual({ originalQuery: 1 });
    port.scope = 'open'; engine = new modules.engine.Engine(); await owner.step(() => engine!.handle('connections.open', { id: binding.profile.id, profile: binding.profile }));
    port.scope = 'get'; const value = await owner.step(() => engine!.handle('schema.databaseDefaultEncoding.get', { connectionId: binding.profile.id, database: 'dbark_ram', taskId: 'actual-get', connectionRevision: 1 }));
    expect(value).toMatchObject({ writable: true, current: { charset: 'utf8mb4', collation: 'utf8mb4_bin' } }); expect(port.connect).toHaveBeenCalledTimes(3);
    const actualGet = facts.filter(fact => fact.scope === 'get'); expect(actualGet).toHaveLength(1); expect(actualGet[0].id).toBe(3);
    expect(originalQueries.filter(query => query.id === 3).map(query => query.sql)).toContain('SHOW CREATE DATABASE `dbark_ram`');
    await owner.step(() => actualGet[0].closed); assertDatabaseEncodingReleased(actualGet, true);
    expect(originalCloses).toEqual([{ id: 2, strict: false }, { id: 3, strict: true }]);
    await owner.step(() => engine!.closeAll()); await owner.step(() => closeDatabaseEncodingObserver(observer!)); assertDatabaseEncodingReleased(facts, false);
    expect(originalCloses).toEqual([{ id: 2, strict: false }, { id: 3, strict: true }, { id: 1, strict: true }]); owner.finish();
  } finally { owner.end(); port.check = port.watch = undefined; port.scope = ''; }
});
