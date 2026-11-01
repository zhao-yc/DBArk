import { describe, expect, it, vi } from 'vitest';
import { copySqliteFindTransfer, copySqliteFindOptions, copySqliteFindSource, runSqliteTableFindInWorker as run, sqliteFindLimits as limits, sqliteFindMessages as text, sqliteFindOccurrences, type SqliteFindSource, type SqliteFindOptions, type SqliteFindWorkerResult } from '../../src/renderer/sqliteTableFind';

const options = (patch: Partial<SqliteFindOptions> = {}): SqliteFindOptions => ({ kind: 'text', query: 'a', caseSensitive: true, wholeCell: false, ...patch });
/** 仅调用Worker的纯算法，不创建桌面/线程；真实超时与CPU隔离另由Client和native专项验证。 */
function source(patch: Partial<SqliteFindSource> = {}): SqliteFindSource { return { columns: [{ name: 'text', generated: false }, { name: 'int', generated: false }, { name: 'blob', generated: false }, { name: 'generated', generated: true }], rows: [{ id: 'one', index: 0, deleted: false, values: [{ kind: 'text', value: 'aAa' }, { kind: 'integer', value: '9223372036854775807' }, { kind: 'blob', value: '00ffaa' }, { kind: 'text', value: 'aaa' }] }], writable: true, options: options(), ...patch }; }
function ready(result: SqliteFindWorkerResult) { if (result.status !== 'ready') throw Error(result.message); return result; }

describe('SQLite当前页typed查找算法', () => {
  it('TEXT原文大小写/整格/列范围可控，generated可导航但不获替换权', () => {
    const found = ready(run({ operation: 'find', source: source() })); expect(found.matches.map(match => [match.column, match.ranges.length, match.replaceable])).toEqual([[0, 2, true], [2, 2, false], [3, 3, false]]);
    const insensitive = ready(run({ operation: 'find', source: source({ options: options({ caseSensitive: false, column: 0 }) }) })); expect(insensitive.matches[0].ranges).toHaveLength(3);
    expect(ready(run({ operation: 'find', source: source({ options: options({ wholeCell: true }) }) })).matches).toEqual([]); expect(ready(run({ operation: 'find', source: source({ options: options({ query: 'aAa', wholeCell: true }) }) })).matches[0].column).toBe(0);
  });
  it('int64/REAL/hex只按准确原文查找，不经Number；只能替换实际TEXT', () => {
    const value = source(); value.rows[0].values[2] = { kind: 'real', value: 'Infinity' };
    expect(ready(run({ operation: 'find', source: { ...value, options: options({ query: '9223372036854775807' }) } })).matches[0]).toMatchObject({ column: 1, replaceable: false }); expect(ready(run({ operation: 'find', source: { ...value, options: options({ query: 'Infinity' }) } })).matches[0].replaceable).toBe(false);
    const preview = ready(run({ operation: 'preview', source: source(), replacement: 'X' })); expect(preview.operation).toBe('preview'); if (preview.operation === 'preview') expect(preview.patches).toEqual([{ rowId: 'one', column: 0, before: 'aAa', after: 'XAX' }]);
  });
  it('NULL、DEFAULT和文字NULL/default分开，待删除行不导航或替换', () => {
    const value = source({ columns: [{ name: 'x', generated: false }], rows: [{ id: 'null', index: 0, deleted: false, values: [{ kind: 'null' }] }, { id: 'default', deleted: false, values: [undefined] }, { id: 'text', index: 1, deleted: false, values: [{ kind: 'text', value: 'NULL' }] }, { id: 'deleted', index: 2, deleted: true, values: [{ kind: 'text', value: 'NULL' }] }] });
    expect(ready(run({ operation: 'find', source: { ...value, options: options({ kind: 'null', query: '' }) } })).matches.map(match => match.rowId)).toEqual(['null']); expect(ready(run({ operation: 'find', source: { ...value, options: options({ kind: 'default', query: '' }) } })).matches.map(match => match.rowId)).toEqual(['default']); expect(ready(run({ operation: 'find', source: { ...value, options: options({ query: 'NULL' }) } })).matches.map(match => match.rowId)).toEqual(['text']);
    expect(run({ operation: 'preview', source: { ...value, options: options({ kind: 'null', query: '' }) }, replacement: 'x' }).status).toBe('blocked');
  });
  it('字面模式不执行正则，regex显式模式才支持捕获组；美元默认保持字面', () => {
    const value = source({ columns: [{ name: 'x', generated: false }], rows: [{ id: 'one', index: 0, deleted: false, values: [{ kind: 'text', value: 'a12 a3' }] }], options: options({ query: '(?<word>a)(\\d+)', regex: true, captureReplacement: true }) });
    const result = ready(run({ operation: 'preview', source: value, replacement: '$<word>-$2-$$-$&' })); if (result.operation !== 'preview') throw Error('非预览'); expect(result.patches[0].after).toBe('a12 a3'.replace(/(?<word>a)(\d+)/gu, '$<word>-$2-$$-$&'));
    const literal = ready(run({ operation: 'preview', source: { ...value, options: options({ query: 'a', regex: false }) }, replacement: '$1' })); if (literal.operation !== 'preview') throw Error('非预览'); expect(literal.patches[0].after).toBe('$112 $13');
    expect(ready(run({ operation: 'find', source: { ...value, options: options({ query: '(a+)+$' }) } })).matches).toEqual([]); expect(run({ operation: 'find', source: { ...value, options: options({ query: '(', regex: true }) } })).toMatchObject({ status: 'blocked', message: text.regexInvalid }); expect(() => copySqliteFindOptions(options({ captureReplacement: true }), 1)).toThrow(text.capture);
  });
  it('Unicode零宽命中按码点推进，单处替换只命中准确range而不是整格', () => {
    const value = source({ columns: [{ name: 'x', generated: false }], rows: [{ id: 'one', index: 0, deleted: false, values: [{ kind: 'text', value: '🚢a' }] }], options: options({ query: '(?=.)', regex: true }) });
    const found = ready(run({ operation: 'find', source: value })); expect(found.matches[0].ranges).toEqual([{ start: 0, end: 0 }, { start: 2, end: 2 }]); const only = sqliteFindOccurrences(found.matches)[1], result = ready(run({ operation: 'preview', source: value, replacement: '_', only })); if (result.operation !== 'preview') throw Error('非预览'); expect(result.patches[0].after).toBe('🚢_a');
    expect(run({ operation: 'preview', source: value, replacement: '_', only: { ...only, range: { start: 1, end: 1 } } }).status).toBe('blocked');
  });
  it('原70k TEXT可完整查找并缩短；65536只限新after，不因大旁列阻断其它查找', () => {
    const before = 'x'.repeat(70000), value = source({ columns: [{ name: 'large', generated: false }, { name: 'small', generated: false }], rows: [{ id: 'one', index: 0, deleted: false, values: [{ kind: 'text', value: before }, { kind: 'text', value: 'target' }] }], options: options({ query: '^x+$', regex: true }) });
    expect(ready(run({ operation: 'find', source: value })).matches[0].ranges).toEqual([{ start: 0, end: 70000 }]); const result = ready(run({ operation: 'preview', source: value, replacement: 'small' })); if (result.operation !== 'preview') throw Error('非预览'); expect(result.patches[0]).toEqual({ rowId: 'one', column: 0, before, after: 'small' }); expect(ready(run({ operation: 'find', source: { ...value, options: options({ query: 'target' }) } })).matches[0].column).toBe(1);
  });
  it('只读source仍可查找但所有格不授替换资格，noop替换不签发空计划', () => {
    const value = source({ writable: false }); expect(ready(run({ operation: 'find', source: value })).matches.every(match => !match.replaceable)).toBe(true); expect(run({ operation: 'preview', source: value, replacement: 'x' }).status).toBe('blocked'); expect(run({ operation: 'preview', source: source(), replacement: 'a' })).toMatchObject({ status: 'blocked', message: text.noReplace });
  });
});

