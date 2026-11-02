import { describe, expect, it } from 'vitest';
import type { QueryResult } from '../../src/shared/contracts';
import { bindSqliteResultStorage, copySqliteResultStorage, projectSqliteResultStorage, sqliteResultStorageLimits as limits } from '../../src/shared/sqliteResultStorage';
import { createQueryResultSnapshot, encodeQueryResultSnapshot, decodeQueryResultSnapshot } from '../../src/shared/queryResultSnapshot';
import { QueryResultFilter } from '../../src/renderer/queryResultFilter';
import { QueryResultSort } from '../../src/renderer/queryResultSort';

/** 同一列真实存储类交错，字符串表示相同的INTEGER、REAL和TEXT仍保有独立标记。 */
function fixture(): QueryResult {
  return { columns: [{ key: 'c0', name: '重复名', type: 'SQLITE' }, { key: 'c1', name: '重复名', type: 'SQLITE' }],
    rows: [{ c0: '2', c1: '9223372036854775807' }, { c0: '2', c1: '-0' }, { c0: '2', c1: 'Infinity' }, { c0: { type: 'binary', base64: 'AP8=' }, c1: null }, { c0: '\uFEFF真实\0🚢\uFFFD', c1: '' }],
    sqliteStorage: { version: 1, rows: ['ii', 'rr', 'tr', 'bn', 'tt'] }, statement: '仅为原查询来源', truncated: true, elapsedMs: 1 };
}

