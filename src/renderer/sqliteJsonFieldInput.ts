import { sqliteEditValueSchema, sqliteTableEditLimits, type SqliteEditColumn, type SqliteOriginalValue } from '../shared/sqliteTableEdit';
import type { LexicalPathSegment, ReadyLexicalDocument } from './jsonLexicalTree';
import type { RecordStructureAction, RecordStructureKind } from './recordJsonStructureInput';
import { beginRecordJsonFieldInput, changeRecordJsonFieldInput, applyRecordJsonFieldInput, type RecordJsonFieldInput } from './recordJsonFieldInput';
import { sqliteRecordTreeZh as text } from './locales/sqliteRecordTree.zh-CN';

export interface SqliteJsonFieldInput extends RecordJsonFieldInput {
  readonly source: SqliteOriginalValue;
}

/** 节点编辑只接受当前TEXT完整原文；声明名为JSON不代表实际值一定是TEXT。 */
export function beginSqliteJsonFieldInput(column: SqliteEditColumn, source: SqliteOriginalValue | undefined, document: ReadyLexicalDocument, segments: readonly LexicalPathSegment[], kind?: RecordStructureKind): SqliteJsonFieldInput {
  if (!source || source.kind !== 'text' || source.value !== document.text) throw Error(text.stale);
  if (column.generated || source.value.length > sqliteTableEditLimits.valueUnits) throw Error(text.readonly);
  return Object.freeze({ ...beginRecordJsonFieldInput(column.name, document, segments, kind), source });
}

export function changeSqliteJsonFieldInput(input: SqliteJsonFieldInput, change: string | RecordStructureAction): SqliteJsonFieldInput {
  return Object.freeze({ ...changeRecordJsonFieldInput(input, change), source: input.source });
}

/** 修改完整词法文档后仍需核对原字段和 SQLite 写入预算。 */
export function applySqliteJsonFieldInput(input: SqliteJsonFieldInput, current: SqliteOriginalValue | undefined): SqliteOriginalValue {
  if (current !== input.source || current?.kind !== 'text' || current.value !== input.base.value.document.text) throw Error(text.stale);
  const result = sqliteEditValueSchema.safeParse({ kind: 'text', value: applyRecordJsonFieldInput(input).text });
  if (!result.success) throw Error(text.limited);
  return result.data;
}
