import { afterEach, expect, it, vi } from 'vitest';
import { LocalStore, defaultSettings } from '../../src/main/storage';
import { validateCommand } from '../../src/shared/validation';
import type { AppSettings } from '../../src/shared/contracts';
import { readSqlKeywordCase } from '../../src/shared/sqlKeywordCase';

const fs = vi.hoisted(() => ({ bytes: new Map<string, Uint8Array>(), writes: 0, fail: false }));
// 只替换原文件字节端口；不创建配置文件、不初始化SQLite或读取用户数据。
vi.mock('node:fs', () => ({ existsSync: () => false, mkdirSync() {}, readFileSync() { throw Error('禁止实际读取'); }, writeFileSync(path: string, bytes: Uint8Array) { fs.writes++; fs.bytes.set(path, Uint8Array.from(bytes)); }, renameSync(from: string, to: string) { if (fs.fail) throw Error('RAM原子替换失败'); fs.bytes.set(to, fs.bytes.get(from)!); fs.bytes.delete(from); } }));
/** 只响应原LocalStore的settings事务和缺失私有文件来源；schema迁移不在此RAM替身中模拟。 */
class SettingsTable {
  constructor(public row?: string) {}
  export() { return Buffer.from(JSON.stringify({ row: this.row })); }
  close() {}
  run(sql: string, values?: string[]) { if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return; if (!sql.startsWith('INSERT INTO settings VALUES')) throw Error('越界RAM写入'); this.row = values![0]; }
  prepare(sql: string) {
    const settings = sql === 'SELECT data FROM settings WHERE id=1';
    if (!settings && sql !== 'SELECT id,revision,data FROM query_file_sources WHERE tab_id=?') throw Error('越界RAM读取');
    let read = false; return { bind() {}, step: () => { if (read || !settings || this.row === undefined) return false; read = true; return true; }, getAsObject: () => ({ data: this.row }), free() {} };
  }
}
/** 真实LocalStore读/写/失败恢复运行；重开仅从RAM原子字节恢复，不调用open或迁移。 */
function open(row?: unknown, bytes?: Uint8Array): LocalStore {
  const restore = (value: Uint8Array) => new SettingsTable(JSON.parse(Buffer.from(value).toString()).row);
  return Reflect.construct(LocalStore, [bytes ? restore(bytes) : new SettingsTable(row === undefined ? undefined : JSON.stringify(row)), 'RAM偏好', { available: () => false, encrypt() { throw Error('禁止凭据'); }, decrypt() { throw Error('禁止凭据'); } }, restore]) as LocalStore;
}
const legacy = (): AppSettings => ({ ...defaultSettings, theme: 'light', sidebarWidth: 333, editorTabSize: 8, editorInsertSpaces: false, tabs: [{ id: 'q', kind: 'query', title: '原草稿', connectionId: 'RAM', sql: "SELECT MiXeD,'🚢';\r\n-- SeLeCt保持" }], activeTabId: 'q' });
afterEach(() => { fs.bytes.clear(); fs.writes = 0; fs.fail = false; });

it('缺项及坏存量只局部回退；合法lower原样读取，零写入且原SQL不改', () => {
  for (const patch of [{}, { sqlKeywordCase: 'mixed' }, { sqlKeywordCase: null }, { sqlKeywordCase: 1 }]) {
    const store = open({ ...legacy(), ...patch }); expect(readSqlKeywordCase(store.settings().sqlKeywordCase)).toBe('preserve'); expect(store.settings().tabs).toEqual(legacy().tabs); expect(Object.hasOwn(store.settings(), 'sqlKeywordCase')).toBe(Object.hasOwn(patch, 'sqlKeywordCase')); store.close();
  }
  const store = open({ ...legacy(), sqlKeywordCase: 'lower' }); expect(store.settings()).toEqual({ ...legacy(), sqlKeywordCase: 'lower' }); store.close(); expect(fs.writes).toBe(0);
});

it('三种值沿严格IPC及真实LocalStore原子字节链保存并重开，原草稿与其它设置逐字保留', () => {
  const store = open();
  for (const sqlKeywordCase of ['upper', 'lower', 'preserve'] as const) {
    const settings = { ...legacy(), sqlKeywordCase }; store.saveSettings(validateCommand('settings.save', settings) as AppSettings);
    const restored = open(undefined, fs.bytes.get('RAM偏好')); expect(restored.settings()).toEqual(settings); restored.close();
    const persisted = JSON.parse(JSON.parse(Buffer.from(fs.bytes.get('RAM偏好')!).toString()).row); expect(persisted).toEqual(settings); expect(persisted.tabs[0].sql).toBe(settings.tabs[0].sql);
  }
  store.close(); expect(fs.writes).toBe(3);
});

it('显式undefined、未知值、大小写别名及未知字段均在事务前拒绝，缺项兼容', () => {
  const store = open(legacy());
  for (const value of [undefined, null, 'LOWER', 'mixed', '', true, 1, {}, []]) {
    const input = { ...legacy(), sqlKeywordCase: value }; expect(() => validateCommand('settings.save', input)).toThrow(); expect(() => store.saveSettings(input as any)).toThrow('大小写偏好');
  }
  expect(() => validateCommand('settings.save', { ...legacy(), keywordCase: 'lower' })).toThrow(); expect(fs.writes).toBe(0); expect(store.settings()).toEqual(legacy());
  store.saveSettings(validateCommand('settings.save', legacy()) as AppSettings); expect(Object.hasOwn(open(undefined, fs.bytes.get('RAM偏好')).settings(), 'sqlKeywordCase')).toBe(false); store.close();
});

it('lower原子保存失败恢复旧内存和旧字节，后续保存不夹带失败偏好', () => {
  const before = { ...legacy(), sqlKeywordCase: 'upper' as const }, store = open(before); store.saveSettings(before); const bytes = fs.bytes.get('RAM偏好'); fs.fail = true;
  expect(() => store.saveSettings({ ...before, sqlKeywordCase: 'lower' })).toThrow('修改未保存'); expect(store.settings()).toEqual(before); expect(fs.bytes.get('RAM偏好')).toEqual(bytes);
  fs.fail = false; store.saveSettings({ ...store.settings(), sidebarWidth: 345 }); expect(open(undefined, fs.bytes.get('RAM偏好')).settings()).toEqual({ ...before, sidebarWidth: 345 }); store.close();
});
