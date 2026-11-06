import type { ResultExportData } from '../shared/contracts';
import type { PostgresRecordTransfer } from './postgresRecordTransfer';
import { resultInsertZh as text } from './locales/resultInsert.zh-CN';

export function networkQueryTransferSource(snapshot: PostgresRecordTransfer | undefined) {
  const source = snapshot?.source;
  return source && 'title' in source && (!source.dialect || source.dialect === 'sqlite') ? source : undefined;
}

/** 保留数值及字节原文；网络数值列无法通用保真表示无穷、NaN 或负零，交由文本目标明确保存。 */
export function networkQueryTransferData(snapshot: PostgresRecordTransfer): { data: ResultExportData; textOnly: ReadonlySet<string> } {
  const source = networkQueryTransferSource(snapshot);
  if (!source || source.dialect === 'sqlite' && snapshot.sqliteStorage?.length !== snapshot.rows.length) throw Error(text.invalid);
  const columns = snapshot.columns.map(({ key, name }) => ({ key, name })), textOnly = new Set<string>();
  const rows = snapshot.rows.map((row, index) => Object.fromEntries(snapshot.columns.map(({ key, type }, position) => {
    const value = row.get(key);
    if (value === undefined) throw Error(text.invalid);
    const numeric = source.dialect === 'sqlite' ? snapshot.sqliteStorage?.[index]?.[position] === 'r' :
      /^(?:real|double precision|numeric|float4|float8)$/.test(type);
    if (numeric && typeof value === 'string' && /^(?:-0|NaN|[+-]?Infinity)$/.test(value)) textOnly.add(key);
    return [key, value];
  })));
  return { data: { columns, rows, truncated: source.truncated }, textOnly };
}
