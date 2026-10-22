import { generatedColumnSchema, parseGeneratedColumnExpression, type GeneratedColumn } from './tableGeneratedColumn';
import type { ColumnTypePatch } from './tableColumnPatches';
import type { TableCreateDraft } from './tableCreate';

export type TableCreateNumericType = Extract<ColumnTypePatch, { kind: 'integer' | 'decimal' }>;
export interface TableCreateGeneratedReference { name: string; ordinal: number; type: TableCreateNumericType; }
export const tableCreateGeneratedMessages = {
  attributes: '新表生成列只支持可空整数/DECIMAL，不得自增，也不得包含DEFAULT或ON UPDATE属性',
  references: '新表生成表达式只能引用此前的普通非自增整数/DECIMAL字段，不能引用自身、后置字段或生成链',
  keys: '首批新表生成列自身不能作为索引或外键键部分；普通字段的索引和外键可以保留',
  names: '新表字段名称重复或无法唯一匹配，不能规划生成表达式',
  facts: '新表生成列实际版本、InnoDB支持、服务器身份或会话模式未完整证明；普通创建仍可继续',
  stale: '新表生成列实际能力已变化，请重新准备；未发送DDL',
  plan: '生成新表缺少本次已证明的专属能力或计划',
  planStale: '生成新表服务器、模式或完整计划已变化，请重新准备；未发送DDL',
  interrupted: '生成新表能力读取连接已取消或断开',
  unavailable: '生成新表的完整目录、版本或会话事实不能证明；普通新建表仍可继续',
  snapshot: '生成新表缺少本次真实能力快照，请重新准备；未发送DDL',
  target: '新表生成列首批仅开放InnoDB，库表名沿原安全引用合同精确核对',
  budget: '新表生成设计或真实目录超过独立预算',
  verify: '新表生成列完整定义与实际目录不能交叉证明',
  computation: '新表生成值由服务器按写入会话sql_mode计算；请核对精度、溢出与NULL传播，不支持自增来源或生成链。此操作仅创建新表，不重算任何既有表。',
} as const;
const text = tableCreateGeneratedMessages;

/** 只解析待建的精确数值声明；结果说明请求，不代表服务器目录或可写权限。 */
export function tableCreateNumericType(value: string): TableCreateNumericType | undefined {
  if (typeof value !== 'string' || value.length > 256) return;
  const type = value.trim(), integer = /^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)(?:\(([1-9]\d{0,2})\))?(?:\s+(UNSIGNED))?$/i.exec(type);
  if (integer) {
    if (integer[2] && Number(integer[2]) > 255) return;
    return { kind: 'integer', type: (integer[1].toUpperCase() === 'INTEGER' ? 'INT' : integer[1].toUpperCase()) as Extract<TableCreateNumericType, { kind: 'integer' }>['type'], unsigned: !!integer[3] };
  }
  const decimal = /^(?:DECIMAL|NUMERIC)(?:\(\s*([1-9]\d?)\s*(?:,\s*(\d{1,2})\s*)?\))?(?:\s+(UNSIGNED))?$/i.exec(type);
  if (!decimal) return;
  const precision = decimal[1] === undefined ? 10 : Number(decimal[1]), scale = decimal[2] === undefined ? 0 : Number(decimal[2]);
  if (precision > 65 || scale > 38 || scale > precision) return;
  return { kind: 'decimal', precision, scale, unsigned: !!decimal[3] };
}

/** 生成列属性必须显式安全；undefined自有键不能被当作省略DEFAULT/ON UPDATE。 */
export function assertTableCreateGeneratedColumn(column: { type: string; nullable: boolean; autoIncrement: boolean; defaultValue?: string | null; onUpdate?: unknown; generated?: GeneratedColumn }): void {
  if (!Object.hasOwn(column, 'generated')) return;
  if (!column.generated || !tableCreateNumericType(column.type) || column.nullable !== true || column.autoIncrement !== false || Object.hasOwn(column, 'defaultValue') || Object.hasOwn(column, 'onUpdate')) throw Error(text.attributes);
  const generated = generatedColumnSchema.parse(column.generated); parseGeneratedColumnExpression(generated.expression);
}

/** 返回0基位次的独立待建候选，绝不构造现表列、目录记录或editable权限。 */
export function tableCreateGeneratedReferenceColumns(design: Pick<TableCreateDraft, 'columns'>, ordinal: number): TableCreateGeneratedReference[] {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > design.columns.length) return [];
  const names = new Set<string>();
  for (const column of design.columns) { const folded = column.name.toLowerCase(); if (names.has(folded)) throw Error(text.names); names.add(folded); }
  return design.columns.slice(0, ordinal).flatMap((column, index) => {
    const type = tableCreateNumericType(column.type);
    return type && column.autoIncrement === false && !Object.hasOwn(column, 'generated') && !Object.hasOwn(column, 'onUpdate') ? [{ name: column.name, ordinal: index, type }] : [];
  });
}

/** 只限制实际生成列及其键成员；普通索引/FK不会因为旁列生成表达式而被整表禁止。 */
export function assertTableCreateGenerated(design: TableCreateDraft): void {
  const generated = new Set<string>();
  for (const [ordinal, column] of design.columns.entries()) {
    if (!Object.hasOwn(column, 'generated')) continue;
    assertTableCreateGeneratedColumn(column); generated.add(column.name);
    const allowed = new Set(tableCreateGeneratedReferenceColumns(design, ordinal).map(item => item.name));
    if (parseGeneratedColumnExpression(column.generated!.expression).referencedColumns.some(name => !allowed.has(name))) throw Error(text.references);
  }
  if (!generated.size) return;
  for (const index of design.indexes) {
    const names = 'keyParts' in index ? index.keyParts.map(part => part.columnName) : index.columns;
    if (names.some(name => generated.has(name))) throw Error(text.keys);
  }
  for (const key of design.foreignKeys) {
    if (key.columns.some(name => generated.has(name)) || key.referencedDatabase === design.database && key.referencedTable === design.name && key.referencedColumns.some(name => generated.has(name))) throw Error(text.keys);
  }
}
