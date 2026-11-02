import type { TableInfo } from '../shared/contracts';
import { relationshipDiagramZh as text } from './locales/relationshipDiagram.zh-CN';

export const relationshipDiagramLimits = { tables: 40, columns: 2000, foreignKeys: 300, parts: 64, targets: 100, catalog: 20000, page: 50 } as const;
export interface DiagramColumn { name: string; type: string; nullable: boolean; }
export interface DiagramForeignKey { name: string; columns: string[]; referencedDatabase: string; referencedTable: string; referencedColumns: string[]; onUpdate: string; onDelete: string; }
export interface DiagramTable { database: string; name: string; columns: DiagramColumn[]; primaryKey: string[]; foreignKeys: DiagramForeignKey[]; }
export interface DiagramNode { id: string; database: string; name: string; external: boolean; columns: DiagramColumn[]; primaryKey: string[]; foreignColumns: string[]; x: number; y: number; width: number; height: number; }
export interface DiagramEdge { id: string; source: string; target: string; key: DiagramForeignKey; path: string; }
export interface RelationshipDiagram { nodes: DiagramNode[]; edges: DiagramEdge[]; width: number; height: number; tables: DiagramTable[]; }
export const diagramTableId = (database: string, table: string) => JSON.stringify([database, table]);
const fail = (): never => { throw Error(text.invalid); };
/** 只读取普通自有数据字段；数据库文字不参与DOM编号、样式或可执行内容。 */
function own(value: unknown, key: string): unknown { if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail(); const field = Object.getOwnPropertyDescriptor(value, key); return field && Object.hasOwn(field, 'value') ? field.value : fail(); }
function label(value: unknown, maximum = 512): string { return typeof value === 'string' && value.length > 0 && value.length <= maximum && !value.includes('\0') ? value : fail(); }
function list(value: unknown, maximum: number): unknown[] { if (!Array.isArray(value) || value.length > maximum || Object.keys(value).length !== value.length) return fail(); for (let i = 0; i < value.length; i++) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, i) ?? {}, 'value')) return fail(); return value; }
function names(value: unknown, minimum = 0): string[] { const result = list(value, relationshipDiagramLimits.parts).map(value => label(value)); if (result.length < minimum || new Set(result).size !== result.length) return fail(); return result; }

/** 从原TableInfo复制显示所需字段，不保留DDL、凭据或可变父对象；不完整映射整份拒绝。 */
export function captureDiagramTable(input: TableInfo): DiagramTable {
  const database = label(own(input, 'database')), name = label(own(input, 'name'));
  if (own(input, 'objectKind') !== 'table') return fail();
  const columns = list(own(input, 'columns'), relationshipDiagramLimits.columns).map(column => { const nullable = own(column, 'nullable'); if (typeof nullable !== 'boolean') return fail(); return { name: label(own(column, 'name')), type: label(own(column, 'type'), 4096), nullable }; });
  if (!columns.length || new Set(columns.map(column => column.name)).size !== columns.length) return fail();
  const known = new Set(columns.map(column => column.name)), primaryKey = names(own(input, 'primaryKey'));
  if (primaryKey.some(name => !known.has(name))) return fail();
  const foreignKeys = list(own(input, 'foreignKeys'), relationshipDiagramLimits.foreignKeys).map(key => {
    const value = { name: label(own(key, 'name')), columns: names(own(key, 'columns'), 1), referencedDatabase: label(own(key, 'referencedDatabase')), referencedTable: label(own(key, 'referencedTable')), referencedColumns: names(own(key, 'referencedColumns'), 1), onUpdate: label(own(key, 'onUpdate')), onDelete: label(own(key, 'onDelete')) };
    if (value.columns.length !== value.referencedColumns.length || value.columns.some(name => !known.has(name))) return fail(); return value;
  });
  if (new Set(foreignKeys.map(key => key.name)).size !== foreignKeys.length) return fail();
  return { database, name, columns, primaryKey, foreignKeys };
}

