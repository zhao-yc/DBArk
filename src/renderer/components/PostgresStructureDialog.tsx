import { useEffect, useRef, useState } from 'react';
import { postgresIndexEditStamp } from '../../shared/postgresIndexEdit';
import type { PostgresStructureInput, PostgresStructureResult } from '../../shared/postgresStructure';
import { postgresIdentifier } from '../../shared/postgresSql';
import { errorMessage, invoke } from '../lib';
import { postgresStructureZh as text } from '../locales/postgresStructure.zh-CN';
import { useWorkspace } from '../store';
import { SqlEditor } from './SqlEditor';
import { PostgresMaterializedRefreshPanel } from './PostgresMaterializedRefreshPanel';
import { postgresMaterializedRefreshZh as refreshText } from '../locales/postgresMaterializedRefresh.zh-CN';
import { PostgresViewManagePanel } from './PostgresViewManagePanel';
import { postgresViewManageZh } from '../locales/postgresViewManage.zh-CN';
import { PostgresViewEditPanel } from './PostgresViewEditPanel';
import { postgresViewEditZh } from '../locales/postgresViewEdit.zh-CN';
import { PostgresColumnEditPanel } from './PostgresColumnEditPanel';
import { PostgresIndexEditPanel } from './PostgresIndexEditPanel';
import { PostgresKeyEditPanel } from './PostgresKeyEditPanel';
import { PostgresForeignEditPanel } from './PostgresForeignEditPanel';
import { PostgresCheckEditPanel } from './PostgresCheckEditPanel';
import { postgresCheckEditZh } from '../locales/postgresCheckEdit.zh-CN';
import { postgresForeignEditZh } from '../locales/postgresForeignEdit.zh-CN';
import { postgresKeyEditZh } from '../locales/postgresKeyEdit.zh-CN';
import { postgresIndexEditZh } from '../locales/postgresIndexEdit.zh-CN';
import { postgresColumnEditZh } from '../locales/postgresColumnEdit.zh-CN';
import { Empty, ErrorBox, Modal, Spinner } from './ui';
import './PostgresStructureDialog.css';

type Section = keyof typeof text.sections;
const editors = {
  materialized: { Panel: PostgresMaterializedRefreshPanel, label: refreshText.title },
  manage: { Panel: PostgresViewManagePanel, label: postgresViewManageZh.title },
  definition: { Panel: PostgresViewEditPanel, label: postgresViewEditZh.title },
  columns: { Panel: PostgresColumnEditPanel, label: postgresColumnEditZh.open },
  indexes: { Panel: PostgresIndexEditPanel, label: postgresIndexEditZh.open },
  constraints: { Panel: PostgresKeyEditPanel, label: postgresKeyEditZh.open },
  foreign: { Panel: PostgresForeignEditPanel, label: postgresForeignEditZh.open },
  check: { Panel: PostgresCheckEditPanel, label: postgresCheckEditZh.open },
};

