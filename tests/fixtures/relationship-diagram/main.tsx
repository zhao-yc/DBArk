import { createRoot } from 'react-dom/client';
import { TableTab } from '../../../src/renderer/components/TableTab';
import { useWorkspace, type WorkspaceTab } from '../../../src/renderer/store';
import { relationshipFixture } from '../../helpers/relationshipDiagramFixture';
import 'react-data-grid/lib/styles.css';
import '../../../src/renderer/styles.css';

const tables = relationshipFixture(), child = tables[0], calls: { command: string; input: Record<string, unknown> }[] = [], denied: string[] = [];
/** 仅用合成目录替代IPC输入，真实TableTab、菜单、关系图、选择及任务生命周期全部参与。 */
Object.defineProperty(window, 'dbark', { value: { invoke: async (command: string, input: Record<string, unknown>) => {
  calls.push({ command, input: structuredClone(input) });
  if (command === 'metadata.table' && input.connectionId === 'offline-diagram' && input.database === child.database) { const table = tables.find(table => table.name === input.table); if (table) return structuredClone(table); }
  if (command === 'metadata.objects' && input.connectionId === 'offline-diagram' && input.database === child.database) return [...tables.map(table => ({ name: table.name, kind: 'table' })), { name: 'some_view', kind: 'view' }];
  if (command === 'table.page' && input.connectionId === 'offline-diagram' && input.database === child.database && input.table === child.name) return { rows: [{ id: '1', tenant: '8', parent_id: '2', manager_id: null, '备注<script>': '本例' }], columns: child.columns.map(column => ({ key: column.name, name: column.name, type: column.type })), page: 1, pageSize: 50, hasMore: false };
  if (command === 'connections.open') return {}; if (command === 'table.preferences.get') return null; if (command === 'settings.save') return;
  denied.push(command); throw Error('关系图离线组件拒绝未声明命令：' + command);
}, onTask: () => () => {} } });
const tab: WorkspaceTab = { id: 'offline-diagram-tab', kind: 'table', connectionId: 'offline-diagram', database: child.database, table: child.name, title: child.name };
const theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme;
useWorkspace.setState({ ready: true, connections: [{ id: 'offline-diagram', name: '合成关系目录', host: '127.0.0.1', port: 1, user: 'offline', group: '', color: '#123456', dialect: 'mysql' }], settings: { ...useWorkspace.getState().settings, theme, tabs: [tab], activeTabId: tab.id } });
Object.defineProperty(window, '__relationshipEvidence', { value: () => ({ calls: structuredClone(calls), denied: [...denied], tabs: structuredClone(useWorkspace.getState().settings.tabs), dirty: structuredClone(useWorkspace.getState().dirtyTabs), jobs: structuredClone(useWorkspace.getState().activeJobs) }) });
createRoot(document.getElementById('root')!).render(<div style={{ height: '100vh' }}><TableTab tab={tab} refreshAutomatically={false} onDesign={() => {}} onTransfer={() => {}} onColumnPatches={() => {}} onIndexPatches={() => {}} onForeignKeyPatches={() => {}} onTableRename={() => {}} onTableAutoIncrement={() => {}} onTableComment={() => {}} onTableDefaultEncoding={() => {}}/></div>);
