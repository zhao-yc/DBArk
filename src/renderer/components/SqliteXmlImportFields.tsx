import { xmlImportZh, type SqliteXmlImportOptions } from '../../shared/xmlImport';
import { Field } from './ui';
import { XmlDocumentImportFields } from './XmlDocumentImportFields';

export const sqliteXmlImportDefaults: SqliteXmlImportOptions = { rowTag: 'RECORD', attributes: true, binaryBase64: false };

export function SqliteXmlImportFields({ options, disabled, onChange }: { options: SqliteXmlImportOptions; disabled: boolean; onChange(options: SqliteXmlImportOptions): void }) {
  return <>
    <XmlDocumentImportFields options={options} disabled={disabled} onChange={next => onChange({ ...next, binaryBase64: false })}/>
    {options.documentResult === undefined && <>
    <Field label={xmlImportZh.rowTag}><input aria-label={xmlImportZh.rowTag} value={options.rowTag} maxLength={256} disabled={disabled} onChange={event => onChange({ ...options, rowTag: event.target.value })}/></Field>
    <label><input type="checkbox" checked={options.attributes} disabled={disabled} onChange={event => onChange({ ...options, attributes: event.target.checked })}/>{xmlImportZh.attributes}</label>
    </>}
  </>;
}
