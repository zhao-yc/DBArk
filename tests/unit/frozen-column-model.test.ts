import { randomUUID } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { LocalStore } from '../../src/main/storage';
import type { ConnectionProfile, QueryResult, ResultColumn } from '../../src/shared/contracts';
import { tablePreferenceBytes, tablePreferenceSaveSchema, tablePreferencesLimits, tablePreferencesSchema, type TablePreferences } from '../../src/shared/tablePreferences';
import { queryResultPresetSaveSchema, queryResultPresetValueSchema, type QueryResultPresetValue } from '../../src/shared/queryResultPresets';
import { commandSchemas } from '../../src/shared/validation';
import { changeTablePreference, frozenTableKeys, moveTableColumn, reconcileTablePreferences, setTableFrozenThrough, visibleTableKeys } from '../../src/renderer/tableColumnPreferences';
import { frozenQueryResultKeys, moveQueryResultColumn, projectQueryResultRows, queryResultVisibleColumns, setQueryResultFrozenThrough, type QueryResultColumnLayout } from '../../src/renderer/queryResultColumns';

const target = { connectionId: 'frozen-offline', database: '库', table: '表' };
/** 隐藏可靠键不影响展示前缀，原型同名列与大小写名称均按精确身份处理。 */
function table(): TablePreferences {
  return { version: 1, columns: [{ name: 'id', hidden: true }, { name: '__proto__', hidden: false, width: 200 }, { name: 'Name', hidden: false, width: 160 }, { name: 'amount', hidden: false }] };
}
/** 重复显示别名保留各自内部key，不用显示名称定位冻结边界。 */
function columns(): ResultColumn[] { return [{ key: '__proto__', name: '重复', type: 'BIGINT' }, { key: 'c1', name: '重复', type: 'DECIMAL' }, { key: 'constructor', name: '', type: 'BLOB' }, { key: 'c3', name: '隐藏', type: 'TEXT' }]; }
function layout(): QueryResultColumnLayout { return { order: ['c3', '__proto__', 'constructor', 'c1'], visible: ['__proto__', 'c1', 'constructor'] }; }
function preset(): QueryResultPresetValue { const all = columns(); return { columns: all, visible: [all[0], all[2], all[1]], configuration: { expression: { mode: 'AND', children: [] }, sort: [] } }; }

