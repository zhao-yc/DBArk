import { expect, it } from 'vitest';
import { beginSqliteRecordJson, readSqliteRecordJson, sqliteRecordJsonBudget } from '../../src/renderer/sqliteRecordJson';
import type { SqliteEditColumn, SqliteOriginalValue } from '../../src/shared/sqliteTableEdit';
import { sqliteRecordJsonZh as text } from '../../src/renderer/locales/sqliteRecordJson.zh-CN';

/** 纯typed来源包含原型同名字段、int64边界、TEXT里的JSON原文及生成列。 */
function fixture(inserted = false) {
  const columns: SqliteEditColumn[] = ['__proto__', 'n', 'body', 'bytes', 'empty', 'generated'].map((name, i) => ({ name, declaredType: i === 1 ? 'INTEGER' : '', generated: i === 5, nullable: true, hasDefault: true }));
  const values: (SqliteOriginalValue | undefined)[] = [{ kind: 'integer', value: '9223372036854775807' }, { kind: 'integer', value: '-9223372036854775808' }, { kind: 'text', value: '{"n":9007199254740993,"n":1e999}\r\n尾🚢\u0000' }, { kind: 'blob', value: '00ff' }, { kind: 'null' }, inserted ? undefined : { kind: 'text', value: '只读生成' }];
  const input = beginSqliteRecordJson(columns, values, inserted), document = JSON.parse(input.initial);
  return { columns, values, input, document, read: () => readSqliteRecordJson(input, JSON.stringify(document)) };
}
it('整行原类型往返保int64、NULL、HEX和TEXT中重复成员及数字原文；无JSON Number往返', () => {
  const f = fixture(); expect(f.read()).toEqual(f.values); expect(f.document.fields[0].value.value).toBe('9223372036854775807'); expect(Object.isFrozen(f.input.values[0])).toBe(true);
  f.document.fields[2].value = { kind: 'text', value: '更新\r\n🚢' }; f.document.fields[3].value = { kind: 'blob', value: 'abcd' }; expect(f.read().slice(2, 4)).toEqual([{ kind: 'text', value: '更新\r\n🚢' }, { kind: 'blob', value: 'abcd' }]); expect(f.values[2]).not.toEqual(f.read()[2]);
});
it.each(['root', 'field', 'value'])('%s重复或转义同名成员在JSON.parse覆盖前整批拒绝', where => {
  const f = fixture(); const source = where === 'root' ? f.input.initial.replace('"version": 1', '"version": 2,"version": 1') : where === 'field' ? f.input.initial.replace('"name": "n"', '"name":"错误","na\\u006de":"n"') : f.input.initial.replace('"kind": "integer"', '"kind":"text","kind":"integer"'); expect(() => readSqliteRecordJson(f.input, source)).toThrow(text.duplicate);
});
it.each(['reorder', 'missing', 'extra', 'name', 'declaredType', 'generated', 'rootExtra'])('%s元数据变化不发布任何部分字段', kind => {
  const f = fixture(); if (kind === 'reorder') f.document.fields.reverse(); if (kind === 'missing') f.document.fields.pop(); if (kind === 'extra') f.document.fields.push(f.document.fields[0]); if (['name','declaredType','generated'].includes(kind)) f.document.fields[0][kind] = kind === 'generated' ? true : '变化'; if (kind === 'rootExtra') f.document.extra = true;
  expect(f.read).toThrow(text.invalid); expect(f.input.values).toEqual(f.values);
});
it.each([{ kind: 'integer', value: 9007199254740992 }, { kind: 'integer', value: '9223372036854775808' }, { kind: 'real', value: 'Infinity' }, { kind: 'blob', value: 'f' }, { kind: 'text', value: 'x', extra: true }, { kind: 'null', value: '' }, { kind: 'object', value: {} }])('非法typed输入整批拒绝：%j', value => { const f = fixture(); f.document.fields[0].value = value; expect(f.read).toThrow(text.value('__proto__')); expect(f.input.values).toEqual(f.values); });
it('新增default省略可改NULL且反向切回；已有行拒绝default；生成列严格保持', () => {
  const f = fixture(true); expect(f.document.fields[5].value).toEqual({ kind: 'default' }); f.document.fields[0].value = { kind: 'default' }; expect(f.read()[0]).toBeUndefined(); f.document.fields[0].value = { kind: 'null' }; expect(f.read()[0]).toEqual({ kind: 'null' });
  const old = fixture(); old.document.fields[0].value = { kind: 'default' }; expect(old.read).toThrow(text.defaultExisting); old.document.fields[5].value = { kind: 'text', value: '污染' }; old.document.fields[0].value = old.values[0]; expect(old.read).toThrow(text.locked);
});
it('未修改非有限原REAL保持，明确输入有限REAL可替换；大BLOB不能修改或截取', () => {
  const columns = fixture().columns.slice(0, 2), values: SqliteOriginalValue[] = [{ kind: 'real', value: 'Infinity' }, { kind: 'blob', value: 'ab'.repeat(32769) }], input = beginSqliteRecordJson(columns, values, false), document = JSON.parse(input.initial);
  expect(readSqliteRecordJson(input, input.initial)).toEqual(values); document.fields[0].value.value = '1.5'; expect(readSqliteRecordJson(input, JSON.stringify(document))[0]).toEqual({ kind: 'real', value: '1.5' }); document.fields[1].value.value = 'ab'; expect(() => readSqliteRecordJson(input, JSON.stringify(document))).toThrow(text.locked);
});
it('源与完整候选共同守2MiB及UTF8预算；无尾部、深层或不完整JSON也不返回部分值', () => {
  const f = fixture(); expect(() => beginSqliteRecordJson(f.columns, [{ kind: 'text', value: 'x'.repeat(sqliteRecordJsonBudget.units + 1) }, ...f.values.slice(1)], false)).toThrow(text.limited);
  for (const source of ['x'.repeat(sqliteRecordJsonBudget.units + 1), '中'.repeat(800000)]) expect(() => readSqliteRecordJson(f.input, source)).toThrow(text.limited);
  for (const source of [f.input.initial.slice(0,-1), f.input.initial+' null', '['.repeat(20)+'0'+']'.repeat(20)]) expect(() => readSqliteRecordJson(f.input, source)).toThrow();
});
it('捕获来源的副本冻结，后续原值或元数据改变不污染已打开文档', () => {
  const f = fixture(); f.columns[0].name = '另一字段'; f.values[0] = { kind: 'null' }; expect(f.input.columns[0].name).toBe('__proto__'); expect(f.read()[0]).toEqual({ kind: 'integer', value: '9223372036854775807' });
});
