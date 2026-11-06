import { postgresTableLimits, type PostgresTableChange, type PostgresTableField, type PostgresTablePage } from '../shared/postgresTable';
import { cellText, ownCell } from './lib';
import { postgresRecordDuplicateZh as text } from './locales/postgresRecordDuplicate.zh-CN';
import { postgresBatchValueValid } from './postgresBatchSelection';

/** 从原页和已暂存字段构造独立新增值。省略目录确认的生成字段，保留其余协议原值。 */
export function postgresRecordDuplicatePlan(page: PostgresTablePage, index: number, prior?: PostgresTableChange) {
  const original = page.rows[index];
  if (!page.pageToken || !page.capabilities.insert || page.truncated || !Number.isSafeInteger(index) || !original ||
      prior?.kind === 'delete') throw Error(text.stale);
  const staged = new Map(prior?.kind === 'update' ? prior.fields.map(field => [field.column, field.value]) : []);
  const fields: PostgresTableField[] = [], omitted: string[] = [];
  let size = 0;
  for (const column of page.columns) {
    if (column.generated || column.sequenceDefault) { omitted.push(column.name); continue; }
    let value = staged.get(column.key);
    if (!value) {
      const raw = ownCell(original, column.key);
      if (raw === undefined) throw Error(text.missing(column.name));
      if (raw === null) value = { mode: 'null' };
      else if (typeof raw === 'object') {
        // 先核编码大小再分配解码缓冲，文本、字节及 NULL 始终区分。
        if (!column.binary || raw.base64.length > 4 * Math.ceil(postgresTableLimits.value / 6)) throw Error(text.invalid(column.name));
        value = { mode: 'binary', value: cellText(raw).slice(2) };
      } else if (typeof raw === 'string') value = { mode: 'text', value: raw };
      else throw Error(text.invalid(column.name));
    }
    if (!postgresBatchValueValid(column, value)) throw Error(text.invalid(column.name));
    size += 32 + ('value' in value ? 4 * value.value.length : 0);
    if (fields.length >= postgresTableLimits.fields || size > postgresTableLimits.draft) throw Error(text.budget);
    fields.push({ column: column.key, value });
  }
  return { fields, omitted };
}
