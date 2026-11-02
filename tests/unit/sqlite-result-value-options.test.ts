import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { CellValue, QueryResult } from '../../src/shared/contracts';
import { captureQueryResultValueOptions, currentQueryResultValueOptions, queryResultValueOptionLabel, queryResultValueOptionsNode, searchQueryResultValueOptions } from '../../src/renderer/queryResultValueOptions';
import { QueryResultFilter } from '../../src/renderer/queryResultFilter';
import { queryResultValueOptionsZh as text } from '../../src/renderer/locales/queryResultValueOptions.zh-CN';

type Value = string | number | bigint | null | Uint8Array;
const values: Value[] = [2n, 2, '2', Uint8Array.of(0, 255), null, '', 9223372036854775807n, '00ff', -0, 0, 'A\0🚢', Infinity, -Infinity, new Uint8Array(), 2n];
/** 参考库只生成实际typeof和独立预期；候选、搜索与生成条件不持有数据库能力。 */
function fixture(input = values) {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE subject(id INTEGER PRIMARY KEY,value);');
  const insert = db.prepare('INSERT INTO subject VALUES(?,?)'); input.forEach((value, index) => insert.run(index, value));
  const types = db.prepare('SELECT typeof(value) AS type FROM subject ORDER BY id').all().map(row => String(row.type));
  const codes: Record<string, string> = { integer: 'i', real: 'r', text: 't', blob: 'b', null: 'n' };
  const source: QueryResult = { columns: [{ key: 'value', name: '同名', type: 'SQLITE' }, { key: 'id', name: '同名', type: 'SQLITE' }], rows: input.map((value, index) => ({ value: value === null ? null : typeof value === 'string' ? value : typeof value === 'bigint' ? String(value) : typeof value === 'number' ? Object.is(value, -0) ? '-0' : String(value) : { type: 'binary' as const, base64: Buffer.from(value).toString('base64') }, id: String(index) })), sqliteStorage: { version: 1, rows: types.map(type => codes[type] + 'i') }, truncated: true, statement: '仅来源，不执行', elapsedMs: 1 };
  const capture = () => captureQueryResultValueOptions(source.columns, source.rows, source.columns[0], source);
  return { source, capture, db, types, expected(indices: number[], exclude: boolean) { const where = indices.map(() => '(typeof(value)=? AND value IS ? COLLATE BINARY)').join(' OR '), params = indices.flatMap(index => [types[index], input[index]]); return db.prepare('SELECT id FROM subject WHERE ' + (exclude ? 'NOT (' + where + ')' : where) + ' ORDER BY id').all(...params).map(row => Number(row.id)); } };
}

