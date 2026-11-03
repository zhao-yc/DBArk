import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const port = vi.hoisted(() => ({ state: undefined as any, invoke: vi.fn(), listeners: new Set<() => void>() }));
vi.mock('../../src/renderer/store', () => ({ useWorkspace: { getState: () => port.state, subscribe: (listener: () => void) => { port.listeners.add(listener); return () => port.listeners.delete(listener); } } }));
vi.mock('../../src/renderer/lib', () => ({ invoke: port.invoke, errorMessage: (reason: Error) => reason.message, uid: () => '123e4567-e89b-42d3-a456-426614174000' }));
import { openSqliteObject, openSqliteSchemaScript, openSqliteSelect } from '../../src/renderer/sqliteNavigation';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { openNetworkSchemaScript, schemaScriptLabel } from '../../src/renderer/schemaScriptNavigation';

beforeEach(() => { port.invoke.mockReset(); vi.stubGlobal('document', { querySelector: () => null }); port.state = { connections: [{ id: '文件连接', dialect: 'sqlite' }], openTab: vi.fn(), notify: vi.fn(), connectionVersions: {}, settings: { activeTabId: '原查询', tabs: [] }, selection: undefined }; });
afterEach(() => vi.unstubAllGlobals());
describe('SQLite 表浏览与显式 SELECT 草稿分开导航', () => {
  it.each(['table', 'view'] as const)('打开%s只建立原只读表标签，不发送查询或创建事务会话', kind => {
    expect(openSqliteObject('文件连接', 'main', { name: '奇怪"表🚢', kind })).toBe(true);
    expect(port.state.openTab).toHaveBeenCalledExactlyOnceWith({ kind: 'table', connectionId: '文件连接', database: 'main', title: '奇怪"表🚢', table: '奇怪"表🚢' }); expect(port.invoke).not.toHaveBeenCalled();
  });
  it('显式生成 SELECT 才创建未执行的原查询草稿，标识符逐个双写引号', () => {
    openSqliteSelect('文件连接', 'main', { name: '奇怪"表🚢', kind: 'view' });
    expect(port.state.openTab).toHaveBeenCalledExactlyOnceWith({ kind: 'query', connectionId: '文件连接', database: 'main', databaseContext: { state: 'known', database: 'main' }, title: '奇怪"表🚢', sql: 'SELECT * FROM "main"."奇怪""表🚢" LIMIT 100;' }); expect(port.invoke).not.toHaveBeenCalled();
  });
  it('其他库上下文和网络连接不借用 main，生成 SELECT 也不为触发器伪造数据读取', () => {
    expect(openSqliteObject('文件连接', '原库foo', { name: '表', kind: 'table' })).toBe(true); openSqliteSelect('文件连接', '原库foo', { name: '表', kind: 'table' }); openSqliteSelect('文件连接', 'main', { name: '触发器', kind: 'trigger' });
    port.state.connections = [{ id: '网络连接', dialect: 'mysql' }]; expect(openSqliteObject('网络连接', 'main', { name: '表', kind: 'table' })).toBe(false); expect(port.state.openTab).not.toHaveBeenCalled(); expect(port.invoke).not.toHaveBeenCalled(); expect(port.state.notify).toHaveBeenCalledTimes(2);
  });
});

describe('SQLite 结构脚本草稿', () => {
  const source = { connectionId: '文件连接', database: 'main', table: '表', kind: 'table' } as const;
  const sql = 'BEGIN;\nCREATE TABLE 表(id);\nCOMMIT;\n';
  const open = () => openSqliteSchemaScript(source.connectionId, source.database, { name: source.table, kind: source.kind });

  it('仅请求准确对象结构，打开同连接的未执行查询草稿', async () => {
    port.invoke.mockResolvedValue({ source, sql });
    await open();
    expect(port.invoke).toHaveBeenCalledExactlyOnceWith('sqlite.schemaScript', source);
    expect(port.state.openTab).toHaveBeenCalledExactlyOnceWith({ kind: 'query', connectionId: source.connectionId, database: 'main', databaseContext: { state: 'known', database: 'main' }, title: '表 · ' + sqliteZh.structureScript, sql });
    expect(port.listeners.size).toBe(0);
  });

  it('切换标签又切回时撤销旧脚本，即使返回原对象', async () => {
    let reply!: (value: { source: typeof source; sql: string }) => void;
    port.invoke.mockReturnValue(new Promise(resolve => { reply = resolve; }));
    const pending = open();
    for (const activeTabId of ['另一个标签', '原查询']) {
      port.state.settings.activeTabId = activeTabId;
      for (const listener of port.listeners) listener();
    }
    reply({ source, sql });
    await pending;
    expect(port.state.openTab).not.toHaveBeenCalled();
    expect(port.listeners.size).toBe(0);
  });
});

it.each(['mysql', 'mariadb'])('%s 结构草稿保持原连接和默认库，拒绝另一个请求的脚本', async dialect => {
  const connectionId = '网络连接', database = '原库', name = '原视图', kind = 'view';
  const source = { connectionId, database, name, kind, taskId: '123e4567-e89b-42d3-a456-426614174000' };
  const sql = 'CREATE VIEW `原视图` AS SELECT 1;';
  port.state.connections = [{ id: connectionId, dialect }];
  port.invoke.mockResolvedValueOnce({ source: { ...source, taskId: '123e4567-e89b-42d3-a456-426614174001' }, sql }).mockResolvedValueOnce({ source, sql });
  await openNetworkSchemaScript(connectionId, database, { name, kind });
  expect(port.state.openTab).not.toHaveBeenCalled();
  await openNetworkSchemaScript(connectionId, database, { name, kind });
  expect(port.invoke.mock.calls).toEqual([['metadata.schemaScript', source], ['metadata.schemaScript', source]]);
  expect(port.state.openTab).toHaveBeenCalledExactlyOnceWith({ kind: 'query', connectionId, database, databaseContext: { state: 'known', database }, title: name + ' · ' + schemaScriptLabel, sql });
});
