import { describe, expect, it, vi } from 'vitest';
import type { QueryResult, ResultExportData, ResultExportOptions } from '../../src/shared/contracts';
import { resultExportColumns, validateResultExportData } from '../../src/shared/resultExport';
import { validateCommand } from '../../src/shared/validation';
import { resolveFileToken } from '../../src/main/fileTokens';
import { exportableQueryResult, resultExportData, ResultExportSelection } from '../../src/renderer/resultExport';
import { publicCommands } from '../../src/shared/commands';

/** 构造精度与特殊键都真实可用的结果，不依赖网络或生成虚假的驱动输出。 */
function result(): QueryResult {
  return { columns: [{ key: '__proto__', name: '原型列', type: 'VARCHAR' }], rows: [JSON.parse('{"__proto__":"18446744073709551615"}')], truncated: true, elapsedMs: 1, statement: 'SELECT secret' };
}
/** 只建立小体积 IPC 外壳，数据预算测试复用行引用避免测试自身无谓占用内存。 */
function input(data: ResultExportData = resultExportData(result())): ResultExportOptions {
  return { fileToken: 'export-token', format: 'json', encoding: 'utf8', taskId: 'result-export', result: data };
}
describe('已返回结果导出的可信边界', () => {
  it('校验保留数据引用，且导出请求不包含 SQL、连接或路径', () => {
    const query = result(); const value = input(resultExportData(query));
    const parsed = validateCommand('files.exportResult', value) as ResultExportOptions;
    expect(parsed.result).toBe(value.result); expect(parsed.result.rows).toBe(query.rows);
    expect(parsed.result.columns).toEqual([{ key: '__proto__', name: '原型列' }]);
    for (const extra of [{ sql: 'DELETE FROM t' }, { connectionId: 'old' }, { sessionId: 'old' }, { filePath: 'C:/secret' }]) expect(() => validateCommand('files.exportResult', { ...value, ...extra })).toThrow();
    expect(publicCommands['files.exportResult']).toBe(true); expect(Object.hasOwn(publicCommands, '__connections.prepareSave')).toBe(false);
  });
  it('拒绝 SQL 格式、未知编码以及缺失/额外/重复内部列键', () => {
    for (const extra of [{ format: 'sql' }, { encoding: 'latin1' }]) expect(() => validateCommand('files.exportResult', { ...input(), ...extra })).toThrow();
    const data = resultExportData(result());
    expect(() => validateResultExportData({ ...data, columns: [...data.columns, ...data.columns] })).toThrow('列键不能重复');
    expect(() => validateResultExportData({ ...data, rows: [{}] })).toThrow('精确包含');
    expect(() => validateResultExportData({ ...data, rows: [{ wrong: '值' }] })).toThrow('精确包含');
    expect(() => validateResultExportData({ ...data, rows: [Object.create({ __proto__: '继承值' })] })).toThrow();
  });
  it('NULL、空串、精确数值与二进制允许，非有限/不安全整数和非法 Base64 拒绝', () => {
    const base = { columns: [{ key: 'c0', name: 'value' }], truncated: false };
    expect(() => validateResultExportData({ ...base, rows: [null, '', '\\N', '0.12345678901234567890', '18446744073709551615', { type: 'binary', base64: 'AAH/' }, false, 1.5].map(c0 => ({ c0 })) })).not.toThrow();
    for (const c0 of [undefined, Infinity, NaN, 9007199254740992, { type: 'binary', base64: 'not base64!' }, { type: 'binary', base64: 'YQ==', other: 1 }]) expect(() => validateResultExportData({ ...base, rows: [{ c0 }] })).toThrow();
  });
  it('在行数、列数、单字段、单行、整组预算边界明确拒绝，空结果仍可导出标题', () => {
    const data = { columns: [{ key: 'c0', name: 'value' }], rows: [], truncated: false };
    expect(() => validateResultExportData(data)).not.toThrow();
    expect(() => validateResultExportData({ ...data, columns: [] })).toThrow('列');
    expect(() => validateResultExportData({ ...data, columns: Array.from({ length: 1025 }, (_, i) => ({ key: `c${i}`, name: 'x' })) })).toThrow('列');
    expect(() => validateResultExportData({ ...data, rows: Array(100001).fill({ c0: '' }) })).toThrow('100000');
    expect(() => validateResultExportData({ ...data, rows: [{ c0: '界'.repeat(100000) }] })).toThrow('256 KiB');
    const wide = { columns: Array.from({ length: 5 }, (_, i) => ({ key: `c${i}`, name: 'x' })), rows: [Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`c${i}`, 'x'.repeat(230000)]))], truncated: false };
    expect(() => validateResultExportData(wide)).toThrow('1 MiB');
    expect(() => validateResultExportData({ ...data, rows: Array(350).fill({ c0: 'x'.repeat(100000) }) })).toThrow('32 MiB');
    expect(() => validateResultExportData({ ...wide, rows: Array(100000).fill(wide.rows[0]), columns: Array.from({ length: 21 }, (_, i) => ({ key: `c${i}`, name: 'x' })) })).toThrow('2000000');
  });
  it('重复/空标题的生成避开所有原始标题，原型名称保持普通数据且列位置不变', () => {
    const names = ['x', 'x', 'x [2]', '', '列 [4]', '__proto__', 'constructor', '2', '1', 'x'];
    const columns = resultExportColumns(names.map((name, i) => ({ key: `c${i}`, name })));
    expect(columns.map(column => column.exportName)).toEqual(['x', 'x [3]', 'x [2]', '列 [5]', '列 [4]', '__proto__', 'constructor', '2', '1', 'x [10]']);
    expect(columns.map(column => column.key)).toEqual(names.map((_, i) => `c${i}`));
  });
  it('只允许导出用途令牌，未知/导入/查询/证书/密钥令牌不能写文件', () => {
    const files = new Map(['export', 'import', 'query', 'certificate', 'key'].map(purpose => [purpose, { path: `C:/${purpose}`, purpose }]));
    expect(resolveFileToken(files, 'export', 'export')).toBe('C:/export');
    for (const token of ['missing', 'import', 'query', 'certificate', 'key', 'C:/export']) expect(() => resolveFileToken(files, token, 'export')).toThrow('未授权');
  });
});

