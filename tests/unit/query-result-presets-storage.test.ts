import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import initSqlJs, { type Database } from 'sql.js';
import { LocalStore } from '../../src/main/storage';
import { exportConnectionProfile, copyConnectionProfile } from '../../src/shared/connectionTransfer';
import { queryResultPresetDocumentSchema, queryResultPresetLimits, queryResultPresetSaveSchema, validateQueryResultPresetBudget, type QueryResultPresetStoredSnapshot, type QueryResultPresetValue } from '../../src/shared/queryResultPresets';

const require = createRequire(import.meta.url), wasm = require.resolve('sql.js/dist/sql-wasm.wasm'), directories: string[] = [];
// 假保护器只保留会话秘密；本组不读取系统safeStorage，也不写真实凭据。
const protector = { available: () => false, encrypt: (_value: string): string => { throw Error('不应加密'); }, decrypt: (_value: string): string => { throw Error('不应解密'); } };
const target = { connectionId: 'query-local-a' };
const profile = { id: target.connectionId, name: '离线连接', host: 'offline.invalid', port: 3306, user: '离线用户', dialect: 'mysql' as const, color: '#ffffff', group: '离线', rememberPassword: false };
const columns = [{ key: '__proto__', name: '重复别名', type: 'BIGINT' }, { key: 'payload', name: '重复别名', type: 'TEXT' }, { key: 'hidden', name: '隐藏列', type: 'DECIMAL' }];
const value: QueryResultPresetValue = {
  columns, visible: [columns[1], columns[0]],
  configuration: {
    expression: { mode: 'AND', children: [
      { mode: 'OR', children: [{ column: '__proto__', operator: 'in', value: '', values: ['9007199254740993', '18446744073709551615'], enabled: false }, { column: 'payload', operator: 'null', value: '' }] },
      { column: 'payload', operator: 'contains', value: '  NULL  ', ignoreCase: false }
    ] },
    sort: [{ column: 'payload', direction: 'DESC', nulls: 'LAST', ignoreCase: true }, { column: '__proto__', direction: 'ASC', nulls: 'FIRST', ignoreCase: false }]
  }
};

/** 每个命令携带实际读取的连接来源与文档修订；令牌由本测试模拟Main签发。 */
function packet(snapshot: QueryResultPresetStoredSnapshot, connectionId = target.connectionId) {
  return { connectionId, source: snapshot.source, expectedRevision: snapshot.revision, bindingToken: randomUUID() };
}

/** 使用真实SQLite临时文件，不连接数据库服务、Electron窗口或系统凭据。 */
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-query-result-presets-')); directories.push(directory);
  const file = join(directory, 'local.sqlite'), store = await LocalStore.open(file, wasm, protector);
  store.saveConnection(profile);
  return { file, store };
}

/** 离线改写合成SQLite夹具，覆盖旧库和损坏文件；调用前必须关闭LocalStore。 */
async function rewrite(file: string, action: (db: Database) => void) {
  const SQL = await initSqlJs({ locateFile: () => wasm }), db = new SQL.Database(readFileSync(file));
  try { action(db); writeFileSync(file, db.export()); } finally { db.close(); }
}

/** 构造有效文档，允许预算测试直接准备大量方案而无需重复写盘。 */
function document(count = 0) {
  return { version: 1, revision: 7, entries: Array.from({ length: count }, (_, index) => ({ id: randomUUID(), name: '方案' + index, connectionDigest: 'a'.repeat(64), value })) };
}

afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('查询结果命名方案真实SQLite与CAS', () => {
  it('完整元数据、显隐顺序、停用嵌套筛选和全部排序选项重启后准确读回', async () => {
    const { file, store } = await fixture(), saved = store.saveQueryResultPreset({ ...packet(store.queryResultPresets(target)), name: '  精确整理  ', value });
    const id = saved.entries[0].id;
    expect(saved.entries[0].name).toBe('精确整理');
    expect(store.selectedQueryResultPreset({ ...packet(saved), id })).toEqual(value);
    store.close();
    const reopened = await LocalStore.open(file, wasm, protector), read = reopened.queryResultPresets(target);
    expect(read.entries).toEqual(saved.entries); expect(read.revision).toBe(1);
    expect(reopened.selectedQueryResultPreset({ ...packet(read), id })).toEqual(value);
    reopened.close();
  });

  it('每连接独立且所有响应都是独立副本，未知连接或附加目标字段拒绝', async () => {
    const { store } = await fixture(); store.saveConnection({ ...profile, id: 'query-local-b' });
    const saved = store.saveQueryResultPreset({ ...packet(store.queryResultPresets(target)), name: '方案', value });
    const selected = store.selectedQueryResultPreset({ ...packet(saved), id: saved.entries[0].id });
    selected.columns[0].name = '调用方改动';
    saved.entries[0].name = '外部改名'; saved.entries.splice(0);
    expect(store.queryResultPresets(target).entries[0].name).toBe('方案');
    expect(store.queryResultPresets(target).entries[0].value).toEqual(value);
    expect(store.queryResultPresets({ connectionId: 'query-local-b' }).entries).toEqual([]);
    expect(() => store.queryResultPresets({ connectionId: '不存在' })).toThrow('连接');
    expect(() => store.queryResultPresets({ ...target, sql: 'SELECT 1' })).toThrow(); store.close();
  });

  it('创建不暗中覆盖，覆盖可改名，重命名和覆盖均不能占用其它项名称', async () => {
    const { store } = await fixture(); let current = store.saveQueryResultPreset({ ...packet(store.queryResultPresets(target)), name: '甲', value });
    const first = current.entries[0].id;
    current = store.saveQueryResultPreset({ ...packet(current), name: '乙', value });
    const second = current.entries[1].id;
    for (const name of ['甲', '  甲  ']) expect(() => store.saveQueryResultPreset({ ...packet(current), name, value })).toThrow('同名');
    expect(() => store.saveQueryResultPreset({ ...packet(current), name: '乙', replaceId: first, value })).toThrow('同名');
    expect(() => store.renameQueryResultPreset({ ...packet(current), id: first, name: '乙' })).toThrow('同名');
    expect(() => store.saveQueryResultPreset({ ...packet(current), name: '丙', replaceId: randomUUID(), value })).toThrow('删除');
    const changed = { ...value, visible: [columns[0], columns[1]] };
    current = store.saveQueryResultPreset({ ...packet(current), name: '丙', replaceId: first, value: changed });
    expect(current.entries.map(entry => [entry.id, entry.name])).toEqual([[first, '丙'], [second, '乙']]);
    expect(store.selectedQueryResultPreset({ ...packet(current), id: first })).toEqual(changed);
    const before = current.entries[0]; current = store.renameQueryResultPreset({ ...packet(current), id: first, name: '丁' });
    expect(current.entries[0]).toEqual({ ...before, name: '丁' }); store.close();
  });

  it('所有旧修订操作拒绝；删除最后一项保留墓碑且重启后不发生ABA', async () => {
    const { file, store } = await fixture(), empty = store.queryResultPresets(target);
    let current = store.saveQueryResultPreset({ ...packet(empty), name: '方案', value }); const id = current.entries[0].id, stale = packet(current);
    current = store.renameQueryResultPreset({ ...stale, id, name: '改名' });
    for (const action of [() => store.selectedQueryResultPreset({ ...stale, id }), () => store.renameQueryResultPreset({ ...stale, id, name: '旧改名' }), () => store.deleteQueryResultPreset({ ...stale, id }), () => store.saveQueryResultPreset({ ...stale, name: '旧覆盖', replaceId: id, value })]) expect(action).toThrow('变化');
    current = store.deleteQueryResultPreset({ ...packet(current), id });
    expect(current.entries).toEqual([]); expect(current.revision).toBe(3);
    expect(() => store.saveQueryResultPreset({ ...packet(empty), name: '旧创建', value })).toThrow('变化'); store.close();
    const reopened = await LocalStore.open(file, wasm, protector), tombstone = reopened.queryResultPresets(target);
    expect(tombstone.revision).toBe(3); expect(tombstone.entries).toEqual([]);
    expect(() => reopened.saveQueryResultPreset({ ...packet(tombstone), source: tombstone.source, expectedRevision: 0, name: '旧创建', value })).toThrow('变化');
    expect(reopened.saveQueryResultPreset({ ...packet(tombstone), name: '新创建', value }).revision).toBe(4); reopened.close();
  });

  it('真实连接修订及摘要分别核对，列表可见旧项，改名不重签而明确覆盖恢复', async () => {
    const { store } = await fixture(), saved = store.saveQueryResultPreset({ ...packet(store.queryResultPresets(target)), name: '方案', value }), id = saved.entries[0].id;
    store.saveConnection({ ...profile, id: '其它连接' });
    expect(() => store.selectedQueryResultPreset({ ...packet(saved), id })).toThrow('变化');
    const refreshed = store.queryResultPresets(target);
    expect(store.selectedQueryResultPreset({ ...packet(refreshed), id })).toEqual(value);
    store.saveConnection({ ...profile, host: 'changed.invalid' });
    let current = store.queryResultPresets(target);
    expect(current.entries).toEqual(saved.entries); expect(current.source.connectionDigest).not.toBe(saved.source.connectionDigest);
    const spoofed = { ...packet(current), source: { ...current.source, connectionDigest: saved.source.connectionDigest } };
    expect(() => store.saveQueryResultPreset({ ...spoofed, name: '伪造', value })).toThrow('变化');
    expect(() => store.selectedQueryResultPreset({ ...packet(current), id })).toThrow('来源');
    current = store.renameQueryResultPreset({ ...packet(current), id, name: '失效项改名' });
    expect(current.entries[0].connectionDigest).toBe(saved.entries[0].connectionDigest);
    expect(current.entries[0].value).toEqual(value);
    expect(() => store.selectedQueryResultPreset({ ...packet(current), id })).toThrow('来源');
    current = store.saveQueryResultPreset({ ...packet(current), replaceId: id, name: '重新保存', value });
    expect(current.entries[0].connectionDigest).toBe(current.source.connectionDigest);
    expect(store.selectedQueryResultPreset({ ...packet(current), id })).toEqual(value); store.close();
  });

  it('真实写盘失败恢复内存、原文件及修订，后续操作不夹带失败改动', async () => {
    const { file, store } = await fixture(); let current = store.saveQueryResultPreset({ ...packet(store.queryResultPresets(target)), name: '原方案', value });
    const id = current.entries[0].id, bytes = readFileSync(file); mkdirSync(file + '.tmp');
    for (const action of [() => store.saveQueryResultPreset({ ...packet(current), name: '失败创建', value }), () => store.saveQueryResultPreset({ ...packet(current), name: '失败覆盖', replaceId: id, value }), () => store.renameQueryResultPreset({ ...packet(current), id, name: '失败改名' }), () => store.deleteQueryResultPreset({ ...packet(current), id })]) {
      expect(action).toThrow('未保存'); expect(store.queryResultPresets(target)).toEqual(current); expect(readFileSync(file).equals(bytes)).toBe(true);
    }
    rmSync(file + '.tmp', { recursive: true }); current = store.renameQueryResultPreset({ ...packet(current), id, name: '成功改名' });
    expect(current.revision).toBe(2); expect(current.entries.map(entry => entry.name)).toEqual(['成功改名']); store.close();
  });

  it('删除连接只删除精确文档，连接导出复制不携带整理值、SQL或行', async () => {
    const { file, store } = await fixture(); store.saveConnection({ ...profile, id: target.connectionId + '/相似' });
    const saved = store.saveQueryResultPreset({ ...packet(store.queryResultPresets(target)), name: '方案', value }), other = { connectionId: target.connectionId + '/相似' };
    store.saveQueryResultPreset({ ...packet(store.queryResultPresets(other), other.connectionId), name: '另一方案', value });
    for (const exported of [exportConnectionProfile(store.connections()[0]), copyConnectionProfile(store.connections()[0])]) {
      expect(JSON.stringify(exported)).not.toContain('configuration'); expect(JSON.stringify(exported)).not.toContain('9007199254740993');
    }
    store.deleteConnection(other.connectionId); expect(store.queryResultPresets(target).entries).toEqual(saved.entries); store.close();
    const SQL = await initSqlJs({ locateFile: () => wasm }), db = new SQL.Database(readFileSync(file));
    expect(db.exec('SELECT connection_id FROM query_result_presets')[0].values).toEqual([[target.connectionId]]); db.close();
  });

  it('命令和完整值拒绝SQL、行、选择、历史及超限配置，失败不改变文件', async () => {
    const { file, store } = await fixture(), current = store.queryResultPresets(target), bytes = readFileSync(file), command = { ...packet(current), name: '方案', value };
    for (const extra of [{ sql: 'SELECT secret' }, { rows: [{ secret: '行秘密' }] }, { selection: [1] }, { history: [] }]) {
      expect(() => store.saveQueryResultPreset({ ...command, ...extra })).toThrow();
      expect(() => store.saveQueryResultPreset({ ...command, value: { ...value, ...extra } })).toThrow();
    }
    expect(() => queryResultPresetSaveSchema.parse({ ...command, name: '名'.repeat(81) })).toThrow();
    const oversized = { ...value, columns: Array.from({ length: 100 }, (_, index) => ({ key: 'k' + index, name: '字'.repeat(4096), type: 'TEXT' })) };
    expect(() => store.saveQueryResultPreset({ ...command, value: oversized })).toThrow();
    expect(store.queryResultPresets(target)).toEqual(current); expect(readFileSync(file).equals(bytes)).toBe(true); store.close();
  });
});

