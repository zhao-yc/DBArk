import { createRoot } from 'react-dom/client';
import { ExplainPlanView } from '../../src/renderer/components/ExplainPlanView';
import { parseExplainPlan } from '../../src/shared/explain';
import type { QueryOutcome } from '../../src/shared/contracts';
import mysql from '../fixtures/explain/mysql84.json';
import maria from '../fixtures/explain/maria1011.json';
import '../../src/renderer/styles.css';

type FixtureWindow = Window & { explainFixture: { render(kind: string): void; textRequests: number } };
const fixtureWindow = window as unknown as FixtureWindow;
const root = createRoot(document.getElementById('root')!);
/** 仅用于离线组件验收，不替换应用 IPC，也不声称连接过数据库。 */
function render(kind: string) {
  const dialect = kind === 'maria' ? 'mariadb' : 'mysql';
  const raw = kind === 'long' ? '{"query_block":{"constructor":{"attached_condition":' + JSON.stringify('中文长条件🚢'.repeat(6000)) + '},"table":{"table_name":"长表名","access_type":"ALL","rows_examined_per_scan":0}}}' : kind === 'invalid' ? '{未知的计划}' : JSON.stringify(kind === 'maria' ? maria : mysql);
  const plan = parseExplainPlan(raw, dialect, dialect === 'mariadb' ? '10.11.0 静态样本' : '8.4.0 静态样本');
  const outcome: QueryOutcome = { explain: plan, elapsedMs: 1, results: [{ columns: [{ key: 'c0', name: 'EXPLAIN', type: 'JSON' }], rows: [{ c0: raw }], statement: 'EXPLAIN FORMAT=JSON SELECT ...', truncated: false, elapsedMs: 1 }] };
  root.render(<ExplainPlanView key={kind} outcome={outcome} busy={false} onText={() => { fixtureWindow.explainFixture.textRequests++; }}/>);
}
fixtureWindow.explainFixture = { render, textRequests: 0 }; render('mysql');