describe('结果导出入口不混用部分流数据', () => {
  it('失败或取消后 outcome 为空时无入口，旧快照仍可导出且保留截断标记', () => {
    const previous = result();
    expect(exportableQueryResult(false, null, 0)).toBeUndefined();
    expect(exportableQueryResult(false, null, 0, previous)).toBe(previous);
    expect(resultExportData(previous).truncated).toBe(true);
    expect(exportableQueryResult(true, null, 0, previous)).toBeUndefined();
  });
  it('结果索引与固定快照各自隔离，无列的 DML 状态包不能导出', () => {
    const first = result(), second = { ...result(), rows: [{ __proto__: 'unused', c0: '二' }] };
    const outcome = { results: [first, second, { ...first, columns: [] }], elapsedMs: 1 };
    expect(exportableQueryResult(false, outcome, 1)).toBe(second);
    expect(exportableQueryResult(false, outcome, 1, first)).toBe(first);
    expect(exportableQueryResult(false, outcome, 3)).toBeUndefined();
    expect(exportableQueryResult(false, outcome, 2)).toBeUndefined();
    expect(exportableQueryResult(false, { results: [second], elapsedMs: 1 }, 0)).toBe(second);
  });
});

/** 真实选择控制器配合原型同名列、二进制和隐藏列，不使用勾选回执的成功mock。 */
function selectionFixture() {
  const source: QueryResult = {
    columns: [{ key: '__proto__', name: '原型列', type: 'TEXT' }, { key: 'bytes', name: '字节列', type: 'BLOB' }, { key: 'hidden', name: '隐藏列', type: 'TEXT' }],
    rows: Array.from({ length: 3 }, (_, index) => Object.fromEntries([['__proto__', index === 0 ? '18446744073709551615' : String(index)], ['bytes', { type: 'binary' as const, base64: index === 0 ? 'AAH/' : '' }], ['hidden', '隐藏值' + index]])),
    truncated: true, elapsedMs: 1, statement: '不进入快照的SQL'
  };
  const owner = new ResultExportSelection(), visible = source.columns.slice(0, 2), binding = owner.bind(source, ['本代结果'], visible)!;
  return { source, owner, binding, visible,
    select: (indices: number[]) => owner.select(binding, { scope: binding, rows: source.rows, columns: visible, indices: new Set(indices) }) };
}

