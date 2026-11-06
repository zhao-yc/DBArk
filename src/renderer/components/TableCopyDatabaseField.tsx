import { useEffect, useState } from 'react';
import { validateTableCopyDatabase } from '../../shared/tableCopyStructure';
import { Field } from './ui';

/** 列表只用于选择。真正的库名、目录身份和占用仍由引擎在预览及提交时核对。 */
export function TableCopyDatabaseField({ label, connectionId, original, value, disabled, load, onChange }: {
  label: string; connectionId: string; original: string; value: string; disabled: boolean;
  load(connectionId: string): Promise<string[]>; onChange(database: string): void;
}) {
  const [options, setOptions] = useState<string[]>([]), [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setOptions([]); setFailed(false);
    void load(connectionId).then(names => {
      if (active) setOptions([...new Set(names.flatMap(name => {
        try { return name.toLowerCase() === original.toLowerCase() ? [] : [validateTableCopyDatabase(name)]; }
        catch { return []; }
      }))]);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [connectionId, original, load]);
  return <Field label={label}>
    <select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      <option value={original}>{original}</option>
      {options.map(name => <option key={name} value={name}>{name}</option>)}
    </select>
    {failed && <span className="muted small">目标库列表读取失败，仍可选择来源库。</span>}
  </Field>;
}
