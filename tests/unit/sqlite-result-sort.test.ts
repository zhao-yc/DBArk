import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CellValue, QueryResult } from '../../src/shared/contracts';
import { QueryResultSort, queryResultSortLimits } from '../../src/renderer/queryResultSort';
import type { QueryResultSortRule } from '../../src/shared/queryResultPresets';
import { createQueryResultSnapshot, encodeQueryResultSnapshot, decodeQueryResultSnapshot } from '../../src/shared/queryResultSnapshot';
import { queryResultSortZh as text } from '../../src/renderer/locales/queryResultSort.zh-CN';

type Value = string | number | bigint | null | Uint8Array;
/** 本例值同时喂给真实SQLite参考库与原始结果表示，不从被测排序器生成预期。 */
function fixture(values: Value[]) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE subject(id INTEGER PRIMARY KEY,value,secondary);');
  const insert = db.prepare('INSERT INTO subject VALUES(?,?,?)');
  const codes: string[] = [], rows = values.map((value, index) => {
    insert.run(index, value, index % 3);
    const code = value === null ? 'n' : typeof value === 'bigint' ? 'i' : typeof value === 'number' ? 'r' : typeof value === 'string' ? 't' : 'b';
    codes.push(code + 'ii');
    const cell: CellValue = value === null ? null : typeof value === 'bigint' ? String(value) : typeof value === 'number' ? Object.is(value, -0) ? '-0' : String(value) : typeof value === 'string' ? value : { type: 'binary', base64: Buffer.from(value).toString('base64') };
    return { value: cell, secondary: String(index % 3), id: String(index) };
  });
  const source: QueryResult = { columns: [{ key: 'value', name: '同名', type: 'SQLITE' }, { key: 'secondary', name: '同名', type: 'SQLITE' }, { key: 'id', name: 'id', type: 'SQLITE' }], rows, sqliteStorage: { version: 1, rows: codes }, truncated: true, elapsedMs: 1, statement: '仅已返回行，不再查询' };
  const sorter = new QueryResultSort(), binding = sorter.bind(source, ['本例原结果'])!;
  return { db, source, sorter, binding, sort: (rules: QueryResultSortRule[]) => sorter.apply(binding, sorter.view(binding)!, rules),
    expected: (order: string) => db.prepare('SELECT id FROM subject ORDER BY ' + order + ',id ASC').all().map(row => Number(row.id)) };
}
const mixed: Value[] = [9223372036854775807n, 9223372036854775808, 9007199254740993n, 9007199254740992, -9223372036854775808n, -9223372036854775808, -9007199254740993n, -9007199254740992,
  2n, 2, '2', '10', -0, 0n, 1.25, -1.25, Number.MIN_VALUE, -Number.MIN_VALUE, Infinity, -Infinity, null, '', 'A', 'a', '\0A', '\0B', '\uFEFF', '\uFFFD', '\uE000', '🚢', '𐀀',
  Uint8Array.of(0xff), Uint8Array.of(0), Uint8Array.of(0, 0xff), new Uint8Array(), Uint8Array.of(0xff, 0), Uint8Array.of(0x68), null, 2n, 2];