describe('表页冻结绑定可见顺序前缀，不重排列或原数据', () => {
  it('冻结到边界、清除和旧文档都保持精确形状及顺序', () => {
    const original = table(), frozen = setTableFrozenThrough(original, 'Name');
    expect(frozenTableKeys(frozen)).toEqual(['__proto__', 'Name']); expect(frozen.columns).toEqual(original.columns);
    expect(original).not.toHaveProperty('frozenThrough'); expect(frozen.frozenThrough).toBe('Name');
    const cleared = setTableFrozenThrough(frozen); expect(cleared).toEqual(original); expect(Object.hasOwn(cleared, 'frozenThrough')).toBe(false);
    expect(tablePreferencesSchema.parse(original)).toEqual(original); expect(tablePreferencesSchema.parse(frozen)).toEqual(frozen);
    expect(reconcileTablePreferences(original.columns.map(column => column.name), null)).not.toHaveProperty('frozenThrough');
  });
  it('隐藏前置列缩小冻结前缀，隐藏边界清除，宽度及移动按新可见顺序保留边界', () => {
    const original = setTableFrozenThrough(table(), 'Name');
    const hiddenFirst = changeTablePreference(original, '__proto__', { hidden: true });
    expect(hiddenFirst.frozenThrough).toBe('Name'); expect(frozenTableKeys(hiddenFirst)).toEqual(['Name']);
    const hiddenBoundary = changeTablePreference(original, 'Name', { hidden: true });
    expect(hiddenBoundary).not.toHaveProperty('frozenThrough'); expect(frozenTableKeys(hiddenBoundary)).toEqual([]);
    expect(changeTablePreference(original, 'Name', { width: 333 }).frozenThrough).toBe('Name');
    const moved = moveTableColumn(original, 'amount', '__proto__');
    expect(moved.columns.map(column => column.name)).toEqual(['id', 'amount', '__proto__', 'Name']);
    expect(frozenTableKeys(moved)).toEqual(['amount', '__proto__', 'Name']);
    expect(frozenTableKeys(moveTableColumn(original, 'Name', '__proto__'))).toEqual(['Name']);
    expect(visibleTableKeys(original)).toEqual(['__proto__', 'Name', 'amount']);
  });
  it.each(['', 'name', 'id', '不存在'])('新冻结边界%s必须精确存在且可见', name => {
    expect(() => setTableFrozenThrough(table(), name)).toThrow('冻结');
  });
  it('元数据消失或歧义清除，唯一大小写迁移保留，精确名称优先于折叠歧义', () => {
    const original = setTableFrozenThrough(table(), 'Name');
    const migrated = reconcileTablePreferences(['id', '__proto__', 'NAME', 'amount', 'new'], original);
    expect(migrated.frozenThrough).toBe('NAME'); expect(frozenTableKeys(migrated)).toEqual(['__proto__', 'NAME']);
    expect(migrated.columns.find(column => column.name === 'NAME')?.width).toBe(160);
    for (const names of [['id', '__proto__', 'amount'], ['id', '__proto__', 'name', 'NAME', 'amount'], ['Name', 'Name']]) {
      expect(reconcileTablePreferences(names, original)).not.toHaveProperty('frozenThrough');
    }
    expect(reconcileTablePreferences(['Name', 'name'], original).frozenThrough).toBe('Name');
    const savedAmbiguous: TablePreferences = { version: 1, columns: [{ name: 'name', hidden: false }, { name: 'NAME', hidden: false }], frozenThrough: 'name' };
    expect(reconcileTablePreferences(['Name'], savedAmbiguous)).not.toHaveProperty('frozenThrough');
    const hidden: TablePreferences = { version: 1, columns: [{ name: 'Name', hidden: true }], frozenThrough: 'Name' };
    expect(reconcileTablePreferences(['Name'], hidden)).toEqual({ version: 1, columns: [{ name: 'Name', hidden: false }] });
  });
  it('精确重复身份不授予冻结，原型同名边界作为普通名称安全保留', () => {
    const source = table(); source.columns.push({ name: 'Name', hidden: false });
    expect(() => setTableFrozenThrough(source, 'Name')).toThrow(); expect(frozenTableKeys({ ...source, frozenThrough: 'Name' })).toEqual([]);
    const prototype = setTableFrozenThrough(table(), '__proto__'); expect(frozenTableKeys(prototype)).toEqual(['__proto__']);
    expect(tablePreferencesSchema.parse(prototype).frozenThrough).toBe('__proto__');
  });
  it('4096列宽表冻结至末列仍取完整可见前缀，不截断或改变顺序', () => {
    const names = Array.from({ length: tablePreferencesLimits.columns }, (_, index) => '字段' + index), original = reconcileTablePreferences(names, null);
    const frozen = setTableFrozenThrough(original, names.at(-1));
    expect(frozenTableKeys(frozen)).toEqual(names); expect(frozen.columns).toEqual(original.columns); expect(original).not.toHaveProperty('frozenThrough');
  });
});

