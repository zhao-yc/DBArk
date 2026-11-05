import { useState } from 'react';
import type { PostgresPlanComparison } from '../../shared/postgresPlanComparison';
import { explainSnapshotZh as text } from '../../shared/explainSnapshot.zh-CN';

/** 两列都读取已经打开的文件。变化节点与字段在本地选择，不再访问数据库。 */
export function PostgresPlanComparisonView({ comparison, left, right }: {
  comparison: PostgresPlanComparison;
  left: string;
  right: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<string>();
  const visible = showAll ? comparison.nodes : comparison.nodes.filter(node => node.status !== 'same');
  const current = visible.find(node => node.path === selected) ?? visible[0];
  return <section className="explain-comparison" aria-label={text.compareTitle}>
    <div className="explain-comparison-sources">
      <span>{text.compareLeft}　{left}</span><span>{text.compareRight}　{right}</span>
    </div>
    <p className="muted small">{text.compareHint}</p>
    <div className="explain-comparison-summary">
      <strong role="status">{text.compareCount(comparison.different, comparison.nodes.length)}</strong>
      <label><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.currentTarget.checked)} /> {text.compareShowAll}</label>
    </div>
    {current ? <div className="explain-comparison-body">
      <div className="explain-comparison-paths">
        {visible.map(node => <button key={node.path} aria-pressed={node === current}
          style={{ paddingInlineStart: 8 + Math.min(node.depth, 8) * 9 }} onClick={() => setSelected(node.path)}>
          <strong>{text.compareStatuses[node.status]} · {node.right ?? node.left}</strong><small>{node.path}</small>
        </button>)}
      </div>
      <div className="explain-comparison-detail">
        <div className="explain-comparison-sources"><span>{current.left ?? '—'}</span><span>{current.right ?? '—'}</span></div>
        {current.fields.length ? <table>
          <thead><tr><th scope="col">{text.compareField}</th><th scope="col">{text.compareLeft}</th><th scope="col">{text.compareRight}</th></tr></thead>
          <tbody>{current.fields.map(field => <tr key={field.name}>
            <th scope="row">{field.name}</th><td>{field.left ?? '—'}</td><td>{field.right ?? '—'}</td>
          </tr>)}</tbody>
        </table> : <p>{text.compareSame}</p>}
        {current.changedFields > current.fields.length && <p>{text.compareMore(current.changedFields - current.fields.length)}</p>}
      </div>
    </div> : <p>{text.compareSame}</p>}
  </section>;
}
