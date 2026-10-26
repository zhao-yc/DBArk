import { describe, expect, it, vi } from 'vitest';
import type { QueryResult } from '../../src/shared/contracts';
import { queryAnalyzeLimits } from '../../src/shared/queryAnalyze';
import { analyzeQuery } from '../../src/engine/queryAnalyze';
import type { ExplainContext } from '../../src/engine/queryExplain';

const tree = '-> Table scan on subject  (cost=12.50 rows=9007199254740993) (actual time=0.001234567890123456789..1.234567890123456789 rows=9007199254740993 loops=1)\n';
const mode = { noBackslashEscapes: false, ansiQuotes: false };

/** 合成原驱动结果只验证引擎调度和保真，不冒充真实服务器执行或取消验收。 */
function results(raw: string = tree): QueryResult[] {
  return [{ columns: [{ key: 'c0', name: 'EXPLAIN', type: 'LONG_BLOB' }], rows: [{ c0: raw }], elapsedMs: 1, statement: '', truncated: false }];
}

/** 每个用例独占同一会话上下文，记录真实待发送 SQL 和取消检查次数。 */
function context(): ExplainContext {
  return { status: { dialect: 'mysql', version: '8.4.11' }, mode, check: vi.fn(), reusable: vi.fn(() => true), run: vi.fn(async () => results()) };
}

describe('实际执行分析的明确确认和一次发送边界', () => {
  it.each([false, undefined, null, 1, 'true'])('未作布尔确认时零检查、零 SQL：%s', async acknowledgement => {
    const current = context();
    await expect(analyzeQuery('UPDATE subject SET n=n+1', acknowledgement as boolean, current)).rejects.toThrow('明确确认');
    expect(current.check).not.toHaveBeenCalled(); expect(current.run).not.toHaveBeenCalled();
  });

  it.each([
    ['mysql', '5.7.44'], ['mysql', '8.0.17'], ['mysql', '未知服务器'],
    ['mariadb', '10.0.38'], ['mariadb', '未知服务器'],
  ] as const)('真实握手不支持时拒绝，不探测或回退：%s %s', async (dialect, version) => {
    const current = context(); current.status = { dialect, version };
    await expect(analyzeQuery('SELECT 1', true, current)).rejects.toThrow();
    expect(current.run).not.toHaveBeenCalled();
  });

  it.each([
    ['mysql', '8.0.18', 'EXPLAIN ANALYZE'],
    ['mysql', '8.0.20', 'EXPLAIN ANALYZE'],
    ['mysql', '8.0.21', 'EXPLAIN ANALYZE FORMAT=TREE'],
    ['mysql', '8.0.46-0ubuntu0.24.04.1', 'EXPLAIN ANALYZE FORMAT=TREE'],
    ['mysql', '8.4.11', 'EXPLAIN ANALYZE FORMAT=TREE'],
    ['mariadb', '10.11.15-MariaDB', 'ANALYZE FORMAT=JSON'],
    ['mariadb', '5.5.5-11.4.13-MariaDB', 'ANALYZE FORMAT=JSON'],
  ] as const)('按真实能力仅发送一次原 SQL：%s %s', async (dialect, version, prefix) => {
    const current = context(); current.status = { dialect, version };
    const source = '/* 原语句 */ SELECT 9007199254740993';
    const original = results(dialect === 'mysql' ? tree : '{"query_block":{"select_id":1,"r_total_time_ms":1.234567890123456789,"table":{"table_name":"subject","rows":9007199254740993,"r_rows":9007199254740993,"r_loops":1}}}');
    vi.mocked(current.run).mockResolvedValue(original);
    const outcome = await analyzeQuery(source, true, current);
    expect(current.run).toHaveBeenCalledExactlyOnceWith(prefix + ' ' + source);
    expect(outcome.results).toBe(original); expect(outcome.analysis?.dialect).toBe(dialect);
    expect(outcome.analysis?.version).toBe(version); expect(outcome.analysis?.format).toBe(dialect === 'mysql' ? 'tree' : 'json');
    expect(outcome.explain).toBeUndefined(); expect(outcome.transactionOpen).toBeUndefined();
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(0); expect(current.check).toHaveBeenCalledTimes(3);
  });

  it.each(['UPDATE subject SET n=n+1', 'DELETE FROM subject WHERE id=1', 'INSERT INTO subject(id) VALUES(1)', 'REPLACE INTO subject(id) VALUES(1)', 'WITH c AS (SELECT 1) SELECT * FROM c'])('不改写已确认的 DML 或 CTE，也不附加事务：%s', async source => {
    const current = context(); await analyzeQuery(source, true, current);
    expect(current.run).toHaveBeenCalledExactlyOnceWith('EXPLAIN ANALYZE FORMAT=TREE ' + source);
  });

  it.each(['SELECT 1; DELETE FROM subject', 'EXPLAIN ANALYZE SELECT 1', 'ANALYZE SELECT 1', '/*!80000 SELECT 1 */', '/*M! SELECT 1 */', 'CALL f()', 'SET @n=1', ''])('不明确输入在真正执行前拒绝：%s', async source => {
    const current = context(); await expect(analyzeQuery(source, true, current)).rejects.toThrow();
    expect(current.run).not.toHaveBeenCalled();
  });

  it('沿用原会话 DELIMITER 和转义，不按另一种 sql_mode 重切后重发', async () => {
    const custom = context(); await analyzeQuery("DELIMITER $$\nSELECT 'a;'$$", true, custom);
    expect(custom.run).toHaveBeenCalledExactlyOnceWith("EXPLAIN ANALYZE FORMAT=TREE SELECT 'a;'");
    const ordinary = context(); await analyzeQuery("SELECT 'a\\'; SELECT 2'", true, ordinary);
    expect(ordinary.run).toHaveBeenCalledExactlyOnceWith("EXPLAIN ANALYZE FORMAT=TREE SELECT 'a\\'; SELECT 2'");
    const escaped = context(); escaped.mode = { ...mode, noBackslashEscapes: true };
    await expect(analyzeQuery("SELECT 'a\\'; SELECT 2'", true, escaped)).rejects.toThrow();
    expect(escaped.run).not.toHaveBeenCalled();
  });

  it.each(['ER_UNKNOWN_EXPLAIN_FORMAT', 'ER_PARSE_ERROR', 'ER_NOT_SUPPORTED_YET', 'ER_TABLEACCESS_DENIED_ERROR', 'ER_QUERY_INTERRUPTED', 'ECONNRESET'])('服务器原错误无回退、重试或隐式回滚：%s', async code => {
    const current = context(), failure = Object.assign(new Error('原始服务器错误'), { code });
    vi.mocked(current.run).mockRejectedValue(failure);
    await expect(analyzeQuery('UPDATE subject SET n=n+1', true, current)).rejects.toBe(failure);
    expect(current.run).toHaveBeenCalledExactlyOnceWith('EXPLAIN ANALYZE FORMAT=TREE UPDATE subject SET n=n+1');
    expect(current.reusable).not.toHaveBeenCalled();
  });

  it.each([1, 2])('发送前第 %s 次检查取消后不发 SQL', async position => {
    const current = context(), cancellation = new Error('原任务已取消');
    let checks = 0; vi.mocked(current.check).mockImplementation(() => { if (++checks === position) throw cancellation; });
    await expect(analyzeQuery('SELECT 1', true, current)).rejects.toBe(cancellation);
    expect(current.run).not.toHaveBeenCalled();
  });

  it('原查询结束后的取消检查不公布迟到计划，也不另发一条 SQL', async () => {
    const current = context(), cancellation = new Error('原任务已取消');
    vi.mocked(current.run).mockImplementation(async () => { vi.mocked(current.check).mockImplementation(() => { throw cancellation; }); return results(); });
    await expect(analyzeQuery('SELECT SLEEP(30)', true, current)).rejects.toBe(cancellation);
    expect(current.run).toHaveBeenCalledTimes(1);
  });
});