describe('查询结果冻结只使用原内部key，投影与行顺序不变', () => {
  it('重复别名按唯一key冻结，移动边界改变范围，清除不引入undefined字段', () => {
    const all = columns(), original = layout(), frozen = setQueryResultFrozenThrough(original, 'constructor');
    expect(frozenQueryResultKeys(all, frozen)).toEqual(['__proto__', 'constructor']);
    expect(queryResultVisibleColumns(all, frozen).map(column => column.key)).toEqual(['__proto__', 'constructor', 'c1']);
    const moved = moveQueryResultColumn(frozen, 'constructor', 1);
    expect(moved.frozenThrough).toBe('constructor'); expect(frozenQueryResultKeys(all, moved)).toEqual(['__proto__', 'c1', 'constructor']);
    expect(setQueryResultFrozenThrough(frozen)).toEqual(original); expect(setQueryResultFrozenThrough(frozen)).not.toHaveProperty('frozenThrough');
    expect(original).not.toHaveProperty('frozenThrough'); expect(frozen.order).toEqual(original.order); expect(frozen.visible).toEqual(original.visible);
  });
  it.each(['', '重复', 'c3', '不存在'])('冻结key%s不可用显示别名、隐藏列或未知列代替', key => {
    expect(() => setQueryResultFrozenThrough(layout(), key)).toThrow('冻结');
  });
  it('隐藏边界的未规范布局明确拒绝，过期或重复元数据安全不冻结', () => {
    const all = columns(), frozen = setQueryResultFrozenThrough(layout(), 'constructor');
    const hidden = { ...frozen, visible: frozen.visible.filter(key => key !== 'constructor') };
    expect(() => queryResultVisibleColumns(all, hidden)).toThrow('冻结'); expect(frozenQueryResultKeys(all, hidden)).toEqual([]);
    expect(frozenQueryResultKeys(all.filter(column => column.key !== 'constructor'), frozen)).toEqual([]);
    expect(frozenQueryResultKeys([all[0], all[0]], frozen)).toEqual([]);
    expect(() => setQueryResultFrozenThrough({ order: ['a', 'a'], visible: ['a'] }, 'a')).toThrow();
    expect(() => setQueryResultFrozenThrough({ order: ['a'], visible: ['a', 'ghost'] }, 'a')).toThrow();
    expect(queryResultVisibleColumns(all, setQueryResultFrozenThrough(hidden)).map(column => column.key)).toEqual(['__proto__', 'c1']);
  });
  it('冻结不是数据重排，原行引用和导出完整可见列保持不变', () => {
    const all = columns(), rows = [JSON.parse('{"__proto__":"18446744073709551615","c1":"0.12345678901234567890","constructor":{"type":"binary","base64":"AP8="},"c3":"隐藏值"}')];
    const original: QueryResult = { columns: all, rows, elapsedMs: 1, truncated: false, statement: 'SELECT 合成示例' }, frozen = setQueryResultFrozenThrough(layout(), '__proto__');
    const visible = queryResultVisibleColumns(all, frozen), exported = projectQueryResultRows(original, visible);
    expect(original.rows).toBe(rows); expect(original.rows[0]).toBe(rows[0]); expect(original.columns).toBe(all);
    expect(exported.columns.map(column => column.key)).toEqual(['__proto__', 'constructor', 'c1']); expect(Object.values(exported.rows[0])).toEqual(['18446744073709551615', { type: 'binary', base64: 'AP8=' }, '0.12345678901234567890']);
    expect(frozenQueryResultKeys(all, frozen)).toEqual(['__proto__']);
  });
  it('1024列前缀完整且无新行状态，非枚举或访问器边界不执行', () => {
    const all = Array.from({ length: 1024 }, (_, index) => ({ key: 'c' + index, name: '重复', type: 'TEXT' })), keys = all.map(column => column.key);
    expect(frozenQueryResultKeys(all, setQueryResultFrozenThrough({ order: keys, visible: keys }, 'c1023'))).toEqual(keys);
    let reads = 0; const invalid = layout(); Object.defineProperty(invalid, 'frozenThrough', { get() { reads++; return '__proto__'; }, enumerable: true });
    expect(() => queryResultVisibleColumns(columns(), invalid)).toThrow('冻结'); expect(frozenQueryResultKeys(columns(), invalid)).toEqual([]); expect(reads).toBe(0);
  });
});

