import { useState } from 'react';
import type { PostgresTableColumn } from '../../shared/postgresTable';
import { maxClipboardCharacters } from '../gridClipboard';
import { errorMessage } from '../lib';
import { postgresGridPasteZh as text } from '../locales/postgresGridPaste.zh-CN';
import { postgresTableZh as tableText } from '../locales/postgresTable.zh-CN';
import { postgresClipboardInput } from '../postgresGridPaste';
import { ErrorBox, Modal } from './ui';

/** 在明确的新增入口收集剪贴板，可见列顺序仍由原表页掌握。 */
export function PostgresGridPasteDialog({ columns, onClose, onStage }: {
  columns: readonly PostgresTableColumn[]; onClose(): void;
  onStage(start: string, source: { plain: string; typed?: string }): void;
}) {
  const [column, setColumn] = useState(columns.find(column => !column.generated)?.key ?? '');
  const [source, setSource] = useState<{ plain: string; typed?: string }>({ plain: '' });
  const [hasInput, setHasInput] = useState(false);
  const [error, setError] = useState('');
  return <Modal title={text.append} onClose={onClose} wide>
    <div className="modal-content">
      <p>{text.appendHint}</p>
      <label className="field">{text.firstColumn}
        <select value={column} onChange={event => { setColumn(event.target.value); setError(''); }}>
          {columns.filter(column => !column.generated).map(column => <option key={column.key} value={column.key}>{column.name}</option>)}
        </select>
      </label>
      <label className="field">{text.source}
        <textarea rows={7} maxLength={maxClipboardCharacters} value={source.plain}
          onChange={event => { setSource({ plain: event.target.value }); setHasInput(!!event.target.value); setError(''); }}
          onPaste={event => {
            event.preventDefault();
            try {
              const input = postgresClipboardInput(event.clipboardData);
              if ((input.typed?.length ?? 0) > maxClipboardCharacters || input.plain.length > maxClipboardCharacters) throw Error(text.invalid);
              setSource(input); setHasInput(true); setError('');
            } catch (reason) { setError(errorMessage(reason)); }
          }}/>
      </label>
      {source.typed && <p className="muted small">{text.typed}</p>}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      <button onClick={onClose}>{tableText.cancel}</button>
      <button className="primary" disabled={!hasInput || !column} onClick={() => {
        try { onStage(column, source); }
        catch (reason) { setError(errorMessage(reason)); }
      }}>{tableText.stage}</button>
    </footer>
  </Modal>;
}
