import { useState } from 'react';
import { errorMessage } from '../lib';
import { postgresBatchDeleteZh as text } from '../locales/postgresBatchDelete.zh-CN';
import { postgresTableZh } from '../locales/postgresTable.zh-CN';
import type { PostgresBatchDeletePlan } from '../postgresBatchDelete';
import { ErrorBox, Modal } from './ui';
import '../tableStatistics.css';

/** 审阅确认只把当前批次的删除计划交给原表页草稿。 */
export function PostgresBatchDeleteDialog({ plan, offset, onStage, onClose }: {
  plan: PostgresBatchDeletePlan; offset: number; onStage(): void; onClose(): void;
}) {
  const [error, setError] = useState('');
  return <Modal title={text.title} onClose={onClose} wide>
    <div className="modal-content">
      <p>{text.notice}</p>
      <strong>{text.count(plan.rows.length)}</strong>
      {!!plan.updates && <p className="warning-text">{text.updates(plan.updates)}</p>}
      <div className="table-statistics-results">
        <table>
          <thead><tr><th>{text.row}</th><th>{text.primary}</th></tr></thead>
          <tbody>{plan.rows.map(row => <tr key={row.index}>
            <th scope="row">{offset + row.index + 1}</th>
            <td>{row.key.map(item => <div key={item.name}>{item.name} = {item.value}</div>)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      <button type="button" onClick={onClose}>{postgresTableZh.cancel}</button>
      <button type="button" className="primary" onClick={() => {
        try { onStage(); } catch (reason) { setError(errorMessage(reason)); }
      }}>{text.stage}</button>
    </footer>
  </Modal>;
}
