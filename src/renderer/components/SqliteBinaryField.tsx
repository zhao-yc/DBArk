import { useMemo } from 'react';
import { sqliteBinaryInputHex, sqliteBinaryOriginalCell } from '../sqliteBinaryInput';
import { sqliteTableEditZh as text } from '../locales/sqliteTableEdit.zh-CN';
import { errorMessage } from '../lib';
import { BinaryCellViewer } from './BinaryCellViewer';
import { ErrorBox } from './ui';

/** SQLite继续使用原字段预算；文件载入和Hex输入都仅修改准确表单缓冲。 */
export function SqliteBinaryField({ value, label, readonlyReason = '', source, current, available, onChange }: {
  value: string; label: string; readonlyReason?: string; source: readonly unknown[]; current(): boolean; available(): boolean; onChange(value: string): void;
}) {
  const input = useMemo(() => {
    let reason = readonlyReason;
    try { sqliteBinaryInputHex(value); } catch { reason ||= text.blobEditLimit; }
    try { return { reason, cell: reason ? sqliteBinaryOriginalCell(value) : { type: 'binary' as const, base64: '' }, error: '' }; }
    catch (failure) { return { reason, cell: undefined, error: errorMessage(failure) }; }
  }, [value, readonlyReason]);
  // 完整原值不可查看时只显示错误，不能用undefined把已有大BLOB误标成DEFAULT。
  if (input.error) return <ErrorBox message={input.error}/>;
  return <BinaryCellViewer value={input.cell} hexInput={input.reason ? undefined : value} label={label} reason={input.reason}
    source={source} isCurrent={current} isAvailable={available} onHexChange={input.reason ? undefined : next => { sqliteBinaryInputHex(next); onChange(next); }}/>;
}
