import { describe, expect, it } from 'vitest';
import type { CellValue } from '../../src/shared/contracts';
import type { PostgresTablePage } from '../../src/shared/postgresTable';
import { postgresReadonlyRecord } from '../../src/renderer/postgresReadonlyRecord';

function pageWith(values: CellValue[]): PostgresTablePage {
  const definitions = [['id', 'bigint'], ['__proto__', 'json'], ['原字节', 'bytea'], ['空值', 'text'], ['空串', 'text']];
  return { exportToken: '原页', relationKind: 'v', order: 'unstable', truncated: false, hasNext: false,
    capabilities: { insert: false, update: false, delete: false }, rows: [Object.fromEntries(values.map((value, index) => ['c' + index, value]))],
    columns: definitions.map(([name, type], index) => ({ name, type, key: 'c' + index, binary: type === 'bytea',
      nullable: true, defaultValue: false, generated: index === 0, primary: false })) };
}

describe('PostgreSQL 原值记录视图', () => {
  const json = '{"同名":9007199254740993,"同名":0.000000000000000001}';
  const row = (): CellValue[] => ['9007199254740993', json, { type: 'binary', base64: 'AP8=' }, null, ''];

  it('保留原字段顺序、重复 JSON 成员文本、Base64、NULL 与空串', () => {
    const view = postgresReadonlyRecord(pageWith(row()), 0, () => true);
    const output = JSON.parse(view.json());
    expect(output).toMatchObject({ format: 'tabrelio-postgresql-record-view', version: 1, complete: true });
    expect(output.fields.map((field: { name: string }) => field.name)).toEqual(['id', '__proto__', '原字节', '空值', '空串']);
    expect(output.fields.map((field: { value: unknown }) => field.value)).toEqual([
      { kind: 'text', value: '9007199254740993' }, { kind: 'text', value: json },
      { kind: 'blob', encoding: 'base64', value: 'AP8=', bytes: 2 }, { kind: 'null' }, { kind: 'text', value: '' },
    ]);
    expect(view.fields.map(field => field.parse)).toEqual([false, true, false, false, true]);
  });

  it('连接、列或原行失效后不能复活旧文档', () => {
    let active = true;
    const page = pageWith(row()), old = postgresReadonlyRecord(page, 0, () => active);
    active = false;
    expect(old.current()).toBe(false);
    active = true;
    expect(() => old.json()).toThrow('已变化');
    const next = postgresReadonlyRecord(page, 0, () => true);
    page.rows[0].c2 = { type: 'binary', base64: 'AQ==' };
    expect(next.current()).toBe(false);
    const renamed = postgresReadonlyRecord(page, 0, () => true);
    page.columns[1].name = '改名';
    expect(renamed.current()).toBe(false);
  });

  it('拒绝缺列和超过整行预算，仍保留可浏览的原字段', () => {
    expect(() => postgresReadonlyRecord(pageWith(row().slice(0, -1)), 0, () => true)).toThrow('不匹配');
    const values = row(); values[4] = '原'.repeat(700_000);
    const view = postgresReadonlyRecord(pageWith(values), 0, () => true);
    expect(() => view.json()).toThrow('2 MiB');
    expect(view.fields[4].raw).toBe(values[4]);
  });
});
