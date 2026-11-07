import type { SqlSyntaxCheckView } from '../sqlSyntaxCheckController';
import { sqlSyntaxCheckZh, sqliteSyntaxCheckZh } from '../locales/sqlSyntaxCheck.zh-CN';
import '../sqlSyntaxCheck.css';

/** 问题列表不复制SQL正文；位置和跳转均由父层原模型围栏确认。 */
export function SqlSyntaxCheckPanel({ dialect, view, position, onSelect, onCancel, onClose, onRecheck }: {
  dialect?: 'sqlite'; view: SqlSyntaxCheckView; position(offset: number): { lineNumber: number; column: number };
  onSelect(index: number): void; onCancel(): void; onClose(): void; onRecheck(): void;
}) {
  const text = dialect === 'sqlite' ? sqliteSyntaxCheckZh : sqlSyntaxCheckZh;
  const result = view.result;
  return <section className="sql-syntax-check" aria-label={text.title}>
    <header><strong>{text.title}</strong><span role="status">{view.busy ? text.running : result?.status === 'ready' ? result.issues.length ? `${result.issues.length} ${text.issues} · ${result.statementCount} ${text.statements}` : result.statementCount ? text.clean : text.empty : result ? text.reasons[result.reason] ?? text.unavailable : ''}</span><span className="grow"/>
      {view.busy ? <button onClick={onCancel}>{text.cancel}</button> : <button onClick={onRecheck}>{text.recheck}</button>}<button onClick={onClose}>{text.close}</button>
    </header>
    <p className="muted small">{text.hint}</p>
    {result?.status === 'ready' && result.issues.length > 0 && <ol>{result.issues.map((issue, index) => { const point = position(issue.start); return <li key={`${issue.start}:${issue.end}:${index}`}><button onClick={() => onSelect(index)}>{text.position(point.lineNumber, point.column)} · {text.issueMessages[issue.code] ?? text.issue}</button></li>; })}</ol>}
  </section>;
}
