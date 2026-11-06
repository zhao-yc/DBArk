import { describe, expect, it } from 'vitest';
import type { PostgresTableColumn } from '../../src/shared/postgresTable';
import { beginPostgresRecordJson, postgresJsonFieldText, readPostgresRecordJson, replacePostgresJsonField } from '../../src/renderer/postgresRecordJson';

const columns: PostgresTableColumn[] = ['精度', '字节', '生成', '空值'].map((name, index) => ({ key: 'c' + index, name,
  type: ['numeric', 'bytea', 'text', 'text'][index], generated: index === 2, nullable: index !== 0, binary: index === 1,
  primary: false, defaultValue: false }));
const original = { c0: '9007199254740993.000000000000000001', c1: { type: 'binary' as const, base64: 'AP8=' }, c2: '', c3: null };

describe('PostgreSQL 整行编辑 JSON', () => {
  it('节点编辑以当前赋值为准，拒绝跨赋值更新', () => {
    const row = { c0: '{"a":1}' };
    const none = beginPostgresRecordJson(columns, undefined, new Map());
    const fields = readPostgresRecordJson(none);
    expect(postgresJsonFieldText(row, fields, 'c0')).toBe('{"a":1}');
    const next = replacePostgresJsonField(row, fields, 'c0', '{"a":1}', '{"a":2}');
    expect(() => replacePostgresJsonField(row, next, 'c0', '{"a":1}', '{"a":3}')).toThrow('已变化');
    expect(postgresJsonFieldText(row, next, 'c0')).toBe('{"a":2}');
    next.set('c0', { mode: 'default' });
    expect(postgresJsonFieldText(row, next, 'c0')).toBeUndefined();
  });
  it('保留原值和未提交赋值，只返回明确指定的字段', () => {
    const buffer = beginPostgresRecordJson(columns, original, new Map([['c0', { mode: 'text', value: '9007199254740994.000000000000000002' }]]));
    const doc = JSON.parse(buffer.source);
    expect(doc.fields.map((field: { original: unknown }) => field.original)).toEqual(Object.values(original));
    doc.fields[1].assignment = { mode: 'binary', value: 'ff00' };
    doc.fields[3].assignment = { mode: 'default' };
    expect([...readPostgresRecordJson({ ...buffer, source: JSON.stringify(doc) })]).toEqual([
      ['c0', { mode: 'text', value: '9007199254740994.000000000000000002' }],
      ['c1', { mode: 'binary', value: 'ff00' }], ['c3', { mode: 'default' }],
    ]);
  });

  it('拒绝重复成员、改动原值、改动生成列和错误赋值', () => {
    const buffer = beginPostgresRecordJson(columns, original, new Map());
    expect(() => readPostgresRecordJson({ ...buffer, source: buffer.source.replace('"version": 1', '"version": 1, "version": 1') })).toThrow('重复成员');
    const check = (index: number, field: object) => {
      const doc = JSON.parse(buffer.source);
      Object.assign(doc.fields[index], field);
      return () => readPostgresRecordJson({ ...buffer, source: JSON.stringify(doc) });
    };
    expect(check(0, { original: '0' })).toThrow('不匹配');
    expect(check(0, { assignment: { mode: 'text', value: 9007199254740994 } })).toThrow('赋值无效');
    expect(check(0, { assignment: { mode: 'null' } })).toThrow('赋值无效');
    expect(check(1, { assignment: { mode: 'binary', value: 'f' } })).toThrow('赋值无效');
    expect(check(2, { assignment: { mode: 'default' } })).toThrow('生成列');
  });

  it('新增省略字段，字符串中的数据库 JSON 保留重复成员和精度', () => {
    const buffer = beginPostgresRecordJson(columns, undefined, new Map());
    const doc = JSON.parse(buffer.source);
    expect(doc.fields.every((field: object) => !Object.hasOwn(field, 'original'))).toBe(true);
    const raw = '{"同名":9007199254740993,"同名":0.000000000000000001}';
    doc.fields[3].assignment = { mode: 'text', value: raw };
    expect([...readPostgresRecordJson({ ...buffer, source: JSON.stringify(doc) })]).toEqual([['c3', { mode: 'text', value: raw }]]);
  });
});
