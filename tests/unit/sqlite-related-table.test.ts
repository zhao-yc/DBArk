import { expect, it } from 'vitest';
import type { SqliteIncomingOutput } from '../../src/shared/sqliteIncoming';
import { sqliteRelatedTableRelation, registerSqliteRelatedTable, sqliteRelatedTableScope } from '../../src/renderer/sqliteRelatedTable';
import { buildSqliteFilteredSelect } from '../../src/shared/sqliteReadSql';
import { SqliteTableExportIntent } from '../../src/renderer/sqliteTableExportUi';
import { SqliteFilteredSelectIntent } from '../../src/renderer/sqliteFilteredSelectUi';

/** 已声明合成子页，实际生产仍由原IncomingReader严格校验Main结果。 */
function output(): SqliteIncomingOutput {
  return { request: { incoming: 'page', connectionId: 'c', database: 'main', table: 'parent', schemaKey: 'a'.repeat(64), taskId: '00000000-0000-4000-8000-000000000001', childTable: 'child', childSchemaKey: 'b'.repeat(64), foreignKey: 0, values: [{ kind: 'integer', value: '9223372036854775807' }], offset: 0, limit: 50 },
    source: { name: 'parent', columns: [{ name: 'id', type: 'INTEGER', notNull: true, primaryKey: 1, hidden: 0 }], foreignKeys: [] }, references: [{ table: 'child', schemaKey: 'b'.repeat(64), key: { ordinal: 0, columns: ['p'], referencedTable: 'parent', referencedColumns: ['id'], onUpdate: 'NO ACTION', onDelete: 'NO ACTION' }, referencedColumns: ['id'] }],
    page: { target: { connectionId: 'c', database: 'main', table: 'child', kind: 'table' }, columns: [{ name: 'p', declaredType: 'TEXT' }], schemaKey: 'b'.repeat(64), storageTypes: ['t'], offset: 0, limit: 50, hasMore: false, result: { columns: [{ key: 'c0', name: 'p', type: 'SQLITE' }], rows: [{ c0: '9223372036854775807' }], truncated: false, statement: '', elapsedMs: 0 } } };
}
it('独立范围仅从准确已读子页生成，保留64位原值与显式映射，不接收错回包', () => {
  const value = output(), relation = sqliteRelatedTableRelation(value); expect(relation.values).toEqual([{ kind: 'integer', value: '9223372036854775807' }]); expect(relation.childColumns).toEqual(['p']);
  value.page!.target.table = 'other'; expect(() => sqliteRelatedTableRelation(value)).toThrow();
});
it('来源只在本进程内存，冻结副本及永久墓碑拒绝连接／目标ABA；重启标记没有普通全表后备', () => {
  const relation = sqliteRelatedTableRelation(output()); let current = true; const id = 'sqlite-related:scope-fixture', scope = registerSqliteRelatedTable(id, relation, () => current);
  expect(sqliteRelatedTableScope(id)).toBe(scope); expect(scope.current()).toBe(true); relation.values[0] = { kind: 'null' }; expect(scope.relation.values[0].kind).toBe('integer'); expect(Object.isFrozen(scope.relation.values)).toBe(true);
  current = false; expect(scope.current()).toBe(false); current = true; expect(scope.current()).toBe(false); expect(sqliteRelatedTableScope(id)).toBeUndefined(); expect(sqliteRelatedTableScope('sqlite-related:restored')).toBeUndefined();
});
it('关联谓词AND包住整个OR组，生成查询与完整导出保留同一范围及父比较语义', () => {
  const value = output(), relation = sqliteRelatedTableRelation(value), page = { ...value.page!, relation }, query = { limit: 50, mode: 'or' as const, filters: [{ column: 'p', operator: 'eq' as const, value: { kind: 'text' as const, value: '其它父值' } }], sort: [] };
  const sql = buildSqliteFilteredSelect({ connectionId: page.target.connectionId, database: page.target.database, table: page.target.table, ...query, relation, taskId: '生成', offset: 0 }, page.columns, ['p']); expect(sql).toContain(' AND (EXISTS'); expect(sql).toContain(' = +"__dbark_source"."p"'); expect(sql).toContain('9223372036854775807');
  const select = new SqliteFilteredSelectIntent(page, query, () => true); expect(select.compile(['p']).sql).toBe(sql);
  const intent = new SqliteTableExportIntent(page, query, [page], () => true), input = intent.input({ format: 'json', encoding: 'utf8', columns: ['p'] }, '合成目标', '导出'); expect(input.relation).toEqual(relation);
  page.relation = { ...relation, values: [{ kind: 'integer', value: '1' }] }; expect(intent.current()).toBe(false); expect(select.current()).toBe(false);
});
