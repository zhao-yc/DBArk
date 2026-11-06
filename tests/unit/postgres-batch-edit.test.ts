import { describe, expect, it } from 'vitest';
import type { PostgresTableChange, PostgresTablePage } from '../../src/shared/postgresTable';
import { postgresBatchEditPlan, type PostgresBatchEditValues } from '../../src/renderer/postgresBatchEdit';
import { postgresBatchRows } from '../../src/renderer/postgresBatchSelection';

const page: PostgresTablePage = {
  columns: ['c0', 'c1', 'c2'].map((key, index) => ({
    key, name: key, type: index ? 'text' : 'bigint', primary: index === 0, nullable: index > 0,
    defaultValue: false, generated: false, binary: false,
  })),
  rows: [{ c0: '9007199254740993', c1: '甲', c2: '原' }, { c0: '9007199254740995', c1: '乙', c2: null }],
  rowKeys: ['一', '二'], pageToken: '原页', capabilities: { insert: true, update: true, delete: true },
  hasNext: false, truncated: false, order: 'primary', relationKind: 'r',
};
const selected = new Set([0, 1]);
const prior: Extract<PostgresTableChange, { kind: 'update' }> = { kind: 'update', row: 8, fields: [
  { column: 'c0', value: { mode: 'text', value: '9007199254740994' } },
  { column: 'c1', value: { mode: 'text', value: '旧草稿' } },
] };

describe('PostgreSQL 逐条编辑勾选记录', () => {
  it('分别生成不同值，保留不开放编辑的既有字段和未修改值', () => {
    const rows = postgresBatchRows(page, selected, key => key === '一' ? prior : undefined);
    const input = new Map<number, PostgresBatchEditValues>([
      [1, new Map([['c1', { mode: 'null' }], ['c2', { mode: 'null' }]])],
      [0, new Map([['c1', { mode: 'text', value: '新草稿' }]])],
    ]);
    expect(postgresBatchEditPlan(page, rows, input)).toEqual({ remove: new Set(), changes: [
      { kind: 'update', row: 0, fields: [prior.fields[0], { column: 'c1', value: { mode: 'text', value: '新草稿' } }] },
      { kind: 'update', row: 1, fields: [{ column: 'c1', value: { mode: 'null' } }] },
    ] });
  });

  it('恢复原值可清除整行旧草稿，未修改的行保持', () => {
    const rows = postgresBatchRows(page, selected, key => key === '一' ? { ...prior, fields: [prior.fields[1]] } : undefined);
    expect(postgresBatchEditPlan(page, rows, new Map([[0, new Map()]]))).toEqual({ changes: [], remove: new Set(['一']) });
    expect(postgresBatchEditPlan(page, rows, new Map([[0, new Map([['c1', { mode: 'text', value: '甲' }]])]])))
      .toEqual({ changes: [], remove: new Set(['一']) });
    expect(postgresBatchEditPlan(page, rows, new Map([[0, new Map([['c1', prior.fields[1].value]])]])))
      .toEqual({ changes: [], remove: new Set() });
  });

  it('拒绝旧行身份、未勾选行和不可编辑字段', () => {
    const rows = postgresBatchRows(page, new Set([0]), () => undefined);
    expect(() => postgresBatchEditPlan(page, rows, new Map([[1, new Map()]]))).toThrow('变化');
    expect(() => postgresBatchEditPlan({ ...page, rowKeys: ['新一', '二'] }, rows, new Map([[0, new Map()]]))).toThrow('变化');
    expect(() => postgresBatchEditPlan(page, rows, new Map([[0, new Map([['c0', { mode: 'null' }]])]]))).toThrow('无效');
  });
});
