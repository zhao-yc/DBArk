import { expect, it } from 'vitest';
import type { PostgresTableColumn, PostgresTablePage } from '../../src/shared/postgresTable';
import { splitPostgresSql } from '../../src/shared/postgresSql';
import { buildPostgresTableQueryTemplate, postgresTableTemplateColumns } from '../../src/renderer/postgresTableQueryTemplate';

const column = (name: string, index: number, extra: Partial<PostgresTableColumn> = {}): PostgresTableColumn => ({
  name, key: `c${index}`, type: 'text', nullable: false, defaultValue: false, generated: false, primary: false, binary: false, ...extra,
});
const page: PostgresTablePage = {
  columns: [
    column('主"键', 0, { primary: true, sequenceDefault: true }), column('复合键', 1, { primary: true }),
    column('带;$88"列', 2), column('金额', 3), column('生成', 4, { generated: true }),
  ],
  rows: [{ c2: '不得进入SQL的原数据' }], capabilities: { insert: true, update: true, delete: true },
  hasNext: false, truncated: false, order: 'primary', relationKind: 'r',
};
const source = { page, table: '"架构.甲"."表""名"' };

it('安全引用限定表和字段，位置参数只来自选择，复合键完整并限制继承范围', () => {
  const selected = { columns: ['金额', '带;$88"列'] };
  const update = buildPostgresTableQueryTemplate(source, 'UPDATE', 100, selected);
  expect(update.sql).toContain('UPDATE ONLY "架构.甲"."表""名"\nSET\n  "金额" = $1,\n  "带;$88""列" = $2');
  expect(update.sql).toContain('WHERE\n  "主""键" = $3\n  AND "复合键" = $4;');
  expect(splitPostgresSql(update.sql).map(statement => statement.parameters)).toEqual([[1, 2, 3, 4]]);
  expect(update.sql).not.toContain('不得进入SQL的原数据');
  expect(buildPostgresTableQueryTemplate(source, 'DELETE', 100).sql).toContain('DELETE FROM ONLY "架构.甲"."表""名"\nWHERE\n  "主""键" = $1\n  AND "复合键" = $2;');
  expect(buildPostgresTableQueryTemplate(source, 'SELECT', 37, selected).sql).toContain('SELECT\n  "金额",\n  "带;$88""列"\nFROM ONLY "架构.甲"."表""名"\nLIMIT 37;');
});

it('列资格保留非自动的主键用于插入，支持 DEFAULT VALUES 并拒绝非法选择', () => {
  expect(postgresTableTemplateColumns(source, 'INSERT')).toEqual(['复合键', '带;$88"列', '金额']);
  expect(postgresTableTemplateColumns(source, 'UPDATE')).toEqual(['带;$88"列', '金额']);
  expect(buildPostgresTableQueryTemplate(source, 'INSERT', 100, { columns: [] }).sql).toContain('INSERT INTO "架构.甲"."表""名" DEFAULT VALUES;');
  expect(buildPostgresTableQueryTemplate(source, 'INSERT', 100, { columns: ['金额'] }).sql).toContain('("金额")\nVALUES\n  ($1);');
  for (const columns of [['生成'], ['主"键'], ['金额', '金额']]) {
    expect(() => buildPostgresTableQueryTemplate(source, 'UPDATE', 100, { columns })).toThrow();
  }
  expect(() => buildPostgresTableQueryTemplate(source, 'SELECT', 100, { columns: [] })).toThrow();
  expect(() => buildPostgresTableQueryTemplate(source, 'DELETE', 100, { columns: [] })).toThrow();
});

it('只有已确认可写表生成 DML，缺键、可空键、视图和宽表预算分别处理', () => {
  const view = { ...source, page: { ...page, relationKind: 'v' as const } };
  expect(buildPostgresTableQueryTemplate(view, 'SELECT', 100).sql).toContain('FROM "架构.甲"."表""名"');
  expect(() => buildPostgresTableQueryTemplate(view, 'INSERT', 100)).toThrow(/普通表/);
  expect(() => buildPostgresTableQueryTemplate({ ...source, page: { ...page, columns: [column('内容', 0)] } }, 'DELETE', 100)).toThrow(/主键/);
  expect(() => buildPostgresTableQueryTemplate({ ...source, page: { ...page, columns: [column('键', 0, { primary: true, nullable: true })] } }, 'UPDATE', 100)).toThrow(/主键/);
  const limited = { ...source, page: { ...page, capabilities: { ...page.capabilities, insert: false } } };
  expect(() => buildPostgresTableQueryTemplate(limited, 'INSERT', 100)).toThrow(/未开放/);
  const wide = { ...source, page: { ...page, columns: Array.from({ length: 201 }, (_, index) => column('列' + index, index)) } };
  expect(() => buildPostgresTableQueryTemplate(wide, 'INSERT', 100)).toThrow(/200/);
  expect(buildPostgresTableQueryTemplate(wide, 'INSERT', 100, { columns: ['列200'] }).parameters).toBe(1);
});

it('当前筛选 SQL 保留字面子串、分组、NULL 顺序及目录主键补序', () => {
  const pageWithKey = { ...page, primaryKey: ['复合键', '主"键'] };
  const filtered = {
    ...source, page: pageWithKey,
    readScope: {
      filter: { rules: [
        { column: '金额', operator: 'BETWEEN' as const, values: ['0.001', '9223372036854775807.25'] },
        { column: '带;$88"列', operator: '=' as const, value: "值'\\; SELECT 1" },
        { column: '生成', operator: 'IS NULL' as const, enabled: false },
      ], mode: 'all' as const, group: { mode: 'all' as const, children: [0, { mode: 'any' as const, children: [1, 2] }] } },
      sort: [{ column: '金额', direction: 'DESC' as const, nulls: 'LAST' as const }],
    },
  };
  const query = buildPostgresTableQueryTemplate(filtered, 'SELECT', 50, { columns: ['金额'] });
  expect(query.sql).toContain(`"金额" BETWEEN E'0.001' AND E'9223372036854775807.25'`);
  expect(query.sql).toContain(`"带;$88""列" = E'值''\\\\; SELECT 1'`);
  expect(query.sql).toContain('ORDER BY "金额" DESC NULLS LAST, "复合键", "主""键"\nLIMIT 50;');
  expect(query.sql).not.toContain('"生成" IS NULL');
  expect(query.sql).not.toContain('OFFSET');
  expect(splitPostgresSql(query.sql, false).map(statement => statement.parameters)).toEqual([[]]);
  const quick = { ...filtered, readScope: { filter: { column: '金额', text: '_%' } } };
  expect(buildPostgresTableQueryTemplate(quick, 'SELECT', 50).sql).toContain(`pg_catalog.strpos("金额"::text, E'_%') > 0`);
  expect(() => buildPostgresTableQueryTemplate(filtered, 'DELETE', 50)).toThrow();
  expect(() => buildPostgresTableQueryTemplate({ ...filtered, page }, 'SELECT', 50)).toThrow();
  const unknown = { ...filtered, readScope: { ...filtered.readScope, sort: [{ column: '失效字段', direction: 'ASC' as const }] } };
  expect(() => buildPostgresTableQueryTemplate(unknown, 'SELECT', 50)).toThrow();
});
