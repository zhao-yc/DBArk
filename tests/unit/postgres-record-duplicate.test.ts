import { describe, expect, it } from 'vitest';
import type { PostgresTablePage } from '../../src/shared/postgresTable';
import { postgresRecordDuplicatePlan } from '../../src/renderer/postgresRecordDuplicate';

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
});
