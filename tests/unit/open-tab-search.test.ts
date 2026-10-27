import { describe, expect, it } from 'vitest';
import type { ConnectionProfile } from '../../src/shared/contracts';
import { OpenTabSearchRegistry, filterOpenTabs, openTabSearchLimits as limits, openTabSearchMessages as text, type OpenTabSearchTab } from '../../src/renderer/openTabSearch';
import { queryContextZh } from '../../src/renderer/locales/queryContext.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

const connections = [{ id: 'c1', name: '研发连接' }, { id: 'c2', name: '生产连接' }];
function query(overrides: Partial<OpenTabSearchTab> = {}): OpenTabSearchTab { return { id: 'q1', kind: 'query', title: '订单 SQL', connectionId: 'c1', databaseContext: { state: 'known', database: '研发库' }, sql: '不可索引的秘密正文', ...overrides }; }
function table(overrides: Partial<OpenTabSearchTab> = {}): OpenTabSearchTab { return { id: 't1', kind: 'table', title: '订单', connectionId: 'c1', database: '研发库', table: '订单`记录', ...overrides }; }
const ids = (value: ReturnType<OpenTabSearchRegistry['snapshot']>) => value.map(entry => entry.id);

describe('已打开标签的纯本地元数据查找', () => {
  it('同名跨连接跨库准确区分，AND token含Unicode与类型，始终保strip顺序', () => {
    const registry = new OpenTabSearchRegistry(), tabs = [query(), table({ id: 't2', connectionId: 'c2', database: '生产库' }), table(), query({ id: 'q2', title: '订单 SQL', connectionId: 'c2', databaseContext: { state: 'known', database: '生产库' } })];
    const entries = registry.snapshot(tabs, connections); expect(ids(entries)).toEqual(['q1', 't2', 't1', 'q2']);
    expect(ids(filterOpenTabs(entries, '订单 生产连接 生产库 table'))).toEqual(['t2']);
    expect(ids(filterOpenTabs(entries, 'SQL 生产库 query'))).toEqual(['q2']);
    expect(ids(filterOpenTabs(entries, '订单 研发连接'))).toEqual(['q1', 't1']);
    expect(ids(filterOpenTabs(entries, ' \t订单`记录 \n 研发库 表 '))).toEqual(['t1']);
    expect(ids(filterOpenTabs(entries, '生产连接 研发库'))).toEqual([]); expect(ids(filterOpenTabs(entries, ''))).toEqual(ids(entries));
    expect(registry.resolveActivation(entries[1], tabs, connections)).toBe('t2'); expect(registry.resolveActivation(entries[2], tabs, connections)).toBe('t1');
  });

  it('已知库、已知null、未知和legacy分别呈现，绝不以profile默认库假充上下文', () => {
    let secretReads = 0;
    const profiles = connections.map(connection => Object.defineProperty({ ...connection }, 'database', { get() { secretReads++; throw Error('不可借默认库'); } })) as ConnectionProfile[];
    const known = query(), none = query({ id: 'none', database: '不能回退', databaseContext: { state: 'known', database: null } }), unknown = query({ id: 'unknown', database: '不能回退', databaseContext: { state: 'unknown' } });
    const legacy = query({ id: 'legacy', databaseContext: undefined, database: '旧库' }), missing = query({ id: 'missing', databaseContext: undefined, database: undefined });
    const entries = new OpenTabSearchRegistry().snapshot([known, none, unknown, legacy, missing], profiles);
    expect(entries.map(entry => entry.databaseContext)).toEqual([{ state: 'known', database: '研发库' }, { state: 'known', database: null }, { state: 'unknown' }, { state: 'legacy', database: '旧库' }, { state: 'legacy' }]);
    expect(entries[1].databaseCaption).toBe(queryContextZh.none); expect(entries[2].databaseCaption).toBe(queryContextZh.unknown); expect(entries[3].databaseCaption).toContain(queryContextZh.legacy); expect(entries[4].databaseCaption).toContain('未记录');
    expect(filterOpenTabs(entries, '不能回退')).toEqual([]); expect(secretReads).toBe(0);
    const inheritedLegacy = query(); Object.defineProperty(inheritedLegacy, 'database', { get() { secretReads++; throw Error('显式上下文忽略旧字段'); } });
    expect(new OpenTabSearchRegistry().snapshot([inheritedLegacy], profiles)[0].databaseContext).toEqual({ state: 'known', database: '研发库' }); expect(secretReads).toBe(0);
    const empty = new OpenTabSearchRegistry().snapshot([query({ databaseContext: undefined, database: '' })], profiles)[0]; expect(empty.databaseCaption).toContain('未记录'); expect(empty.databaseContext).toEqual({ state: 'legacy', database: '' }); expect(secretReads).toBe(0);
  });

  it('SQL/结果/会话/秘密与保存digest/revision getter零读取，发布项仅含有界元数据', () => {
    let reads = 0; const tab = query(), profile = { id: 'c1', name: '研发连接' } as ConnectionProfile;
    for (const key of ['sql', 'results', 'sessionId']) Object.defineProperty(tab, key, { enumerable: true, get() { reads++; throw Error('不允许读取正文或会话'); } });
    for (const key of ['password', 'ssh', 'tls', 'host', 'user', 'database']) Object.defineProperty(profile, key, { enumerable: true, get() { reads++; throw Error('不允许读取私密配置'); } });
    const binding = { id: 'saved-query' } as any; Object.defineProperty(binding, 'digest', { get() { reads++; throw Error('不可读取摘要'); } });
    tab.sourceBinding = binding; const registry = new OpenTabSearchRegistry(), entries = registry.snapshot([tab], [profile]);
    expect(registry.resolveActivation(entries[0], [tab], [profile])).toBe(tab.id); expect(filterOpenTabs(entries, '研发 SQL')).toHaveLength(1); expect(reads).toBe(0);
    for (const key of ['sql', 'results', 'sessionId', 'sourceBinding', 'password', 'host', 'ssh', 'tls']) expect(entries[0]).not.toHaveProperty(key);
    expect(JSON.stringify(entries)).not.toContain('不可索引的秘密正文');
    const fileTab = query({ sourceBinding: undefined }); const file = { id: 'file-id' } as any; Object.defineProperty(file, 'revision', { get() { reads++; throw Error('不可读取保存修订'); } }); fileTab.fileSourceBinding = file;
    const fileEntry = registry.snapshot([fileTab], [profile])[0]; expect(registry.resolveActivation(fileEntry, [fileTab], [profile])).toBe(fileTab.id); expect(reads).toBe(0);
  });

  it('连接缺失明确显示已删除，不借另一个同名连接或第一个profile回退', () => {
    const tabs = [query({ connectionId: 'missing' })], registry = new OpenTabSearchRegistry(), [entry] = registry.snapshot(tabs, connections);
    expect(entry.connectionCaption).toBe(zh.common.connectionDeleted); expect(filterOpenTabs([entry], '研发连接')).toEqual([]); expect(registry.resolveActivation(entry, tabs, connections)).toBe('q1');
  });
});

