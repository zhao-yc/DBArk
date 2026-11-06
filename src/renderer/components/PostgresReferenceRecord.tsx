import { useState } from 'react';
import type { DataRow, ResultColumn } from '../../shared/contracts';
import { cellPreview, cellText } from '../lib';
import { postgresRecordViewZh as text } from '../locales/postgresRecordView.zh-CN';

/** 关联弹窗和表页共用只读原值视图，完整值只在明确展开时渲染。 */
export function PostgresReferenceRecord({ columns, row }: { columns: ResultColumn[]; row: DataRow }) {
  const [expanded, setExpanded] = useState<string>();
  return <div className="pg-reference-candidates pg-reference-record"><table>
    <tbody>{columns.map(column => {
      const value = row[column.key], open = expanded === column.key;
      return <tr key={column.key}><th scope="row">{column.name}</th><td>
        {value === null ? text.null : value === '' ? text.empty : cellPreview(value)}
        {value != null && value !== '' && <button type="button" aria-expanded={open} aria-label={text.raw(column.name)}
          onClick={() => setExpanded(open ? undefined : column.key)}>{open ? text.closeValue : text.fullValue}</button>}
        {open && <textarea readOnly aria-label={text.raw(column.name)} rows={3} value={cellText(value)}/>}
      </td></tr>;
    })}</tbody>
  </table></div>;
}