describe('SQLite查询结果不同值候选', () => {
  it('同显示值按原类型分别计数，正负REAL零合并，首个原文与空字节完整保留', () => {
    const f = fixture(); try {
      const before = structuredClone(f.source), capture = f.capture();
      expect(capture.entries.slice(0, 5)).toEqual([{ id: 0, literal: '2', count: 2, sqliteType: 'integer' }, { id: 1, literal: '2', count: 1, sqliteType: 'real' }, { id: 2, literal: '2', count: 1, sqliteType: 'text' }, { id: 3, literal: '00ff', count: 1, sqliteType: 'blob' }, { id: 4, literal: null, count: 1 }]);
      expect(capture.entries.find(entry => entry.literal === '-0')).toMatchObject({ sqliteType: 'real', count: 2 });
      expect(capture.entries.filter(entry => entry.sqliteType === 'blob').map(entry => entry.literal)).toEqual(['00ff', '']);
      expect(capture.entries.map(queryResultValueOptionLabel).slice(0, 5)).toEqual(['INTEGER · "2"', 'REAL · "2"', 'TEXT · "2"', 'BLOB · 0x00ff', text.nullValue]);
      expect(searchQueryResultValueOptions(capture, 'integer')).toEqual([0, 6]); expect(searchQueryResultValueOptions(capture, '00ff')).toEqual([3, 7]); expect(searchQueryResultValueOptions(capture, '\0')).toEqual([9]);
      expect(f.source).toEqual(before); expect(capture.entries.every(Object.isFrozen)).toBe(true);
    } finally { f.db.close(); }
  });
  it.each(Array.from({ length: 31 }, (_, index) => index + 1))('五类任意组合%d的包含／排除与真实SQLite逐行一致，NULL不遗漏', mask => {
    const f = fixture(); try {
      const capture = f.capture(), ids = Array.from({ length: 5 }, (_, index) => index).filter(index => mask & 1 << index), filter = new QueryResultFilter(), binding = filter.bind(f.source, [])!;
      for (const mode of ['include', 'exclude'] as const) {
        const node = queryResultValueOptionsNode(capture, ids, mode), result = filter.applyExpression(binding, filter.view(binding)!, { mode: 'AND', children: [node] });
        expect(result.sourceIndices).toEqual(f.expected(ids, mode === 'exclude'));
        expect(result.result.sqliteStorage!.rows).toEqual(result.sourceIndices.map(index => f.source.sqliteStorage!.rows[index]));
      }
    } finally { f.db.close(); }
  });
  it('所有候选排除后为零行，包含恢复全量，长整数、NUL、Infinity及空BLOB不改写', () => {
    const f = fixture(); try {
      const capture = f.capture(), filter = new QueryResultFilter(), binding = filter.bind(f.source, [])!, ids = capture.entries.map(entry => entry.id);
      for (const mode of ['include', 'exclude'] as const) { const node = queryResultValueOptionsNode(capture, ids, mode); expect(filter.applyExpression(binding, filter.view(binding)!, { mode: 'AND', children: [node] }).sourceIndices).toEqual(mode === 'exclude' ? [] : values.map((_, index) => index)); }
    } finally { f.db.close(); }
  });
  it.each(['codes', 'storage', 'binary', 'wrapper'] as const)('%s变化永久撤销捕获；恢复旧值不能借用原编号', mode => {
    const f = fixture(); try {
      const capture = f.capture(), old = f.source.sqliteStorage, code = old!.rows[0], blob = f.source.rows[3].value as { type: 'binary'; base64: string };
      if (mode === 'codes') old!.rows[0] = 'ti'; else if (mode === 'storage') f.source.sqliteStorage = structuredClone(old); else if (mode === 'binary') blob.base64 = 'AA==';
      expect(currentQueryResultValueOptions(capture, f.source.columns, f.source.rows, mode === 'wrapper' ? { ...f.source } : f.source)).toBe(false);
      old!.rows[0] = code; f.source.sqliteStorage = old; blob.base64 = 'AP8='; expect(() => queryResultValueOptionsNode(capture, [0], 'include')).toThrow(text.stale);
    } finally { f.db.close(); }
  });
  it('只扫描目标列；其它格和SQL的访问器均不执行，目标访问器整份拒绝', () => {
    const f = fixture(); try {
      const getter = vi.fn(() => { throw Error('不可读取'); }); Object.defineProperty(f.source.rows[0], 'id', { configurable: true, enumerable: true, get: getter }); Object.defineProperty(f.source, 'statement', { get: getter }); expect(f.capture().rows).toBe(values.length); expect(getter).not.toHaveBeenCalled();
      Object.defineProperty(f.source.rows[0], 'value', { get: getter }); expect(f.capture).toThrow(); expect(getter).not.toHaveBeenCalled();
    } finally { f.db.close(); }
  });
  it('旧结果只可捕获NULL，坏类型和不完整BLOB拒绝，完整预算不截取前N个值', () => {
    const f = fixture(); try {
      delete f.source.sqliteStorage; expect(f.capture).toThrow();
      f.source.rows = [{ value: null, id: '0' }]; expect(queryResultValueOptionsNode(f.capture(), [0], 'exclude')).toEqual({ column: 'value', operator: 'notNull', value: '' });
      f.source.sqliteStorage = { version: 1, rows: ['bi'] }; f.source.rows[0].value = { type: 'binary', base64: Buffer.alloc(2049).toString('base64') }; const decode = vi.spyOn(globalThis, 'atob'); try { expect(f.capture).toThrow(); expect(decode).not.toHaveBeenCalled(); } finally { decode.mockRestore(); }
      f.source.rows = Array.from({ length: 2001 }, (_, index) => ({ value: String(index), id: String(index) })); f.source.sqliteStorage.rows = Array(2001).fill('ti'); expect(f.capture).toThrow(text.budget);
      f.source.rows = Array.from({ length: 2049 }, (_, index) => ({ value: 'x'.repeat(4096), id: String(index) })); f.source.sqliteStorage.rows = Array(2049).fill('ti'); expect(f.capture).toThrow(text.budget);
    } finally { f.db.close(); }
  });
});