describe('分析原结果、精度和传输截断', () => {
  it('原文和大数不转浮点数，解析失败也保留原结果且不重发', async () => {
    const current = context(); const outcome = await analyzeQuery('SELECT * FROM subject', true, current);
    expect(outcome.analysis?.raw).toBe(tree); expect(JSON.stringify(outcome.analysis)).toContain('9007199254740993');
    const unknown = context(), original = results('未来服务器输出，未识别'); vi.mocked(unknown.run).mockResolvedValue(original);
    const unavailable = await analyzeQuery('SELECT 1', true, unknown);
    expect(unavailable.results).toBe(original); expect(unavailable.analysis?.raw).toBe('未来服务器输出，未识别');
    expect(unavailable.analysis?.nodes).toEqual([]); expect(unavailable.analysis?.warnings.length).toBeGreaterThan(0);
    expect(unknown.run).toHaveBeenCalledTimes(1);
  });

  it('原驱动标截断时即使前缀可解析也清空树，保留有界原文', async () => {
    const current = context(), original = results(); original[0].truncated = true; vi.mocked(current.run).mockResolvedValue(original);
    const outcome = await analyzeQuery('SELECT 1', true, current);
    expect(outcome.results).toBe(original); expect(outcome.analysis?.raw).toBe(tree);
    expect(outcome.analysis?.nodes).toEqual([]); expect(outcome.analysis?.rawTruncated).toBe(true);
    expect(outcome.analysis?.warnings.join()).toContain('传输预算'); expect(current.run).toHaveBeenCalledTimes(1);
  });

  it('超过字节预算只保留有界原文，不把前缀误作完整树', async () => {
    const current = context(), raw = tree + '中'.repeat(queryAnalyzeLimits.rawBytes);
    const original = results(raw); vi.mocked(current.run).mockResolvedValue(original);
    const outcome = await analyzeQuery('SELECT 1', true, current);
    expect(outcome.results).toBe(original); expect(outcome.analysis?.nodes).toEqual([]); expect(outcome.analysis?.rawTruncated).toBe(true);
    expect(Buffer.byteLength(outcome.analysis?.raw ?? '')).toBeLessThanOrEqual(queryAnalyzeLimits.rawBytes);
    expect(outcome.analysis?.warnings.join()).toContain('原文展示预算'); expect(current.run).toHaveBeenCalledTimes(1);
  });

  it.each(['none', 'empty-row', 'multiple-results', 'multiple-rows', 'multiple-columns', 'non-text'] as const)('未知协议形状保留原始结果但不生成完整树：%s', async shape => {
    const current = context(), original = shape === 'none' ? [] : results();
    if (shape === 'empty-row') original[0].rows = [];
    if (shape === 'multiple-results') original.push(...results());
    if (shape === 'multiple-rows') original[0].rows.push({ c0: tree });
    if (shape === 'multiple-columns') original[0].columns.push({ key: 'c1', name: '未知列', type: 'LONG_BLOB' });
    if (shape === 'non-text') original[0].rows[0].c0 = null;
    vi.mocked(current.run).mockResolvedValue(original);
    const outcome = await analyzeQuery('SELECT 1', true, current);
    expect(outcome.results).toBe(original); expect(outcome.analysis?.nodes).toEqual([]); expect(outcome.analysis?.rawTruncated).toBe(true);
    expect(outcome.analysis?.warnings.join()).toContain('单行单列'); expect(current.run).toHaveBeenCalledTimes(1);
  });
});
