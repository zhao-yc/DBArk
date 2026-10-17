import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../src/shared/contracts';
import { editorFontOptions, isEditorFontSize, readEditorFontSize } from '../../src/shared/editorFont';
import { validateCommand } from '../../src/shared/validation';
import { LocalStore, defaultSettings } from '../../src/main/storage';

const fs = vi.hoisted(() => ({ bytes: new Map<string, Uint8Array>(), fail: false, writes: 0 }));
// 仅把存储原子文件端口替换为RAM，绝不创建真实配置文件或读取私料。
vi.mock('node:fs', () => ({ existsSync: () => false, mkdirSync() {}, readFileSync: () => { throw Error('禁止真实读取'); }, writeFileSync: (path: string, bytes: Uint8Array) => { fs.writes++; fs.bytes.set(path, Uint8Array.from(bytes)); }, renameSync: (from: string, to: string) => { if (fs.fail) throw Error('RAM落盘失败'); fs.bytes.set(to, fs.bytes.get(from)!); fs.bytes.delete(from); } }));
/** 单一settings表的RAM端口只执行原存储器发出的SQL；不启动SQLite或数据库连接。 */
class SettingsTable {
  constructor(public row?: string) {}
  export() { return Buffer.from(JSON.stringify({ row: this.row })); }
  close() {}
  run(sql: string, parameters?: string[]) { if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return; if (!sql.startsWith('INSERT INTO settings VALUES')) throw Error('越界SQL'); this.row = parameters![0]; }
  prepare(sql: string) { if (sql !== 'SELECT data FROM settings WHERE id=1') throw Error('越界读取'); let read = false; return { bind() {}, step: () => { if (read || this.row === undefined) return false; read = true; return true; }, getAsObject: () => ({ data: this.row }), free() {} }; }
}
function open(row?: unknown, bytes?: Uint8Array): LocalStore {
  const restore = (data: Uint8Array) => new SettingsTable(JSON.parse(Buffer.from(data).toString('utf8')).row);
  return Reflect.construct(LocalStore, [bytes ? restore(bytes) : new SettingsTable(row === undefined ? undefined : JSON.stringify(row)), 'ram-settings', { available: () => false, encrypt: () => '', decrypt: () => '' }, restore]) as LocalStore;
}
afterEach(() => { fs.bytes.clear(); fs.fail = false; fs.writes = 0; });

describe('编辑器字号主进程边界与原持久化链路（RAM）', () => {
  it('新设置和缺字段旧记录默认13/23，损坏旧值不隐式转换且读取不写盘', () => {
    expect(defaultSettings.editorFontSize).toBe(13); expect(open().settings().editorFontSize).toBe(13);
    const legacy = { ...defaultSettings, tabs: [{ id: 'q', kind: 'query', title: '保留', connectionId: 'c', sql: '原SQL' }] }; delete legacy.editorFontSize;
    expect(open(legacy).settings()).toEqual({ ...legacy, editorFontSize: 13 });
    for (const value of ['20', 7, 33, 13.5, null]) expect(open({ ...legacy, editorFontSize: value }).settings().editorFontSize).toBe(13);
    expect(fs.writes).toBe(0); expect(editorFontOptions(undefined)).toEqual({ fontSize: 13, lineHeight: 23 });
  });
  it('8/32和恢复13经IPC校验及实际LocalStore保存，RAM原子字节重开保留其他设置与SQL', () => {
    const store = open(), original = { ...store.settings(), theme: 'light' as const, tabs: [{ id: 'q', kind: 'query' as const, title: '保留', connectionId: 'c', sql: 'select 精确原文' }], activeTabId: 'q' };
    for (const editorFontSize of [8, 32, 13]) {
      const settings = { ...original, editorFontSize }; store.saveSettings(validateCommand('settings.save', settings) as AppSettings);
      const restored = open(undefined, fs.bytes.get('ram-settings')); expect(restored.settings()).toEqual(settings); restored.close();
    }
    expect(fs.writes).toBe(3); expect(editorFontOptions(8).fontSize).toBe(8); expect(editorFontOptions(32).fontSize).toBe(32);
  });
  it('越界/非整数/非数字值在IPC与直接存储都拒绝，旧缺项仍可保存且未知字段拒绝', () => {
    const store = open(), initial = store.settings();
    for (const value of [7, 33, 8.5, NaN, Infinity, '13', null, true, {}]) {
      expect(isEditorFontSize(value)).toBe(false); expect(() => validateCommand('settings.save', { ...initial, editorFontSize: value })).toThrow();
      expect(() => store.saveSettings({ ...initial, editorFontSize: value } as AppSettings)).toThrow('整数');
    }
    expect(fs.writes).toBe(0); expect(store.settings()).toEqual(initial);
    const legacy = { ...initial }; delete legacy.editorFontSize; store.saveSettings(validateCommand('settings.save', legacy) as AppSettings); expect(store.settings().editorFontSize).toBe(13);
    expect(() => validateCommand('settings.save', { ...initial, editorFontFamily: '未知' })).toThrow(); expect(readEditorFontSize('20')).toBe(13);
  });
  it('原子保存失败恢复原存储快照，不把失败字号夹入以后保存', () => {
    const store = open(); store.saveSettings(store.settings()); const before = fs.bytes.get('ram-settings'); fs.fail = true;
    expect(() => store.saveSettings({ ...store.settings(), editorFontSize: 24 })).toThrow('修改未保存'); expect(fs.bytes.get('ram-settings')).toEqual(before); expect(store.settings().editorFontSize).toBe(13);
    fs.fail = false; store.saveSettings(store.settings()); expect(open(undefined, fs.bytes.get('ram-settings')).settings().editorFontSize).toBe(13);
  });
});
