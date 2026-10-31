import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { TableTab } from '../../../src/renderer/components/TableTab';
import { useWorkspace, type WorkspaceTab } from '../../../src/renderer/store';
import type { DataRow, TableInfo, TablePage } from '../../../src/shared/contracts';
import 'react-data-grid/lib/styles.css';
import '../../../src/renderer/styles.css';

const parameters = new URLSearchParams(location.search);
const readonly = parameters.has('readonly'), malicious = parameters.has('malicious');
const columns = ['id', 'note', 'other', 'binary', 'nil', 'generated'].map(name => ({ name, type: name === 'id' ? 'BIGINT' : name === 'binary' ? 'BLOB' : 'TEXT', nullable: true, defaultValue: null, extra: '', comment: '', generated: name === 'generated' }));
const info: TableInfo = { database: '离线夹具', name: '测试表', columns, indexes: [], foreignKeys: [], primaryKey: ['id'], editableKey: readonly ? [] : ['id'], engine: 'InnoDB', ddl: '', objectKind: 'table' };
const rows: DataRow[] = [{ id: '9007199254740993123', note: malicious ? 'a'.repeat(40000) + '!' : '😀old前old后old', other: 'OLD', binary: { type: 'binary' as const, base64: 'b2xk' }, nil: null, generated: 'old' }, { id: '9007199254740993124', note: '', other: '无匹配', nil: 'NULL' }];
const calls: string[] = [];
/** 只替代离线输入数据；实际 TableTab、草稿、网格、预览和 Web Worker 全部使用生产实现。 */
Object.defineProperty(window, 'dbark', { value: { invoke: async (command: string, input: { page?: number; pageSize?: number }) => {
  calls.push(command);
  if (command === 'metadata.table') return structuredClone(info);
  if (command === 'table.page') return { rows: structuredClone(rows), columns: columns.map(column => ({ key: column.name, name: column.name, type: column.type })), page: input.page ?? 1, pageSize: input.pageSize ?? 100, hasMore: true } satisfies TablePage;
  if (command === 'connections.open') return {};
  if (command === 'table.preferences.get') return null;
  if (command === 'settings.save') return undefined;
  throw new Error('离线夹具拒绝未声明命令：' + command);
}, onTask: () => () => {} } });
Object.defineProperty(window, '__pageFindCalls', { value: calls });
useWorkspace.setState({ ready: true, connections: [{ id: 'offline', name: '离线数据夹具', host: '127.0.0.1', port: 1, user: 'offline', group: '', color: '#123456', dialect: 'mysql' }] });
const tab: WorkspaceTab = { id: 'offline-table', kind: 'table', connectionId: 'offline', database: info.database, table: info.name, title: info.name };
// 原页夹具发布准确活动标签；不绕过生产菜单的工作区身份核验。
useWorkspace.setState({ settings: { ...useWorkspace.getState().settings, tabs: [tab], activeTabId: tab.id } });
/** 夹具提供外部结构刷新和连接版本变化，以验证正在查找及预览的生命周期。 */
function Fixture() {
  const [refresh, setRefresh] = useState(0);
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><div><button onClick={() => setRefresh(value => value + 1)}>夹具外部结构变化</button><button onClick={() => useWorkspace.getState().invalidateConnection('offline')}>夹具连接变化</button></div><div style={{ flex: 1, minHeight: 0 }}><TableTab tab={tab} refreshVersion={refresh} refreshAutomatically={false} onDesign={() => {}} onTransfer={() => {}} onColumnPatches={() => {}} onIndexPatches={() => {}} onForeignKeyPatches={() => {}} onTableRename={() => {}} onTableAutoIncrement={() => {}} onTableComment={() => {}} onTableDefaultEncoding={() => {}}/></div></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
