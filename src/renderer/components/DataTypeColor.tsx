import { UsageHelp } from './ui';
import type { ComponentProps } from 'react';
import type { CellValue } from '../../shared/contracts';
import { dataTypeColorKind, dataTypeColorKinds, type DataTypeColorSource } from '../dataTypeColors';
import { dataTypeColorsZh as text } from '../locales/dataTypeColors.zh-CN';
import '../dataTypeColors.css';

/** 原span的值、标题和NULL/DEFAULT标记完全透传；关闭或选中时不附加语义样式。 */
export function DataTypeColor({ enabled, selected, value, type, source, className = '', ...span }: ComponentProps<'span'> & { enabled?: boolean; selected?: boolean; value: CellValue | undefined; type?: string; source: DataTypeColorSource }) {
  const invalid = span['aria-invalid'] !== undefined && span['aria-invalid'] !== false && span['aria-invalid'] !== 'false' || span['aria-errormessage'] !== undefined;
  const kind = enabled === true && !selected && !invalid ? dataTypeColorKind(value, type, source) : undefined;
  return <span {...span} className={[className, ...(kind ? ['data-type-color', `data-type-${kind}`] : [])].filter(Boolean).join(' ')} data-value-type={kind}/>;
}

/** 图例有明确文本名称，颜色不是唯一表达；不呈现任何实际行数据。 */
export function DataTypeColorLegend() {
  return <ul className="data-type-legend" aria-label={text.legend}>{dataTypeColorKinds.map(kind => <li key={kind}><span className={`data-type-swatch data-type-${kind}`} aria-hidden="true"/>{text[kind]}</li>)}</ul>;
}

/** 显式开关及单项重置复用应用本地偏好入口，不修改其他设置或历史记录。 */
export function DataTypeColorPreferences({ enabled, onChange }: { enabled: boolean; onChange(enabled: boolean): void }) {
  return <section className="full data-type-preference"><label className="check"><input type="checkbox" checked={enabled} onChange={event => onChange(event.target.checked)}/>{text.title}</label><UsageHelp><p>{text.hint}</p></UsageHelp><DataTypeColorLegend/><button type="button" disabled={!enabled} onClick={() => onChange(false)}>{text.reset}</button></section>;
}
