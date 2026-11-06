import { postgresTableLimits, type PostgresTableChange, type PostgresTableField, type PostgresTablePage } from '../shared/postgresTable';
import { cellText, ownCell } from './lib';
import { postgresRecordDuplicateZh as text } from './locales/postgresRecordDuplicate.zh-CN';
import { postgresBatchValueValid } from './postgresBatchSelection';
import { postgresBatchDuplicateZh } from './locales/postgresBatchDuplicate.zh-CN';
import type { PostgresBatchEditInput } from './postgresBatchEdit';

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

/** 以原页顺序生成全部副本。可插入但无行键的表仍可复制不同原页索引。 */
export function postgresBatchDuplicatePlan(page: PostgresTablePage, selected: ReadonlySet<number>,
  prior: (key: string) => PostgresTableChange | undefined) {
  if (!selected.size || selected.size > postgresTableLimits.changes) throw Error(postgresBatchDuplicateZh.stale);
  const initial = new Map<number, Map<string, PostgresTableField['value']>>();
  let omitted: string[] = [];
  const rows = [...selected].sort((left, right) => left - right).map(index => {
    const key = page.rowKeys?.[index], previous = key ? prior(key) : undefined;
    const plan = postgresRecordDuplicatePlan(page, index, previous);
    initial.set(index, new Map(plan.fields.map(field => [field.column, field.value])));
    omitted = plan.omitted;
    return { index, key: String(index), original: page.rows[index], previous: undefined };
  });
  return { rows, initial, omitted };
}

/** 窗口只提交逐行覆盖的字段，未编辑副本仍从原计划生成独立 INSERT 草稿。 */
export function postgresBatchDuplicateChanges(page: PostgresTablePage, plan: ReturnType<typeof postgresBatchDuplicatePlan>,
  inputs: PostgresBatchEditInput): PostgresTableChange[] {
  if ([...inputs.keys()].some(index => !plan.initial.has(index))) throw Error(postgresBatchDuplicateZh.stale);
  const columns = new Map(page.columns.filter(column => !column.generated).map(column => [column.key, column]));
  return plan.rows.map(({ index, original }) => {
    if (page.rows[index] !== original) throw Error(postgresBatchDuplicateZh.stale);
    const values = inputs.get(index) ?? plan.initial.get(index);
    if (!values) throw Error(postgresBatchDuplicateZh.stale);
    const fields = Array.from(values, ([key, value]) => {
      const column = columns.get(key);
      if (!column || !postgresBatchValueValid(column, value)) throw Error(text.invalid(column?.name ?? key));
      return { column: key, value };
    });
    return { kind: 'insert', fields };
  });
}