describe('SQLite查找完整预算与不可信输入门', () => {
  it('超过50000命中拒绝而不截断，超过500修改行也整组阻断', () => {
    const many = source({ columns: [{ name: 'x', generated: false }], rows: [{ id: 'one', index: 0, deleted: false, values: [{ kind: 'text', value: 'a'.repeat(50001) }] }] }); expect(run({ operation: 'find', source: many })).toMatchObject({ status: 'blocked', message: text.budget });
    const rows = Array.from({ length: 501 }, (_, index) => ({ id: 'r' + index, index, deleted: false, values: [{ kind: 'text' as const, value: 'a' }] })); expect(run({ operation: 'preview', source: source({ columns: [{ name: 'x', generated: false }], rows }), replacement: 'b' })).toMatchObject({ status: 'blocked', message: text.budget });
  });
  it('新after单格及整批2MiB门不松；捕获prefix展开先计量再构造', () => {
    const value = source({ columns: [{ name: 'x', generated: false }], rows: [{ id: 'one', index: 0, deleted: false, values: [{ kind: 'text', value: 'a'.repeat(65000) }] }], options: options({ query: '^', regex: true }) }); expect(run({ operation: 'preview', source: value, replacement: 'x'.repeat(4096) })).toMatchObject({ status: 'blocked', message: text.valueLimit });
    const large = { ...value, rows: Array.from({ length: 33 }, (_, index) => ({ id: 'r' + index, index, deleted: false, values: [{ kind: 'text' as const, value: 'a'.repeat(61440) }] })) }; expect(run({ operation: 'preview', source: large, replacement: 'x'.repeat(4096) })).toMatchObject({ status: 'blocked', message: text.budget });
    expect(run({ operation: 'preview', source: { ...value, rows: [{ id: 'one', index: 0, deleted: false, values: [{ kind: 'text', value: 'a'.repeat(30000) }] }], options: options({ query: 'a', regex: true, captureReplacement: true }) }, replacement: "$`" }).status).toBe('blocked');
  });
  it('getter/原型/稀疏/额外命令、坏Unicode和超16MiB原文均拒绝，不调用访问器', () => {
    const getter = vi.fn(() => 'PRIVATE'), raw = { kind: 'text' }; Object.defineProperty(raw, 'value', { enumerable: true, get: getter }); const value = source(); value.rows[0].values[0] = raw as any; expect(run({ operation: 'find', source: value }).status).toBe('blocked'); expect(getter).not.toHaveBeenCalled();
    expect(() => copySqliteFindTransfer('x'.repeat(limits.bytes + 1))).toThrow(text.budget); expect(() => copySqliteFindTransfer('\ud800')).toThrow(); expect(() => copySqliteFindSource(Object.assign(Object.create({ inherited: true }), source()))).toThrow(); expect(() => copySqliteFindSource({ ...source(), rows: Array(2) })).toThrow(); expect(run({ operation: 'find', source: source(), sql: 'PRIVATE' } as any)).toMatchObject({ status: 'blocked', message: text.invalid }); expect(() => copySqliteFindOptions(options({ column: 999 }), 4)).toThrow();
  });
});
