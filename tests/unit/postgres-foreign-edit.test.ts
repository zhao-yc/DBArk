import { describe, expect, it } from 'vitest';
import { postgresForeignPlan, type PostgresForeignChange, type PostgresForeignCreation } from '../../src/shared/postgresForeignKeyEdit';
import type { PostgresStructureResult } from '../../src/shared/postgresStructure';

const editStamp = 'f'.repeat(64);
const source: PostgresStructureResult = {
  database: '库', schema: '左.边', name: '子表', kind: 'r', comment: null, partitionKey: null, partitionBound: null,
  rowSecurity: false, forceRowSecurity: false, viewDefinition: null, editStamp, constraints: [], indexes: [],
  columns: ['一', '二"'].map((name, i) => ({ name, position: i + 1, type: 'integer', nullable: true, defaultExpression: null,
    generationExpression: null, generation: '', identity: '', collation: null, comment: null })),
};
const creation: PostgresForeignCreation = { kind: 'create', name: '外键"名称',
  reference: { schema: '右.边', name: '父"表', stamp: 'a'.repeat(64) },
  pairs: [{ local: '二"', remote: 'B' }, { local: '一', remote: 'A' }],
  match: 'f', onUpdate: 'c', onDelete: 'n', timing: 'deferred', notValid: true };

/** 使用同一原表结构编译候选批次。 */
function plan(changes: PostgresForeignChange[], original = source) {
  return postgresForeignPlan(original, { connectionId: '连接', database: '库', table: '"左.边"."子表"', editStamp, changes });
}

describe('PostgreSQL 外键编辑', () => {
  it('保留真实列映射顺序并支持同批改名和验证', () => {
    const result = plan([creation, { kind: 'rename', from: creation.name, name: '改名' }, { kind: 'validate', from: '改名' }]);
    expect(result.statements).toEqual([
      'ALTER TABLE ONLY "左.边"."子表" ADD CONSTRAINT "外键""名称" FOREIGN KEY ("二""", "一") REFERENCES "右.边"."父""表" ("B", "A") MATCH FULL ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED NOT VALID',
      'ALTER TABLE ONLY "左.边"."子表" RENAME CONSTRAINT "外键""名称" TO "改名"',
      'ALTER TABLE ONLY "左.边"."子表" VALIDATE CONSTRAINT "改名"',
    ]);
    expect(result.keys.get('改名')).toMatchObject({ created: creation, validated: true });
  });

  it('拒绝不存在、重复的映射以及重复验证', () => {
    expect(() => plan([{ ...creation, pairs: [{ local: '不存在', remote: 'B' }] }])).toThrow('外键列必须存在');
    expect(() => plan([{ ...creation, pairs: [{ local: '一', remote: 'B' }, { local: '二"', remote: 'B' }] }])).toThrow('不能重复');
    expect(() => plan([{ ...creation, notValid: false }, { kind: 'validate', from: creation.name }])).toThrow('不需要或不能验证');
  });

  it('拒绝继承外键的操作及与其他类型约束的同名创建', () => {
    const constraint = { name: creation.name, kind: 'f' as const, definition: '实际定义', deferrable: false,
      initiallyDeferred: false, validated: false, inherited: true };
    expect(() => plan([{ kind: 'drop', from: creation.name }], { ...source, constraints: [constraint] })).toThrow('继承结构');
    expect(() => plan([creation], { ...source, constraints: [{ ...constraint, kind: 'p' }] })).toThrow('名称已存在');
    const withInternalConstraint = plan([creation], { ...source, constraints: [{ ...constraint, name: '分区内部约束' }] });
    expect([...withInternalConstraint.keys.keys()]).toEqual([creation.name]);
  });
});