/** 确定性网格布局，关系由目录外键生成；同名不同库、复合键和自引用均保留精确身份。 */
export function buildRelationshipDiagram(tables: readonly DiagramTable[], allFields = true): RelationshipDiagram {
  if (!Array.isArray(tables as unknown) || !tables.length || tables.length > relationshipDiagramLimits.tables || tables.reduce((count, table) => count + table.columns.length, 0) > relationshipDiagramLimits.columns || tables.reduce((count, table) => count + table.foreignKeys.length, 0) > relationshipDiagramLimits.foreignKeys) return fail();
  const nodes: DiagramNode[] = [], byId = new Map<string, DiagramNode>(), edges: DiagramEdge[] = [], relevant = new Map<string, Set<string>>();
  for (const table of tables) {
    const id = diagramTableId(table.database, table.name); if (byId.has(id)) return fail();
    const node: DiagramNode = { id, database: table.database, name: table.name, external: false, columns: table.columns, primaryKey: table.primaryKey, foreignColumns: [...new Set(table.foreignKeys.flatMap(key => key.columns))], x: 0, y: 0, width: 300, height: 0 };
    byId.set(id, node); nodes.push(node); relevant.set(id, new Set([...node.primaryKey, ...node.foreignColumns]));
  }
  for (const table of tables) for (const key of table.foreignKeys) {
    const source = diagramTableId(table.database, table.name), target = diagramTableId(key.referencedDatabase, key.referencedTable);
    let node = byId.get(target);
    if (!node) { if (nodes.length - tables.length >= relationshipDiagramLimits.targets) return fail(); node = { id: target, database: key.referencedDatabase, name: key.referencedTable, external: true, columns: [], primaryKey: [], foreignColumns: [], x: 0, y: 0, width: 300, height: 0 }; byId.set(target, node); nodes.push(node); }
    if (!node.external && key.referencedColumns.some(name => !node!.columns.some(column => column.name === name))) return fail();
    for (const name of key.referencedColumns) relevant.get(target)?.add(name);
    edges.push({ id: JSON.stringify([source, key.name]), source, target, key, path: '' });
  }
  let y = 30, width = 0;
  for (let row = 0; row < nodes.length; row += 3) {
    let rowHeight = 0;
    for (let col = 0; col < 3 && row + col < nodes.length; col++) {
      const node = nodes[row + col]; node.columns = allFields ? node.columns : node.columns.filter(column => relevant.get(node.id)?.has(column.name));
      node.x = 30 + col * 440; node.y = y; node.height = node.external ? 80 : 54 + Math.max(1, node.columns.length) * 26;
      rowHeight = Math.max(rowHeight, node.height); width = Math.max(width, node.x + node.width + 80);
    }
    y += rowHeight + 100;
  }
  for (const [index, edge] of edges.entries()) {
    const source = byId.get(edge.source)!, target = byId.get(edge.target)!;
    const at = (node: DiagramNode, columns: string[]) => { const indices = columns.map(name => node.columns.findIndex(column => column.name === name)).filter(index => index >= 0); return node.y + (indices.length ? 54 + (indices.reduce((sum, value) => sum + value, 0) / indices.length + .5) * 26 : 40); };
    const sx = source.x + source.width, sy = at(source, edge.key.columns), ty = at(target, edge.key.referencedColumns), tx = target.x;
    // 自引用绕过原节点；多条关系略作偏移，完整名称与各字段顺序仍由旁侧列表展示。
    const bend = 45 + index % 7 * 7;
    if (source === target) edge.path = `M ${sx} ${sy} C ${sx + bend} ${sy}, ${sx + bend} ${source.y - 22}, ${sx - 20} ${source.y - 22} L ${sx - 20} ${source.y}`;
    else if (source.y === target.y && target.x === source.x + 440) edge.path = `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`;
    else {
      // 非相邻目标走卡片间隙和行顶通道，避免穿过第三张表后造成错误的视觉来源。
      const lane = Math.max(6, Math.min(source.y, target.y) - 18 - index % 4 * 4);
      edge.path = `M ${sx} ${sy} L ${sx + 30} ${sy} L ${sx + 30} ${lane} L ${tx - 30} ${lane} L ${tx - 30} ${ty} L ${tx} ${ty}`;
    }
  }
  return { nodes, edges, width, height: y, tables: [...tables] };
}
