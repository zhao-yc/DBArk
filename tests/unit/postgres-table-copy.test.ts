import { describe, expect, it } from 'vitest';
import { postgresTableCopyApplySchema, postgresTableCopyPreviewSchema } from '../../src/shared/postgresTableCopy';
import { postgresTableCopySql } from '../../src/engine/postgres/tableCopy';

const draft = { connectionId: 'c', database: 'db', source: '"原.库"."原""表"', schema: '目标', name: '副"表', mode: 'data' as const };
const columns = [
  { name: 'id', signature: '', generated: false, identity: true, cycle: false, sequenceDefault: false },
  { name: '生成', signature: '', generated: true, identity: false, cycle: false, sequenceDefault: false },
];
describe('PostgreSQL 整表复制结构化计划', () => {
  it('逐段引用，确认前的计划包含来源锁和目标专用标识序列，生成列由服务器重算', () => {
    const plan = postgresTableCopySql(postgresTableCopyPreviewSchema.parse(draft), columns, "保留'原注释");
    expect(plan.lock).toBe('LOCK TABLE ONLY "原.库"."原""表" IN ACCESS SHARE MODE');
    expect(plan.statements[0]).toBe('CREATE TABLE "目标"."副""表" (LIKE "原.库"."原""表" INCLUDING ALL)');
    expect(plan.statements[1]).toBe('COMMENT ON TABLE "目标"."副""表" IS E\'保留\'\'原注释\'');
    expect(plan.statements[3]).toBe('INSERT INTO "目标"."副""表" ("id") OVERRIDING SYSTEM VALUE SELECT "id" FROM ONLY "原.库"."原""表"');
    expect(plan.statements[4]).toContain('pg_catalog.pg_get_serial_sequence(E\'"目标"."副""表"\', E\'id\')');
    expect(plan.statements[4]).not.toContain('原.库');
  });

  it('仅结构不插入或推进序列，拒绝系统目标和缺少确认的提交', () => {
    expect(postgresTableCopySql({ ...draft, mode: 'structure' }, columns, null).statements).toHaveLength(1);
    expect(postgresTableCopyPreviewSchema.safeParse({ ...draft, schema: 'pg_catalog' }).success).toBe(false);
    expect(postgresTableCopyPreviewSchema.safeParse({ ...draft, source: 'bad\0' }).success).toBe(false);
    expect(postgresTableCopyApplySchema.safeParse({ connectionId: 'c', database: 'db', token: 'f089fc7b-1c37-4b9d-8471-d1be72cc1ba9' }).success).toBe(false);
  });
});
