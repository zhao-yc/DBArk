import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import type { SchemaComparisonSnapshot } from '../../src/engine/schemaCompare';

/** 用真实解析器构造已交叉核验的快照，测试不绕过原定义投影。 */
export function comparisonSnapshot(body: string, table = 't', database = 'db'): SchemaComparisonSnapshot {
  const context = { dialect: 'mysql' as const, mode: { ansiQuotes: false, noBackslashEscapes: false } };
  const source = `CREATE TABLE \`${table.replaceAll('`', '``')}\` (${body}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;
  const document = parseTableColumnDefinition(source, context);
  return { source, context, originalMode: '', normalizedMode: '', identity: '内部身份', namespace: { serverIdentity: `服务器:${table}`, identifierCase: 0 }, serverVersion: '8.4.11', target: { connectionId: table, database, table }, tableEncoding: { charset: 'utf8mb4', collation: 'utf8mb4_bin' }, nullability: document.columns.map(column => [column.name, column.nullable !== false]), encodings: document.columns.map(column => ({ name: column.name, charset: /char|text|enum|set/i.test(column.type.raw) ? 'utf8mb4' : null, collation: /char|text|enum|set/i.test(column.type.raw) ? 'utf8mb4_bin' : null })) };
}
