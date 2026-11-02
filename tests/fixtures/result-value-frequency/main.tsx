import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CellValue, QueryResult } from '../../../src/shared/contracts';
import { QueryResultFilter, type QueryResultFilterGroup } from '../../../src/renderer/queryResultFilter';
import { QueryResultFilterPanel } from '../../../src/renderer/components/QueryResultFilterPanel';
import { queryResultFilterZh as filterText } from '../../../src/renderer/locales/queryResultFilter.zh-CN';
import '../../../src/renderer/styles.css';
import '../../../src/renderer/queryResultFilter.css';

type Kind = 'mysql' | 'sqlite';
const denied: string[] = [], proposals: { kind: Kind; indices: number[]; expression: QueryResultFilterGroup }[] = [];
Object.defineProperty(window, 'dbark', { value: { invoke: async (command: string) => { denied.push(command); throw Error('组件专项不提供真实 IPC'); } } });
/** 明确合成已返回结果；原过滤器、父面板与选择器全部使用产品实现，不伪称真实驱动。 */
function source(kind: Kind): QueryResult {
  const values: CellValue[] = [...Array.from({ length: 55 }, (_, i) => 'rare' + i), ...Array(100).fill('hot'), ...Array(9).fill('warm'), null, null, '', 'NULL'];
  const codes: string[] = values.map(value => value === null ? 'in' : 'it');
  if (kind === 'sqlite') { values.push('2', '2', '2', '2', '2', '2', { type: 'binary', base64: 'AP8=' }); codes.push('ii', 'ii', 'ir', 'it', 'it', 'it', 'ib'); }
  return { columns: [{ key: 'id', name: '编号', type: kind === 'sqlite' ? 'SQLITE' : 'BIGINT' }, { key: 'v', name: '分类', type: kind === 'sqlite' ? 'SQLITE' : 'VARCHAR' }], rows: values.map((v, i) => ({ id: String(9007199254740993n + BigInt(i)), v })), ...(kind === 'sqlite' ? { sqliteStorage: { version: 1, rows: codes } } : {}), statement: '仅合成来源，不得重新执行', elapsedMs: 1, truncated: true };
}
/** 宿主只提供打开与接纳入口；原条件保持到真正点击外层应用。 */
function Workspace({ kind }: { kind: Kind }) {
  const [state] = useState(() => { const result = source(kind), filter = new QueryResultFilter(), binding = filter.bind(result, [])!; return { result, saved: JSON.stringify(result), filter, binding, initial: filter.applyExpression(binding, filter.view(binding)!, { mode: 'AND', children: [{ column: 'v', operator: 'eq', value: 'rare0', ...(kind === 'sqlite' ? { sqliteType: 'text' as const } : {}) }] }) }; });
  const [view, setView] = useState(state.initial), [open, setOpen] = useState(false);
  Object.defineProperty(window, '__resultFrequencyEvidence', { configurable: true, value: () => structuredClone({ kind, indices: view.sourceIndices, proposals, denied, sourceUnchanged: JSON.stringify(state.result) === state.saved }) });
  return <section><p>当前生效行数：{view.sourceIndices.length}</p><button onClick={() => setOpen(true)}>{filterText.open}</button>{open && <QueryResultFilterPanel binding={state.binding} initial={view} isCurrent={() => true} onClose={() => setOpen(false)} onApply={expression => { const next = state.filter.applyExpression(state.binding, view, expression); proposals.push({ kind, indices: [...next.sourceIndices], expression: structuredClone(expression) }); setView(next); setOpen(false); }}/>}</section>;
}
/** 真实主题和来源切换仅为测试入口，不暴露可改变产品业务状态的观察端口。 */
function Fixture() {
  const [kind, setKind] = useState<Kind>('mysql'), [light, setLight] = useState(false);
  return <main style={{ padding: 16 }}><h1>已返回结果次数排序</h1><label>测试结果来源<select aria-label="测试结果来源" value={kind} onChange={event => setKind(event.target.value as Kind)}><option value="mysql">MySQL 合成结果</option><option value="sqlite">SQLite 合成结果</option></select></label><button onClick={() => { setLight(!light); document.documentElement.dataset.theme = light ? 'dark' : 'light'; }}>切换主题</button><Workspace key={kind} kind={kind}/></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
