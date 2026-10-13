import { describe, expect, it } from 'vitest';
import type { QueryResult, ResultExportData, ResultExportOptions } from '../../src/shared/contracts';
import { resultExportColumns, validateResultExportData } from '../../src/shared/resultExport';
import { validateCommand } from '../../src/shared/validation';
import { resolveFileToken } from '../../src/main/fileTokens';
import { exportableQueryResult, resultExportData } from '../../src/renderer/resultExport';
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
