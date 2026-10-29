import { describe, expect, it } from 'vitest';
import { assertObjectBrowserTabs, objectCategories, readObjectBrowserTabs } from '../../src/shared/objectBrowser';
import { validateCommand } from '../../src/shared/validation';
import { defaultSettings } from '../../src/main/storage';

const browser = { id: 'objects', kind: 'objects', title: '对象', connectionId: 'c', database: '库.名`/🚢', objectCategory: 'table' };

describe('对象浏览标签设置合同', () => {
  it('五类对象定位可经原设置入口读写，旧查询及表标签保持兼容', () => {
    for (const objectCategory of objectCategories) {
      const tabs = [
        { id: 'q', kind: 'query', title: '草稿', connectionId: 'c', sql: '原查询正文' },
        { id: 't', kind: 'table', title: '原表', connectionId: 'c', database: '库', table: '表' },
        { ...browser, objectCategory }
      ];
      const settings = { ...defaultSettings, tabs, activeTabId: 'objects' };
      expect(validateCommand('settings.save', settings)).toEqual(settings);
    }
  });

  it('对象浏览必须有明确连接/库/分类，禁止携带查询、表记录及来源权限', () => {
    for (const patch of [{ database: '' }, { database: undefined }, { objectCategory: undefined }, { objectCategory: 'function' }, { connectionId: '' }, { database: 'a\0b' }]) {
      const settings = { ...defaultSettings, tabs: [{ ...browser, ...patch }] };
      expect(() => validateCommand('settings.save', settings)).toThrow();
    }
    for (const field of ['sql', 'table', 'databaseContext', 'sourceBinding', 'fileSourceBinding', 'queryEditorHeight']) {
      expect(() => assertObjectBrowserTabs({ tabs: [{ ...browser, [field]: undefined }] })).toThrow();
      expect(() => validateCommand('settings.save', { ...defaultSettings, tabs: [{ ...browser, [field]: undefined }] })).toThrow();
    }
    expect(() => validateCommand('settings.save', { ...defaultSettings, tabs: [{ id: 'q', kind: 'query', title: '查询', connectionId: 'c', objectCategory: 'table' }] })).toThrow();
    expect(() => assertObjectBrowserTabs({ tabs: [{ ...browser, fileBinding: '不得保存的来源' }] })).toThrow('其它字段');
  });

  it('原始分类和库必须是自有数据属性，不能从原型或访问器提升定位', () => {
    for (const field of ['database', 'connectionId', 'objectCategory']) {
      const own: Record<string, unknown> = { ...browser }, value = own[field]; delete own[field];
      expect(() => assertObjectBrowserTabs({ tabs: [Object.assign(Object.create({ [field]: value }), own)] })).toThrow('自有');
      Object.defineProperty(own, field, { enumerable: true, get: () => value });
      expect(() => assertObjectBrowserTabs({ tabs: [own] })).toThrow('数据属性');
    }
  });

  it('读取只过滤损坏的对象浏览项，不改动旧标签或原列表', () => {
    const query = { id: 'q', kind: 'query', sql: '待保存正文' }, table = { id: 't', kind: 'table', table: '原表' };
    const good = { ...browser }, bad = { ...browser, database: '' }, input = [query, bad, table, good];
    const restored = readObjectBrowserTabs(input);
    expect(restored).toEqual([query, table, good]);
    expect(restored[0]).toBe(query); expect(restored[2]).toBe(good); expect(input).toEqual([query, bad, table, good]);
  });
});
