import { beforeEach, describe, expect, it, vi } from 'vitest';
const port = vi.hoisted(() => ({ state: undefined as any, invoke: vi.fn() }));
vi.mock('../../src/renderer/store', () => ({ useWorkspace: { getState: () => port.state } }));
vi.mock('../../src/renderer/lib', () => ({ invoke: port.invoke, errorMessage: (reason: Error) => reason.message }));
import { openSqliteObject, openSqliteSelect } from '../../src/renderer/sqliteNavigation';

beforeEach(() => { port.invoke.mockReset(); port.state = { connections: [{ id: '文件连接', dialect: 'sqlite' }], openTab: vi.fn(), notify: vi.fn(), connectionVersions: {}, settings: { activeTabId: '原查询' }, selection: undefined }; });
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