describe('准确现有标签身份与不可复活租约', () => {
  it('关闭再加入原对象不能复活原click，同名新ID不作为fallback', () => {
    const original = query(), registry = new OpenTabSearchRegistry(), [old] = registry.snapshot([original], connections);
    registry.observe([]); registry.observe([original]); expect(registry.resolveActivation(old, [original], connections)).toBeUndefined();
    const [fresh] = registry.snapshot([original], connections); expect(fresh.token).not.toBe(old.token); expect(registry.resolveActivation(fresh, [original], connections)).toBe('q1');
    expect(registry.resolveActivation(fresh, [query({ id: 'another' })], connections)).toBeUndefined();
  });

  it.each(['connection', 'known', 'null', 'unknown', 'legacy', 'table', 'kind', 'source', 'file'] as const)('%s目标A→B→A后旧token永久失效', field => {
    const original = field === 'table' ? table() : query(), registry = new OpenTabSearchRegistry(), [old] = registry.snapshot([original], connections);
    let changed: OpenTabSearchTab;
    if (field === 'connection') changed = { ...original, connectionId: 'c2' };
    else if (field === 'known') changed = { ...original, databaseContext: { state: 'known', database: '另一库' } };
    else if (field === 'null') changed = { ...original, databaseContext: { state: 'known', database: null } };
    else if (field === 'unknown') changed = { ...original, databaseContext: { state: 'unknown' } };
    else if (field === 'legacy') changed = { ...original, databaseContext: undefined, database: '旧库' };
    else if (field === 'table') changed = { ...original, table: '另一表' };
    else if (field === 'kind') changed = { ...original, kind: 'table', database: '研发库', table: '订单' };
    else if (field === 'source') changed = { ...original, sourceBinding: { id: 'saved', digest: 'a'.repeat(64), context: { state: 'known', database: null } } };
    else changed = { ...original, fileSourceBinding: { id: 'file-id', revision: 1 } };
    registry.observe([changed]); registry.observe([original]); expect(registry.resolveActivation(old, [original], connections)).toBeUndefined();
    expect(registry.snapshot([original], connections)[0].token).not.toBe(old.token);
  });

  it('同真实doc的SQL/标题编辑及保存摘要/修订只更新caption，不废弃原scope token', () => {
    const original = query({ sourceBinding: { id: 'saved', digest: 'a'.repeat(64), context: { state: 'known', database: null } } }), registry = new OpenTabSearchRegistry(), [old] = registry.snapshot([original], connections);
    let reads = 0; const edited = { ...original, sourceBinding: { ...original.sourceBinding!, digest: 'b'.repeat(64) } }; Object.defineProperty(edited, 'sql', { get() { reads++; throw Error('不读新SQL'); } });
    registry.observe([edited]); expect(registry.resolveActivation(old, [edited], connections)).toBe('q1'); expect(registry.snapshot([edited], connections)[0].token).toBe(old.token); expect(reads).toBe(0);
    const renamed = { ...original, title: '另一个标题' }; registry.observe([renamed]); expect(registry.resolveActivation(old, [renamed], connections)).toBeUndefined();
    const [fresh] = registry.snapshot([renamed], connections); expect(fresh.token).toBe(old.token); expect(registry.resolveActivation(fresh, [renamed], connections)).toBe('q1');
    const file = query({ fileSourceBinding: { id: 'same-file', revision: 1 } }), [fileEntry] = registry.snapshot([file], connections); const saved = { ...file, fileSourceBinding: { id: 'same-file', revision: 2 } }; expect(registry.resolveActivation(fileEntry, [saved], connections)).toBe('q1');
  });

  it.each(['saved', 'file', 'tableDatabase', 'legacyDatabase'] as const)('同ID真实%s换绑后即使恢复原对象，旧click不能复活', source => {
    const original = source === 'tableDatabase' ? table() : source === 'legacyDatabase' ? query({ databaseContext: undefined, database: '旧库' }) : source === 'file' ? query({ fileSourceBinding: { id: 'file-A', revision: 1 } }) : query({ sourceBinding: { id: 'saved-A', digest: 'a'.repeat(64), context: { state: 'known', database: null } } });
    const registry = new OpenTabSearchRegistry(), [old] = registry.snapshot([original], connections);
    const changed = source === 'tableDatabase' || source === 'legacyDatabase' ? { ...original, database: '另一库' } : source === 'file' ? { ...original, fileSourceBinding: { id: 'file-B', revision: 1 } } : { ...original, sourceBinding: { ...original.sourceBinding!, id: 'saved-B' } };
    registry.observe([changed]); registry.observe([original]); expect(registry.resolveActivation(old, [original], connections)).toBeUndefined(); expect(registry.snapshot([original], connections)[0].token).not.toBe(old.token);
  });

  it('连接标题变化只更新caption，旧可见条目拒绝，新条目仍绑定同一真实标签', () => {
    const tabs = [query()], registry = new OpenTabSearchRegistry(), [old] = registry.snapshot(tabs, connections), renamed = [{ id: 'c1', name: '改名连接' }];
    expect(registry.resolveActivation(old, tabs, renamed)).toBeUndefined(); const [fresh] = registry.snapshot(tabs, renamed); expect(fresh.token).toBe(old.token); expect(fresh.connectionCaption).toBe('改名连接'); expect(registry.resolveActivation(fresh, tabs, renamed)).toBe('q1');
  });

  it('dispose后新生命周期可重建，但任何原token都不能重新获得激活许可', () => {
    const tabs = [query()], registry = new OpenTabSearchRegistry(), [old] = registry.snapshot(tabs, connections); registry.dispose(); expect(registry.resolveActivation(old, tabs, connections)).toBeUndefined();
    const [fresh] = registry.snapshot(tabs, connections); expect(fresh.token).not.toBe(old.token); expect(registry.resolveActivation(fresh, tabs, connections)).toBe('q1');
  });

  it('原型同名ID/名字采用Map和自有字段，不能碰撞或污染原型', () => {
    const tabs = [query({ id: '__proto__', title: 'constructor', connectionId: '__proto__' }), table({ id: 'constructor', title: '__proto__' })], registry = new OpenTabSearchRegistry();
    const entries = registry.snapshot(tabs, [{ id: '__proto__', name: '特殊连接' }]); expect(ids(entries)).toEqual(['__proto__', 'constructor']); expect(registry.resolveActivation(entries[0], tabs, [{ id: '__proto__', name: '特殊连接' }])).toBe('__proto__'); expect(({} as any).polluted).toBeUndefined();
  });
});

