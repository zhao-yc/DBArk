import type { CellValue } from '../shared/contracts';
import type { PostgresTableColumn, PostgresTablePage } from '../shared/postgresTable';
import { assertTextInputBudget } from './boundedTextInput';
import type { ReadonlyRecordViewSource } from './components/ReadonlyRecordView';
import { ownCell } from './lib';
import { postgresReadonlyRecordZh as text } from './locales/postgresReadonlyRecord.zh-CN';
import { canonicalBinaryBytes } from './recordProjections';

const budget = { units: 2 * 1024 * 1024, bytes: 2 * 1024 * 1024, message: text.limited };

/** PostgreSQL 协议只解码 BYTEA，其余值按原文本保存，不能靠类型名推断数值或执行 JSON 解析。 */
function originalValue(value: CellValue | undefined, column: PostgresTableColumn) {
  if (value === null) return { kind: 'null' } as const;
  if (!column.binary && typeof value === 'string') return { kind: 'text', value } as const;
  if (column.binary && value && typeof value === 'object' && value.type === 'binary' && typeof value.base64 === 'string')
    return { kind: 'blob', encoding: 'base64', value: value.base64, bytes: canonicalBinaryBytes(value.base64) } as const;
  throw Error(text.invalid);
}

/** 绑定准确已加载行，不把网格显示、草稿或列搜索当作整行来源。 */
export function postgresReadonlyRecord(page: PostgresTablePage, index: number, scope: () => boolean): ReadonlyRecordViewSource {
  const token = page.exportToken, row = page.rows[index], columns = page.columns;
  if (!token || !row || !scope()) throw Error(text.stale);
  const entries = columns.map((column, position) => {
    if (column.key !== 'c' + position) throw Error(text.invalid);
    const raw = ownCell(row, column.key);
    const { key, name, type, generated, binary } = column;
    return { column, binary, raw, field: { key, name, type, generated, value: originalValue(raw, column) } };
  });
  const documentFields = entries.map(entry => entry.field);
  let revoked = false;
  function current(): boolean {
    if (revoked) return false;
    revoked = !scope() || page.exportToken !== token || page.rows[index] !== row || page.columns !== columns || columns.length !== entries.length ||
      entries.some(({ column, raw, binary, field }, position) => columns[position] !== column || column.key !== field.key ||
        column.name !== field.name || column.type !== field.type || column.generated !== field.generated || column.binary !== binary ||
        ownCell(row, field.key) !== raw || (field.value.kind === 'blob' &&
          (typeof raw !== 'object' || raw?.type !== 'binary' || raw.base64 !== field.value.value)));
    return !revoked;
  }
  return {
    current,
    fields: documentFields.map(({ name, type, generated, value }) => ({ name, type, generated, kind: value.kind,
      raw: value.kind === 'null' ? null : value.value,
      parse: value.kind === 'text' && /^(?:jsonb?|text|character(?: varying)?(?:\(\d+\))?)$/.test(type),
      ...(value.kind === 'blob' ? { bytes: value.bytes } : {}),
    })),
    json() {
      if (!current()) throw Error(text.stale);
      let units = 0;
      for (const field of documentFields) {
        units += field.key.length + field.name.length + field.type.length + (field.value.kind === 'null' ? 0 : field.value.value.length);
        if (units > budget.units) throw Error(text.limited);
      }
      const output = JSON.stringify({ format: 'tabrelio-postgresql-record-view', version: 1, complete: true, fields: documentFields }, null, 2);
      assertTextInputBudget(output, budget);
      return output;
    },
  };
}
