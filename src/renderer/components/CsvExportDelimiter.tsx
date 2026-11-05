import { csvExportDelimiters, type CsvExportDelimiter } from '../../shared/csvExport';
import { csvExportZh as text } from '../locales/csvExport.zh-CN';
import { Field } from './ui';

/** 仅渲染受控枚举，保留各入口的标签及说明。 */
export function CsvExportDelimiterField({ value, disabled, onChange, label = text.label, hint = text.hint }: {
  value: CsvExportDelimiter; disabled: boolean; onChange(value: CsvExportDelimiter): void; label?: string; hint?: string;
}) {
  return <Field label={label}><select aria-label={label} title={hint} value={value} disabled={disabled} onChange={event => { const next = event.target.value as CsvExportDelimiter; if (csvExportDelimiters.includes(next)) onChange(next); }}>{csvExportDelimiters.map(delimiter => <option key={delimiter} value={delimiter}>{text.labels[delimiter]}</option>)}</select></Field>;
}
