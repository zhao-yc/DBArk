import { useEffect, useState } from 'react';
import type { PostgresRoutineInfo, PostgresRoutineReadInput } from '../../shared/postgresRoutine';
import { errorMessage, invoke } from '../lib';
import { postgresRoutineZh as text } from '../locales/postgresRoutine.zh-CN';
import { zh } from '../locales/zh-CN';
import { useWorkspace } from '../store';
import { SqlEditor } from './SqlEditor';
import { ErrorBox, Modal, Spinner } from './ui';
import './PostgresStructureDialog.css';

/** 定义读取和草稿绑定原连接及完整签名，加载或打开时只读取文本。 */
export function PostgresRoutineDialog({ target, onClose }: { target: PostgresRoutineReadInput; onClose(): void }) {
  const { connectionId, database, kind, name } = target;
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([connectionId, database, kind, name, version, attempt]);
  const [result, setResult] = useState<{ key: string; info?: PostgresRoutineInfo; error?: string }>();
  const current = result?.key === key ? result : undefined;
  const info = current?.info;
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      void invoke('postgres.routine.read', { connectionId, database, kind, name }).then(info => {
        if (active) setResult({ key, info });
      }, reason => { if (active) setResult({ key, error: errorMessage(reason) }); });
    });
    return () => { active = false; };
  }, [connectionId, database, kind, name, key]);

  function openDraft() {
    const workspace = useWorkspace.getState();
    if (!info || (workspace.connectionVersions[connectionId] ?? 0) !== version ||
        workspace.connections.find(profile => profile.id === connectionId)?.dialect !== 'postgresql') return;
    workspace.openTab({ kind: 'query', title: name, connectionId, database, sql: info.definition });
    onClose();
  }

  const fields = info && [[text.kind, text.categories[info.category]], [text.owner, info.owner], [text.language, info.language],
    [text.arguments, info.arguments || '—'], ...(info.category === 'p' ? [] : [
      [text.returns, info.returns ?? '—'], [text.volatility, text.volatilityValues[info.volatility]],
    ]), [text.security, info.securityDefiner ? text.definer : text.invoker], [text.comment, info.comment ?? '—']];

  return <Modal title={text.title} wide onClose={onClose}>
    <div className="modal-content pg-structure-content">
      <div className="pg-structure-caption"><strong>{name}</strong><span>{database}</span></div>
      {!current && <Spinner text={text.loading}/>}
      <ErrorBox message={current?.error ?? ''}/>
      {info && fields && <><table className="pg-structure-table"><tbody>{fields.map(([label, value]) =>
        <tr key={label}><th scope="row">{label}</th><td><code>{value}</code></td></tr>)}</tbody></table>
        <SqlEditor value={info.definition} dialect="postgresql" readOnly height={300}/></>}
    </div>
    <footer className="modal-footer"><button disabled={!current} onClick={() => setAttempt(value => value + 1)}>{zh.common.refresh}</button>
      <button disabled={!info} onClick={openDraft}>{text.draft}</button>
      <span className="grow"/><button onClick={onClose}>{zh.common.close}</button></footer>
  </Modal>;
}
