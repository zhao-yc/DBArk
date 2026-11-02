import { describe, expect, it, vi } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import { buildForeignKeyJoin, type ForeignKeyJoinOptions } from '../../src/renderer/tableForeignKeyJoin';
import { foreignKeyJoinPreview, revalidateForeignKeyJoin, TableForeignKeyJoinIntent, type ForeignKeyJoinRead } from '../../src/renderer/tableForeignKeyJoinIntent';
import { tableForeignKeyJoinZh as text } from '../../src/renderer/locales/tableForeignKeyJoin.zh-CN';
import { splitSql } from '../../src/engine/sql';

/** 双侧同名字段用于证明投影和排序身份不会只按名称合并。 */
function fixture() {
  const info = (name: string): TableInfo => ({ database: 'db', name, objectKind: 'table', engine: 'InnoDB', columns: ['id', 'pid', 'name'].map(name => ({ name, type: 'bigint', nullable: true, generated: false, extra: '', comment: '', defaultValue: null })), foreignKeys: [], primaryKey: [], editableKey: [], indexes: [], ddl: '' });
  const child = info('child'), parent = info('parent');
  child.foreignKeys = [{ name: 'fk', columns: ['pid'], referencedDatabase: 'db', referencedTable: 'parent', referencedColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }];
  const options: ForeignKeyJoinOptions = { childColumns: [], parentColumns: ['name'] };
  const build = (patch: Partial<ForeignKeyJoinOptions> = {}) => buildForeignKeyJoin(child, parent, 'fk', 'LEFT', 43, { ...options, ...patch });
  return { child, parent, options, build };
}

describe('外键JOIN完整输出去重', () => {
  it('未声明和明确关闭保持原字节及投影；开启只增加DISTINCT，不追加主键', () => {
    const f = fixture(), plain = f.build();
    expect(f.build({ distinct: false })).toEqual(plain);
    expect(f.build({ distinct: true })).toEqual({ ...plain, sql: plain.sql.replace('SELECT\n', 'SELECT DISTINCT\n') });
    expect(plain.columns).toEqual([{ side: 'parent', column: 'name', alias: 'p_3_name' }]);
    expect(f.build({ distinct: true }).sql).not.toContain('c.`id` AS');
  });
  it.each(['ASC', 'DESC'] as const)('已投影字段支持%s及两种NULL分桶，未投影关联键仍用于ON', direction => {
    const f = fixture();
    for (const nulls of ['FIRST', 'LAST'] as const) {
      const result = f.build({ distinct: true, sort: [{ side: 'parent', column: 'name', direction, nulls }], limit: 2 });
      expect(result.sql).toContain(`ORDER BY (p.\`name\` IS NULL) ${nulls === 'FIRST' ? 'DESC' : 'ASC'}, p.\`name\` ${direction}\nLIMIT 2;`);
      expect(result.sql).toContain('c.`pid` = p.`id`');
      expect(splitSql(result.sql)).toHaveLength(1);
    }
  });
  it('未输出排序和错误侧同名排序拒绝，不改投影；普通明细仍允许未输出排序', () => {
    const f = fixture();
    for (const sort of [[{ side: 'parent', column: 'id', direction: 'ASC' }], [{ side: 'child', column: 'name', direction: 'ASC' }]] as const) {
      expect(() => f.build({ distinct: true, sort })).toThrow(text.distinctSort);
      expect(f.build({ sort }).sql).toContain('ORDER BY');
    }
  });
  it.each([null, 0, 1, 'true', new Boolean(true), {}, []])('去重标记拒绝非布尔值%j', distinct => {
    expect(() => fixture().build({ distinct } as never)).toThrow(text.invalid);
  });
  it('访问器及继承声明拒绝且不执行getter', () => {
    const f = fixture(), getter = vi.fn(() => true);
    const accessor = Object.defineProperty({ ...f.options }, 'distinct', { enumerable: true, get: getter });
    const inherited = Object.assign(Object.create({ distinct: true }), f.options);
    for (const options of [accessor, inherited]) expect(() => buildForeignKeyJoin(f.child, f.parent, 'fk', 'LEFT', 43, options)).toThrow(text.invalid);
    expect(getter).not.toHaveBeenCalled();
  });
  it('汇总模式不同时应用明细去重；false不改变原汇总', () => {
    const f = fixture(), summary = { groups: [], aggregates: [{ fn: 'COUNT_ALL' as const, alias: 'n' }] };
    expect(() => f.build({ distinct: true, summary })).toThrow(text.distinctMode);
    expect(f.build({ distinct: false, summary })).toEqual(f.build({ summary }));
  });
  it('选列仍须非空，SQL仍受原预算约束', () => {
    const f = fixture();
    expect(() => f.build({ distinct: true, parentColumns: [] })).toThrow(text.columns);
    expect(f.build({ distinct: true, filters: [{ side: 'child', column: 'id', operator: '>', value: '9007199254740993' }], sort: [{ side: 'parent', column: 'name', direction: 'ASC' }] }).sql).toMatch(/WHERE [\s\S]+\nORDER BY [\s\S]+\nLIMIT 43;$/);
  });
  it('深冻结回执保存去重并重新核双方；伪造或复用旧SQL不能消费', async () => {
    const f = fixture(), intent = new TableForeignKeyJoinIntent(f.child, 'connection', 43, [], () => true), options = { ...f.options, distinct: true };
    const preview = foreignKeyJoinPreview(intent, f.parent, 'fk', 'LEFT', options);
    options.distinct = false;
    expect(preview.options.distinct).toBe(true); expect(Object.isFrozen(preview.options)).toBe(true);
    const read = vi.fn<ForeignKeyJoinRead>(async target => target.table === 'child' ? f.child : f.parent);
    await revalidateForeignKeyJoin(intent, preview, read, () => true); expect(read).toHaveBeenCalledTimes(2);
    expect(() => intent.consume({ ...preview, sql: preview.sql.replace('SELECT DISTINCT', 'SELECT') })).toThrow(text.stale);
    expect(intent.consume(preview)).toBe(preview.sql);
    expect(() => intent.consume(preview)).toThrow(text.stale);
  });
});