describe('父级已接纳勾选的精确索引证明', () => {
  it('非空私有选择才可证明，按实际显示顺序精确匹配且不暴露或修改内部索引', () => {
    const f = selectionFixture();
    expect(f.owner.matchesIndices(f.binding, [])).toBe(false); expect(f.owner.matchesIndices(f.binding, [0])).toBe(false);
    expect(f.select([])).toBe(true); expect(f.owner.matchesIndices(f.binding, [])).toBe(false);
    expect(f.select([2, 0])).toBe(true);
    const indices = [0, 2]; expect(f.owner.matchesIndices(f.binding, indices)).toBe(true);
    expect(f.owner.matchesIndices(f.binding, Object.freeze([0, 2]))).toBe(true);
    for (const candidate of [[], [2, 0], [0], [0, 1], [0, 2, 2], [-0, 2], [NaN, 2]]) expect(f.owner.matchesIndices(f.binding, candidate)).toBe(false);
    indices[0] = 1; expect(f.owner.matchesIndices(f.binding, [0, 2])).toBe(true);
    expect(f.owner.count(f.binding)).toBe(2); expect(f.owner.snapshot(f.binding).rows.map(row => row.__proto__)).toEqual(['18446744073709551615', '2']);
    expect(f.select([1])).toBe(true); expect(f.owner.matchesIndices(f.binding, [0, 2])).toBe(false); expect(f.owner.matchesIndices(f.binding, [1])).toBe(true);
  });

  it('伪造binding或旧binding只拒绝，不能撤销本代的新选择', () => {
    const f = selectionFixture(); f.select([0]);
    expect(f.owner.matchesIndices({ ...f.binding }, [0])).toBe(false); expect(f.owner.matchesIndices(f.binding, [0])).toBe(true);
    const next = f.owner.bind(f.source, ['下一代'], f.visible)!;
    expect(f.owner.select(next, { scope: next, rows: f.source.rows, columns: f.visible, indices: new Set([2]) })).toBe(true);
    expect(f.owner.matchesIndices(f.binding, [0])).toBe(false); expect(f.owner.matchesIndices(next, [2])).toBe(true);
    expect(f.owner.count(next)).toBe(1);
    expect(f.owner.select(f.binding, { scope: f.binding, rows: f.source.rows, columns: f.visible, indices: new Set([1]) })).toBe(false);
    expect(f.owner.matchesIndices(next, [2])).toBe(true);
  });

  it('拒绝空洞、访问器及自定义数组字段，核对失败不修改已接纳选择', () => {
    const f = selectionFixture(); f.select([0, 2]); const getter = vi.fn(() => 0);
    const accessor = [0, 2]; Object.defineProperty(accessor, '0', { get: getter, enumerable: true });
    const sparse = new Array<number>(2); sparse[1] = 2;
    const decorated = Object.assign([0, 2], { accepted: true });
    for (const indices of [accessor, sparse, decorated]) expect(f.owner.matchesIndices(f.binding, indices)).toBe(false);
    expect(getter).not.toHaveBeenCalled(); expect(f.owner.count(f.binding)).toBe(2); expect(f.owner.matchesIndices(f.binding, [0, 2])).toBe(true);
  });

  it.each(['cell', 'type', 'base64'] as const)('select拒绝%s getter且零调用，并撤销坏来源绑定', field => {
    const f = selectionFixture(), getter = vi.fn(() => field === 'type' ? 'binary' : field === 'base64' ? 'AAH/' : '伪造值');
    f.select([1]);
    if (field === 'cell') Object.defineProperty(f.source.rows[0], '__proto__', { get: getter, enumerable: true, configurable: true });
    else Object.defineProperty(f.source.rows[0].bytes, field, { get: getter, enumerable: true, configurable: true });
    expect(() => f.select([0])).toThrow(); expect(getter).not.toHaveBeenCalled();
    expect(f.owner.current(f.binding)).toBe(false); expect(f.owner.matchesIndices(f.binding, [1])).toBe(false); expect(f.owner.count(f.binding)).toBe(0);
  });

  it.each(['cell', 'type', 'base64'] as const)('current拒绝已选来源的%s getter且零调用，旧快照仍保留精确字节', field => {
    const f = selectionFixture(); f.select([0]); const snapshot = f.owner.snapshot(f.binding), getter = vi.fn(() => field === 'type' ? 'binary' : field === 'base64' ? 'AAH/' : '18446744073709551615');
    if (field === 'cell') Object.defineProperty(f.source.rows[0], '__proto__', { get: getter, enumerable: true, configurable: true });
    else Object.defineProperty(f.source.rows[0].bytes, field, { get: getter, enumerable: true, configurable: true });
    expect(f.owner.current(f.binding)).toBe(false); expect(getter).not.toHaveBeenCalled(); expect(f.owner.matchesIndices(f.binding, [0])).toBe(false);
    expect(snapshot.rows[0]).toEqual(JSON.parse('{"__proto__":"18446744073709551615","bytes":{"type":"binary","base64":"AAH/"}}'));
  });

  it('自有原型同名字段保留，继承字段或非协议二进制整份拒绝', () => {
    const f = selectionFixture(); expect(f.select([0])).toBe(true); expect(f.owner.matchesIndices(f.binding, [0])).toBe(true);
    const inherited = selectionFixture(), getter = vi.fn(() => '继承值');
    Object.setPrototypeOf(inherited.source.rows[0], Object.defineProperty({}, '__proto__', { get: getter })); delete inherited.source.rows[0].__proto__;
    expect(() => inherited.select([0])).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(inherited.owner.current(inherited.binding)).toBe(false);
    for (const bytes of [{ type: 'binary', base64: '', extra: true }, { type: 'other', base64: '' }, Object.create({ type: 'binary', base64: '' })]) {
      const bad = selectionFixture(); bad.source.rows[0].bytes = bytes;
      expect(() => bad.select([0])).toThrow(); expect(bad.owner.current(bad.binding)).toBe(false);
    }
  });

  it('隐藏字段getter及字节内容漂移也撤销，错误事件和索引保留既有失败语义', () => {
    const hidden = selectionFixture(); hidden.select([0]); const getter = vi.fn(() => '隐藏值0');
    Object.defineProperty(hidden.source.rows[0], 'hidden', { get: getter, enumerable: true }); expect(hidden.owner.matchesIndices(hidden.binding, [0])).toBe(false); expect(getter).not.toHaveBeenCalled();
    const bytes = selectionFixture(); bytes.select([0]); (bytes.source.rows[0].bytes as { type: 'binary'; base64: string }).base64 = 'AA=='; expect(bytes.owner.matchesIndices(bytes.binding, [0])).toBe(false);
    const f = selectionFixture(); f.select([0]);
    expect(f.owner.select(f.binding, { scope: {}, rows: f.source.rows, columns: f.visible, indices: new Set([1]) })).toBe(false); expect(f.owner.matchesIndices(f.binding, [0])).toBe(true);
    expect(() => f.select([3])).toThrow(); expect(f.owner.current(f.binding)).toBe(true); expect(f.owner.count(f.binding)).toBe(0); expect(f.owner.matchesIndices(f.binding, [0])).toBe(false);
  });
});
