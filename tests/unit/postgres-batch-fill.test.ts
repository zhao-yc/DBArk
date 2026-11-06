import { describe, expect, it } from 'vitest';
import type { PostgresTableChange, PostgresTableColumn, PostgresTablePage } from '../../src/shared/postgresTable';
import { postgresBatchFillChanges } from '../../src/renderer/postgresBatchFill';

const column = (key: string, options: Partial<PostgresTableColumn> = {}): PostgresTableColumn => ({
  key, name: key, type: 'text', primary: false, generated: false, binary: false, nullable: true, defaultValue: false, ...options,
});
const columns = [column('c0', { primary: true }), column('c1'), column('c2', { binary: true }), column('c3', { generated: true })];
const page: PostgresTablePage = {
  columns, rows: [
    { c0: '9007199254740993', c1: '甲', c2: { type: 'binary', base64: 'AP8=' }, c3: '自动' },
    { c0: '9007199254740995', c1: '乙', c2: null, c3: '自动' },
  ],
  rowKeys: ['一', '二'], pageToken: '页能力', capabilities: { insert: true, update: true, delete: true },
  hasNext: false, truncated: false, order: 'primary', relationKind: 'r',
};

describe('PostgreSQL 勾选记录批量填充', () => {
  it('只构造有变化的勾选行，保留该行其他草稿字段', () => {
    const previous: PostgresTableChange = { kind: 'update', row: 7, fields: [{ column: 'c2', value: { mode: 'default' } }] };
    const rows = postgresBatchFillChanges(page, columns, new Set([1, 0]), [{ column: 'c1', value: { mode: 'text', value: '甲' } }],
      key => key === '二' ? previous : undefined);
    expect(rows).toEqual([{ kind: 'update', row: 1, fields: [...previous.fields, { column: 'c1', value: { mode: 'text', value: '甲' } }] }]);
    expect(postgresBatchFillChanges(page, columns, new Set([0]), [{ column: 'c2', value: { mode: 'binary', value: '00FF' } }],
      () => undefined)).toEqual([]);
  });

  it('原页、列、值和任一所选行无效时拒绝整批', () => {
    const selected = new Set([0, 1]);
    const plan = (field: string, prior: (key: string) => PostgresTableChange | undefined = () => undefined) =>
      postgresBatchFillChanges(page, columns, selected, [{ column: field, value: { mode: 'text', value: '' } }], prior);
    expect(() => plan('c0')).toThrow('字段');
    expect(() => plan('c3')).toThrow('字段');
    expect(() => plan('c1', key => key === '二' ? { kind: 'delete', row: 1 } : undefined)).toThrow('已有记录');
    expect(() => postgresBatchFillChanges(page, columns, selected, [{ column: 'c2', value: { mode: 'binary', value: 'x' } }],
      () => undefined)).toThrow('填充值');
  });
});
