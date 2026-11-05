import { describe, expect, it } from 'vitest';
import { postgresCreateTablePlan, postgresCreateTablePreviewSchema, type PostgresCreateTableInput } from '../../src/shared/postgresCreateTable';
import { splitPostgresSql } from '../../src/shared/postgresSql';

const draft: PostgresCreateTableInput = {
  connectionId: '原连接', database: '原库', schema: '业务"区', table: '新"表', comment: "注释'；\\",
  columns: [{ name: '原"列', type: 'text', nullable: false, primary: true, unique: false, identity: 'none',
    default: { mode: 'literal', value: "a\\'; DROP TABLE 其他; --" }, comment: '多行\n注释' }],
};

describe('PostgreSQL 建表计划', () => {
  it('标识符、带反斜杠的默认值及注释不能逸出各自语法边界', () => {
    const result = postgresCreateTablePlan(draft);
    expect(result.table).toBe('"业务""区"."新""表"');
    expect(result.statements).toHaveLength(3);
    expect(splitPostgresSql(result.statements.join(';\n'), true).map(item => item.keyword)).toEqual(['CREATE', 'COMMENT', 'COMMENT']);
    expect(splitPostgresSql(result.statements.join(';\n'), false)).toHaveLength(3);
    expect(result.checks[0].value).toBe("a\\'; DROP TABLE 其他; --");
  });
  it('拒绝 Unicode 截断、重复列和类型属性错配', () => {
    expect(postgresCreateTablePreviewSchema.safeParse({ ...draft, table: '长'.repeat(22) }).success).toBe(false);
    expect(postgresCreateTablePreviewSchema.safeParse({ ...draft, columns: [...draft.columns, ...draft.columns] }).success).toBe(false);
    expect(postgresCreateTablePreviewSchema.safeParse({ ...draft, columns: [{ ...draft.columns[0], identity: 'always' }] }).success).toBe(false);
    expect(postgresCreateTablePreviewSchema.safeParse({ ...draft, columns: [{ ...draft.columns[0], type: 'numeric', precision: 2, scale: 3 }] }).success).toBe(false);
  });
});
