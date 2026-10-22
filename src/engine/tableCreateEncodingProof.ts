import type { TableEncodingPair } from '../shared/tableDefaultEncoding';
import type { TableDefaultEncodingDefinition } from './tableDefaultEncodingSql';

/** SHOW可省略字符集默认排序规则，但显式矛盾或未知语法仍不能进入目录补证。 */
export function tableCreateShownEncodingProof(request: { charset: string; collation?: string }, shown: TableDefaultEncodingDefinition): 'inherited' | 'shown' | 'default-required' | 'invalid' {
  if (request.collation === undefined) return 'inherited';
  if (shown.reasons.length || shown.charset !== request.charset || shown.collation !== undefined && shown.collation !== request.collation) return 'invalid';
  return shown.collation === undefined ? 'default-required' : 'shown';
}

/** 只接受同一真实CHARACTER_SETS行中的准确名称及默认排序规则，不猜utf8别名或general_ci。 */
export function tableCreateDefaultEncodingRowsMatch(rows: unknown, request: TableEncodingPair): boolean {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') return false;
  const row = rows[0] as Record<string, unknown>;
  return row.name === request.charset && row.collation === request.collation;
}
