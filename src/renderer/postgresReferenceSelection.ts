import type { DataRow } from '../shared/contracts';
import { postgresTableLimits, type PostgresTableField, type PostgresTableReference } from '../shared/postgresTable';
import { cellText, ownCell } from './lib';
import { postgresReferencePickerZh as text } from './locales/postgresReferencePicker.zh-CN';

/** 按目录序号生成完整元组。任一字段缺失、超限或类型不符时不返回部分输入。 */
export function postgresReferenceSelection(choice: PostgresTableReference, row: DataRow): PostgresTableField[] {
  if (!choice.pairs.length || new Set(choice.pairs.map(pair => pair.local)).size !== choice.pairs.length) throw Error(text.invalid);
  return choice.pairs.map((pair, index) => {
    const raw = ownCell(row, 'c' + index);
    if (raw == null || typeof raw === 'object' && !pair.binary ||
      typeof raw === 'number' && (!Number.isFinite(raw) || Number.isInteger(raw) && !Number.isSafeInteger(raw))) throw Error(text.invalid);
    const binary = typeof raw === 'object';
    if (binary && raw.base64.length > 4 * Math.ceil(postgresTableLimits.value / 6)) throw Error(text.invalid);
    const value = binary ? cellText(raw).slice(2) : cellText(raw);
    if (value.length > postgresTableLimits.value || /[\u0000\uD800-\uDFFF]/u.test(value)) throw Error(text.invalid);
    return { column: pair.local, value: { mode: binary ? 'binary' : 'text', value } };
  });
}
