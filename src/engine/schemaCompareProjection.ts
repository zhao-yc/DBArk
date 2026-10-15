import type { SchemaCompareCategory, SchemaCompareDifference, SchemaCompareReport, SchemaCompareStatus } from '../shared/schemaCompare';
import { hasUnprovenBinaryDefault, type TableDefinitionContext } from '../shared/tableColumnPatches';
import { structureDocumentOf } from './structureDefinition';
import { tableDefinitionTokens } from './tableColumnDefinition';
import { readTableIndexDefinition } from './tableIndexDefinition';
import { readTableForeignKeyDefinition } from './tableForeignKeyDefinition';
import type { SchemaComparisonSnapshot } from './schemaCompare';

interface Item { name: string; rawSql: string; ordinal?: number; properties: Record<string, unknown>; reasons: string[]; }
interface Projection { items: Record<SchemaCompareCategory, Item[]>; unknownConstraints: boolean; tail: string; }

/** 仅忽略布局和普通注释。文字量、标识符、数值精度与可执行注释都逐字保留，不猜表达式等价。 */
function lexical(sql: string, context: TableDefinitionContext): unknown {
  return tableDefinitionTokens(sql, context).map(token => [token.kind, token.value]);
}

/** 投影来自同一 SHOW CREATE 文档与校验目录；保留全部未覆盖片段并使未知性显式传播。 */
function project(snapshot: SchemaComparisonSnapshot): Projection {
  const document = structureDocumentOf(snapshot), context = document.context;
  if (document.table !== snapshot.target.table || document.database !== undefined && document.database !== snapshot.target.database) throw new Error('比较快照目标与原定义不一致');
  const indexes = readTableIndexDefinition(document), foreignKeys = readTableForeignKeyDefinition(document, snapshot.target.database, snapshot.serverVersion);
  const encoding = new Map(snapshot.encodings.map(value => [value.name, value]));
  const items: Projection['items'] = { columns: [], indexes: [], foreignKeys: [], unclassified: [] };
  for (const column of document.columns) {
    const reasons: string[] = [];
    if (!column.type.known) reasons.push('字段类型未被完整识别');
    if (column.attributes.some(value => value.kind === 'opaque')) reasons.push('字段含未知属性片段');
    if (column.attributes.some(value => value.kind === 'check')) reasons.push('字段 CHECK 约束不在首阶段可可靠比较范围内');
    if (column.default.kind === 'opaque') reasons.push(column.default.reason);
    if (tableDefinitionTokens(column.raw, context).some(value => value.kind === 'executable')) reasons.push('字段含可执行注释');
    if (hasUnprovenBinaryDefault(column)) reasons.push('二进制默认值原始字节不能从显示文本证明');
    if (column.nullable === undefined) reasons.push('无法确认真实可空性');
    const codec = encoding.get(column.name);
    if (!codec) reasons.push('缺少字段实际字符集与排序规则');
    const value = column.default;
    items.columns.push({ name: column.name, rawSql: column.raw, ordinal: column.ordinal, reasons,
      properties: { type: lexical(column.type.raw, context), nullable: column.nullable, default: value.kind === 'expression' ? { kind: value.kind, sql: lexical(value.sql, context) } : value,
        comment: column.comment, position: column.ordinal, charset: codec?.charset, collation: codec?.collation,
        // 生成列、ON UPDATE、可见性、SRID 等已识别属性也逐项参与，不能因编辑器只读而消失。
        attributes: column.attributes.filter(value => !['nullable', 'default', 'comment', 'charset', 'collation'].includes(value.kind)).map(value => [value.kind, lexical(value.raw, context)]) } });
  }
  for (const index of indexes.indexes) items.indexes.push({ name: index.name || `未命名索引@${index.range.start}`, rawSql: index.rawSql, reasons: [...index.opaqueReasons],
    properties: { kind: index.kind, method: index.method, comment: index.comment, parts: index.parts.map(part => ({ column: part.columnName, prefix: part.prefixLength, direction: part.direction, expression: part.expressionSql ? lexical(part.expressionSql, context) : undefined })),
      attributes: index.attributes.filter(value => !['method', 'comment'].includes(value.kind)).map(value => lexical(value.rawSql, context)) } });
  for (const key of foreignKeys.foreignKeys) items.foreignKeys.push({ name: key.name || `未命名外键@${key.range.start}`, rawSql: key.rawSql, reasons: [...key.opaqueReasons],
    // 父库/父表按原身份比较，不把源库自动映射为目标库，也不将自引用名偷偷替换。
    properties: { childColumns: key.childColumnNames, parent: key.parentTarget, parentColumns: key.parentColumnNames, onUpdate: key.onUpdate, onDelete: key.onDelete, definition: lexical(key.rawSql, context) } });
  const classified = new Set([...indexes.indexes, ...foreignKeys.foreignKeys].map(item => item.range.start));
  for (const constraint of document.items.filter(value => value.kind === 'constraint' && !classified.has(value.range.start))) items.unclassified.push({ name: `其它约束@${constraint.range.start}`, rawSql: constraint.raw, properties: {}, reasons: ['CHECK 或其它约束不在首阶段可可靠比较范围内'] });
  // 列内未知 REFERENCES 也可能隐藏出向外键；此时不能证明另一侧某个外键不存在。
  return { items, unknownConstraints: !foreignKeys.complete || items.unclassified.length > 0, tail: document.tail.raw };
}

