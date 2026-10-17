import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { assertDefaultEncodingLiveTarget } from '../helpers/tableDefaultEncodingTarget';

const uuid = '11111111-2222-3333-4444-555555555555';
/** 执行整个生产正式入口及原共享隔离函数，所有网络/桌面/CA端口只提供合成RAM事实。 */
function harness(changes: { facts?: Record<string, unknown>; unknownQuery?: boolean; unknownClose?: boolean; ownerChanged?: boolean; invalidUuid?: boolean; tls?: boolean } = {}) {
  const source = readFileSync(new URL('../e2e/table-create-live.ts', import.meta.url), 'utf8');
  const helper = readFileSync(new URL('../e2e/live-helpers.ts', import.meta.url), 'utf8');
  const isolated = helper.slice(helper.indexOf('export async function isolatedDatabase'), helper.indexOf('/** 选中数据库节点后通过对象树新建查询'));
  const calls: string[] = [], info = {}, resource = { page: { evaluate: vi.fn(async () => []), locator: () => { calls.push('ui-entry'); throw Error('合成UI边界'); } }, application: {}, closed: false };
  const environment = { DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: changes.tls ? '13484' : '13384', DBARK_TEST_USER: '合成账号', DBARK_TEST_EXPECTED_SERVER_UUID: changes.invalidUuid ? '无效UUID' : uuid, DBARK_TEST_TLS: changes.tls ? '1' : '0', DBARK_TEST_CA: changes.tls ? '合成CA路径' : undefined };
  let callback: Function | undefined, retained = false, lost = false, connections = 0;
  const owned = (value: unknown) => { expect(value).toBe(info); if (retained || lost) throw Error('合成归属未知'); return resource; };
  const retain = () => { retained = true; calls.push('retain'); };
  const mysql = { createConnection: async (options: Record<string, unknown>) => {
    const id = ++connections; calls.push(`observer-${id}-connect`); expect(options).not.toHaveProperty('database');
    if (changes.tls) expect(options.ssl).toMatchObject({ rejectUnauthorized: true, verifyIdentity: true, ca: '合成CA内容' });
    return {
      query: async (statement: string | { sql: string }) => {
        const sql = typeof statement === 'string' ? statement : statement.sql;
        if (sql.startsWith('SELECT @@version')) {
          calls.push(`observer-${id}-facts`);
          if (changes.unknownQuery && id === 1) throw Error('合成读取结果未知');
          if (changes.ownerChanged && id === 1) lost = true;
          return [[{ version: '8.4.11', os: 'Linux', names: 0, uuid, ...changes.facts }]];
        }
        calls.push(sql.startsWith('DROP') ? 'drop-database' : 'remaining'); return [[]];
      },
      end: async () => { calls.push(`observer-${id}-end`); if (changes.unknownClose && id === 1) throw Error('合成关闭未知'); },
    };
  } };
  const globals = { exports: {} as Record<string, unknown>, expect, mysql, environment, preservesUnconfirmedExit: () => true, ownedDesktopResources: owned, retainOwnedDesktopResources: retain, tlsCertificate: () => changes.tls ? '合成CA路径' : undefined, readFileSync: () => '合成CA内容', connectAndCreate: async (database: string) => { calls.push('create-database'); return { database, connectionId: '合成连接', connectionName: '合成连接' }; }, pageErrors: [], randomUUID: () => uuid, confirmOwnedDesktopExit: async () => { calls.push('exit'); resource.closed = true; } };
  const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true };
  const sharedContext = createContext(globals);
  runInContext(ts.transpileModule(isolated, { compilerOptions }).outputText, sharedContext);
  const test = Object.assign((_title: string, value: Function) => { callback = value; }, { use: vi.fn(), afterEach: vi.fn() });
  const context = createContext({ exports: {}, require(name: string) {
    if (name === 'mysql2/promise') return { __esModule: true, default: mysql };
    if (name === 'node:fs') return { readFileSync: () => { calls.push('synthetic-ca'); return '合成CA内容'; } };
    if (name === './desktop-fixture') return { test, expect, ownedDesktopResources: owned, retainOwnedDesktopResources: retain };
    if (name === './live-helpers') return { environment, isolatedDatabase: globals.exports.isolatedDatabase };
    if (name === '../helpers/tableDefaultEncodingTarget') return { assertDefaultEncodingLiveTarget };
    if (name.endsWith('/zh-CN')) return { zh: {}, formatText: () => '' };
    if (name.endsWith('/tableCreate.zh-CN')) return { tableCreateZh: {} };
    throw Error('不允许实际导入：' + name);
  } });
  runInContext(ts.transpileModule(source + '\nregisterTableCreateUiTests();', { compilerOptions }).outputText, context);
  return { calls, run: () => callback!({}, info) };
}

describe('新建表正式入口在任何隔离DDL前核Root身份（纯RAM）', () => {
  it.each([{ uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, { version: '8.4.12' }, { version: '8.0.46' }, { os: 'Win64' }, { names: 1 }])('身份事实%s不符时不创建或清理任何隔离库', async facts => {
    const f = harness({ facts }); await expect(f.run()).rejects.toThrow('Root尚未绑定');
    expect(f.calls).toEqual(['observer-1-connect', 'observer-1-facts', 'observer-1-end']);
  });
  it('无规范Root UUID时不建观察连接', async () => {
    const f = harness({ invalidUuid: true }); await expect(f.run()).rejects.toThrow('Root尚未绑定'); expect(f.calls).toEqual([]);
  });
  it.each([{ unknownQuery: true }, { unknownClose: true }, { ownerChanged: true }])('预检读取/关闭/归属未知%s时保留并停止', async changes => {
    const f = harness(changes); await expect(f.run()).rejects.toThrow(); expect(f.calls).toContain('retain');
    expect(f.calls).not.toContain('create-database'); expect(f.calls).not.toContain('drop-database');
  });
  it.each([false, true])('身份通过且预检关闭完成后才进入原隔离helper，严格TLS=%s', async tls => {
    const f = harness({ tls }); await expect(f.run()).rejects.toThrow('合成UI边界');
    expect(f.calls.indexOf('observer-1-facts')).toBeLessThan(f.calls.indexOf('observer-1-end'));
    expect(f.calls.indexOf('observer-1-end')).toBeLessThan(f.calls.indexOf('create-database'));
    expect(f.calls).toContain('ui-entry'); expect(f.calls.indexOf('exit')).toBeLessThan(f.calls.indexOf('drop-database'));
    expect(f.calls).toContain('observer-2-end');
  });
});