describe('冻结列共享IPC与命名方案校验', () => {
  it.each(['', 'id', 'name', '不存在', undefined, null, 1])('表schema拒绝无效、隐藏或不精确边界%j', frozenThrough => {
    const preferences = { ...table(), frozenThrough };
    expect(tablePreferencesSchema.safeParse(preferences).success).toBe(false);
    expect(commandSchemas['table.preferences.save'].safeParse({ ...target, preferences }).success).toBe(false);
  });
  it('旧表内容保持无字段，新边界通过原严格IPC且未知根字段仍拒绝', () => {
    const old = table(); expect(commandSchemas['table.preferences.save'].parse({ ...target, preferences: old })).toEqual({ ...target, preferences: old });
    const preferences = setTableFrozenThrough(old, 'Name'); expect(commandSchemas['table.preferences.save'].parse({ ...target, preferences })).toEqual({ ...target, preferences });
    expect(commandSchemas['table.preferences.save'].safeParse({ ...target, preferences, frozenThrough: 'Name' }).success).toBe(false);
    expect(tablePreferencesSchema.safeParse({ ...preferences, rows: [] }).success).toBe(false);
  });
  it('表和方案冻结getter、稀疏数组及异常原型均零执行或明确拒绝', () => {
    let reads = 0;
    const preferences = table(); Object.defineProperty(preferences, 'frozenThrough', { get() { reads++; return 'Name'; }, enumerable: true });
    expect(tablePreferencesSchema.safeParse(preferences).success).toBe(false);
    const source = preset(); Object.defineProperty(source, 'frozenThrough', { get() { reads++; return '__proto__'; }, enumerable: true });
    expect(queryResultPresetValueSchema.safeParse(source).success).toBe(false); expect(reads).toBe(0);
    const sparse = table(); Reflect.deleteProperty(sparse.columns, '0'); expect(tablePreferencesSchema.safeParse(sparse).success).toBe(false);
    const unusual = table(); Object.setPrototypeOf(unusual, { frozenThrough: 'Name' }); expect(tablePreferencesSchema.safeParse(unusual).success).toBe(false);
  });
  it('查询方案深复制冻结边界与完整元数据，旧值仍无可选属性', () => {
    const old = preset(), frozen = { ...old, frozenThrough: 'constructor' }, parsed = queryResultPresetValueSchema.parse(frozen);
    expect(queryResultPresetValueSchema.parse(old)).toEqual(old); expect(queryResultPresetValueSchema.parse(old)).not.toHaveProperty('frozenThrough');
    expect(parsed).toEqual(frozen); expect(parsed).not.toBe(frozen); expect(parsed.columns).not.toBe(frozen.columns); expect(parsed.visible).not.toBe(frozen.visible);
    expect(parsed.frozenThrough).toBe('constructor');
    const packet = { connectionId: target.connectionId, expectedRevision: 0, source: { connectionRevision: 0, connectionDigest: 'a'.repeat(64) }, bindingToken: randomUUID(), name: '冻结方案', value: frozen };
    expect(queryResultPresetSaveSchema.parse(packet).value.frozenThrough).toBe('constructor');
  });
  it.each(['', '重复', 'c3', '不存在', undefined, null, 1])('方案拒绝未知/隐藏/显示别名边界%j', frozenThrough => {
    expect(queryResultPresetValueSchema.safeParse({ ...preset(), frozenThrough }).success).toBe(false);
  });
  it('方案冻结字段计入128Ki单元预算，不截断值或放松旧条件预算', () => {
    const all = [{ key: 'c0', name: '值', type: 'TEXT' }, { key: 'k'.repeat(4096), name: '边界', type: 'TEXT' }];
    const value: QueryResultPresetValue = { columns: all, visible: all, configuration: { expression: { mode: 'AND', children: Array.from({ length: 29 }, () => ({ column: 'c0', operator: 'contains' as const, value: 'x'.repeat(4096) })) }, sort: [] } };
    expect(queryResultPresetValueSchema.safeParse(value).success).toBe(true);
    expect(queryResultPresetValueSchema.safeParse({ ...value, frozenThrough: all[1].key }).success).toBe(false);
  });
  it('表冻结字段照常计入512KiB UTF8预算，旧布局可保存时新增边界也可能明确超额', () => {
    const sample = { name: 'x'.repeat(230) + '0000', hidden: false }, itemBytes = new TextEncoder().encode(JSON.stringify(sample)).byteLength + 1;
    const fixed = tablePreferenceBytes(target, { version: 1, columns: [] }), count = Math.floor((tablePreferencesLimits.entryBytes - fixed) / itemBytes);
    const columns = Array.from({ length: count }, (_, index) => ({ ...sample, name: 'x'.repeat(230) + String(index).padStart(4, '0') }));
    const old: TablePreferences = { version: 1, columns }, frozen = () => ({ ...old, frozenThrough: columns[0].name });
    const extraNeeded = Math.max(0, tablePreferencesLimits.entryBytes - tablePreferenceBytes(target, frozen()) + 1);
    columns[columns.length - 1].name += 'y'.repeat(extraNeeded);
    expect(columns.at(-1)!.name.length).toBeLessThanOrEqual(256);
    expect(tablePreferenceSaveSchema.safeParse({ ...target, preferences: old }).success).toBe(true);
    expect(tablePreferenceSaveSchema.safeParse({ ...target, preferences: frozen() }).success).toBe(false);
  });
});

