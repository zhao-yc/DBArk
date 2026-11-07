import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalStore } from '../../src/main/storage';
import { validateCommand } from '../../src/shared/validation';

const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
const protector = { available: () => false, encrypt: () => '', decrypt: (value: string) => value };
const csv = { name: '日报', options: { format: 'csv', encoding: 'gb18030', delimiter: '\t' } };
const insert = { name: '日报', options: { format: 'sql', target: { schema: '报表', table: '数据', columns: ['编号', '附注'] } } };
const sqlite = { dialect: 'sqlite' };
const postgres = { dialect: 'postgresql' };
let folder: string, file: string, store: LocalStore;

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'dbark-query-export-profiles-'));
  file = join(folder, 'local.sqlite');
  store = await LocalStore.open(file, wasm, protector);
});
afterEach(() => { store.close(); rmSync(folder, { recursive: true, force: true }); });

describe('完整查询导出方案', () => {
  it('旧配置直接读空，按数据库类型独立保存，关闭重开可恢复', async () => {
    const before = readFileSync(file);
    expect(store.fullQueryExportProfiles(sqlite)).toEqual([]);
    expect(readFileSync(file)).toEqual(before);
    const sqliteList = store.mutateFullQueryExportProfiles({ ...sqlite, kind: 'add', profile: csv });
    const postgresList = store.mutateFullQueryExportProfiles({ ...postgres, kind: 'add', profile: insert });
    expect(sqliteList).toMatchObject([csv]); expect(postgresList).toMatchObject([insert]);
    store.saveSettings({ ...store.settings(), theme: 'light' });
    store.close();
    store = await LocalStore.open(file, wasm, protector);
    expect(store.fullQueryExportProfiles(sqlite)).toEqual(sqliteList);
    expect(store.fullQueryExportProfiles(postgres)).toEqual(postgresList);
    expect(store.settings().theme).toBe('light');
    expect(store.history()).toEqual([]); expect(store.tasks()).toEqual([]);
  });

  it('允许修改和改名，拒绝重名及过期操作，删除后重建同名仍隔离版本', () => {
    const add = { ...sqlite, kind: 'add', profile: csv };
    const [{ name, revision }] = store.mutateFullQueryExportProfiles(add);
    const first = { name, revision };
    expect(() => store.mutateFullQueryExportProfiles({ ...add, profile: { ...csv, name: ' 日报 ' } })).toThrow('同名');
    const renamed = { name: '月报', options: { format: 'xlsx' } };
    const [updated] = store.mutateFullQueryExportProfiles({ ...sqlite, kind: 'update', selected: first, profile: renamed });
    expect(updated).toMatchObject(renamed);
    expect(updated.revision).not.toBe(first.revision);
    const target = { name: updated.name, revision: updated.revision };
    const remove = { ...sqlite, kind: 'delete', selected: target };
    expect(store.mutateFullQueryExportProfiles(remove)).toEqual([]);
    const recreated = store.mutateFullQueryExportProfiles({ ...add, profile: renamed });
    expect(() => store.mutateFullQueryExportProfiles(remove)).toThrow('已变化');
    expect(store.fullQueryExportProfiles(sqlite)).toEqual(recreated);
  });

  it('IPC 和直接存储均拒绝运行数据、错误方言和格式额外字段', () => {
    const before = readFileSync(file);
    for (const profile of [
      { ...csv, sql: 'SELECT :secret' }, { ...csv, fileToken: '临时授权' },
      { ...csv, parameters: [{ name: 'secret', value: '参数原值' }] },
      { ...csv, options: { format: 'xlsx', delimiter: '\t' } }, insert,
    ]) {
      const request = { ...sqlite, kind: 'add', profile };
      expect(() => validateCommand('queryExportProfiles.mutate', request)).toThrow();
      expect(() => store.mutateFullQueryExportProfiles(request)).toThrow();
    }
    expect(() => validateCommand('queryExportProfiles.list', { ...sqlite, connectionId: '不需要的连接' })).toThrow();
    expect(readFileSync(file)).toEqual(before);
  });

  it('写盘失败时保留原方案和文件，可按原版本重试', () => {
    const [{ name, revision }] = store.mutateFullQueryExportProfiles({ ...sqlite, kind: 'add', profile: csv });
    const before = readFileSync(file);
    const update = { ...sqlite, kind: 'update', selected: { name, revision }, profile: { name, options: { format: 'xlsx' } } };
    mkdirSync(file + '.tmp');
    expect(() => store.mutateFullQueryExportProfiles(update)).toThrow('修改未保存');
    expect(readFileSync(file)).toEqual(before);
    expect(store.fullQueryExportProfiles(sqlite)).toEqual([{ ...csv, revision }]);
    rmdirSync(file + '.tmp');
    expect(store.mutateFullQueryExportProfiles(update)).toMatchObject([update.profile]);
  });
});
