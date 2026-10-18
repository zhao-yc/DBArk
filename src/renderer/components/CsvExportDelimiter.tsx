import { csvExportDelimiters, type CsvExportDelimiter } from '../../shared/csvExport';
import { csvExportZh as text } from '../locales/csvExport.zh-CN';
import { Field } from './ui';

/** 仅渲染受控枚举，各CSV导出入口共用同一选项和中文说明。 */
export function CsvExportDelimiterField({ value, disabled, onChange }: { value: CsvExportDelimiter; disabled: boolean; onChange(value: CsvExportDelimiter): void }) {
  return <Field label={text.label}><select aria-label={text.label} value={value} disabled={disabled} onChange={event => { const next = event.target.value as CsvExportDelimiter; if (csvExportDelimiters.includes(next)) onChange(next); }}>{csvExportDelimiters.map(delimiter => <option key={delimiter} value={delimiter}>{text.labels[delimiter]}</option>)}</select><small>{text.hint}</small></Field>;
}
