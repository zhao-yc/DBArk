import type { TableCreateDraft } from '../../shared/tableCreate';
import { tableCreateColumnEncodingAllowed } from '../../shared/tableCreateColumnEncoding';
import type { TableEncodingPair } from '../../shared/tableDefaultEncoding';
import type { NewTableEncodingDirectory } from '../newTableEncodingCatalog';
import { tableCreateColumnEncodingZh as text } from '../locales/tableCreateColumnEncoding.zh-CN';
import '../tableCreateColumnEncoding.css';

/** 显式属性始终可清除；改类型或生成模式只禁新选择，不静默删除已选配对。 */
export function NewTableColumnEncodingField({ column, position, catalog, disabled, onChange }: { column: TableCreateDraft['columns'][number]; position: number; catalog?: NewTableEncodingDirectory; disabled: boolean; onChange(pair: TableEncodingPair | undefined): void }) {
  const explicit = Object.hasOwn(column, 'collation'), allowed = tableCreateColumnEncodingAllowed(column), ready = !!catalog && Date.parse(catalog.expiresAt) > Date.now(), selected = column.collation;
  const choices = catalog?.candidates ?? [], pairCurrent = () => !disabled && allowed && !!catalog && Date.parse(catalog.expiresAt) > Date.now();
  return <div className="new-table-column-encoding">
    <select aria-label={text.mode(position)} value={explicit ? 'explicit' : 'inherit'} disabled={disabled} onChange={event => { if (disabled) return; if (event.target.value === 'inherit') onChange(undefined); else if (event.target.value === 'explicit' && pairCurrent()) onChange({ charset: '', collation: '' }); }}>
      <option value="inherit">{text.inherit}</option><option value="explicit" disabled={!allowed || !ready}>{text.explicit}</option>
    </select>
    {explicit && <><select aria-label={text.charset(position)} value={selected?.charset ?? ''} disabled={disabled || !allowed || !ready} onChange={event => { const charset = event.target.value; if (pairCurrent() && choices.some(pair => pair.charset === charset)) onChange({ charset, collation: '' }); }}><option value="">{text.placeholder}</option>{[...new Set(choices.map(pair => pair.charset))].map(charset => <option key={charset} value={charset}>{charset}</option>)}</select>
      <select aria-label={text.collation(position)} value={selected?.collation ?? ''} disabled={disabled || !allowed || !ready || !selected?.charset} onChange={event => { if (!pairCurrent()) return; const pair = choices.find(pair => pair.charset === selected?.charset && pair.collation === event.target.value); if (pair) onChange({ ...pair }); }}><option value="">{text.placeholder}</option>{choices.filter(pair => pair.charset === selected?.charset).map(pair => <option key={pair.collation} value={pair.collation}>{pair.collation}</option>)}</select>
      <p className="muted small">{selected?.charset ?? '—'} / {selected?.collation ?? '—'}</p><button type="button" disabled={disabled} onClick={() => { if (!disabled) onChange(undefined); }} aria-label={text.clear(position)}>{text.inherit}</button>{!allowed && <p className="warning-text">{text.incompatible}</p>}</>}
  </div>;
}
