import { describe, expect, it } from 'vitest';
import { postgresCheckPlan, type PostgresCheckChange } from '../../src/shared/postgresCheckEdit';
import { assertPostgresCheckExpression } from '../../src/shared/postgresSql';
import type { PostgresStructureResult } from '../../src/shared/postgresStructure';

const editStamp = 'b'.repeat(64);
const original: PostgresStructureResult = {
  database: '库', schema: '有.点', name: '表', kind: 'r', comment: null, partitionKey: null, partitionBound: null,
  rowSecurity: false, forceRowSecurity: false, viewDefinition: null, columns: [], indexes: [], editStamp,
  constraints: [{ name: '检"查', kind: 'c', definition: 'CHECK (true) NOT VALID', deferrable: false,
    initiallyDeferred: false, validated: false, inherited: false, check: { expression: 'true', noInherit: false, enforced: true } }],
};

/** 按同一目录编译待审核的 CHECK SQL。 */
function plan(changes: PostgresCheckChange[]) {
  return postgresCheckPlan(original, { connectionId: '连接', database: '库', table: '"有.点"."表"', editStamp, changes });
}

describe('PostgreSQL CHECK 编辑', () => {
  it('接受字面值内的分号、转义、数组和嵌套注释', () => {
    const expressions = [
      '"带;)" IS NOT NULL AND ARRAY[1, 2][1] = 1',
      "note <> $值$); $1$值$ AND note <> E'a\\');b'",
      "note <> '单引号'';)' /* 外 /* 内 */ ; ) */ -- 尾注释",
      "note = '尾反斜杠\\' OR note IS NULL",
    ];
    for (const expression of expressions) expect(() => assertPostgresCheckExpression(expression)).not.toThrow();
  });

  it('拒绝括号逃逸、语句、外部参数和未闭合引用', () => {
    for (const expression of ['true) , ADD COLUMN injected int --', 'true; SELECT 1', 'amount > $1', 'array[1)', '$a$未闭合', '/* 未闭合', '-- 空', "'未闭合", '('.repeat(65) + 'true' + ')'.repeat(65)]) {
      expect(() => assertPostgresCheckExpression(expression), expression).toThrow();
    }
  });

  it('替换和验证按批次顺序编译，末尾注释不能吞掉生成的右括号', () => {
    const draft = plan([{ kind: 'replace', from: '检"查', expression: 'amount > 0 -- 尾注释', noInherit: true, notValid: true },
      { kind: 'rename', from: '检"查', name: '新名' }, { kind: 'validate', from: '新名' }]);
    expect(draft.statements).toEqual([
      'ALTER TABLE ONLY "有.点"."表" DROP CONSTRAINT "检""查" RESTRICT',
      'ALTER TABLE ONLY "有.点"."表" ADD CONSTRAINT "检""查" CHECK (\namount > 0 -- 尾注释\n) NO INHERIT NOT VALID',
      'ALTER TABLE ONLY "有.点"."表" RENAME CONSTRAINT "检""查" TO "新名"',
      'ALTER TABLE ONLY "有.点"."表" VALIDATE CONSTRAINT "新名"',
    ]);
    expect(draft.checks.get('新名')).toMatchObject({ validated: true, created: { noInherit: true } });
  });

  it('仅在支持的版本生成 NOT ENFORCED，且禁止将其加入验证批次', () => {
    const change = { kind: 'create', name: '未强制', expression: 'true', noInherit: false, notValid: false, notEnforced: true } as const;
    expect(() => plan([change])).toThrow('PostgreSQL 18');
    const source = { ...original, serverVersion: 180000 };
    const target = { connectionId: '连接', database: '库', table: '"有.点"."表"', editStamp };
    expect(postgresCheckPlan(source, { ...target, changes: [change] }).statements[0]).toContain('NOT ENFORCED');
    expect(() => postgresCheckPlan(source, { ...target, changes: [change, { kind: 'validate', from: change.name }] })).toThrow('不能验证');
    expect(() => postgresCheckPlan(source, { ...target, changes: [{ ...change, notValid: true }] })).toThrow('不能和 NOT VALID 同时设置');
  });
});
