import { afterEach, expect, it, vi } from 'vitest';
import { LocalStore, defaultSettings } from '../../src/main/storage';
import { validateCommand } from '../../src/shared/validation';
import type { AppSettings } from '../../src/shared/contracts';

const fs = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), writes: 0 }));
vi.mock('node:fs', () => ({ existsSync: () => false, mkdirSync() {}, readFileSync() { throw Error('禁止实际读取'); }, writeFileSync(path: string, data: Uint8Array) { fs.writes++; fs.files.set(path, Uint8Array.from(data)); }, renameSync(from: string, to: string) { fs.files.set(to, fs.files.get(from)!); fs.files.delete(from); } }));

/** 原存储和原子保存真实运行，表端口只接纳本例settings SQL，禁止业务查询。 */
class Rows {
  constructor(public row?: string) {}
  export() { return Buffer.from(JSON.stringify({ row: this.row })); }
  close() {}
  run(sql: string, values?: string[]) {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return;
    if (!sql.startsWith('INSERT INTO settings VALUES')) throw Error('越界SQL');
    this.row = values![0];
  }
  prepare(sql: string) {
    if (sql !== 'SELECT data FROM settings WHERE id=1') throw Error('越界表');
    let used = false;
    return { bind() {}, step: () => { if (used || this.row === undefined) return false; used = true; return true; }, getAsObject: () => ({ data: this.row }), free() {} };
  }
}

/** 仅在内存恢复settings字节，不读取真实配置或建立数据库连接。 */
function open(settings?: unknown, bytes?: Uint8Array): LocalStore {
  const restore = (data: Uint8Array) => new Rows(JSON.parse(Buffer.from(data).toString('utf8')).row);
  return Reflect.construct(LocalStore, [bytes ? restore(bytes) : new Rows(settings === undefined ? undefined : JSON.stringify(settings)), 'ram-object-browser-settings', { available: () => false }, restore]);
}
afterEach(() => { fs.files.clear(); fs.writes = 0; });

it('对象浏览设置经真实IPC验证及原存储字节恢复，原查询草稿不变且不创建会话', () => {
  const settings: AppSettings = { ...defaultSettings, activeTabId: 'o', tabs: [
    { id: 'q', kind: 'query', title: '原草稿', connectionId: 'c', sql: '原SQL与未保存内容' },
    { id: 't', kind: 'table', title: '原表', connectionId: 'c', database: '库', table: '表' },
    { id: 'o', kind: 'objects', title: '对象', connectionId: 'c', database: '库', objectCategory: 'routine' }
  ] };
  const store = open();
  store.saveSettings(validateCommand('settings.save', settings) as AppSettings);
  expect(open(undefined, fs.files.get('ram-object-browser-settings')).settings()).toEqual(settings);
  expect(fs.writes).toBe(1);
});

it('损坏对象定位仅在读取过滤且不写盘，直存非法对象字段在任何事务前拒绝', () => {
  const query = { id: 'q', kind: 'query', title: '保留草稿', connectionId: 'c', sql: '原文' };
  const object = { id: 'o', kind: 'objects', title: '对象', connectionId: 'c', database: '', objectCategory: 'table' };
  const store = open({ ...defaultSettings, activeTabId: 'q', tabs: [query, object] });
  expect(store.settings().tabs).toEqual([query]); expect(fs.writes).toBe(0);
  const before = store.settings();
  expect(() => store.saveSettings({ ...before, tabs: [{ ...object, database: '库', sql: '不得混入' }] } as AppSettings)).toThrow('查询');
  expect(fs.writes).toBe(0); expect(store.settings()).toEqual(before);
});

it('过滤活动坏对象页仅修复返回活动ID，保留可用原标签或返回空活动且零写盘', () => {
  const query = { id: 'q', kind: 'query', title: '保留草稿', connectionId: 'c', sql: '原文' };
  const invalid = { id: 'bad', kind: 'objects', title: '坏对象页', connectionId: 'c', database: '', objectCategory: 'table' };
  const restored = open({ ...defaultSettings, activeTabId: 'bad', tabs: [query, invalid] }).settings();
  expect(restored.tabs).toEqual([query]); expect(restored.activeTabId).toBe('q');
  const empty = open({ ...defaultSettings, activeTabId: 'bad', tabs: [invalid] }).settings();
  expect(empty.tabs).toEqual([]); expect(empty.activeTabId).toBeUndefined(); expect(fs.writes).toBe(0);
});