/** 统一目录表格语义，空列表和数据库空值分别显示。 */
function CatalogTable({ headers, children, empty }: { headers: readonly string[]; children: React.ReactNode; empty: boolean }) {
  if (empty) return <Empty title={text.empty}/>;
  return <div className="pg-structure-table-wrap"><table className="pg-structure-table">
    <thead><tr>{headers.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{children}</tbody>
  </table></div>;
}

/** 在原窗口、连接修订和关系目标下读取结构，刷新、关闭及切换来源废弃迟到回包。 */
export function PostgresStructureDialog({ target, onClose, onDirtyChange, onEdited, onManaged }: {
  target: PostgresStructureInput; onClose(): void; onDirtyChange(value: boolean): void;
  onManaged(target: PostgresStructureInput, message: string, unknown: boolean, version: number, destination?: string): void;
  onEdited(target: PostgresStructureInput, message: string, unknown: boolean, version: number): void;
}) {
  const version = useWorkspace(state => state.connectionVersions[target.connectionId] ?? 0);
  const dialect = useWorkspace(state => state.connections.find(profile => profile.id === target.connectionId)?.dialect);
  const [section, setSection] = useState<Section>('columns');
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<keyof typeof editors>();
  const [view, setView] = useState<{ key: string; output?: PostgresStructureResult; error?: string }>();
  const owner = useRef<object | undefined>(undefined);
  const { connectionId, database, table } = target;
  const scope = JSON.stringify([connectionId, database, table, version, attempt]);
  const currentView = view?.key === scope && dialect === 'postgresql' ? view : undefined;
  const output = currentView?.output;
  const busy = !currentView && dialect === 'postgresql';
  useEffect(() => { setEditing(undefined); }, [scope]);

  useEffect(() => {
    if (dialect !== 'postgresql') return;
    const request = {};
    owner.current = request;
    // 严格模式的试挂载和同帧关闭不分配数据库连接。
    queueMicrotask(async () => {
      if (owner.current !== request) return;
      try {
        const output = await invoke('postgres.structure.read', { connectionId, database, table });
        if (owner.current !== request || (useWorkspace.getState().connectionVersions[connectionId] ?? 0) !== version) return;
        setView({ key: scope, output });
        if (!output.viewDefinition) setSection(value => value === 'definition' ? 'columns' : value);
      } catch (reason) {
        if (owner.current === request) setView({ key: scope, error: errorMessage(reason) });
      }
    });
    return () => { if (owner.current === request) owner.current = undefined; };
  }, [attempt, connectionId, database, table, version, dialect, scope]);

  /** 只有显式选择草稿才进入原数据库查询页，原定义保持原样。 */
  function openDraft() {
    if (!output?.viewDefinition || !owner.current) return;
    const state = useWorkspace.getState();
    if ((state.connectionVersions[connectionId] ?? 0) !== version || state.connections.find(p => p.id === connectionId)?.dialect !== 'postgresql') return;
    const title = postgresIdentifier(output.schema) + '.' + postgresIdentifier(output.name);
    state.openTab({ kind: 'query', title, connectionId, database, sql: output.viewDefinition });
    onClose();
  }

  const sections: Section[] = output?.viewDefinition ? ['columns', 'constraints', 'indexes', 'definition'] : ['columns', 'constraints', 'indexes'];
  const EditPanel = editing && editors[editing].Panel;
  const indexStamp = output && postgresIndexEditStamp(output);
  const manageStamp = output?.materializedManageStamp ?? output?.viewEditStamp;
  const editStamp = editing === 'indexes' ? indexStamp : editing === 'materialized' ? output?.materialized?.stamp :
    editing === 'manage' ? manageStamp : editing === 'definition' ? output?.viewEditStamp : output?.editStamp;
  return <Modal title={text.title} wide onClose={() => { if (!editing) onClose(); }}>
    <div className="modal-content pg-structure-content">
      <div className="pg-structure-caption"><strong>{table}</strong><span>{database}</span>{output && <span>{text.kinds[output.kind]}</span>}</div>
      {busy && <Spinner text={text.loading}/>}
      <ErrorBox message={dialect !== 'postgresql' ? text.missing : currentView?.error ?? ''}/>
      {EditPanel && output && editStamp ? <EditPanel target={target} original={output} version={version}
        onDirtyChange={onDirtyChange} onClose={() => { setEditing(undefined); setAttempt(value => value + 1); }}
        onResult={(message, unknown, receipt) => {
          if (editing === 'manage') {
            onManaged(target, message, unknown, version, receipt?.table);
            if (!unknown) onClose();
            return;
          }
          onEdited(target, message, unknown, version);
          if (!unknown) { setEditing(undefined); setAttempt(value => value + 1); }
        }}/> : output && <>
        {output.materialized && <p className="muted">
          {output.materialized.populated ? refreshText.populated : refreshText.empty}
          {output.materialized.stamp && output.materialized.populated && output.materialized.uniqueIndex ? ' · ' + refreshText.eligible : ''}
        </p>}
        {output.comment !== null && <p className="pg-structure-comment">{text.comment}　{output.comment}</p>}
        {output.partitionKey && <p>{text.partitionKey}　<code>{output.partitionKey}</code></p>}
        {output.partitionBound && <p>{text.partitionBound}　<code>{output.partitionBound}</code></p>}
        {output.rowSecurity && <p className="muted">{text.rowSecurity}{output.forceRowSecurity ? ' · ' + text.forceRowSecurity : ''}</p>}
        <nav className="pg-structure-sections" aria-label={text.title}>
          {sections.map(key => <button key={key} aria-pressed={key === section} className={key === section ? 'primary' : undefined}
            onClick={() => setSection(key)}>{text.sections[key]}</button>)}
        </nav>
        {section === 'columns' && <CatalogTable empty={!output.columns.length} headers={[
          text.position, text.name, text.type, text.nullable, text.defaultExpression, text.generatedExpression, text.identity, text.collation, text.comment,
        ]}>{output.columns.map(column => <tr key={column.position}>
          <td>{column.position}</td><th scope="row">{column.name}</th><td><code>{column.type}</code></td>
          <td>{column.nullable ? text.yes : text.no}</td><td><code>{column.defaultExpression ?? '—'}</code></td>
          <td><code>{column.generationExpression ?? '—'}</code>{column.generation && <small>{column.generation === 's' ? text.stored : text.virtual}</small>}</td>
          <td>{column.identity === 'a' ? text.always : column.identity === 'd' ? text.byDefault : '—'}</td>
          <td>{column.collation ?? '—'}</td><td>{column.comment ?? '—'}</td>
        </tr>)}</CatalogTable>}
        {section === 'constraints' && <CatalogTable empty={!output.constraints.length} headers={[text.name, text.type, text.definition, text.status]}>
          {output.constraints.map((constraint, index) => <tr key={index}>
            <th scope="row">{constraint.name}</th><td>{text.kindsOfConstraint[constraint.kind]}</td><td><code>{constraint.definition}</code></td>
            <td>{[constraint.deferrable && text.deferrable, constraint.initiallyDeferred && text.deferred,
              !constraint.validated && text.unvalidated, (constraint.foreign?.enforced === false || constraint.check?.enforced === false) && postgresForeignEditZh.unenforced, constraint.inherited && text.inherited].filter(Boolean).join(' · ') || '—'}</td>
          </tr>)}
        </CatalogTable>}
        {section === 'indexes' && <CatalogTable empty={!output.indexes.length} headers={[text.name, text.method, text.definition, text.constraint, text.status]}>
          {output.indexes.map(index => <tr key={index.name}>
            <th scope="row">{index.name}</th><td>{index.method}</td><td><code>{index.definition}</code></td><td>{index.constraint ?? '—'}</td>
            <td>{[index.primary && text.primary, index.unique && text.unique, index.replicaIdentity && postgresIndexEditZh.replicaIdentity,
              index.valid ? text.valid : text.invalid,
              !index.ready && text.notReady].filter(Boolean).join(' · ')}</td>
          </tr>)}
        </CatalogTable>}
        {section === 'definition' && output.viewDefinition && <>
          <p className="muted">{text.viewHint}</p><SqlEditor value={output.viewDefinition} dialect="postgresql" readOnly height={300}/>
        </>}
      </>}
    </div>
    <footer className="modal-footer">
      <button disabled={!!editing || busy || dialect !== 'postgresql'} onClick={() => { owner.current = undefined; setAttempt(value => value + 1); }}>{text.refresh}</button>
      {(section === 'indexes' ? indexStamp : output?.editStamp) && !editing && section !== 'definition' && <button onClick={() => setEditing(section)}>
        {editors[section].label}
      </button>}
      {output?.editStamp && !editing && section === 'constraints' &&
        <><button onClick={() => setEditing('foreign')}>{editors.foreign.label}</button>
          <button onClick={() => setEditing('check')}>{editors.check.label}</button></>}
      {output?.materialized?.stamp && !editing && <button onClick={() => setEditing('materialized')}>{refreshText.title}</button>}
      {manageStamp && !editing && <button onClick={() => setEditing('manage')}>{postgresViewManageZh.title}</button>}
      {section === 'definition' && output?.viewEditStamp && !editing && <button onClick={() => setEditing('definition')}>
        {postgresViewEditZh.title}
      </button>}
      {section === 'definition' && output?.viewDefinition && !editing && <button onClick={openDraft}>{text.openDraft}</button>}
      <span className="grow"/><button disabled={!!editing} onClick={onClose}>{text.close}</button>
    </footer>
  </Modal>;
}