/** 纯源→目标比较。新增表示目标需新增，删除表示目标多出；名称精确配对，不推断重命名。 */
export function compareSchemaSnapshots(source: SchemaComparisonSnapshot, target: SchemaComparisonSnapshot): SchemaCompareReport {
  const left = project(source), right = project(target), rows: SchemaCompareDifference[] = [];
  const crossDialect = source.context.dialect !== target.context.dialect;
  for (const category of ['columns', 'indexes', 'foreignKeys', 'unclassified'] as const) {
    const a = new Map(left.items[category].map(item => [item.name, item])), b = new Map(right.items[category].map(item => [item.name, item]));
    for (const name of new Set([...a.keys(), ...b.keys()])) {
      const old = a.get(name), next = b.get(name), reasons = [...(old?.reasons ?? []), ...(next?.reasons ?? [])];
      if (crossDialect) reasons.push('源与目标方言不同，无法证明定义语义可直接比较');
      if ((category === 'indexes' || category === 'foreignKeys') && (!old || !next) && (left.unknownConstraints || right.unknownConstraints)) reasons.push('存在未分类约束，无法证明另一侧不存在同类对象');
      const changedProperties = old && next ? [...new Set([...Object.keys(old.properties), ...Object.keys(next.properties)])].filter(key => JSON.stringify(old.properties[key]) !== JSON.stringify(next.properties[key])) : [];
      const status: SchemaCompareStatus = reasons.length ? 'unknown' : !next ? 'added' : !old ? 'removed' : changedProperties.length ? 'changed' : 'same';
      rows.push({ category, name, status, source: old ? { rawSql: old.rawSql, ordinal: old.ordinal } : undefined, target: next ? { rawSql: next.rawSql, ordinal: next.ordinal } : undefined, reasons: [...new Set(reasons)], changedProperties });
    }
  }
  const counts = { added: 0, removed: 0, changed: 0, same: 0, unknown: 0 };
  for (const row of rows) counts[row.status]++;
  return { source: { ...source.target }, target: { ...target.target }, direction: 'source-to-target', mode: 'read-only-definition', rows, counts, comparable: counts.unknown === 0,
    sourceVersion: source.serverVersion, targetVersion: target.serverVersion,
    ignored: ['仅比较两张明确配对表的字段、主键/索引及出向外键；不代表完整 M02 已完成', '表选项、分区、CHECK、触发器、入向外键及其它对象未进行语义比较', '名称精确且区分大小写配对；不推断重命名，不自动映射父库/父表', '默认值与表达式保守按精确定义比较；不证明跨版本语义等价', '两个独立读取时点不构成跨服务器事务快照；只拒绝读取期间已观察到的变化', '比较阶段不执行 DDL；SQL 审查稿的支持范围另行列出'],
    ignoredFragments: [{ side: 'source', category: 'tableOptions', rawSql: left.tail }, { side: 'target', category: 'tableOptions', rawSql: right.tail }] };
}
