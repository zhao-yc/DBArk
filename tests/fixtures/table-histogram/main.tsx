import { createRoot } from 'react-dom/client';
import { TableTab } from '../../../src/renderer/components/TableTab';
import { useWorkspace, type WorkspaceTab } from '../../../src/renderer/store';
import { tableHistogramFixtureSource as source, tableHistogramFixtureOutput } from '../../helpers/tableHistogramFixture';
import type { TableStatisticsInput } from '../../../src/shared/tableStatistics';
import 'react-data-grid/lib/styles.css';
import '../../../src/renderer/styles.css';

const calls: { command: string; input: Record<string, unknown> }[] = [], denied: string[] = [];
let hold = false, reading: { input: TableStatisticsInput; resolve(value: ReturnType<typeof tableHistogramFixtureOutput>): void } | undefined, cancel: (() => void) | undefined;
/** 只有本例合成IPC；产品TableTab、真实菜单、统计窗口、合同校验和图全部参与。 */
Object.defineProperty(window, 'dbark', { value: { invoke: async (command: string, input: Record<string, unknown>) => {
  calls.push({ command, input: structuredClone(input) });
  if (command === 'metadata.table' && input.connectionId === 'offline-histogram' && input.database === source.database && input.table === source.name) return structuredClone(source);
  if (command === 'table.page' && input.connectionId === 'offline-histogram' && input.database === source.database && input.table === source.name) return { rows: [{ id: '1', '金额<script>': '0.' + '0'.repeat(29) + '1', floating: 1, all_null: null, note: '只显示一行，合成统计为百万行' }], columns: source.columns.map(column => ({ key: column.name, name: column.name, type: column.type })), page: 1, pageSize: 50, hasMore: false };
  if (command === 'connections.open') return {}; if (command === 'table.preferences.get') return null; if (command === 'settings.save') return;
  if (command === 'table.statistics') { const request = input as unknown as TableStatisticsInput; if (!hold) return tableHistogramFixtureOutput(request); return new Promise<ReturnType<typeof tableHistogramFixtureOutput>>(resolve => { reading = { input: structuredClone(request), resolve }; }); }
  if (command === 'query.cancel' && hold && reading?.input.taskId === input.taskId) return new Promise<void>(resolve => { cancel = resolve; });
  denied.push(command); throw Error('分布组件拒绝未声明命令：' + command);
}, onTask: () => () => {} } });
const tab: WorkspaceTab = { id: 'offline-histogram-tab', kind: 'table', connectionId: 'offline-histogram', database: source.database, table: source.name, title: source.name };
const theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme;
useWorkspace.setState({ ready: true, connections: [{ id: 'offline-histogram', name: '合成统计工作区', host: '127.0.0.1', port: 1, user: 'offline', group: '', color: '#123456', dialect: 'mysql' }], settings: { ...useWorkspace.getState().settings, theme, tabs: [tab], activeTabId: tab.id } });
Object.defineProperty(window, '__histogramEvidence', { value: () => ({ calls: structuredClone(calls), denied: [...denied], tabs: structuredClone(useWorkspace.getState().settings.tabs), jobs: structuredClone(useWorkspace.getState().activeJobs), dirty: structuredClone(useWorkspace.getState().dirtyTabs), waitingRead: !!reading, waitingCancel: !!cancel }) });
/** 仅控制准确合成服务的两个独立Promise，不替换产品按钮、取消或生命周期处理器。 */
Object.defineProperty(window, '__histogramControl', { value: { hold() { if (hold || reading || cancel) throw Error('本轮合成读取尚未完成'); hold = true; }, reply() { if (!reading) throw Error('没有合成在途请求'); reading.resolve(tableHistogramFixtureOutput(reading.input)); }, ack() { if (!cancel) throw Error('没有准确合成取消请求'); cancel(); cancel = undefined; reading = undefined; hold = false; } } });
createRoot(document.getElementById('root')!).render(<div style={{ height: '100vh' }}><TableTab tab={tab} refreshAutomatically={false} onDesign={() => {}} onTransfer={() => {}} onColumnPatches={() => {}} onIndexPatches={() => {}} onForeignKeyPatches={() => {}} onTableRename={() => {}} onTableAutoIncrement={() => {}} onTableComment={() => {}} onTableDefaultEncoding={() => {}}/></div>);
