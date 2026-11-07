import { xmlImportZh as text, type XmlImportOptions } from '../../shared/xmlImport';
import { Field } from './ui';

/** 切换布局即撤下旧来源。文档的二进制类型来自原单元格，无须再次解释。 */
export function XmlDocumentImportFields({ options, disabled, onChange }: {
  options: XmlImportOptions; disabled: boolean; onChange(options: XmlImportOptions): void;
}) {
  const documentResult = options.documentResult;
  return <>
    <Field label={text.layout}><select aria-label={text.layout} value={documentResult === undefined ? 'flat' : 'document'} disabled={disabled}
      onChange={event => {
        if (event.target.value === 'document') onChange({ ...options, rowTag: 'RECORD', documentResult: 1, binaryBase64: false });
        else { const { documentResult: _documentResult, ...flat } = options; onChange(flat); }
      }}>
      <option value="flat">{text.flat}</option><option value="document">{text.document}</option>
    </select></Field>
    {documentResult !== undefined && <Field label={text.result}><input aria-label={text.result} type="number" min={1} max={200}
      value={documentResult || ''} disabled={disabled} onChange={event => onChange({ ...options, documentResult: Number(event.target.value) })}/></Field>}
  </>;
}
