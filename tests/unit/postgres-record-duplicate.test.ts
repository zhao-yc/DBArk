import { describe, expect, it } from 'vitest';
import type { PostgresTablePage } from '../../src/shared/postgresTable';
import { postgresBatchDuplicateChanges, postgresBatchDuplicatePlan, postgresRecordDuplicatePlan } from '../../src/renderer/postgresRecordDuplicate';

const page: PostgresTablePage = {
  columns: ['id', 'serial', 'generated', 'empty', 'bytes', 'note'].map((name, index) => ({
    key: 'c' + index, name, type: index === 4 ? 'bytea' : 'text', primary: index === 0,
    nullable: index > 2, defaultValue: index === 1, generated: index === 2, binary: index === 4,
    ...(index === 1 ? { sequenceDefault: true } : {}),
  })),
  rows: [{ c0: '9007199254740993', c1: '7', c2: '生成', c3: '', c4: { type: 'binary', base64: 'AP8=' }, c5: null }],
  rowKeys: ['原记录'], pageToken: '原页', capabilities: { insert: true, update: true, delete: true },
  hasNext: false, truncated: false, order: 'primary', relationKind: 'r',
};

describe('PostgreSQL 复制当前记录', () => {
  it('保留手工主键、空串和原字节，优先已暂存值并省略序列及生成列', () => {
    const plan = postgresRecordDuplicatePlan(page, 0, { kind: 'update', row: 3, fields: [
      { column: 'c5', value: { mode: 'default' } }, { column: 'c1', value: { mode: 'text', value: '9' } },
    ] });
    expect(plan).toEqual({ omitted: ['serial', 'generated'], fields: [
      { column: 'c0', value: { mode: 'text', value: '9007199254740993' } },
      { column: 'c3', value: { mode: 'text', value: '' } },
      { column: 'c4', value: { mode: 'binary', value: '00ff' } },
      { column: 'c5', value: { mode: 'default' } },
    ] });
    expect(postgresRecordDuplicatePlan(page, 0).fields.at(-1)?.value).toEqual({ mode: 'null' });
  });

  it('原行不完整、已删除、不可写或过大时拒绝复制', () => {
    expect(() => postgresRecordDuplicatePlan(page, 0, { kind: 'delete', row: 0 })).toThrow('已变化');
    expect(() => postgresRecordDuplicatePlan({ ...page, truncated: true }, 0)).toThrow('已变化');
    expect(() => postgresRecordDuplicatePlan({ ...page, rows: [{}] }, 0)).toThrow('不完整');
    expect(() => postgresRecordDuplicatePlan({ ...page, rows: [{ ...page.rows[0], c4: { type: 'binary', base64: 'A'.repeat(90_000) } }] }, 0))
      .toThrow('超出暂存范围');
  });

  it('无行键也按原页顺序复制，单个副本的默认值选择不改变其他副本', () => {
    const source = { ...page, rowKeys: undefined, rows: [page.rows[0], { ...page.rows[0], c0: '9007199254740994' }] };
    const plan = postgresBatchDuplicatePlan(source, new Set([1, 0]), () => undefined);
    const changes = postgresBatchDuplicateChanges(source, plan, new Map([[1, new Map()]]));
    expect(changes).toEqual([{ kind: 'insert', fields: postgresRecordDuplicatePlan(source, 0).fields }, { kind: 'insert', fields: [] }]);
    expect(() => postgresBatchDuplicateChanges(source, plan, new Map([[2, new Map()]]))).toThrow('已变化');
    expect(() => postgresBatchDuplicateChanges({ ...source, rows: source.rows.map(row => ({ ...row })) }, plan, new Map())).toThrow('已变化');
  });

  it('任何一条已标记删除的记录都会拒绝整个复制计划', () => {
    const source = { ...page, rowKeys: ['一', '二'], rows: [page.rows[0], { ...page.rows[0], c0: '2' }] };
    expect(() => postgresBatchDuplicatePlan(source, new Set([0, 1]), key => key === '二' ? { kind: 'delete', row: 1 } : undefined))
      .toThrow('已变化');
  });
});
