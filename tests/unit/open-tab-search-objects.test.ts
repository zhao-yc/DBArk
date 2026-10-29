import { expect, it } from 'vitest';
import { OpenTabSearchRegistry, filterOpenTabs } from '../../src/renderer/openTabSearch';
import type { OpenTabSearchTab } from '../../src/renderer/openTabSearch';
import type { ObjectCategory } from '../../src/shared/objectBrowser';

const connections = [{ id: 'c1', name: '开发连接' }, { id: 'c2', name: '另一连接' }];
const objectTab = (objectCategory: ObjectCategory = 'table'): OpenTabSearchTab => ({ id: 'objects', kind: 'objects', title: '开发库对象', connectionId: 'c1', database: '开发.库`/🚢', objectCategory });

it('查找现有标签兼容对象浏览并保持查询、表和对象页的原顺序与准确ID', () => {
  const tabs: OpenTabSearchTab[] = [
    { id: 'q', kind: 'query', title: '未保存查询', connectionId: 'c2', sql: '不应索引的原文' },
    objectTab('routine'),
    { id: 't', kind: 'table', title: '同名表', connectionId: 'c1', database: '开发.库`/🚢', table: '同名表' }
  ];
  const registry = new OpenTabSearchRegistry(), entries = registry.snapshot(tabs, connections);
  expect(entries.map(entry => entry.id)).toEqual(['q', 'objects', 't']);
  expect(entries[1]).toMatchObject({ kind: 'objects', objectCategory: 'routine', databaseContext: { state: 'known', database: '开发.库`/🚢' } });
  expect(entries[1].kindCaption).toContain('对象浏览'); expect(entries[1].kindCaption).toContain('存储过程／函数');
  expect(filterOpenTabs(entries, '开发连接 objects routine').map(entry => entry.id)).toEqual(['objects']);
  expect(filterOpenTabs(entries, '同名表 table').map(entry => entry.id)).toEqual(['t']);
  expect(registry.resolveActivation(entries[1], tabs, connections)).toBe('objects');
  expect(JSON.stringify(entries)).not.toContain('不应索引的原文');
});

it('对象页的搜索元数据不读取SQL、会话、记录、保存来源或连接默认库', () => {
  let reads = 0;
  const tab = objectTab('view'), profile = { id: 'c1', name: '开发连接' };
  for (const key of ['sql', 'sessionId', 'rows', 'sourceBinding', 'fileSourceBinding', 'databaseContext']) Object.defineProperty(tab, key, { enumerable: true, get() { reads++; throw Error('不得读取对象页无关字段'); } });
  for (const key of ['database', 'password', 'ssh', 'tls']) Object.defineProperty(profile, key, { enumerable: true, get() { reads++; throw Error('不得读取连接配置'); } });
  const registry = new OpenTabSearchRegistry(), [entry] = registry.snapshot([tab], [profile]);
  expect(entry.databaseContext).toEqual({ state: 'known', database: tab.database });
  expect(registry.resolveActivation(entry, [tab], [profile])).toBe('objects'); expect(reads).toBe(0);
  for (const key of ['sql', 'sessionId', 'rows', 'sourceBinding', 'fileSourceBinding']) expect(entry).not.toHaveProperty(key);
});

it('分类A到B再回A、切库及同ID换类型均永久撤销原搜索点击', () => {
  const registry = new OpenTabSearchRegistry(), tab = objectTab(), [original] = registry.snapshot([tab], connections);
  tab.objectCategory = 'view'; registry.observe([tab]); tab.objectCategory = 'table'; registry.observe([tab]);
  expect(registry.resolveActivation(original, [tab], connections)).toBeUndefined();
  const [afterCategory] = registry.snapshot([tab], connections); tab.database = '另一库'; registry.observe([tab]); tab.database = '开发.库`/🚢'; registry.observe([tab]);
  expect(registry.resolveActivation(afterCategory, [tab], connections)).toBeUndefined();
  const [beforeKind] = registry.snapshot([tab], connections);
  registry.observe([{ id: tab.id, kind: 'query', title: tab.title, connectionId: tab.connectionId, database: tab.database, sql: '' }]);
  registry.observe([tab]); expect(registry.resolveActivation(beforeKind, [tab], connections)).toBeUndefined();
});

it('缺库、坏分类及分类访问器拒绝整组，不返回部分列表或复活旧条目', () => {
  const registry = new OpenTabSearchRegistry(), good = objectTab(), [original] = registry.snapshot([good], connections);
  for (const patch of [{ database: undefined }, { database: '' }, { objectCategory: undefined }, { objectCategory: 'unknown' }]) {
    expect(() => registry.snapshot([good, { ...objectTab(), id: 'bad', ...patch } as OpenTabSearchTab], connections)).toThrow('元数据无效');
    expect(registry.resolveActivation(original, [good], connections)).toBeUndefined();
  }
  let reads = 0; const invalid = objectTab(); Object.defineProperty(invalid, 'objectCategory', { enumerable: true, get() { reads++; return 'table'; } });
  expect(() => registry.snapshot([invalid], connections)).toThrow('元数据无效'); expect(reads).toBe(0);
});
