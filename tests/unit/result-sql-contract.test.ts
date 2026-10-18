import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { previewResultSql } from '../../src/engine/resultSql';
import { assertResultSqlData, resultSqlLimits, type ResultSqlPreviewInput } from '../../src/shared/resultSql';
import { validateCommand } from '../../src/shared/validation';
import { ResultSqlPreviews } from '../../src/main/resultSqlPreviews';
import { resolveFileToken, type SelectedFile } from '../../src/main/fileTokens';

/** 原始别名不作目标名；源键包含原型同名键，正文无查询语句或服务器上下文。 */
function input(): ResultSqlPreviewInput { return { encoding: 'utf8', target: { database: 'd`b', table: 't', columns: [{ key: '__proto__', name: 'a`b' }] }, result: { columns: [{ key: '__proto__', name: '' }], rows: [Object.fromEntries([['__proto__', '原值']])], truncated: true } }; }

describe('结果INSERT合同和模式无关字面量', () => {
  it('手工独立SQL期望：反引号分段引用，Unicode、引号、反斜线、换行和NUL全用原字节', () => {
    const value = input(); value.result.rows = [Object.fromEntries([['__proto__', "中😊'\\\n\0"]])];
    expect(previewResultSql(value.result, value.target).sql).toBe("-- 已返回结果快照；仅生成INSERT，不执行SQL。\nINSERT INTO `d``b`.`t` (`a``b`) VALUES (_utf8mb4 X'e4b8adf09f988a275c0a00');\n");
  });
  it('NULL、空串、二进制、大数、小数、日期小数、JSON及函数文字不混成表达式', () => {
    const value = input(); value.target = { database: 'db', table: 't', columns: [{ key: 'c', name: 'v' }] }; value.result.columns = [{ key: 'c', name: '别名' }];
    value.result.rows = [null, '', { type: 'binary' as const, base64: 'AP8=' }, '18446744073709551615', '0.12345678901234567890', '2026-10-18 12:34:56.123456', '{"x":"中"}', 'CURRENT_TIMESTAMP', true, 1.5].map(c => ({ c }));
    const literals = ['NULL', "_utf8mb4 X''", "X'00ff'", "_utf8mb4 X'3138343436373434303733373039353531363135'", "_utf8mb4 X'302e3132333435363738393031323334353637383930'", "_utf8mb4 X'323032362d31302d31382031323a33343a35362e313233343536'", "_utf8mb4 X'7b2278223a22e4b8ad227d'", "_utf8mb4 X'43555252454e545f54494d455354414d50'", '1', '1.5'];
    expect(previewResultSql(value.result, value.target).sql).toBe('-- 已返回结果快照；仅生成INSERT，不执行SQL。\n' + literals.map(literal => `INSERT INTO \`db\`.\`t\` (\`v\`) VALUES (${literal});\n`).join(''));
  });
  it.each(['', 'x\\y', 'x\n', 'x ', '\uD800', 'x'.repeat(65)])('非法目标名称%j拒绝', name => { const value = input(); value.target.table = name; expect(() => validateCommand('files.previewResultSql', value)).toThrow(); });
  it('空、重名、未知源键、缺列及注入SQL/路径/连接都在IPC前拒绝', () => {
    const value = input(); for (const columns of [[], [{ key: 'missing', name: 'v' }], [{ key: '__proto__', name: '' }], [...value.target.columns, { key: 'other', name: 'A`B' }]]) expect(() => assertResultSqlData(value.result, { ...value.target, columns })).toThrow();
    const data = { columns: [{ key: 'a', name: 'a' }, { key: 'b', name: 'b' }], rows: [], truncated: false };
    expect(() => assertResultSqlData(data, { ...value.target, columns: [{ key: 'a', name: 'Value' }, { key: 'b', name: 'value' }] })).toThrow();
    for (const extra of [{ sql: 'SELECT 1' }, { filePath: 'C:/secret' }, { connectionId: 'c' }, { sessionId: 's' }]) expect(() => validateCommand('files.previewResultSql', { ...value, ...extra })).toThrow();
    expect(() => validateCommand('files.choose', { purpose: 'import', format: 'sql', resultSqlPreviewId: randomUUID() })).toThrow();
  });
  it.each(['\uD800', -0, { type: 'binary' as const, base64: 'AB==' }])('无损合同拒绝来源%j', cell => { const value = input(); value.result.rows = [Object.fromEntries([['__proto__', cell]])]; expect(() => assertResultSqlData(value.result, value.target)).toThrow(); });
  it('原结果预算仍生效，预览样例有界且明确报告全部已返回行数', () => {
    const value = input(); value.result.rows = Array.from({ length: 31 }, () => Object.fromEntries([['__proto__', '已返回']]));
    expect(previewResultSql(value.result, value.target)).toMatchObject({ shownRows: 20, totalRows: 31 });
    value.result.rows = Array(100001).fill(value.result.rows[0]); expect(() => assertResultSqlData(value.result, value.target)).toThrow('100000');
    value.result.rows = [Object.fromEntries([['__proto__', '界'.repeat(100000)]])]; expect(() => assertResultSqlData(value.result, value.target)).toThrow('256 KiB');
  });
  it('大字段预览按4MiB预算提前停止，不拼接整份25行SQL', () => {
    const value = input(); value.result.rows = Array.from({ length: 25 }, () => Object.fromEntries([['__proto__', 'x'.repeat(200000)]]));
    const preview = previewResultSql(value.result, value.target); expect(preview.shownRows).toBeGreaterThan(0); expect(preview.shownRows).toBeLessThan(20); expect(preview.totalRows).toBe(25); expect(Buffer.byteLength(preview.sql)).toBeLessThanOrEqual(resultSqlLimits.previewBytes);
  });
});

