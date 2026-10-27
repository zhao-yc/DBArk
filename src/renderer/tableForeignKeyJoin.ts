import type { TableInfo } from '../shared/contracts';
import { tableForeignKeyJoinZh as text } from './locales/tableForeignKeyJoin.zh-CN';

export const foreignKeyJoinLimits = { columns: 4096, foreignKeys: 512, mappingColumns: 4096, metadataUnits: 2 * 1024 * 1024, outputColumns: 1024, sqlUnits: 256 * 1024 } as const;
export interface ForeignKeyJoinChoice { name: string; columns: string[]; referencedDatabase: string; referencedTable: string; referencedColumns: string[] }
export interface ForeignKeyJoinColumn { side: 'child' | 'parent'; column: string; alias: string }
export interface ForeignKeyJoinOptions { childColumns: readonly string[]; parentColumns: readonly string[] }
type Budget = { units: number };

/** 只读自有数据属性；不会为了生成SELECT访问DDL、默认值、注释或调用访问器。 */
function own(value: unknown, key: string, optional = false): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(text.invalid);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) { if (optional) return undefined; throw Error(text.invalid); }
  if (!('value' in descriptor)) throw Error(text.invalid);
  return descriptor.value;
}

/** 数量在枚举前检查，拒绝稀疏数组和附加字段，不执行自定义迭代器。 */
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw Error(text.invalid);
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0) throw Error(text.invalid);
  if (length > maximum) throw Error(text.budget);
  if (Reflect.ownKeys(value).length !== length + 1) throw Error(text.invalid);
  const copy: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    if (!item || !('value' in item)) throw Error(text.invalid);
    copy.push(item.value);
  }
  return copy;
}

/** 按JSON转义后的UTF16长度计入整体预算，拒绝孤立代理项且不先序列化超大字符串。 */
function string(value: unknown, maximum: number, budget: Budget, empty = true): string {
  if (typeof value !== 'string' || !empty && !value.length) throw Error(text.invalid);
  if (value.length > maximum) throw Error(text.budget);
  let size = 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw Error(text.invalid);
      size += 2;
    } else if (code >= 0xdc00 && code <= 0xdfff) throw Error(text.invalid);
    else size += code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code) ? 2 : code < 32 ? 6 : 1;
  }
  budget.units += size;
  if (budget.units > foreignKeyJoinLimits.metadataUnits) throw Error(text.budget);
  return value;
}
function identifier(value: unknown, budget: Budget): string {
  const result = string(value, 64, budget, false);
  if (result.includes('\0')) throw Error(text.invalid);
  return result;
}
function flag(value: unknown): boolean { if (typeof value !== 'boolean') throw Error(text.invalid); return value; }
const quote = (value: string) => '`' + value.replaceAll('`', '``') + '`';

/** 快照只包括SELECT及关联身份有关的属性；完整外键目录参与失效检查。 */
function snapshot(info: TableInfo) {
  const budget = { units: 0 };
  if (own(info, 'objectKind', true) !== 'table') throw Error(text.ordinary);
  const database = identifier(own(info, 'database'), budget), name = identifier(own(info, 'name'), budget);
  const engine = string(own(info, 'engine'), 128, budget);
  const optional = (record: unknown, key: string) => { const value = own(record, key, true); return value == null ? null : string(value, 255, budget); };
  const columns = array(own(info, 'columns'), foreignKeyJoinLimits.columns).map(value => {
    budget.units += 128;
    return { name: identifier(own(value, 'name'), budget), type: string(own(value, 'type'), 4096, budget, false), nullable: flag(own(value, 'nullable')), generated: flag(own(value, 'generated')), extra: string(own(value, 'extra'), 4096, budget), characterSet: optional(value, 'characterSet') };
  });
  const names = new Set(columns.map(column => column.name));
  if (!columns.length || names.size !== columns.length) throw Error(text.columns);
  const list = (value: unknown) => array(value, foreignKeyJoinLimits.mappingColumns).map(item => identifier(item, budget));
  const foreignKeys = array(own(info, 'foreignKeys'), foreignKeyJoinLimits.foreignKeys).map(value => {
    budget.units += 128;
    const key = { name: identifier(own(value, 'name'), budget), columns: list(own(value, 'columns')), referencedDatabase: identifier(own(value, 'referencedDatabase'), budget), referencedTable: identifier(own(value, 'referencedTable'), budget), referencedColumns: list(own(value, 'referencedColumns')), onUpdate: string(own(value, 'onUpdate'), 64, budget, false), onDelete: string(own(value, 'onDelete'), 64, budget, false) };
    if (!key.columns.length || key.columns.length !== key.referencedColumns.length || new Set(key.columns).size !== key.columns.length || new Set(key.referencedColumns).size !== key.referencedColumns.length || key.columns.some(column => !names.has(column))) throw Error(text.relation);
    return key;
  });
  if (new Set(foreignKeys.map(key => key.name)).size !== foreignKeys.length) throw Error(text.relation);
  const result = { database, name, kind: 'table' as const, engine, charset: optional(info, 'charset'), collation: optional(info, 'collation'), columns, foreignKeys };
  if (JSON.stringify(result).length > foreignKeyJoinLimits.metadataUnits) throw Error(text.budget);
  return result;
}

