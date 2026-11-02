import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CellValue, QueryResult } from '../../src/shared/contracts';
import type { QueryResultFilterGroup, QueryResultFilterRule } from '../../src/shared/queryResultPresets';
import { queryResultPresetValueSchema } from '../../src/shared/queryResultPresets';
import { QueryResultFilter, queryResultFilterLimits } from '../../src/renderer/queryResultFilter';
import { QueryResultSort } from '../../src/renderer/queryResultSort';
import { queryResultFilterZh as text } from '../../src/renderer/locales/queryResultFilter.zh-CN';
import { createQueryResultSnapshot } from '../../src/shared/queryResultSnapshot';

type Value = string | number | bigint | null | Uint8Array;
const values: Value[] = [2n, 2, '2', 9223372036854775807n, -9223372036854775808n, 9007199254740993n, 9007199254740992, Infinity, -Infinity, null, '', 'NULL', 'a2', '2b', 'a2b', 'A', 'a', 'B', 'b', '\0A', '\0B', '\uE000', '🚢', '𐀀', Uint8Array.of(0), Uint8Array.of(0xff), Uint8Array.of(0, 0xff), new Uint8Array(), 'İ', 'i\u0307'];
/** 真实SQLite只作独立预期库；被测控制器只收到已返回行，不持有数据库调用能力。 */
function fixture(input = values) {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE subject(id INTEGER PRIMARY KEY,value);');
  const insert = db.prepare('INSERT INTO subject VALUES(?,?)'); input.forEach((value, index) => insert.run(index, value));
  const actual = db.prepare('SELECT typeof(value) AS storage FROM subject ORDER BY id').all();
  const codeByType: Record<string, string> = { integer: 'i', real: 'r', text: 't', blob: 'b', null: 'n' };
  const codes = actual.map(row => { const code = codeByType[String(row.storage)]; if (!code) throw Error('参考库返回未知存储类'); return code; });
  const rows = input.map((value, index) => ({ value: value === null ? null : typeof value === 'string' ? value : typeof value === 'bigint' ? String(value) : typeof value === 'number' ? Object.is(value, -0) ? '-0' : String(value) : { type: 'binary' as const, base64: Buffer.from(value).toString('base64') }, id: String(index) }));
  const source: QueryResult = { columns: [{ key: 'value', name: '同名', type: 'SQLITE' }, { key: 'id', name: '同名', type: 'SQLITE' }], rows, sqliteStorage: { version: 1, rows: codes.map(code => code + 'i') }, truncated: true, elapsedMs: 1, statement: '仅来源，筛选不执行SQL' };
  const filter = new QueryResultFilter(), binding = filter.bind(source, [])!;
  return { db, source, filter, binding, apply: (rules: QueryResultFilterRule[], mode: 'AND' | 'OR' = 'AND') => filter.apply(binding, filter.view(binding)!, rules, mode),
    expected: (where: string, parameters: Value[] = []) => db.prepare('SELECT id FROM subject WHERE ' + where + ' ORDER BY id').all(...parameters).map(row => Number(row.id)) };
}
const rule = (type: QueryResultFilterRule['sqliteType'], operator: QueryResultFilterRule['operator'], value = '', extras: Partial<QueryResultFilterRule> = {}): QueryResultFilterRule => ({ column: 'value', operator, value, ...(type ? { sqliteType: type } : {}), ...extras });