describe('SQLite原存储类型的本地多列排序', () => {
  it.each(['ASC', 'DESC'] as const)('%s顺序与真实UTF-8 SQLite参考库一致：混合类型、int64/REAL边界、NUL、非BMP及BLOB', direction => {
    const f = fixture(mixed), before = structuredClone(f.source);
    try {
      const view = f.sort([{ column: 'value', direction }]); expect(view.sourceIndices).toEqual(f.expected('value COLLATE BINARY ' + direction));
      expect(view.result.rows.map(row => row.id)).toEqual(view.sourceIndices.map(String));
      expect(view.result.sqliteStorage!.rows).toEqual(view.sourceIndices.map(index => f.source.sqliteStorage!.rows[index]));
      view.sourceIndices.forEach((index, position) => expect(view.result.rows[position]).toBe(f.source.rows[index]));
      expect(f.source).toEqual(before); expect(decodeQueryResultSnapshot(encodeQueryResultSnapshot(createQueryResultSnapshot(view.result))).result).toEqual(view.result);
    } finally { f.db.close(); }
  });
  it('多列优先级、显式NULL位置、方向和清除与真实参考库一致', () => {
    const f = fixture(mixed);
    try {
      const first = f.sort([{ column: 'value', direction: 'ASC', nulls: 'LAST' }, { column: 'secondary', direction: 'DESC' }]);
      expect(first.sourceIndices).toEqual(f.expected('value COLLATE BINARY ASC NULLS LAST,secondary DESC'));
      const second = f.sort([{ column: 'secondary', direction: 'DESC' }, { column: 'value', direction: 'DESC', nulls: 'FIRST' }]);
      expect(second.sourceIndices).toEqual(f.expected('secondary DESC,value COLLATE BINARY DESC NULLS FIRST'));
      expect(f.sort([]).result).toBe(f.source); expect(f.sorter.view(f.binding)!.sourceIndices).toEqual(mixed.map((_, index) => index));
    } finally { f.db.close(); }
  });
  it('忽略大小写只作用TEXT，数值、NULL、BLOB和原字符串保持；Unicode展开键也计费', () => {
    const f = fixture(['z', 'A', 'a', 'İ', 'i\u0307', '2', 2, 2n, null, Uint8Array.of(0)]);
    try {
      const before = structuredClone(f.source), view = f.sort([{ column: 'value', direction: 'ASC', ignoreCase: true }]);
      expect(view.sourceIndices).toEqual([8, 6, 7, 5, 1, 2, 3, 4, 0, 9]); expect(f.source).toEqual(before);
    } finally { f.db.close(); }
  });
  it('旧SQLite结果没有原类型时明确拒绝，不能把同显示原文猜成数值', () => {
    const f = fixture([2n, 2, '2']);
    try {
      delete f.source.sqliteStorage; const binding = f.sorter.bind(f.source, [])!;
      expect(binding.reasons.get('value')).toBe(text.sqliteUnknown); expect(() => f.sorter.apply(binding, f.sorter.view(binding)!, [{ column: 'value', direction: 'ASC' }])).toThrow(text.sqliteUnknown);
      expect(f.sorter.view(binding)!.result).toBe(f.source);
    } finally { f.db.close(); }
  });
  it('次级BLOB原地变化或同字符串类型改变均撤销旧视图，恢复原值不复活', () => {
    for (const mode of ['blob', 'storage']) {
      const f = fixture([Uint8Array.of(0), Uint8Array.of(0xff)]);
      try {
        f.sort([{ column: 'id', direction: 'ASC' }, { column: 'value', direction: 'DESC' }]);
        const binary = f.source.rows[1].value as { type: 'binary'; base64: string }, previous = binary.base64, codes = f.source.sqliteStorage!.rows[1];
        if (mode === 'blob') binary.base64 = 'AA=='; else f.source.sqliteStorage!.rows[1] = 'tii';
        expect(f.sorter.current(f.binding)).toBe(false); binary.base64 = previous; f.source.sqliteStorage!.rows[1] = codes;
        expect(f.sorter.view(f.binding)).toBeUndefined();
      } finally { f.db.close(); }
    }
  });
  it('单格BLOB与UTF-8编码键消耗原预算，拒绝时保原顺序', () => {
    for (const values of [[new Uint8Array(3075)], Array(600).fill('界'.repeat(queryResultSortLimits.valueUnits))] as Value[][]) {
      const f = fixture(values);
      try { expect(f.binding.reasons.get('value')).toBe(text.budget); expect(() => f.sort([{ column: 'value', direction: 'ASC' }])).toThrow(text.budget); expect(f.sorter.view(f.binding)!.result).toBe(f.source); }
      finally { f.db.close(); }
    }
  });
});