describe('冻结列沿既有JSON在真实SQLite跨重启保存，不新增schema', () => {
  it('表偏好与命名结果方案保存/清除精确边界，旧文档和配置版本保持', async () => {
    const require = createRequire(import.meta.url), wasm = require.resolve('sql.js/dist/sql-wasm.wasm'), directory = mkdtempSync(join(tmpdir(), 'dbark-frozen-model-')), file = join(directory, 'local.sqlite');
    const protector = { available: () => false, encrypt: (value: string) => value, decrypt: (value: string) => value };
    const profile: ConnectionProfile = { id: target.connectionId, name: '离线冻结布局', group: '', color: '#123456', host: '127.0.0.1', port: 1, user: 'offline', dialect: 'mysql' };
    let store: LocalStore | undefined;
    try {
      const SQL = await initSqlJs({ locateFile: () => wasm });
      /** 从实际文件只读PRAGMA，避免以源码常量代替迁移版本证据。 */
      const schema = () => { const database = new SQL.Database(readFileSync(file)); try { return database.exec('PRAGMA user_version')[0].values[0][0]; } finally { database.close(); } };
      store = await LocalStore.open(file, wasm, protector); store.saveConnection(profile); const originalVersion = schema();
      const preferences = setTableFrozenThrough(table(), 'Name'), value = { ...preset(), frozenThrough: 'constructor' };
      store.saveTablePreferences({ ...target, preferences }); const empty = store.queryResultPresets({ connectionId: profile.id });
      store.saveQueryResultPreset({ connectionId: profile.id, expectedRevision: empty.revision, source: empty.source, bindingToken: randomUUID(), name: '冻结方案', value });
      store.close(); store = undefined; store = await LocalStore.open(file, wasm, protector);
      expect(store.tablePreferences(target)).toEqual(preferences); expect(store.queryResultPresets({ connectionId: profile.id }).entries[0].value).toEqual(value); expect(schema()).toBe(originalVersion);
      store.saveTablePreferences({ ...target, preferences: setTableFrozenThrough(store.tablePreferences(target)!) });
      const previous = store.queryResultPresets({ connectionId: profile.id });
      store.saveQueryResultPreset({ connectionId: profile.id, expectedRevision: previous.revision, source: previous.source, bindingToken: randomUUID(), name: previous.entries[0].name, replaceId: previous.entries[0].id, value: preset() });
      store.close(); store = undefined; store = await LocalStore.open(file, wasm, protector);
      expect(store.tablePreferences(target)).toEqual(table()); expect(store.tablePreferences(target)).not.toHaveProperty('frozenThrough');
      expect(store.queryResultPresets({ connectionId: profile.id }).entries[0].value).toEqual(preset()); expect(schema()).toBe(originalVersion);
      expect(store.history()).toEqual([]); expect(store.tasks()).toEqual([]);
    } finally {
      store?.close();
      const absolute = resolve(directory), canonicalRoot = realpathSync(tmpdir());
      const same = (left: string, right: string) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
      if (!/^dbark-frozen-model-[a-zA-Z0-9]+$/.test(basename(absolute)) || !same(dirname(absolute), resolve(tmpdir())) || lstatSync(absolute).isSymbolicLink() || !same(dirname(realpathSync(absolute)), canonicalRoot)) throw Error('拒绝清理非本例创建的真实临时目录');
      rmSync(absolute, { recursive: true, force: true });
    }
  });
});
