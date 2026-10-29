import { fileImportConflictZh as text } from '../locales/fileImportConflict.zh-CN';
import { importConflictKeyReason, type ImportConflictMode, type ImportConflictSource, type ImportConflictState } from '../importConflict';
import { ErrorBox, Field, Spinner } from './ui';

/** 目录只提供当前目标已验证键，不从表格元数据推测前缀或表达式索引可靠性。 */
export function ImportConflictFields({ state, source, busy, onMode, onKey, onRefresh }: {
  state: ImportConflictState; source: ImportConflictSource | null; busy: boolean;
  onMode(mode: ImportConflictMode): void; onKey(name: string): void; onRefresh(): void;
}) {
  return <section>
    <div className="form-grid"><Field label={text.mode}><select aria-label={text.mode} title={text.preset} value={state.mode} disabled={busy || !source} onChange={event => onMode(event.target.value as ImportConflictMode)}><option value="insert">{text.insert}</option><option value="skip-existing">{text.skipExisting}</option><option value="upsert">{text.upsert}</option><option value="update-existing">{text.updateExisting}</option></select></Field>
      {state.mode !== 'insert' && <Field label={text.key}><select aria-label={text.key} value={state.key} disabled={busy || state.status !== 'ready' || !source} onChange={event => onKey(event.target.value)}><option value="">{text.chooseKey}</option>{state.catalog?.keys.map(key => {
        const reason = source ? importConflictKeyReason(source, key, state.mode) : text.stale;
        return <option key={key.name} value={key.name} disabled={!!reason}>{key.name}（{key.columns.join(', ')}）{reason ? ` · ${reason}` : ''}</option>;
      })}</select></Field>}
    </div>
    {state.mode !== 'insert' && <><p className="muted small">{text.scope}</p>{state.status === 'loading' ? <Spinner text={text.loading}/> : <button disabled={busy || !source} onClick={onRefresh}>{text.refresh}</button>}{state.status === 'ready' && !state.catalog?.keys.length && <p className="warning-text">{text.noKey}</p>}<ErrorBox message={state.error}/></>}
  </section>;
}
