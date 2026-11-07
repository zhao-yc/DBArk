import { useEffect, useState } from 'react';
import { excelImportZh as text, excelMaxRow, excelRowRangeMessage, excelRowRangeSchema, type ExcelImportOptions, type ExcelRowRange, type ExcelSheet } from '../../shared/excelTransfer';
import { errorMessage, invoke, uid } from '../lib';
import { ErrorBox, Field, Spinner } from './ui';

/** 复用所有 XLSX 入口的工作表行号控件，留空的数据边界交给读取器推定。 */
export function ExcelRowRangeFields({ range, disabled, headerLabel = text.header, onChange }: {
  range: ExcelRowRange; disabled: boolean; headerLabel?: string; onChange(range: ExcelRowRange): void;
}) {
  const { headerRow = 1, firstDataRow, lastDataRow } = range;
  return <>
    <Field label={headerLabel}><input aria-label={headerLabel} type="number" min={0} max={excelMaxRow} step={1}
      value={headerRow} disabled={disabled} onChange={event => onChange({ ...range, headerRow: Number(event.target.value) })}/></Field>
    <Field label={text.firstDataRow}><input aria-label={text.firstDataRow} type="number" min={1} max={excelMaxRow} step={1}
      placeholder={String(headerRow + 1)} value={firstDataRow ?? ''} disabled={disabled}
      onChange={event => onChange({ ...range, firstDataRow: event.target.value === '' ? undefined : Number(event.target.value) })}/></Field>
    <Field label={text.lastDataRow}><input aria-label={text.lastDataRow} type="number" min={1} max={excelMaxRow} step={1}
      placeholder={text.throughEnd} value={lastDataRow ?? ''} disabled={disabled}
      onChange={event => onChange({ ...range, lastDataRow: event.target.value === '' ? undefined : Number(event.target.value) })}/></Field>
  </>;
}

/** 工作表目录请求绑定当前文件令牌，选择别的文件时取消原读取并丢弃迟到结果。 */
export function ExcelImportFields({ fileToken, options, disabled, frozen = false, onChange }: {
  fileToken?: string; options: ExcelImportOptions; disabled: boolean; frozen?: boolean; onChange(options: ExcelImportOptions): void;
}) {
  const [loaded, setLoaded] = useState<{ token: string; sheets?: ExcelSheet[]; error?: string }>();
  useEffect(() => {
    if (!fileToken || frozen) return;
    const taskId = uid(); let current = true, done = false;
    void invoke('excel.sheets', { fileToken, taskId }).then(sheets => {
      if (current) setLoaded({ token: fileToken, sheets });
    }, reason => {
      if (current) setLoaded({ token: fileToken, error: errorMessage(reason) });
    }).finally(() => { done = true; });
    return () => { current = false; if (!done) void invoke('query.cancel', { taskId }).catch(() => undefined); };
  }, [fileToken, frozen]);
  const catalogue = loaded?.token === fileToken ? loaded : undefined;
  return <>
    <Field label={text.sheet}><select aria-label={text.sheet} value={options.sheetId} disabled={disabled || frozen || !catalogue?.sheets}
      onChange={event => onChange({ ...options, sheetId: event.target.value })}>
      <option value="">{text.sheet}</option>
      {frozen ? <option value={options.sheetId}>{options.sheetId}</option> : catalogue?.sheets?.map(sheet =>
        <option key={sheet.id} value={sheet.id}>{sheet.name}{sheet.hidden ? text.hidden : ''}</option>)}
    </select></Field>
    <ExcelRowRangeFields range={options} disabled={disabled || frozen} onChange={range => onChange({ ...options, ...range })}/>
    <Field label={text.protocol}><select aria-label={text.protocol} value={options.protocol} disabled={disabled || frozen}
      onChange={event => onChange({ ...options, protocol: event.target.value as ExcelImportOptions['protocol'] })}>
      <option value="plain">{text.plain}</option><option value="dbark-v1">{text.reversible}</option>
    </select></Field>
    <p className="muted small">{text.rangeHint} {text.hint}</p>
    {!excelRowRangeSchema.safeParse(options).success && <ErrorBox message={excelRowRangeMessage}/>}
    {fileToken && !catalogue && !frozen && <Spinner text={text.reading}/>}
    {catalogue?.error && <ErrorBox message={catalogue.error}/>}
  </>;
}
