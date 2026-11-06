import { describe, expect, it } from 'vitest';
import type { PostgresTablePage } from '../../src/shared/postgresTable';
import { postgresBatchDeletePlan } from '../../src/renderer/postgresBatchDelete';

const page: PostgresTablePage = {
  columns: ['c0', 'c1'].map((key, index) => ({
    key, name: index ? '分组' : '编号', type: index ? 'text' : 'bigint',
    primary: true, nullable: false, defaultValue: false, generated: false, binary: false,
  })),
  rows: [{ c0: '9007199254740993', c1: '' }, { c0: '9007199254740995', c1: '分组乙' }],
  rowKeys: ['原一', '原二'], pageToken: '原页', capabilities: { insert: false, update: false, delete: true },
  hasNext: false, truncated: false, order: 'primary', relationKind: 'r',
};

describe('PostgreSQL 删除勾选记录', () => {
  it('允许仅有删除权限的表，展示复合键原值及待替换更新的数量', () => {
    const plan = postgresBatchDeletePlan(page, new Set([1, 0]), key =>
      key === '原二' ? { kind: 'update', row: 9, fields: [{ column: 'c1', value: { mode: 'text', value: '暂存' } }] } : undefined);
    expect(plan).toEqual({
      updates: 1, changes: [{ kind: 'delete', row: 0 }, { kind: 'delete', row: 1 }],
      rows: [
        { index: 0, key: [{ name: '编号', value: '9007199254740993' }, { name: '分组', value: '""' }] },
        { index: 1, key: [{ name: '编号', value: '9007199254740995' }, { name: '分组', value: '分组乙' }] },
      ],
    });
  });

  it('已暂存删除、重复原行、越界及只读来源均拒绝整组', () => {
    const selected = new Set([0, 1]);
    expect(() => postgresBatchDeletePlan(page, selected, key => key === '原二' ? { kind: 'delete', row: 1 } : undefined)).toThrow('已有记录');
    expect(() => postgresBatchDeletePlan({ ...page, rowKeys: ['原一', '原一'] }, selected, () => undefined)).toThrow('已有记录');
    expect(() => postgresBatchDeletePlan(page, new Set([0, 5]), () => undefined)).toThrow('已有记录');
    expect(() => postgresBatchDeletePlan({ ...page, capabilities: { ...page.capabilities, delete: false } }, selected, () => undefined)).toThrow('变化');
  });
});
