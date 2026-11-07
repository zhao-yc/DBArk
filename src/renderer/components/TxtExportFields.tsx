import { txtExportOptionsSchema, txtExportZh as text, type TxtExportOptions } from '../../shared/txtExport';
import { txtImportZh } from '../../shared/txtImport';
import { TxtDelimiterFields } from './TxtImportFields';
import { ErrorBox, Field } from './ui';

export function TxtExportFields({ options, disabled, onChange }: {
  options: TxtExportOptions; disabled: boolean; onChange(options: TxtExportOptions): void;
}) {
  return <>
    <TxtDelimiterFields options={options} disabled={disabled} onChange={fields => onChange({ ...options, ...fields })}/>
    <Field label={txtImportZh.record}><select aria-label={txtImportZh.record} disabled={disabled} value={options.recordDelimiter}
      onChange={event => onChange({ ...options, recordDelimiter: event.target.value as TxtExportOptions['recordDelimiter'] })}>
      <option value="crlf">CRLF</option><option value="lf">LF</option><option value="cr">CR</option>
    </select></Field>
    <label className="check"><input type="checkbox" disabled={disabled} checked={options.hasHeader}
      onChange={event => onChange({ ...options, hasHeader: event.target.checked })}/>{text.hasHeader}</label>
    {!txtExportOptionsSchema.safeParse(options).success && <ErrorBox message={text.invalid}/>}
  </>;
}
