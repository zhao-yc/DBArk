import { useEffect, useState } from 'react';
import type { PostgresDependencies } from '../../shared/postgresDependencies';
import type { PostgresStructureInput } from '../../shared/postgresStructure';
import { errorMessage, invoke } from '../lib';
import { postgresDependenciesZh as text } from '../locales/postgresDependencies.zh-CN';
import { zh } from '../locales/zh-CN';
import { useWorkspace } from '../store';
import { ErrorBox, Modal, Spinner } from './ui';
import './PostgresStructureDialog.css';

const directions = ['referencedBy', 'references'] as const;

/** 原目标与连接版本约束目录回包；返回后恢复上层结构或删除窗口。 */
export function PostgresDependenciesDialog({ target, onBack }: { target: PostgresStructureInput; onBack(): void }) {
  const { connectionId, database, table } = target;
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([connectionId, database, table, version, attempt]);
  const [result, setResult] = useState<{ key: string; value?: PostgresDependencies; error?: string }>();
  const current = result?.key === key ? result : undefined;
  const value = current?.value;
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      void invoke('postgres.structure.dependencies', { connectionId, database, table }).then(value => {
        if (active) setResult({ key, value });
      }, reason => { if (active) setResult({ key, error: errorMessage(reason) }); });
    });
    return () => { active = false; };
  }, [connectionId, database, table, key]);

  return <Modal title={text.title} wide onClose={onBack}>
    <div className="modal-content pg-structure-content">
      <strong>{database} / {table}</strong><p>{text.hint}</p>
      {!current && <Spinner text={text.loading}/>}
      <ErrorBox message={current?.error ?? ''}/>
      {value?.limited && <p role="status">{text.limited}</p>}
      {value && directions.map(direction => {
        const entries = value.entries.filter(entry => entry.direction === direction);
        return <section key={direction} aria-label={text[direction]}>
          <h3>{text[direction]}</h3>
          {entries.length ? <div className="pg-structure-table-wrap"><table className="pg-structure-table">
            <thead><tr><th scope="col">{text.kind}</th><th scope="col">{text.identity}</th><th scope="col">{text.type}</th></tr></thead>
            <tbody>{entries.map(entry => <tr key={JSON.stringify([entry.kind, entry.identity, entry.type])}>
              <td>{entry.kind ? (text.kinds as Readonly<Record<string, string>>)[entry.kind] ?? entry.kind : '—'}</td>
              <td><code>{entry.identity ?? text.hidden}</code></td>
              <td>{(text.types as Readonly<Record<string, string>>)[entry.type] ?? entry.type}</td>
            </tr>)}</tbody>
          </table></div> : <p className="muted">{value.limited ? text.limited : text.empty}</p>}
        </section>;
      })}
    </div>
    <footer className="modal-footer"><button disabled={!current} onClick={() => setAttempt(value => value + 1)}>{zh.common.refresh}</button>
      <span className="grow"/><button onClick={onBack}>{text.back}</button></footer>
  </Modal>;
}
