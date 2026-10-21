import type { TableInfo } from '../shared/contracts';
import { queryParameterLimits } from '../shared/queryParameters';
import { tableQueryTemplateZh as text } from './locales/tableQueryTemplate.zh-CN';

export const tableQueryTemplateKinds = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;
export type TableQueryTemplateKind = typeof tableQueryTemplateKinds[number];
const limits = { columns: 4096, indexes: 512, units: 256 * 1024 } as const;

/** 与MySQL／MariaDB标识符引用规则一致；名称不作为注释或参数名拼接。 */
function quote(value: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 64 || value.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw Error(text.invalid);
  return '`' + value.replaceAll('`', '``') + '`';
}
/** 只投影与模板相关的有界元数据，不复制DDL、注释、默认值或任何表数据。 */
function source(info: TableInfo) {
  quote(info.database); quote(info.name);
  if (!Array.isArray(info.columns) || !info.columns.length || info.columns.length > limits.columns || !Array.isArray(info.indexes) || info.indexes.length > limits.indexes || !Array.isArray(info.primaryKey) || !Array.isArray(info.editableKey)) throw Error(text.budget);
  const columns = info.columns.map(column => { quote(column.name); if (typeof column.generated !== 'boolean' || typeof column.nullable !== 'boolean' || typeof column.extra !== 'string' || typeof column.type !== 'string' || column.extra.length > 4096 || column.type.length > 4096) throw Error(text.invalid); return { name: column.name, generated: column.generated, nullable: column.nullable, extra: column.extra, type: column.type }; });
  if (new Set(columns.map(column => column.name)).size !== columns.length) throw Error(text.invalid);
  const key = (value: string[]) => { if (value.length > columns.length || new Set(value).size !== value.length || value.some(name => !columns.some(column => column.name === name))) throw Error(text.invalid); return [...value]; };
  const indexes = info.indexes.map(index => { if (typeof index.unique !== 'boolean' || !Array.isArray(index.columns) || index.columns.length > limits.columns || index.columns.some(name => typeof name !== 'string' || name.length > 4096)) throw Error(text.invalid); return { unique: index.unique, columns: index.columns.every(name => columns.some(column => column.name === name)) && new Set(index.columns).size === index.columns.length ? [...index.columns] : [] }; });
  return { database: info.database, name: info.name, kind: info.objectKind, columns, primary: key(info.primaryKey), key: key(info.editableKey), indexes };
}
/** 原结构相关字段变化即改变身份；不把相同表名当成原先的表结构。 */
export function tableQueryTemplateMetadataKey(info: TableInfo): string { return JSON.stringify(source(info)); }

/** 生成可审阅的单语句草稿，所有值保留为ASCII参数，不猜测业务值或执行SQL。 */
export function buildTableQueryTemplate(info: TableInfo, kind: TableQueryTemplateKind, resultLimit: number): { sql: string; parameters: number } {
  const metadata = source(info), target = quote(metadata.database) + '.' + quote(metadata.name);
  if (!tableQueryTemplateKinds.includes(kind) || !Number.isSafeInteger(resultLimit) || resultLimit < 1 || resultLimit > 100000) throw Error(text.invalid);
  let body: string, parameters = 0;
  if (kind === 'SELECT') body = `SELECT\n${metadata.columns.map(column => '  ' + quote(column.name)).join(',\n')}\nFROM ${target}\nLIMIT ${resultLimit};`;
  else {
    if (metadata.kind !== 'table') throw Error(text.readonly);
    const writable = metadata.columns.filter(column => !column.generated && !/\bauto_increment\b/i.test(column.extra) && !/\b(?:VIRTUAL|STORED|PERSISTENT)\s+GENERATED\b/i.test(column.extra));
    if (kind === 'INSERT') { parameters = writable.length; body = writable.length ? `INSERT INTO ${target}\nSET\n${writable.map((column, index) => `  ${quote(column.name)} = :value_${index + 1}`).join(',\n')};` : `INSERT INTO ${target} () VALUES ();`; }
    else {
      const same = (columns: readonly string[]) => columns.length === metadata.key.length && columns.every((name, index) => name === metadata.key[index]);
      if (!metadata.key.length || metadata.key.some(name => metadata.columns.find(column => column.name === name)!.nullable) || !same(metadata.primary) && !metadata.indexes.some(index => index.unique && same(index.columns))) throw Error(text.key);
      const where = metadata.key.map((name, index) => `  ${quote(name)} = :key_${index + 1}`).join('\n  AND ');
      parameters = metadata.key.length;
      if (kind === 'DELETE') body = `DELETE FROM ${target}\nWHERE\n${where}\nLIMIT 1;`;
      else { const changes = writable.filter(column => !metadata.key.includes(column.name)); if (!changes.length) throw Error(text.noUpdates); parameters += changes.length; body = `UPDATE ${target}\nSET\n${changes.map((column, index) => `  ${quote(column.name)} = :value_${index + 1}`).join(',\n')}\nWHERE\n${where}\nLIMIT 1;`; }
    }
  }
  const sql = text.generatedComment + '\n' + body;
  if (parameters > queryParameterLimits.names || sql.length > limits.units) throw Error(text.budget);
  return { sql, parameters };
}
