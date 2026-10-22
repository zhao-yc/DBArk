import type { TableInfo } from '../shared/contracts';
import { queryParameterLimits } from '../shared/queryParameters';
import { tableQueryTemplateZh as text } from './locales/tableQueryTemplate.zh-CN';

export const tableQueryTemplateKinds = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;
export type TableQueryTemplateKind = typeof tableQueryTemplateKinds[number];
export interface TableQueryTemplateOptions { columns: readonly string[]; }
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

/** 可选列始终来自当前结构；写模板继续要求真实普通表及完整非空可靠定位键。 */
function candidateColumns(metadata: ReturnType<typeof source>, kind: TableQueryTemplateKind): string[] {
  if (!tableQueryTemplateKinds.includes(kind)) throw Error(text.invalid);
  if (kind === 'SELECT') return metadata.columns.map(column => column.name);
  if (metadata.kind !== 'table') throw Error(text.readonly);
  const writable = metadata.columns.filter(column => !column.generated && !/\bauto_increment\b/i.test(column.extra) && !/\b(?:VIRTUAL|STORED|PERSISTENT)\s+GENERATED\b/i.test(column.extra)).map(column => column.name);
  if (kind === 'INSERT') return writable;
  const same = (columns: readonly string[]) => columns.length === metadata.key.length && columns.every((name, index) => name === metadata.key[index]);
  if (!metadata.key.length || metadata.key.some(name => metadata.columns.find(column => column.name === name)!.nullable) || !same(metadata.primary) && !metadata.indexes.some(index => index.unique && same(index.columns))) throw Error(text.key);
  return kind === 'DELETE' ? [] : writable.filter(name => !metadata.key.includes(name));
}
/** 返回有界候选名称，不因默认候选超过参数上限阻止用户精简宽表。 */
export function tableQueryTemplateColumns(info: TableInfo, kind: TableQueryTemplateKind): string[] { return candidateColumns(source(info), kind); }

/** 显式选列严格校验全部输入，保留请求顺序，不把非法列静默过滤成另一条SQL。 */
function selectedColumns(candidates: string[], kind: TableQueryTemplateKind, options: TableQueryTemplateOptions | undefined): readonly string[] {
  if (options === undefined) return candidates;
  if (kind === 'DELETE' || options === null || typeof options !== 'object' || Array.isArray(options) || Reflect.ownKeys(options).length !== 1 || !Object.hasOwn(options, 'columns')) throw Error(text.invalid);
  const descriptor = Object.getOwnPropertyDescriptor(options, 'columns');
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || !Array.isArray(descriptor.value)) throw Error(text.invalid);
  // 不执行调用方数组的迭代器或索引getter；每个选项只能是有界、自有的数据属性。
  const supplied: unknown[] = descriptor.value, lengthDescriptor = Object.getOwnPropertyDescriptor(supplied, 'length');
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) throw Error(text.invalid);
  const length: number = lengthDescriptor.value;
  if (length > limits.columns) throw Error(text.budget);
  if (Reflect.ownKeys(supplied).length !== length + 1) throw Error(text.invalid);
  const selected: string[] = [], allowed = new Set(candidates), seen = new Set<string>();
  for (let index = 0; index < length; index++) {
    const item = Object.getOwnPropertyDescriptor(supplied, String(index));
    if (!item || !Object.hasOwn(item, 'value') || typeof item.value !== 'string' || !allowed.has(item.value) || seen.has(item.value)) throw Error(text.invalid);
    seen.add(item.value); selected.push(item.value);
  }
  return selected;
}

/** 生成可审阅的单语句草稿，所有值保留为ASCII参数，不猜测业务值或执行SQL。 */
export function buildTableQueryTemplate(info: TableInfo, kind: TableQueryTemplateKind, resultLimit: number, options?: TableQueryTemplateOptions): { sql: string; parameters: number } {
  const metadata = source(info), target = quote(metadata.database) + '.' + quote(metadata.name);
  if (!tableQueryTemplateKinds.includes(kind) || !Number.isSafeInteger(resultLimit) || resultLimit < 1 || resultLimit > 100000) throw Error(text.invalid);
  const selected = selectedColumns(candidateColumns(metadata, kind), kind, options);
  let body: string, parameters = 0;
  if (kind === 'SELECT') { if (!selected.length) throw Error(text.fieldRequired); body = `SELECT\n${selected.map(name => '  ' + quote(name)).join(',\n')}\nFROM ${target}\nLIMIT ${resultLimit};`; }
  else {
    if (kind === 'INSERT') { parameters = selected.length; body = selected.length ? `INSERT INTO ${target}\nSET\n${selected.map((name, index) => `  ${quote(name)} = :value_${index + 1}`).join(',\n')};` : `INSERT INTO ${target} () VALUES ();`; }
    else {
      const where = metadata.key.map((name, index) => `  ${quote(name)} = :key_${index + 1}`).join('\n  AND ');
      parameters = metadata.key.length;
      if (kind === 'DELETE') body = `DELETE FROM ${target}\nWHERE\n${where}\nLIMIT 1;`;
      else { if (!selected.length) throw Error(text.noUpdates); parameters += selected.length; body = `UPDATE ${target}\nSET\n${selected.map((name, index) => `  ${quote(name)} = :value_${index + 1}`).join(',\n')}\nWHERE\n${where}\nLIMIT 1;`; }
    }
  }
  const sql = text.generatedComment + '\n' + body;
  if (parameters > queryParameterLimits.names || sql.length > limits.units) throw Error(text.budget);
  return { sql, parameters };
}
