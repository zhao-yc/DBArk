import { describe, expect, it } from 'vitest';
import { matchesCreatedPostgresIndex, postgresIndexPlan, type PostgresIndexChange } from '../../src/shared/postgresIndexEdit';
import type { PostgresStructureResult } from '../../src/shared/postgresStructure';

const editStamp = 'e'.repeat(64);
const key = { column: 'a"b', direction: 'desc', nulls: 'last' } as const;
const existing = { name: '旧索引', method: 'btree', definition: '实际定义', primary: false, unique: false,
  valid: true, ready: true, constraint: null };
const source: PostgresStructureResult = {
  database: '库', schema: '甲.乙', name: '表', kind: 'r', comment: null, partitionKey: null, partitionBound: null,
  rowSecurity: false, forceRowSecurity: false, viewDefinition: null, editStamp, constraints: [],
  columns: ['a"b', 'included'].map((name, index) => ({ name, position: index + 1, type: 'text', nullable: true,
    defaultExpression: null, generationExpression: null, generation: '', identity: '', collation: null, comment: null })),
  indexes: [existing, { ...existing, name: '复制标识', replicaIdentity: true }, { ...existing, name: '约束', constraint: '约束' }],
};
const newIndex = { kind: 'create', name: '新"索引', method: 'btree', unique: true, keys: [key], include: ['included'] } as const;
const create = { ...newIndex, keys: [...newIndex.keys], include: [...newIndex.include] } satisfies PostgresIndexChange;

/** 模拟已读目录，索引名称和字段一律通过标识符编译。 */
function plan(changes: PostgresIndexChange[]) {
  return postgresIndexPlan(source, { connectionId: '连接', database: '库', table: '"甲.乙"."表"', editStamp, changes });
}

describe('PostgreSQL 结构索引预览', () => {
  it('编译创建、重命名和受限删除，同时维护批次中的索引身份', () => {
    const result = plan([create, { kind: 'rename', from: create.name, name: '确认' }, { kind: 'drop', from: '旧索引' }]);
    expect(result.statements).toEqual([
      'CREATE UNIQUE INDEX "新""索引" ON ONLY "甲.乙"."表" USING btree ("a""b" DESC NULLS LAST) INCLUDE ("included")',
      'ALTER INDEX "甲.乙"."新""索引" RENAME TO "确认"',
      'DROP INDEX "甲.乙"."旧索引" RESTRICT',
    ]);
    expect(result.indexes.get('确认')?.created).toEqual(create);
    expect(result.indexes.has('旧索引')).toBe(false);
  });

  it('限制索引方法、重复列和受保护的约束或复制标识', () => {
    expect(() => plan([{ ...create, keys: [key, key] }])).toThrow('不得重复');
    expect(() => plan([{ ...create, method: 'gin' }])).toThrow('不支持包含列');
    expect(() => plan([{ ...create, include: [], method: 'hash', unique: false }])).toThrow('排序选项');
    expect(() => plan([{ kind: 'drop', from: '复制标识' }])).toThrow('复制标识');
    expect(() => plan([{ kind: 'rename', from: '约束', name: '新名称' }])).toThrow('受约束');
  });

  it('拒绝列方向、NULL 位置、包含列角色或有效状态与计划不符的回读', () => {
    const parts = [{ column: key.column, key: true, descending: true, nullsFirst: false },
      { column: 'included', key: false, descending: false, nullsFirst: false }];
    const actual = { ...existing, unique: true, parts };
    expect(matchesCreatedPostgresIndex(actual, create)).toBe(true);
    expect(matchesCreatedPostgresIndex({ ...actual, valid: false }, create)).toBe(false);
    expect(matchesCreatedPostgresIndex({ ...actual, parts: [{ ...parts[0], nullsFirst: true }, parts[1]] }, create)).toBe(false);
    expect(matchesCreatedPostgresIndex({ ...actual, parts: [parts[0], { ...parts[1], key: true }] }, create)).toBe(false);
  });
});
