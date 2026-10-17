import { afterEach, expect, it, vi } from 'vitest';
import { LocalStore, defaultSettings } from '../../src/main/storage';
import { validateCommand } from '../../src/shared/validation';
import { editorWordWrapOptions, readEditorWordWrap } from '../../src/shared/editorWordWrap';
import type { AppSettings } from '../../src/shared/contracts';
const fs = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), writes: 0 }));
// 原LocalStore/事务/原子保存真实运行，表和文件端口均在RAM，不启动SQLite或读取实际配置。
vi.mock('node:fs', () => ({ existsSync: () => false, mkdirSync() {}, readFileSync() { throw Error('禁止实际读取'); }, writeFileSync(path: string, data: Uint8Array) { fs.writes++; fs.files.set(path, Uint8Array.from(data)); }, renameSync(from: string, to: string) { fs.files.set(to, fs.files.get(from)!); fs.files.delete(from); } }));
/** 仅支持本例settings表原SQL，拒绝跨表或任何业务数据库命令。 */
class Rows {
  constructor(public row?: string) {}
  export() { return Buffer.from(JSON.stringify({ row: this.row })); } close() {}
  run(sql: string, values?: string[]) { if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return; if (!sql.startsWith('INSERT INTO settings VALUES')) throw Error('越界SQL'); this.row = values![0]; }
  prepare(sql: string) { if (sql !== 'SELECT data FROM settings WHERE id=1') throw Error('越界表'); let used = false; return { bind() {}, step: () => { if (used || this.row === undefined) return false; used = true; return true; }, getAsObject: () => ({ data: this.row }), free() {} }; }
}
function open(settings?: any, data?: Uint8Array): LocalStore { const restore = (bytes: Uint8Array) => new Rows(JSON.parse(Buffer.from(bytes).toString('utf8')).row); return Reflect.construct(LocalStore, [data ? restore(data) : new Rows(settings === undefined ? undefined : JSON.stringify(settings)), 'ram-wrap-settings', { available: () => false }, restore]); }
afterEach(() => { fs.files.clear(); fs.writes = 0; });

it('旧缺项读取默认true而不写盘，false/true经原IPC与原子字节保存可重读且其它字段不变', () => {
  const old = { ...defaultSettings, editorFontSize: 20, tabs: [{ id: 'q', kind: 'query' as const, connectionId: 'c', title: '保留', sql: 'select 原SQL' }] }; delete old.editorWordWrap;
  const store = open(old); expect(defaultSettings.editorWordWrap).toBe(true); expect(open().settings().editorWordWrap).toBe(true); expect(store.settings()).toEqual({ ...old, editorWordWrap: true }); expect(fs.writes).toBe(0);
  for (const editorWordWrap of [false,true]) { const settings = { ...old, editorWordWrap }; store.saveSettings(validateCommand('settings.save', settings) as AppSettings); expect(open(undefined, fs.files.get('ram-wrap-settings')).settings()).toEqual(settings); }
  expect(editorWordWrapOptions(undefined)).toEqual({ wordWrap: 'on' }); expect(editorWordWrapOptions(false)).toEqual({ wordWrap: 'off' });
});

it('非法显式值在写入口拒绝，读取只局部回退true且不丢其它偏好', () => {
  const store = open(), original = store.settings();
  for (const value of ['true','false',0,1,null,{},[],NaN]) {
    const changed = { ...original, editorWordWrap: value, editorFontSize: 32, tabs: [{ id: 'q', kind: 'query', connectionId: 'c', title: '错误混入', sql: '不应保存' }] };
    expect(() => validateCommand('settings.save', changed)).toThrow(); expect(() => store.saveSettings(changed as AppSettings)).toThrow('布尔'); expect(readEditorWordWrap(value)).toBe(true); expect(open({ ...original, editorWordWrap: value }).settings()).toEqual({ ...original, editorWordWrap: true });
  }
  expect(fs.writes).toBe(0); expect(store.settings()).toEqual(original); const legacy = { ...original }; delete legacy.editorWordWrap; expect(validateCommand('settings.save', legacy)).toEqual(legacy);
});