describe('SQLite查询结果逐格存储类型', () => {
  it('重复显示名按原key定位，五类与相同字符串分开，严格复制不改源值', () => {
    const source = fixture(), before = structuredClone(source), value = copySqliteResultStorage(source.sqliteStorage, source.columns, source.rows);
    expect(value).toEqual(source.sqliteStorage); expect(value).not.toBe(source.sqliteStorage); expect(value.rows).not.toBe(source.sqliteStorage!.rows); expect(source).toEqual(before);
  });
  it('行过滤和重排同步投影类型，保留原行值；无类型信息时不猜测', () => {
    const source = fixture(), result = { ...source, rows: [source.rows[3], source.rows[1]], ...projectSqliteResultStorage(source, [3, 1]) };
    expect(result.sqliteStorage).toEqual({ version: 1, rows: ['bn', 'rr'] }); expect(result.rows[0]).toBe(source.rows[3]);
    expect(copySqliteResultStorage(result.sqliteStorage, result.columns, result.rows)).toEqual(result.sqliteStorage);
    const { sqliteStorage: _storage, ...legacy } = source; expect(projectSqliteResultStorage(legacy, [1, 0])).toEqual({}); expect(legacy.rows[0].c0).toBe('2');
  });
  it('SQLite快照用版本2保留类型，旧版本1继续无损，版本不得隐藏或猜造类型', () => {
    const source = fixture(), snapshot = createQueryResultSnapshot(source), encoded = encodeQueryResultSnapshot(snapshot), reopened = decodeQueryResultSnapshot(encoded);
    expect(snapshot.version).toBe(2); expect(reopened).toEqual(snapshot); expect(reopened.result.sqliteStorage).toEqual(source.sqliteStorage);
    expect(encodeQueryResultSnapshot(reopened)).toBe(encoded); expect(source.rows[1].c1).toBe('-0');
    const { sqliteStorage: _storage, ...legacy } = source, old = createQueryResultSnapshot(legacy); expect(old.version).toBe(1); expect(decodeQueryResultSnapshot(encodeQueryResultSnapshot(old))).toEqual(old);
    expect(() => encodeQueryResultSnapshot({ ...snapshot, version: 1 })).toThrow(); expect(() => encodeQueryResultSnapshot({ ...old, version: 2 })).toThrow();
  });
  it.each([
    { version: 2, rows: ['ii'] }, { version: 1, rows: [] }, { version: 1, rows: ['iii', 'rr', 'tr', 'bn', 'tt'] }, { version: 1, rows: ['xi', 'rr', 'tr', 'bn', 'tt'] },
    { version: 1, rows: ['bi', 'rr', 'tr', 'bn', 'tt'] }, { version: 1, rows: ['ni', 'rr', 'tr', 'bn', 'tt'] }, { version: 1, rows: ['ii', 'rr', 'tr', 'bt', 'tt'] },
    { version: 1, rows: ['ii', 'rr', 'tr', 'bn', 'tt'], injected: true },
  ])('类型形状或原值不一致时整份拒绝：%j', supplied => {
    const source = fixture(); expect(() => copySqliteResultStorage(supplied, source.columns, source.rows)).toThrow();
  });
  it.each(['9223372036854775808', '-9223372036854775809', '-0', '+2', '02', '2.0', '2e0', ''])('INTEGER非canonical或越界原文拒绝：%s', value => {
    const source = fixture(); source.rows[0].c0 = value; expect(() => copySqliteResultStorage(source.sqliteStorage, source.columns, source.rows)).toThrow();
  });
  it.each(['NaN', '+Infinity', '1.0', ' 2', '', '2.00', '1e+02'])('REAL不接受猜测或非原生canonical文本：%s', value => {
    const source = fixture(); source.rows[1].c0 = value; expect(() => copySqliteResultStorage(source.sqliteStorage, source.columns, source.rows)).toThrow();
  });
  it.each(['?', 'A===', 'AB==', 'AAP=', '====', 'AA=A', 'A A='])('BLOB的非法或非canonicalBase64拒绝：%s', base64 => {
    const source = fixture(); source.rows[3].c0 = { type: 'binary', base64 }; expect(() => copySqliteResultStorage(source.sqliteStorage, source.columns, source.rows)).toThrow();
  });
  it('访问器、稀疏数组、额外行字段、列类型伪造和重复key均拒绝且不执行getter', () => {
    const source = fixture(); let calls = 0; const accessor = Object.defineProperty({ version: 1 }, 'rows', { enumerable: true, get() { calls++; return source.sqliteStorage!.rows; } });
    expect(() => copySqliteResultStorage(accessor, source.columns, source.rows)).toThrow(); expect(calls).toBe(0);
    expect(() => copySqliteResultStorage({ version: 1, rows: new Array(5) }, source.columns, source.rows)).toThrow();
    const extra = fixture(); extra.rows[0].injected = '不属于原列'; expect(() => copySqliteResultStorage(extra.sqliteStorage, extra.columns, extra.rows)).toThrow();
    for (const change of [(value: QueryResult) => { value.columns[0].type = 'BIGINT'; }, (value: QueryResult) => { value.columns[1].key = 'c0'; }, (value: QueryResult) => { value.rows[4].c0 = '\ud800'; }]) {
      const value = fixture(); change(value); expect(() => copySqliteResultStorage(value.sqliteStorage, value.columns, value.rows)).toThrow();
    }
  });
  it('行数、总单元格及原文预算在过量读取前拒绝，不以较窄样本补类型', () => {
    const source = fixture(); expect(() => copySqliteResultStorage(source.sqliteStorage, source.columns, new Array(limits.rows + 1))).toThrow();
    const columns = Array.from({ length: 2048 }, (_, index) => ({ key: 'k' + index, name: '列', type: 'SQLITE' })), rows = Array.from({ length: 1000 }, () => Object.create(null));
    expect(() => copySqliteResultStorage({ version: 1, rows: Array(1000).fill('t'.repeat(2048)) }, columns, rows)).toThrow();
    const value = fixture(); value.rows[4].c0 = 'x'.repeat(limits.units + 1); expect(() => copySqliteResultStorage(value.sqliteStorage, value.columns, value.rows)).toThrow();
  });
  it('旧投影坐标及非数据属性拒绝，不改变原结果', () => {
    const source = fixture(), before = structuredClone(source); for (const indices of [[-1], [source.rows.length], [0.5], [0, 0], new Array(1)]) expect(() => projectSqliteResultStorage(source, indices)).toThrow();
    const bad = Object.defineProperty({ ...source }, 'sqliteStorage', { enumerable: true, get() { throw Error('不应读取getter'); } }); expect(() => projectSqliteResultStorage(bad, [0])).toThrow(); expect(source).toEqual(before);
  });
  it('类型租约发现同原文类型改变、对象替换和访问器；恢复原值也不复活旧租约', () => {
    for (const change of [
      (source: QueryResult) => { source.sqliteStorage!.rows[0] = 'ri'; },
      (source: QueryResult) => { source.sqliteStorage = structuredClone(source.sqliteStorage); },
      (source: QueryResult) => { source.sqliteStorage!.rows = source.sqliteStorage!.rows.slice(); },
      (source: QueryResult) => { Object.defineProperty(source.sqliteStorage!, 'rows', { enumerable: true, get() { throw Error('不应调用'); } }); },
    ]) {
      const source = fixture(), original = source.sqliteStorage, rows = original!.rows, current = bindSqliteResultStorage(source);
      expect(current()).toBe(true); change(source); expect(current()).toBe(false);
      source.sqliteStorage = original; Object.defineProperty(original!, 'rows', { configurable: true, writable: true, enumerable: true, value: rows }); rows[0] = 'ii';
      expect(current()).toBe(false);
    }
  });
  it('固定结果NULL筛选保类型与原行；筛选和排序租约均随类型漂移撤销', () => {
    const source = fixture(), filter = new QueryResultFilter(), filtered = filter.bind(source, [])!, sort = new QueryResultSort(), sorted = sort.bind(source, [])!;
    const view = filter.apply(filtered, filter.view(filtered)!, [{ column: 'c1', operator: 'null', value: '' }], 'AND');
    expect(view.sourceIndices).toEqual([3]); expect(view.result.sqliteStorage!.rows).toEqual(['bn']); expect(view.result.rows[0]).toBe(source.rows[3]);
    expect(createQueryResultSnapshot(view.result).version).toBe(2);
    source.sqliteStorage!.rows[0] = 'ri'; expect(filter.current(filtered)).toBe(false); expect(sort.current(sorted)).toBe(false);
    source.sqliteStorage!.rows[0] = 'ii'; expect(filter.view(filtered)).toBeUndefined(); expect(sort.view(sorted)).toBeUndefined();
  });
  it('版本2完整wire预算包含类型标记；空结果保持准确类型元数据', () => {
    const source: QueryResult = { columns: [], rows: [], sqliteStorage: { version: 1, rows: [] }, truncated: false, elapsedMs: 0, statement: '' };
    const empty = encodeQueryResultSnapshot(createQueryResultSnapshot(source)), maximum = 16 * 1024 * 1024;
    expect(decodeQueryResultSnapshot(empty).result.sqliteStorage).toEqual({ version: 1, rows: [] });
    source.statement = 'x'.repeat(maximum - new TextEncoder().encode(empty).length);
    expect(new TextEncoder().encode(encodeQueryResultSnapshot(createQueryResultSnapshot(source))).length).toBe(maximum);
    source.statement += 'x'; expect(() => createQueryResultSnapshot(source)).toThrow();
  });
});
