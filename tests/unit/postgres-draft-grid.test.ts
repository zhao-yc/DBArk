import { expect, it } from 'vitest';
import type { PostgresTablePage } from '../../src/shared/postgresTable';
import type { PostgresDraftEntry } from '../../src/shared/postgresTableDraft';
import { postgresDraftGrid } from '../../src/renderer/postgresDraftGrid';

it('按当前页主键显示跨页草稿，保留原行和待删除定位，DEFAULT 不能当作已生成的值复制', () => {
  const first = { c0: '2', c1: '原值', c2: null, c3: '原默认', c4: '未改', c5: '原非空' };
  const second = { c0: '1', c1: '另一行' };
  const page: PostgresTablePage = {
    columns: [], rows: [first, second], rowKeys: ['key2', 'key1'],
    capabilities: { insert: true, update: true, delete: true }, hasNext: false, truncated: false, order: 'primary', relationKind: 'r',
  };
  const draft: PostgresDraftEntry[] = [
    { offset: 4, rowKey: 'key2', change: { kind: 'update', row: 12, pageToken: '原页', fields: [
      { column: 'c1', value: { mode: 'text', value: '9223372036854775807' } },
      { column: 'c2', value: { mode: 'binary', value: '00ff' } },
      { column: 'c3', value: { mode: 'default' } },
      { column: 'c5', value: { mode: 'null' } },
    ] } },
    { offset: 0, rowKey: 'key1', change: { kind: 'delete', row: 0, pageToken: '另一原页' } },
    { offset: 0, change: { kind: 'insert', fields: [], pageToken: '另一原页' } },
  ];
  const overlay = postgresDraftGrid(page, draft);
  expect(overlay.hasChanges).toBe(true);
  expect(overlay.cell(first, 'c1')).toMatchObject({ value: '9223372036854775807', className: 'pg-grid-staged' });
  expect(overlay.cell(first, 'c2')?.value).toEqual({ type: 'binary', base64: 'AP8=' });
  expect(overlay.cell(first, 'c3')).toMatchObject({ value: undefined, label: '待应用 DEFAULT', copyError: expect.any(String) });
  expect(overlay.cell(first, 'c5')?.value).toBeNull();
  expect(overlay.cell(first, 'c4')).toBeUndefined();
  expect(overlay.cell(second, 'c1')).toMatchObject({ value: '另一行', className: 'pg-grid-deleted' });
  expect(overlay.cell({ ...first }, 'c1')).toBeUndefined();
  expect(page.rows).toEqual([{ c0: '2', c1: '原值', c2: null, c3: '原默认', c4: '未改', c5: '原非空' }, second]);
  expect(postgresDraftGrid(page, [draft[2]]).hasChanges).toBe(false);
});
