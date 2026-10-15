import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { explainLimits, explainNodeDetail, parseExplainPlan, readExplainJson } from '../../src/shared/explain';
import { explainCapability, explainQuery, explainStatement, type ExplainContext } from '../../src/engine/queryExplain';
import { commandSchemas } from '../../src/shared/validation';
import type { QueryResult } from '../../src/shared/contracts';

const sample = (name: string) => readFileSync(new URL('../fixtures/explain/' + name + '.json', import.meta.url), 'utf8');
const mode = { noBackslashEscapes: false, ansiQuotes: false };
const result = (raw: string): QueryResult[] => [{ columns: [{ key: 'c0', name: 'EXPLAIN', type: 'JSON' }], rows: [{ c0: raw }], elapsedMs: 1, statement: '', truncated: false }];
function context(): ExplainContext {
  return { status: { dialect: 'mysql', version: '8.4.0' }, mode, check: vi.fn(), reusable: () => true, run: vi.fn(async () => result(sample('mysql57'))) };
}

describe('双数据库五版本静态形状适配（不代表实库验证）', () => {
  it.each([['mysql57','mysql','5.7.44'],['mysql80','mysql','8.0.44'],['mysql84','mysql','8.4.0'],['maria1011','mariadb','10.11.0'],['maria114','mariadb','11.4.0']] as const)('%s 保留树、原文、来源和数据库专有指标', (name, dialect, version) => {
    const raw = sample(name), plan = parseExplainPlan(raw, dialect, version);
    expect(plan.raw).toBe(raw); expect(plan.nodes.length).toBeGreaterThan(4);
    for (const node of plan.nodes) { expect(node.depth).toBeLessThan(explainLimits.depth); if (node.parent) expect(plan.nodes.some(parent => parent.id === node.parent && parent.depth + 1 === node.depth)).toBe(true); }
    const table = plan.nodes.find(node => node.kind === 'table')!;
    expect(table.rows?.source).toBe(dialect === 'mysql' ? 'rows_examined_per_scan' : 'rows');
    expect(explainNodeDetail(raw, table.path)).toContain('table_name');
    if (dialect === 'mariadb') expect(plan.nodes.every(node => !node.costs.length)).toBe(true);
  });
  it('保留 JOIN 顺序、子查询关系、未知节点和未知标量详情', () => {
    const join = parseExplainPlan(sample('mysql57'), 'mysql', '5.7.44');
    expect(join.nodes.filter(node => node.kind === 'table').map(node => node.name)).toEqual(['customer','orders']);
    const unknown = parseExplainPlan(sample('mysql84'), 'mysql', '8.4.0'), node = unknown.nodes.find(node => node.kind === 'future_operation')!;
    expect(node.unknown).toBe(true); expect(explainNodeDetail(unknown.raw, node.path)).toContain('unknown'); expect(unknown.warnings).toHaveLength(1);
    const subquery = parseExplainPlan(sample('maria1011'), 'mariadb', '10.11.0');
    expect(subquery.nodes.filter(node => node.kind === 'query_block').map(node => node.name)).toEqual(['1','2']);
  });
  it('保持大整数、小数、零和负数的原始精度，缺项保持 undefined', () => {
    const raw = '{"query_block":{"table":{"rows_examined_per_scan":900719925474099312345,"filtered":0,"cost_info":{"read_cost":0.123456789012345678901}}}}';
    const table = parseExplainPlan(raw, 'mysql', '8.4.0').nodes.find(node => node.kind === 'table')!;
    expect(table.rows?.value).toBe('900719925474099312345'); expect(table.filtered?.value).toBe('0'); expect(table.costs[0].value).toBe('0.123456789012345678901'); expect(table.access).toBeUndefined(); expect(table.produced).toBeUndefined();
    expect(readExplainJson('{"x":-1e-12,"y":"a\\\"9"}')).toEqual({ x: '-1e-12', y: 'a"9' });
  });
  it('JSON 字节、深度、项数和节点数均有预算，原文不被静默丢弃', () => {
    for (const raw of ['{坏JSON}', '{"x":"' + '中'.repeat(70000) + '"}', '['.repeat(65) + '0' + ']'.repeat(65), '{"x":[' + '0,'.repeat(18000) + '0]}']) {
      const plan = parseExplainPlan(raw, 'mysql', '8.4.0'); expect(plan.nodes).toEqual([]); expect(plan.warnings.length).toBe(1); expect(plan.raw).toBe(raw);
    }
    const plan = parseExplainPlan(JSON.stringify({ query_block: { nested_loop: Array.from({ length: 500 }, (_, i) => ({ table: { table_name: String(i) } })) } }), 'mysql', '8.4.0');
    expect(plan.nodes).toHaveLength(300); expect(plan.warnings.join()).toContain('300');
  });
  it('长文本详情截断，原型同名键与路径转义仍可读取', () => {
    const raw = '{"__proto__":{"a/b~c":{"text":' + JSON.stringify('内容'.repeat(12000)) + '}}}';
    expect(explainNodeDetail(raw, '/__proto__/a~1b~0c')).toContain('展示已截断'); expect(explainNodeDetail(raw, '/constructor')).toBe('');
    const long = parseExplainPlan(JSON.stringify({ ['x'.repeat(100000)]: { nested_loop: Array.from({ length: 250 }, () => ({ table: { table_name: 't' } })) } }), 'mysql', '8.4.0');
    expect(long.nodes.some(node => node.pathTruncated)).toBe(true); expect(long.nodes.every(node => node.path.length <= explainLimits.path)).toBe(true);
    expect(JSON.stringify(long).length).toBeLessThan(2 * 1024 * 1024); expect(long.warnings.join()).toContain('2048');
  });
});