describe('Main一次性预览与文件授权', () => {
  function harness() { const files = new Map<string, SelectedFile>(), owner = {}; let now = 1000; const store = new ResultSqlPreviews(files, () => now); return { files, owner, store, expire() { now += resultSqlLimits.ttlMs; } }; }
  it.each(['mapping', 'encoding', 'value', 'truncated', 'confirmation', 'file'] as const)('%s变化使提交拒绝且消费旧预览，旧文件令牌也撤销', mode => {
    const f = harness(), value = input(), preview = f.store.issue(value, f.owner); f.files.set('file', { path: 'RAM', purpose: 'export', format: 'sql' }); f.store.bindFile(preview.previewId, f.owner, 'file');
    expect(() => resolveFileToken(f.files, 'file', 'export')).toThrow();
    const request = { ...value, target: undefined, format: 'sql' as const, fileToken: 'file', taskId: 'task', sql: { target: value.target, previewId: preview.previewId, confirmation: 'd`b.t', acknowledged: true as const } };
    if (mode === 'mapping') request.sql.target = { ...value.target, table: 'other' };
    if (mode === 'encoding') request.encoding = 'utf16le';
    if (mode === 'value') request.result.rows[0].__proto__ = '后来';
    if (mode === 'truncated') request.result.truncated = false;
    if (mode === 'confirmation') request.sql.confirmation += ' ';
    if (mode === 'file') request.fileToken = 'other';
    expect(() => f.store.consume(request, f.owner)).toThrow(); expect(f.files.size).toBe(0); expect(() => f.store.assert(preview.previewId, f.owner)).toThrow();
  });
  it('只消费一次；释放/过期/旧主文档及跨用途令牌不能恢复能力', () => {
    const f = harness(), value = input(), preview = f.store.issue(value, f.owner); f.files.set('file', { path: 'RAM', purpose: 'export', format: 'sql' }); f.store.bindFile(preview.previewId, f.owner, 'file');
    const request = { ...value, format: 'sql' as const, fileToken: 'file', taskId: 'task', sql: { target: value.target, previewId: preview.previewId, confirmation: 'd`b.t', acknowledged: true as const } };
    expect(f.store.consume(request, f.owner)).toBe('RAM'); expect(() => f.store.consume(request, f.owner)).toThrow();
    const next = f.store.issue(value, f.owner); f.store.release(preview.previewId, f.owner); expect(f.store.assert(next.previewId, f.owner)).toBeDefined(); expect(() => f.store.assert(next.previewId, {})).toThrow(); f.expire(); expect(() => f.store.assert(next.previewId, f.owner)).toThrow();
  });
  it('缓存有界，旧主文档轮换及开始重新选择精确撤销旧文件授权', () => {
    const f = harness(), value = input(), issued = Array.from({ length: resultSqlLimits.previews }, () => f.store.issue(value, f.owner));
    expect(() => f.store.issue(value, f.owner)).toThrow('上限'); f.store.release(issued[0].previewId, f.owner);
    const fresh = f.store.issue(value, f.owner); f.files.set('old', { path: 'RAM', purpose: 'export', format: 'sql' }); f.store.bindFile(fresh.previewId, f.owner, 'old');
    f.store.beginChoice(fresh.previewId, f.owner); expect(f.files.size).toBe(0); expect(f.store.assert(fresh.previewId, f.owner)).toBeDefined();
    f.store.issue(value, {}); expect(() => f.store.assert(fresh.previewId, f.owner)).toThrow('失效');
  });
});
