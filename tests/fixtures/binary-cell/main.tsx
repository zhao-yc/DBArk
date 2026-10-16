import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { TableTab } from '../../../src/renderer/components/TableTab';
import { ResultsGrid } from '../../../src/renderer/components/ResultsGrid';
import { useWorkspace, type WorkspaceTab } from '../../../src/renderer/store';
import type { DataRow, TableInfo, TablePage } from '../../../src/shared/contracts';
import 'react-data-grid/lib/styles.css';
import '../../../src/renderer/styles.css';

const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 3; canvas.getContext('2d')!.fillRect(0, 0, 2, 3);
const format = new URLSearchParams(location.search).get('format') ?? 'png';
const binary = (value: string) => ({ type: 'binary' as const, base64: btoa(value) });
const data: DataRow[] = [{ id: '9007199254740993123', payload: binary('\xe4\xb8\xad\xf0\x9f\x98\x80\x00'), picture: { type: 'binary', base64: canvas.toDataURL('image/' + format).split(',')[1] }, nil: null, empty: binary(''), medium: binary('a'.repeat(140000)), large: binary('a'.repeat(2 * 1024 * 1024 + 1)), script: binary('<svg onload="window.__binaryExecuted=true"><image href="https://example.invalid/x"/></svg>') }];
const columns = Object.keys(data[0]).map(name => ({ name, type: name === 'id' ? 'BIGINT' : 'LONGBLOB', generated: false, nullable: true, defaultValue: null, extra: '', comment: '' }));
const info: TableInfo = { database: '离线', name: '二进制表', engine: 'InnoDB', objectKind: 'table', primaryKey: ['id'], editableKey: ['id'], columns, indexes: [], foreignKeys: [], ddl: '' };
const resultColumns = columns.map(column => ({ key: column.name, name: column.name, type: column.type }));
const calls: string[] = [];
/** 只替代输入数据与桥接返回；表格、记录编辑、类型校验及图片展示均使用生产模块。 */
Object.defineProperty(window, 'dbark', { value: { invoke: async (command: string, input: { page?: number; pageSize?: number }) => {
  calls.push(command);
  if (command === 'connections.open') return {};
  if (command === 'metadata.table') return structuredClone(info);
  if (command === 'table.preferences.get') return null;
  if (command === 'table.page') return { rows: structuredClone(data), columns: resultColumns, hasMore: false, page: input.page ?? 1, pageSize: input.pageSize ?? 100 } satisfies TablePage;
  if (command === 'settings.save') return undefined;
  throw new Error('离线夹具拒绝未声明命令：' + command);
}, onTask: () => () => {} } });
Object.defineProperty(window, '__binaryCalls', { value: calls });
useWorkspace.setState({ ready: true, connections: [{ id: 'offline', name: '二进制离线夹具', host: '127.0.0.1', port: 1, user: 'offline', group: '', color: '#123456', dialect: 'mysql' }] });
const tab: WorkspaceTab = { id: 'binary-table', kind: 'table', title: '二进制表', connectionId: 'offline', database: '离线', table: '二进制表' };
/** 结构/连接通知和结果刷新提供真实组件失效场景，不直接操作编辑器内部状态。 */
function Fixture() { const [mode, setMode] = useState('table'), [refresh, setRefresh] = useState(0), [rows, setRows] = useState(data); return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><nav><button onClick={() => setMode('table')}>表数据</button><button onClick={() => setMode('query')}>SQL只读结果</button><button onClick={() => setRefresh(value => value + 1)}>夹具结构变化</button><button onClick={() => useWorkspace.getState().invalidateConnection('offline')}>夹具连接变化</button><button onClick={() => setRows(structuredClone(data))}>夹具结果刷新</button></nav><div style={{ flex: 1, minHeight: 0 }}>{mode === 'table' ? <TableTab tab={tab} refreshVersion={refresh} refreshAutomatically={false} onDesign={() => {}} onTransfer={() => {}} onColumnPatches={() => {}} onIndexPatches={() => {}} onForeignKeyPatches={() => {}} onTableRename={() => {}} onTableAutoIncrement={() => {}} onTableComment={() => {}} onTableDefaultEncoding={() => {}}/> : <ResultsGrid columns={resultColumns} rows={rows}/>}</div></div>; }
createRoot(document.getElementById('root')!).render(<Fixture/>);