describe('整组预算与异常状态', () => {
  it('100标签完整保序，101在读取元素前拒绝，恢复原组不复活旧token', () => {
    const registry = new OpenTabSearchRegistry(), tabs = Array.from({ length: 100 }, (_, index) => query({ id: 'q' + index })), old = registry.snapshot(tabs, connections); expect(old).toHaveLength(100); expect(ids(old)).toEqual(tabs.map(tab => tab.id));
    let reads = 0; const oversized = Array(101); Object.defineProperty(oversized, '0', { get() { reads++; return tabs[0]; } });
    expect(() => registry.observe(oversized)).toThrow(text.budget); expect(reads).toBe(0); expect(registry.resolveActivation(old[0], tabs, connections)).toBeUndefined(); expect(registry.snapshot(tabs, connections)).toHaveLength(100);
  });

  it.each(['duplicate', 'accessor', 'sparse', 'unknown'] as const)('坏组%s整组拒绝并撤销旧token，不悄漏部分标签', kind => {
    const registry = new OpenTabSearchRegistry(), original = query(), [old] = registry.snapshot([original], connections); let tabs: OpenTabSearchTab[] = [query()];
    if (kind === 'duplicate') tabs.push(query()); else if (kind === 'accessor') Object.defineProperty(tabs[0], 'title', { get() { throw Error('不能调用'); } }); else if (kind === 'sparse') delete tabs[0]; else Object.defineProperty(tabs[0], 'kind', { value: 'unknown', enumerable: true });
    expect(() => registry.observe(tabs)).toThrow(text.invalid); expect(registry.resolveActivation(old, [original], connections)).toBeUndefined();
  });

  it('搜索文本和token数有界，超限不返回看似完整的部分结果', () => {
    const entries = new OpenTabSearchRegistry().snapshot([query()], connections); expect(() => filterOpenTabs(entries, 'x'.repeat(limits.queryUnits + 1))).toThrow(text.budget); expect(() => filterOpenTabs(entries, Array(limits.queryTokens + 1).fill('a').join(' '))).toThrow(text.budget);
    expect(filterOpenTabs(entries, 'SQL sql SQL')).toHaveLength(1);
  });
});
