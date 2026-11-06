import { useRef, useState } from 'react';
import type { FileChoice } from '../../shared/contracts';
import type { PostgresArchiveExportInput, PostgresArchiveListing, PostgresArchiveRestoreChoice, PostgresArchiveSqlExport } from '../../shared/postgresArchive';
import { errorMessage, invoke, uid } from '../lib';
import { postgresArchiveZh as text } from '../locales/postgresArchive.zh-CN';
import { ErrorBox, Field, Modal } from './ui';
import '../databaseBackup.css';

export function PostgresArchiveDialog({ onClose, onRestore, paused }: {
  onClose(): void;
  onRestore?: (archive: PostgresArchiveRestoreChoice) => void;
  paused?: boolean;
}) {
  const [source, setSource] = useState<FileChoice | null>(null), [tool, setTool] = useState<FileChoice | null>(null);
  const [listing, setListing] = useState<PostgresArchiveListing>();
  const [exported, setExported] = useState<PostgresArchiveSqlExport | null>(null);
  const [content, setContent] = useState<PostgresArchiveExportInput['content']>('all');
  const [portable, setPortable] = useState(false);
  const [choosing, setChoosing] = useState(false), [operation, setOperation] = useState<string>();
  const [cancelling, setCancelling] = useState(false), [error, setError] = useState('');
  const active = useRef(false);
  const locked = choosing || !!operation;
  const available = !!source && !!tool && !locked;

  async function choose(kind: 'tool' | 'source') {
    if (active.current) return;
    active.current = true;
    setChoosing(true); setListing(undefined); setExported(null); setError('');
    const update = kind === 'tool' ? setTool : setSource;
    update(null);
    try { update(await invoke('postgres.archive.choose', { kind })); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setChoosing(false); active.current = false; }
  }

  async function run(action: 'list' | 'export') {
    if (active.current || !source || !tool) return;
    active.current = true;
    const operationId = uid();
    const input = { operationId, sourceToken: source.token, toolToken: tool.token };
    setOperation(operationId); setError('');
    try {
      if (action === 'list') {
        setListing(undefined);
        setListing(await invoke('postgres.archive.list', input));
      } else {
        setExported(null);
        setExported(await invoke('postgres.archive.exportSql', { ...input, content, portable }));
      }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setOperation(undefined); setCancelling(false); active.current = false; }
  }

  async function cancel() {
    if (!operation || cancelling) return;
    setCancelling(true);
    try { await invoke('postgres.archive.cancel', { operationId: operation }); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  const close = () => { if (!active.current) onClose(); };
  if (paused) return null;
  return <Modal title={text.title} wide onClose={close}>
    <div className="modal-content database-backup-content">
      <p>{text.scope}</p>
      <div>
        <button disabled={locked} onClick={() => void choose('source')}>{text.chooseSource}</button>
        {source && <span> · {source.name}</span>}
      </div>
      <div>
        <button disabled={locked} onClick={() => void choose('tool')}>{text.chooseTool}</button>
        {tool && <span> · {tool.name}</span>}
      </div>
      <fieldset disabled={locked}>
        <Field label={text.content}><select aria-label={text.content} value={content} onChange={event => {
          setContent(event.target.value as PostgresArchiveExportInput['content']); setExported(null);
        }}><option value="all">{text.all}</option><option value="schema">{text.schema}</option><option value="data">{text.data}</option></select></Field>
      </fieldset>
      <label className="check"><input type="checkbox" disabled={locked} checked={portable} onChange={event => {
        setPortable(event.target.checked); setExported(null);
      }}/>{text.portable}</label>
      {operation && <p role="status">{cancelling ? text.cancelling : text.running}</p>}
      {listing && <section className="database-backup-plan">
        <p>{text.directory} · pg_restore {listing.toolVersion}</p>
        <pre className="database-backup-native-list" aria-label={text.directory} tabIndex={0}>{listing.text}</pre>
        {listing.warning && <p>{text.warnings} · {listing.warning}</p>}
      </section>}
      {exported && <section className="database-backup-plan" role="status">
        <p>{text.done(exported.name, exported.bytes)}</p>
        {exported.warning && <p>{text.warnings} · {exported.warning}</p>}
      </section>}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      <button disabled={!available} onClick={() => void run('list')}>{text.list}</button>
      {operation ? <button disabled={cancelling} onClick={() => void cancel()}>{text.cancel}</button> :
        <>
          <button disabled={!available} onClick={() => void run('export')}>{text.export}</button>
          {onRestore && <button className="primary" disabled={!available} onClick={() => {
            if (!active.current && source && tool)
              onRestore({ name: source.name, selection: { sourceToken: source.token, toolToken: tool.token, content, portable } });
          }}>{text.restore}</button>}
        </>}
      <span className="grow"/>
      <button disabled={locked} onClick={close}>{text.close}</button>
    </footer>
  </Modal>;
}
