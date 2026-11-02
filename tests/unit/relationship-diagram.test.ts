import { describe, expect, it, vi } from 'vitest';
import { buildRelationshipDiagram, captureDiagramTable, diagramTableId } from '../../src/renderer/relationshipDiagram';
import { relationshipFixture } from '../helpers/relationshipDiagramFixture';

describe('从目录生成真实主外键图', () => {
  it('保留复合映射顺序、同名不同库、自引用和未读外部目标，不推测基数', () => {
    const original = relationshipFixture(), before = JSON.stringify(original), graph = buildRelationshipDiagram(original.map(captureDiagramTable));
    expect(graph.tables).toHaveLength(3); expect(graph.nodes).toHaveLength(4); expect(graph.edges).toHaveLength(3);
    expect(graph.edges[0].key.columns).toEqual(['tenant', 'parent_id']); expect(graph.edges[0].key.referencedColumns).toEqual(['tenant', 'id']);
    const internal = graph.nodes.find(node => node.id === diagramTableId('diagram_db', 'parent'))!, external = graph.nodes.find(node => node.id === diagramTableId('outside_db', 'parent'))!;
    expect(internal.primaryKey).toEqual(['tenant', 'id']); expect(external).toMatchObject({ external: true, columns: [], primaryKey: [] }); expect(internal.external).toBe(false);
    expect(graph.edges[1].source).toBe(graph.edges[1].target); expect(graph.edges[1].path).toContain(' L ');
    for (const node of graph.nodes) { expect(node.x).toBeGreaterThanOrEqual(0); expect(node.y).toBeGreaterThanOrEqual(0); expect(node.x + node.width).toBeLessThanOrEqual(graph.width); expect(node.y + node.height).toBeLessThanOrEqual(graph.height); }
    expect(JSON.stringify(original)).toBe(before);
  });
  it('键字段显示保留引用目标列，普通列可恢复，图范围不受可见字段影响', () => {
    const tables = relationshipFixture().map(captureDiagramTable), keys = buildRelationshipDiagram(tables, false), all = buildRelationshipDiagram(tables);
    expect(keys.nodes.find(node => node.name === 'child')!.columns.map(column => column.name)).toEqual(['id', 'tenant', 'parent_id', 'manager_id']);
    expect(keys.nodes.find(node => !node.external && node.name === 'parent')!.columns.map(column => column.name)).toEqual(['tenant', 'id']);
    expect(all.nodes.find(node => node.name === 'child')!.columns.map(column => column.name)).toContain('备注<script>'); expect(keys.edges.map(edge => edge.key)).toEqual(all.edges.map(edge => edge.key));
  });
  it('复制显示结构不保留父数组、DDL或备注；特殊名称仍按数组身份区分', () => {
    const source = relationshipFixture()[0], result = captureDiagramTable(source); source.columns[0].name = 'changed'; source.foreignKeys[0].columns[0] = 'changed';
    expect(result.columns[0].name).toBe('id'); expect(result.foreignKeys[0].columns[0]).toBe('tenant'); expect(result).not.toHaveProperty('ddl'); expect(result.columns[0]).not.toHaveProperty('comment');
    expect(diagramTableId('a.b', 'c')).not.toBe(diagramTableId('a', 'b.c'));
  });
  it('跨过中间表的关系绕行，不从第三张表背后穿过并冒充其外键', () => {
    const graph = buildRelationshipDiagram(relationshipFixture().map(captureDiagramTable)), middle = graph.nodes.find(node => node.id === diagramTableId('diagram_db', 'parent'))!;
    const edge = graph.edges.find(edge => edge.key.name === 'fk_external')!, points = [...edge.path.matchAll(/[ML] ([\d.]+) ([\d.]+)/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
    expect(points.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i]; expect(a.x === b.x || a.y === b.y).toBe(true);
      const intersects = Math.max(a.x, b.x) > middle.x && Math.min(a.x, b.x) < middle.x + middle.width && Math.max(a.y, b.y) > middle.y && Math.min(a.y, b.y) < middle.y + middle.height;
      expect(intersects).toBe(false);
    }
  });
  it.each(['duplicate-column', 'bad-primary', 'bad-child', 'bad-count', 'duplicate-key', 'view', 'empty-name', 'sparse'])('不完整结构整份拒绝：%s', kind => {
    const table = relationshipFixture()[0];
    if (kind === 'duplicate-column') table.columns.push(table.columns[0]); if (kind === 'bad-primary') table.primaryKey = ['unknown']; if (kind === 'bad-child') table.foreignKeys[0].columns = ['unknown', 'parent_id'];
    if (kind === 'bad-count') table.foreignKeys[0].referencedColumns = ['id']; if (kind === 'duplicate-key') table.foreignKeys.push(table.foreignKeys[0]); if (kind === 'view') table.objectKind = 'view';
    if (kind === 'empty-name') table.name = ''; if (kind === 'sparse') delete table.columns[0]; expect(() => captureDiagramTable(table)).toThrow();
  });
  it('数据访问器不执行，整份拒绝重复身份、字段漂移和预算溢出', () => {
    const table = relationshipFixture()[0], getter = vi.fn(() => 'unsafe'); Object.defineProperty(table, 'name', { get: getter }); expect(() => captureDiagramTable(table)).toThrow(); expect(getter).not.toHaveBeenCalled();
    const tables = relationshipFixture().map(captureDiagramTable); expect(() => buildRelationshipDiagram([...tables, tables[0]])).toThrow(); tables[1].columns = tables[1].columns.filter(column => column.name !== 'tenant'); expect(() => buildRelationshipDiagram(tables)).toThrow();
    const plain = captureDiagramTable(relationshipFixture()[2]); expect(() => buildRelationshipDiagram(Array.from({ length: 41 }, (_, i) => ({ ...plain, name: 't' + i })))).toThrow();
    expect(() => buildRelationshipDiagram([{ ...plain, columns: Array.from({ length: 2001 }, (_, i) => ({ name: 'c' + i, type: 'INT', nullable: true })) }])).toThrow();
  });
});
