import { describe, expect, it } from 'vitest';
import { decodePostgresDraft, encodePostgresDraft, postgresDraftSchema, type PostgresDraftDocument } from '../../src/shared/postgresTableDraft';

const file: PostgresDraftDocument = {
  version: 1, kind: 'tabrelio.postgresql.tableDraft',
  target: { connectionId: '原连接', database: '库', table: '"架构"."带""引号"' },
  endpoint: 'a'.repeat(64), relation: 'b'.repeat(64),
  view: { offset: 2, limit: 1, sort: [{ column: 'id', direction: 'ASC' }] },
  groups: [{ offset: 0, limit: 1 }, { offset: 2, limit: 1 }],
  entries: [
    { group: 0, change: { kind: 'update', row: 0, fields: [
      { column: 'c2', value: { mode: 'text', value: '9223372036854775807.123456789012345678' } },
      { column: 'c3', value: { mode: 'binary', value: '00ff' } },
    ] }, original: { tid: '(0,1)', version: '201', tableOid: '16384', digest: 'c'.repeat(64) } },
    { group: 1, change: { kind: 'insert', fields: [{ column: 'c1', value: { mode: 'default' } }] } },
  ],
};

describe('PostgreSQL 草稿文件', () => {
  it('按原操作顺序往返原页、筛选和准确字段模式', () => {
    const source = encodePostgresDraft(file);
    expect(decodePostgresDraft(source)).toEqual(file);
    expect(source).not.toContain('pageToken');
  });
  it('拒绝失配分组、重复物理原行、页令牌、未知版本和缺失原行', () => {
    const [first, second] = file.entries;
    for (const input of [
      { ...file, version: 2 },
      { ...file, entries: [{ ...first, group: 3 }, second] },
      { ...file, entries: [first, { ...first, group: 1 }] },
      { ...file, entries: [{ ...first, change: { ...first.change, pageToken: 'b23948a3-e1a3-45a7-b139-ffb37daa23bb' } }, second] },
      { ...file, entries: [{ ...first, original: undefined }, second] },
      { ...file, entries: [{ ...first, change: { ...first.change, row: 1 } }, second] },
    ]) expect(postgresDraftSchema.safeParse(input).success).toBe(false);
  });
  it('在解码及恢复前拒绝整体预算、重复字段和 NUL', () => {
    expect(() => decodePostgresDraft(' '.repeat(8 * 1024 * 1024 + 1))).toThrow(/8 MiB/);
    const fields = Array.from({ length: 5 }, (_, index) => ({
      column: `c${index}`, value: { mode: 'text', value: 'x'.repeat(65536) },
    }));
    expect(postgresDraftSchema.safeParse({ ...file, entries: [file.entries[0], { group: 1, change: { kind: 'insert', fields } }] }).success).toBe(false);
    const insert = (values: typeof fields) => ({ ...file, entries: [file.entries[0], { group: 1, change: { kind: 'insert', fields: values } }] });
    expect(postgresDraftSchema.safeParse(insert([fields[0], fields[0]])).success).toBe(false);
    expect(postgresDraftSchema.safeParse(insert([{ column: 'c0', value: { mode: 'text', value: '含\0NUL' } }])).success).toBe(false);
  });
});