/** 结构签名不持有原对象引用；列重排、类型及任一外键变化都会使旧预览失效。 */
export function foreignKeyJoinMetadataKey(info: TableInfo): string { return JSON.stringify(snapshot(info)); }

/** 仅返回真实、完整的出向外键；返回副本不能改写原表元数据。 */
export function foreignKeyJoinChoices(child: TableInfo): ForeignKeyJoinChoice[] {
  return snapshot(child).foreignKeys.map(key => ({ name: key.name, columns: [...key.columns], referencedDatabase: key.referencedDatabase, referencedTable: key.referencedTable, referencedColumns: [...key.referencedColumns] }));
}

/** 显式选列整份校验且保持请求顺序，不能把错列静默过滤为另一条查询。 */
function selected(value: unknown, columns: { name: string }[]): string[] {
  const supplied = array(value, foreignKeyJoinLimits.columns);
  const names = new Set(columns.map(column => column.name)), seen = new Set<string>();
  return supplied.map(item => {
    if (typeof item !== 'string' || !names.has(item) || seen.has(item)) throw Error(text.columns);
    seen.add(item); return item;
  });
}

/** 别名绑定原列序号而非选中顺序；截断按Unicode字符进行，不切坏代理对。 */
function alias(side: 'child' | 'parent', ordinal: number, name: string): string {
  const prefix = (side === 'child' ? 'c_' : 'p_') + ordinal + '_';
  let suffix = '';
  for (const character of name) { if (prefix.length + suffix.length + character.length > 64) break; suffix += character; }
  return prefix + suffix;
}

/** 生成MySQL/MariaDB独立只读单语句；不猜测主键、不继承父页条件，也不执行SQL。 */
export function buildForeignKeyJoin(child: TableInfo, parent: TableInfo, fkName: string, kind: 'LEFT' | 'INNER', limit: number, options?: ForeignKeyJoinOptions): { sql: string; columns: ForeignKeyJoinColumn[] } {
  if (kind !== 'LEFT' && kind !== 'INNER' || !Number.isSafeInteger(limit) || limit < 1 || limit > 100000) throw Error(text.invalid);
  const left = snapshot(child), right = snapshot(parent), relation = left.foreignKeys.find(key => key.name === fkName);
  if (!relation) throw Error(text.relation);
  if (right.database !== relation.referencedDatabase || right.name !== relation.referencedTable) throw Error(text.target);
  const parentNames = new Set(right.columns.map(column => column.name));
  if (relation.referencedColumns.some(column => !parentNames.has(column))) throw Error(text.relation);
  let childColumns: string[], parentColumns: string[];
  if (options === undefined) { childColumns = left.columns.map(column => column.name); parentColumns = right.columns.map(column => column.name); }
  else {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Reflect.ownKeys(options).length !== 2 || !Object.hasOwn(options, 'childColumns') || !Object.hasOwn(options, 'parentColumns')) throw Error(text.invalid);
    childColumns = selected(own(options, 'childColumns'), left.columns); parentColumns = selected(own(options, 'parentColumns'), right.columns);
  }
  const count = childColumns.length + parentColumns.length;
  if (!count) throw Error(text.columns);
  if (count > foreignKeyJoinLimits.outputColumns) throw Error(text.budget);
  const columns: ForeignKeyJoinColumn[] = [];
  for (const [side, selectedColumns, metadata] of [['child', childColumns, left], ['parent', parentColumns, right]] as const) {
    const ordinals = new Map(metadata.columns.map((column, index) => [column.name, index + 1]));
    for (const column of selectedColumns) columns.push({ side, column, alias: alias(side, ordinals.get(column)!, column) });
  }
  let sql = 'SELECT\n';
  const append = (part: string) => { if (sql.length + part.length > foreignKeyJoinLimits.sqlUnits) throw Error(text.budget); sql += part; };
  columns.forEach((column, index) => append(`  ${column.side === 'child' ? 'c' : 'p'}.${quote(column.column)} AS ${quote(column.alias)}${index + 1 === columns.length ? '\n' : ',\n'}`));
  append(`FROM ${quote(left.database)}.${quote(left.name)} AS c\n${kind} JOIN ${quote(right.database)}.${quote(right.name)} AS p\nON\n`);
  relation.columns.forEach((column, index) => append(`${index ? '  AND ' : '  '}c.${quote(column)} = p.${quote(relation.referencedColumns[index])}\n`));
  append(`LIMIT ${limit};`);
  return { sql, columns };
}
