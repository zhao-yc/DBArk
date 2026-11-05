import { describe, expect, it } from 'vitest';
import { postgresKeyPlan, type PostgresKeyChange } from '../../src/shared/postgresKeyEdit';
import type { PostgresStructureResult } from '../../src/shared/postgresStructure';

const editStamp = 'c'.repeat(64);
const key = { name: '旧主键', kind: 'p', definition: 'PRIMARY KEY (id)', deferrable: false,
  initiallyDeferred: false, validated: true, inherited: false, keyColumns: ['id'] } as const;
const source: PostgresStructureResult = {
  database: '库', schema: '有.点', name: '表', kind: 'r', comment: null, partitionKey: null, partitionBound: null,
  rowSecurity: false, forceRowSecurity: false, viewDefinition: null, serverVersion: 180000, editStamp,
  constraints: [{ ...key, keyColumns: [...key.keyColumns] }, { ...key, name: '已有检查', kind: 'c', keyColumns: [] }],
  columns: ['id', 'a"b'].map((name, index) => ({ name, position: index + 1, type: 'text', nullable: true,
    defaultExpression: null, generationExpression: null, generation: '', identity: '', collation: null, comment: null })),
  indexes: [],
};
const nextKey: PostgresKeyChange = { kind: 'create', key: 'p', name: '新"主键', columns: ['a"b', 'id'],
  timing: 'immediate', nullsNotDistinct: false };
const unique: PostgresKeyChange = { kind: 'create', key: 'u', name: '唯一', columns: ['a"b'],
  timing: 'deferred', nullsNotDistinct: true };

/** 以同一结构的目录快照编译拟执行批次。 */
function plan(changes: PostgresKeyChange[], snapshot = source) {
  return postgresKeyPlan(snapshot, { connectionId: '连接', database: '库', table: '"有.点"."表"', editStamp, changes });
}

describe('PostgreSQL 主键与唯一约束', () => {
  it('按顺序编译主键替换、NULL 比较、检查时机和引号标识符', () => {
    const result = plan([{ kind: 'drop', from: '旧主键' }, nextKey, unique, { kind: 'rename', from: '唯一', name: '后续名称' }]);
    expect(result.statements).toEqual([
      'ALTER TABLE ONLY "有.点"."表" DROP CONSTRAINT "旧主键" RESTRICT',
      'ALTER TABLE ONLY "有.点"."表" ADD CONSTRAINT "新""主键" PRIMARY KEY ("a""b", "id")',
      'ALTER TABLE ONLY "有.点"."表" ADD CONSTRAINT "唯一" UNIQUE NULLS NOT DISTINCT ("a""b") DEFERRABLE INITIALLY DEFERRED',
      'ALTER TABLE ONLY "有.点"."表" RENAME CONSTRAINT "唯一" TO "后续名称"',
    ]);
    expect(result.keys.get('后续名称')?.created).toEqual(unique);
    expect([...result.requiredNotNull]).toEqual(['a"b', 'id']);
  });

  it('拒绝重复主键、无效列、旧服务端选项及其他约束名碰撞', () => {
    expect(() => plan([nextKey])).toThrow('已有主键');
    expect(() => plan([{ ...unique, columns: ['不存在'] }])).toThrow('必须来自原表');
    expect(() => plan([unique], { ...source, serverVersion: 140000 })).toThrow('PostgreSQL 15');
    expect(() => plan([{ ...unique, name: '已有检查' }])).toThrow('名称已存在');
  });

  it('允许复制标识约束保留原身份改名，拒绝在同批改名后删除', () => {
    const replica = { ...source, indexes: [{ name: '旧主键', method: 'btree', definition: '实际定义', unique: true,
      primary: true, valid: true, ready: true, constraint: '旧主键', replicaIdentity: true }] };
    const rename = { kind: 'rename', from: '旧主键', name: '已改名' } as const;
    expect(plan([rename], replica).keys.get('已改名')?.original?.name).toBe('旧主键');
    expect(() => plan([rename, { kind: 'drop', from: '已改名' }], replica)).toThrow('复制标识');
  });
});
