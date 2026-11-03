import { useState } from 'react';
import { sqlSyntaxBoundary } from '../../shared/sqlSyntaxCheck';
import { formatText } from '../locales/zh-CN';
import { historyPagesZh as text } from '../locales/historyPages.zh-CN';

const sqlPartUnits = 65536;

/** 只把当前段放进界面，分段边界保留原 CRLF 和 Unicode 代理对。 */
export function SqlTextPreview({ title, sql, onClose }: { title: string; sql: string; onClose(): void }) {
  const [part, setPart] = useState(0);
  const count = Math.max(1, Math.ceil(sql.length / sqlPartUnits));
  const boundary = (index: number) => {
    const offset = Math.min(sql.length, index * sqlPartUnits);
    return sqlSyntaxBoundary(sql, offset) ? offset : offset - 1;
  };
  return <section className="history-sql-preview" aria-label={title}><pre tabIndex={0}>{sql.slice(boundary(part), boundary(part + 1))}</pre>
    <div className="inline-field"><button disabled={part === 0} onClick={() => setPart(part - 1)}>{text.sqlPrevious}</button>
      <span role="status">{formatText(text.sqlPart, part + 1, count)}</span>
      <button disabled={part + 1 >= count} onClick={() => setPart(part + 1)}>{text.sqlNext}</button>
      <button onClick={onClose}>{text.sqlClose}</button>
    </div></section>;
}