describe('SQLite已返回结果的显式类型条件', () => {
  it.each([
    ['integer', '2', 2n], ['real', '2', 2], ['text', '2', '2'], ['blob', '00', Uint8Array.of(0)],
    ['integer', '9223372036854775807', 9223372036854775807n], ['integer', '-9223372036854775808', -9223372036854775808n], ['real', 'Infinity', Infinity], ['text', '', ''], ['blob', '', new Uint8Array()],
  ] as const)('%s等值／排除只匹配原类型：%s', (type, input, literal) => {
    const f = fixture(), before = structuredClone(f.source);
    try { for (const operator of ['eq', 'ne'] as const) { const view = f.apply([rule(type, operator, input)]); expect(view.sourceIndices).toEqual(f.expected('typeof(value)=? AND value ' + (operator === 'eq' ? '=' : '<>') + ' ? COLLATE BINARY', [type, literal])); expect(view.result.sqliteStorage!.rows).toEqual(view.sourceIndices.map(index => f.source.sqliteStorage!.rows[index])); view.sourceIndices.forEach((index, position) => expect(view.result.rows[position]).toBe(f.source.rows[index])); } expect(f.source).toEqual(before); }
    finally { f.db.close(); }
  });
  it.each([
    ['integer', '2', 2n], ['real', '2', 2], ['text', '\uE000', '\uE000'], ['blob', '00', Uint8Array.of(0)],
  ] as const)('%s四种有序比较与真实SQLite一致', (type, input, literal) => {
    const f = fixture();
    try { for (const [operator, sql] of [['gt', '>'], ['gte', '>='], ['lt', '<'], ['lte', '<=']] as const) expect(f.apply([rule(type, operator, input)]).sourceIndices).toEqual(f.expected('typeof(value)=? AND value ' + sql + ' ? COLLATE BINARY', [type, literal])); }
    finally { f.db.close(); }
  });
  it.each([
    ['integer', '2', '9223372036854775807', 2n, 9223372036854775807n], ['real', '2', 'Infinity', 2, Infinity],
    ['text', '\uE000', '🚢', '\uE000', '🚢'], ['blob', '00', 'ff', Uint8Array.of(0), Uint8Array.of(0xff)],
  ] as const)('%s包含端点的范围与反范围、列表和反列表均保持原类型', (type, low, high, a, b) => {
    const f = fixture();
    try {
      for (const [operator, sql] of [['between', 'BETWEEN'], ['notBetween', 'NOT BETWEEN']] as const) expect(f.apply([rule(type, operator, low, { upper: high })]).sourceIndices).toEqual(f.expected('typeof(value)=? AND value COLLATE BINARY ' + sql + ' ? AND ?', [type, a, b]));
      for (const [operator, sql] of [['in', 'IN'], ['notIn', 'NOT IN']] as const) expect(f.apply([rule(type, operator, '', { values: [low, high] })]).sourceIndices).toEqual(f.expected('typeof(value)=? AND value COLLATE BINARY ' + sql + ' (?,?)', [type, a, b]));
    } finally { f.db.close(); }
  });
  it('文本包含、首尾与否定按完整原文，不把数字和BLOB转成文本；空串不等于NULL', () => {
    const f = fixture();
    try {
      // SQLite对空BLOB的substr返回NULL；参考SQL显式补空字节，才能表达JS首尾判断的空文本语义。
      for (const [operator, predicate] of [['contains', 'instr(CAST(value AS BLOB),x\'32\')>0'], ['notContains', 'instr(CAST(value AS BLOB),x\'32\')=0'], ['startsWith', 'substr(CAST(value AS BLOB),1,1)=x\'32\''], ['notStartsWith', 'COALESCE(substr(CAST(value AS BLOB),1,1),x\'\')<>x\'32\''], ['endsWith', 'substr(CAST(value AS BLOB),-1)=x\'32\''], ['notEndsWith', 'COALESCE(substr(CAST(value AS BLOB),-1),x\'\')<>x\'32\'']] as const) expect(f.apply([rule('text', operator, '2')]).sourceIndices).toEqual(f.expected("typeof(value)='text' AND " + predicate));
      expect(f.apply([rule('text', 'empty')]).sourceIndices).toEqual([10]); expect(f.apply([rule('text', 'notEmpty')]).sourceIndices).toEqual(f.expected("typeof(value)='text' AND CAST(value AS BLOB)<>x''"));
      expect(f.apply([rule(undefined, 'null')]).sourceIndices).toEqual([9]); expect(f.apply([rule(undefined, 'notNull')]).sourceIndices).toEqual(f.expected('value IS NOT NULL'));
    } finally { f.db.close(); }
  });
  it('Unicode小写用于上下限、列表及源文本；NUL、换行和非BMP通配不跨存储类', () => {
    const f = fixture();
    try { expect(f.apply([rule('text', 'between', 'A', { upper: 'B', ignoreCase: true })]).sourceIndices).toEqual([12, 14, 15, 16, 17, 18]); expect(f.apply([rule('text', 'in', '', { values: ['A', 'B'], ignoreCase: true })]).sourceIndices).toEqual([15, 16, 17, 18]); expect(f.apply([rule('text', 'eq', 'İ', { ignoreCase: true })]).sourceIndices).toEqual([28, 29]); }
    finally { f.db.close(); }
    const wild = fixture(['a🚢b', 'aXb', 'a\nb', 'a\0b', 'a%_\\', 2n, Uint8Array.of(0x61)]);
    try { expect(wild.apply([rule('text', 'like', 'a_b')]).sourceIndices).toEqual([0, 1, 2, 3]); expect(wild.apply([rule('text', 'notLike', 'a_b')]).sourceIndices).toEqual([4]); expect(wild.apply([rule('text', 'like', 'a\\%\\_\\\\')]).sourceIndices).toEqual([4]); }
    finally { wild.db.close(); }
  });
  it('嵌套组合、停用原文、排序与类型投影保持，方案结构保留显式类型', () => {
    const f = fixture();
    try {
      const expression: QueryResultFilterGroup = { mode: 'OR', children: [rule('integer', 'eq', '2'), { mode: 'AND', children: [rule('text', 'contains', '2'), rule('integer', 'eq', '尚未完成的数字', { enabled: false })] }] };
      const filtered = f.filter.applyExpression(f.binding, f.filter.view(f.binding)!, expression); expect(filtered.sourceIndices).toEqual([0, 2, 12, 13, 14]);
      const sort = new QueryResultSort(), binding = sort.bind(filtered.result, [])!, view = sort.apply(binding, sort.view(binding)!, [{ column: 'id', direction: 'DESC' }]);
      expect(view.result.rows.map(row => row.id)).toEqual(['14', '13', '12', '2', '0']); expect(view.result.sqliteStorage!.rows).toEqual(['ti', 'ti', 'ti', 'ti', 'ii']); expect(createQueryResultSnapshot(view.result).version).toBe(2);
      const preset = { columns: f.source.columns, visible: f.source.columns, configuration: { expression, sort: [] } }; expect(queryResultPresetValueSchema.parse(JSON.parse(JSON.stringify(preset)))).toEqual(preset);
      for (const change of [{ ...preset, configuration: { expression: { mode: 'AND', children: [rule(undefined, 'eq', '2')] }, sort: [] } }, { ...preset, columns: f.source.columns.map(c => ({ ...c, type: 'TEXT' })), visible: f.source.columns.map(c => ({ ...c, type: 'TEXT' })) }]) expect(queryResultPresetValueSchema.safeParse(change).success).toBe(false);
    } finally { f.db.close(); }
  });
  it.each([rule('integer', 'eq', '9223372036854775808'), rule('integer', 'eq', '2.0'), rule('real', 'eq', 'NaN'), rule('real', 'eq', '1e999'), rule('blob', 'eq', '0'), rule('blob', 'eq', '0x00'), rule('text', 'eq', '\ud800'), rule('integer', 'between', '3', { upper: '2' }), rule(undefined, 'eq', '2'), rule('integer', 'null'), rule('blob', 'eq', '', { ignoreCase: true })])('非法类型条件拒绝并保已生效视图：%j', invalid => {
    const f = fixture(); try { const old = f.apply([rule('text', 'eq', '2')]); expect(() => f.apply([invalid])).toThrow(); expect(f.filter.view(f.binding)).toBe(old); } finally { f.db.close(); }
  });
  it('旧SQLite结果不猜类型，NULL仍可判断；未涉及的巨大BLOB不为文本条件解码', () => {
    const f = fixture(['2', new Uint8Array(65536), null]);
    try { expect(f.apply([rule('text', 'eq', '2')]).sourceIndices).toEqual([0]); delete f.source.sqliteStorage; const binding = f.filter.bind(f.source, [])!; expect(() => f.filter.apply(binding, f.filter.view(binding)!, [rule('text', 'eq', '2')], 'AND')).toThrow(text.sqliteUnknown); expect(f.filter.apply(binding, f.filter.view(binding)!, [rule(undefined, 'null')], 'AND').sourceIndices).toEqual([2]); }
    finally { f.db.close(); }
  });
  it('UTF-8编码键计入预算，类型或活动BLOB原地漂移使租约永久失效', () => {
    const f = fixture(Array(600).fill('界'.repeat(queryResultFilterLimits.valueUnits)));
    try { const old = f.filter.view(f.binding); expect(() => f.apply([rule('text', 'eq', '界')])).toThrow(text.budget); expect(f.filter.view(f.binding)).toBe(old); } finally { f.db.close(); }
    const bytes = fixture([Uint8Array.of(0), Uint8Array.of(0xff)]);
    try { bytes.apply([rule('blob', 'eq', '00')]); const value = bytes.source.rows[1].value as { type: 'binary'; base64: string }, old = value.base64; value.base64 = 'AA=='; expect(bytes.filter.current(bytes.binding)).toBe(false); value.base64 = old; expect(bytes.filter.view(bytes.binding)).toBeUndefined(); } finally { bytes.db.close(); }
  });
});