describe('查询结果方案预算与schema9兼容保护', () => {
  it('每连接100项上限由真实写入检查，拒绝第101项且保留文件', async () => {
    const { file, store } = await fixture(); store.close();
    await rewrite(file, db => db.run('INSERT INTO query_result_presets VALUES (?,?)', [target.connectionId, JSON.stringify(document(100))]));
    const reopened = await LocalStore.open(file, wasm, protector), current = reopened.queryResultPresets(target), bytes = readFileSync(file);
    expect(() => reopened.saveQueryResultPreset({ ...packet(current), name: '第101项', value })).toThrow();
    expect(reopened.queryResultPresets(target)).toEqual(current); expect(readFileSync(file).equals(bytes)).toBe(true); reopened.close();
  });

  it.each(['connections', 'entries', 'bytes'] as const)('真实全库%s预算含空墓碑和UTF-8原文，新增失败保留旧文件', async mode => {
    const { file, store } = await fixture(); store.close();
    await rewrite(file, db => {
      if (mode === 'connections') for (let index = 0; index < 500; index++) db.run('INSERT INTO query_result_presets VALUES (?,?)', ['其它' + index, JSON.stringify(document())]);
      if (mode === 'entries') for (let index = 0; index < 10; index++) db.run('INSERT INTO query_result_presets VALUES (?,?)', ['其它' + index, JSON.stringify(document(100))]);
      if (mode === 'bytes') { const key = '其它', json = JSON.stringify(document()), remaining = queryResultPresetLimits.totalBytes - Buffer.byteLength(key + json, 'utf8'); db.run('INSERT INTO query_result_presets VALUES (?,?)', [key, json + ' '.repeat(remaining)]); }
    });
    const reopened = await LocalStore.open(file, wasm, protector), current = reopened.queryResultPresets(target), bytes = readFileSync(file);
    expect(() => reopened.saveQueryResultPreset({ ...packet(current), name: '新增越界', value })).toThrow('上限');
    // Buffer原生逐字节比较保持同样的文件不变断言，避免8MiB被通用深比较逐属性遍历。
    expect(reopened.queryResultPresets(target)).toEqual(current); expect(readFileSync(file).equals(bytes)).toBe(true); reopened.close();
  });

  it('全库预算边界接受精确上限，所有非法数值拒绝', () => {
    expect(() => validateQueryResultPresetBudget(500, 1000, 8 * 1024 * 1024)).not.toThrow();
    for (const args of [[501, 0, 0], [1, 1001, 1], [1, 1, 8 * 1024 * 1024 + 1], [-1, 0, 0], [1, Number.NaN, 0], [1, 1, 0.5]]) expect(() => validateQueryResultPresetBudget(...args as [number, number, number])).toThrow();
    expect(() => queryResultPresetDocumentSchema.parse(document(101))).toThrow();
  });

  it('旧schema9追加可选表，原有表逐表保持且SQLite兼容客户端导出仍保留方案', async () => {
    const { file, store } = await fixture(); store.saveQuery({ id: 'old-query', name: '旧查询', sql: 'SELECT 旧原文', updatedAt: '2026-10-22T00:00:00Z' }); store.saveSettings({ ...store.settings(), sidebarWidth: 345 }); store.close();
    const tables = ['connections', 'secrets', 'queries', 'history', 'settings', 'workbench', 'tasks', 'table_presets', 'query_file_sources', 'query_file_recents']; let before: unknown;
    await rewrite(file, db => { db.run('DROP TABLE query_result_presets;PRAGMA user_version=9'); before = tables.map(table => db.exec('SELECT * FROM ' + table)); });
    const migrated = await LocalStore.open(file, wasm, protector);
    expect(migrated.queryResultPresets(target).entries).toEqual([]);
    const saved = migrated.saveQueryResultPreset({ ...packet(migrated.queryResultPresets(target)), name: '兼容方案', value }); migrated.close();
    await rewrite(file, db => { expect(db.exec('PRAGMA user_version')[0].values[0][0]).toBe(9); expect(tables.map(table => db.exec('SELECT * FROM ' + table))).toEqual(before); });
    const reopened = await LocalStore.open(file, wasm, protector); expect(reopened.queryResultPresets(target).entries).toEqual(saved.entries); reopened.close();
  });

  it.each(['future-schema', 'future-document', 'malformed-json', 'invalid-value', 'duplicate', 'oversized-collection', 'failed-migration'] as const)('%s启动失败保持原文件字节，不修剪或覆盖', async mode => {
    const { file, store } = await fixture(); store.close();
    await rewrite(file, db => {
      if (mode === 'future-schema') db.run('PRAGMA user_version=10');
      else if (mode === 'failed-migration') db.run('DROP TABLE query_result_presets');
      else if (mode === 'oversized-collection') for (let index = 0; index < 501; index++) db.run('INSERT INTO query_result_presets VALUES (?,?)', ['其它' + index, JSON.stringify(document())]);
      else {
        const source = document(1), entry = source.entries[0];
        let data = JSON.stringify(source);
        if (mode === 'future-document') data = JSON.stringify({ ...source, version: 2 });
        if (mode === 'malformed-json') data = '{broken';
        if (mode === 'invalid-value') data = JSON.stringify({ ...source, entries: [{ ...entry, value: { ...value, rows: [] } }] });
        if (mode === 'duplicate') data = JSON.stringify({ ...source, entries: [entry, entry] });
        db.run('INSERT INTO query_result_presets VALUES (?,?)', [target.connectionId, data]);
      }
    });
    if (mode === 'failed-migration') mkdirSync(file + '.tmp');
    const bytes = readFileSync(file); await expect(LocalStore.open(file, wasm, protector)).rejects.toThrow(); expect(readFileSync(file).equals(bytes)).toBe(true);
  });
});