describe('执行计划语句与原会话调度', () => {
  it.each(['SELECT 1; DELETE FROM t','EXPLAIN ANALYZE SELECT 1','EXPLAIN FORMAT=JSON ANALYZE SELECT 1','ANALYZE SELECT 1','/*!80000 SELECT 1 */','/*M! SELECT 1 */','CALL unsafe()','SET @x=1'])('拒绝危险或不明确输入：%s', sql => expect(() => explainStatement(sql, mode)).toThrow());
  it('沿用 DELIMITER、注释、CTE 与已知转义模式', () => {
    expect(explainStatement('DELIMITER $$\nSELECT \'a;\'$$', mode)).toBe("SELECT 'a;'");
    expect(explainStatement('/*说明*/ WITH x AS (SELECT 1) SELECT * FROM x;', mode)).toContain('WITH');
    expect(explainStatement("SELECT 'a\\'; SELECT 2'", { noBackslashEscapes: false, ansiQuotes: false })).toContain('SELECT 2');
    expect(() => explainStatement("SELECT 'a\\'; SELECT 2'", { noBackslashEscapes: true, ansiQuotes: false })).toThrow();
  });
  it('IPC 只接受自动/文本格式，不能请求 ANALYZE 或附加字段', () => {
    const input = { sessionId: 's', taskId: 't', sql: 'SELECT 1', maxRows: 1 };
    expect(commandSchemas['query.explain'].safeParse({ ...input, format: 'auto' }).success).toBe(true);
    expect(commandSchemas['query.explain'].safeParse({ ...input, format: 'analyze' }).success).toBe(false);
    expect(commandSchemas['query.explain'].safeParse({ ...input, database: 'other' }).success).toBe(false);
  });
  it('能力来自服务器版本，未知服务器不发送 JSON', async () => {
    expect(explainCapability({ dialect: 'mariadb', version: '5.5.5-10.11.2-MariaDB' })).toBe(true);
    const c = context(); c.status.version = '未知服务器'; await explainQuery('SELECT 1', 'auto', c);
    expect(c.run).toHaveBeenCalledExactlyOnceWith('EXPLAIN SELECT 1');
  });
  it('默认只发送 JSON，手选文本显式绕过 MySQL explain_format', async () => {
    const c = context(); const output = await explainQuery('SELECT 1', 'auto', c);
    expect(c.run).toHaveBeenCalledExactlyOnceWith('EXPLAIN FORMAT=JSON SELECT 1'); expect(output.explain?.nodes.length).toBeGreaterThan(0);
    const text = context(); await explainQuery('SELECT 1', 'text', text); expect(text.run).toHaveBeenCalledExactlyOnceWith('EXPLAIN FORMAT=TRADITIONAL SELECT 1');
  });
  it('只对格式不支持错误回退原会话文本，普通错误和断线不重试', async () => {
    const c = context(); vi.mocked(c.run).mockRejectedValueOnce({ code: 'ER_UNKNOWN_EXPLAIN_FORMAT' });
    const output = await explainQuery('UPDATE t SET n=n+1', 'auto', c);
    expect(vi.mocked(c.run).mock.calls.map(call => call[0])).toEqual(['EXPLAIN FORMAT=JSON UPDATE t SET n=n+1', 'EXPLAIN FORMAT=TRADITIONAL UPDATE t SET n=n+1']); expect(output.explain?.warnings.join()).toContain('回退');
    for (const code of ['ER_PARSE_ERROR', 'ER_NOT_SUPPORTED_YET', 'ER_TABLEACCESS_DENIED_ERROR', 'ER_QUERY_INTERRUPTED', 'ECONNRESET']) { const failed = context(); vi.mocked(failed.run).mockRejectedValue({ code }); await expect(explainQuery('SELECT 1', 'auto', failed)).rejects.toMatchObject({ code }); expect(failed.run).toHaveBeenCalledTimes(1); }
    const broken = context(); broken.reusable = () => false; vi.mocked(broken.run).mockRejectedValue({ code: 'ER_PARSE_ERROR' }); await expect(explainQuery('SELECT 1', 'auto', broken)).rejects.toBeDefined(); expect(broken.run).toHaveBeenCalledTimes(1);
  });
  it('取消后不进入回退；解析错误保留原文，不能自动重发用户语句', async () => {
    const c = context(); vi.mocked(c.run).mockImplementation(async () => { c.check = () => { throw Error('已取消'); }; throw { code: 'ER_PARSE_ERROR' }; });
    await expect(explainQuery('SELECT 1', 'auto', c)).rejects.toThrow('已取消'); expect(c.run).toHaveBeenCalledTimes(1);
    const invalid = context(); vi.mocked(invalid.run).mockResolvedValue(result('未知格式'));
    const output = await explainQuery('SELECT 1', 'auto', invalid); expect(output.explain?.raw).toBe('未知格式'); expect(output.explain?.nodes).toEqual([]); expect(invalid.run).toHaveBeenCalledTimes(1);
  });
});
