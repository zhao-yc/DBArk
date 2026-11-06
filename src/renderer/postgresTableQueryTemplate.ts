import { postgresIdentifier, postgresRelationName } from '../shared/postgresSql';
import type { PostgresTablePage } from '../shared/postgresTable';
import { queryParameterLimits } from '../shared/queryParameters';
import { tableQueryTemplateZh as text } from './locales/tableQueryTemplate.zh-CN';
import { selectedTemplateColumns, tableQueryTemplateKinds, type TableQueryTemplateKind, type TableQueryTemplateOptions } from './tableQueryTemplate';

export interface PostgresTemplateSource {
  table: string;
  page: PostgresTablePage;
}

/** 从真实表页列目录选择字段；写入模板必须符合该页已经确认的操作权限。 */
export function postgresTableTemplateColumns({ page }: PostgresTemplateSource, kind: TableQueryTemplateKind): string[] {
  const names = page.columns.map(column => column.name);
  if (!tableQueryTemplateKinds.includes(kind) || !names.length || names.length > 1022 || new Set(names).size !== names.length) throw Error(text.invalid);
  if (kind === 'SELECT') return names;
  if (page.relationKind !== 'r') throw Error(text.readonly);
  if (kind !== 'INSERT' && (!page.columns.some(column => column.primary) ||
      page.columns.some(column => column.primary && column.nullable))) throw Error(text.postgresKey);
  const operation = kind === 'INSERT' ? 'insert' : kind === 'UPDATE' ? 'update' : 'delete';
  if (!page.capabilities[operation]) throw Error(text.postgresPermission);
  if (kind === 'DELETE') return [];
  return page.columns.filter(column => !column.generated && !column.identityAlways && !column.sequenceDefault &&
    (kind === 'INSERT' || !column.primary)).map(column => column.name);
}

/** PostgreSQL 的 ONLY 将普通表操作限定在原关系，避免同键的继承子表记录进入写入范围。 */
export function buildPostgresTableQueryTemplate(source: PostgresTemplateSource, kind: TableQueryTemplateKind, limit: number,
  options?: TableQueryTemplateOptions): { sql: string; parameters: number } {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100000) throw Error(text.invalid);
  const { schema, name } = postgresRelationName(source.table);
  const target = postgresIdentifier(schema) + '.' + postgresIdentifier(name);
  const only = source.page.relationKind === 'r' ? 'ONLY ' + target : target;
  const selected = selectedTemplateColumns(postgresTableTemplateColumns(source, kind), kind, options);
  const columns = selected.map(postgresIdentifier);
  let body: string, parameters = 0;
  if (kind === 'SELECT') {
    if (!columns.length) throw Error(text.fieldRequired);
    body = `SELECT\n  ${columns.join(',\n  ')}\nFROM ${only}\nLIMIT ${limit};`;
  } else if (kind === 'INSERT') {
    parameters = columns.length;
    body = columns.length ? `INSERT INTO ${target}\n  (${columns.join(', ')})\nVALUES\n  (${columns.map((_, index) => '$' + (index + 1)).join(', ')});`
      : `INSERT INTO ${target} DEFAULT VALUES;`;
  } else {
    if (kind === 'UPDATE' && !columns.length) throw Error(text.noUpdates);
    const key = source.page.columns.filter(column => column.primary).map(column => postgresIdentifier(column.name));
    const where = key.map((column, index) => `${column} = $${columns.length + index + 1}`).join('\n  AND ');
    parameters = columns.length + key.length;
    body = kind === 'DELETE' ? `DELETE FROM ${only}\nWHERE\n  ${where};`
      : `UPDATE ${only}\nSET\n  ${columns.map((column, index) => `${column} = $${index + 1}`).join(',\n  ')}\nWHERE\n  ${where};`;
  }
  const sql = text.postgresGeneratedComment + '\n' + body;
  if (parameters > queryParameterLimits.names || sql.length > 256 * 1024) throw Error(text.budget);
  return { sql, parameters };
}
