import { describe, expect, it, vi } from 'vitest';
import type { CommandMap, QueryOutcome } from '../../src/shared/contracts';
import { parseQueryAnalyzePlan } from '../../src/shared/queryAnalyze';
import { capturePlanSnapshot, captureExplainSnapshot } from '../../src/shared/explainSnapshot';
import { parseExplainPlan } from '../../src/shared/explain';
import { commandSchemas } from '../../src/shared/validation';

/** 原始SQL故意与服务器计划原文不同，验证文件只带有声明的计划容器。 */
function actual(): QueryOutcome {
  const raw = '-> Rows fetched before execution (cost=0 rows=1) (actual time=0.000000000000000001..1.234567890123456789 rows=9007199254740993 loops=1)\n';
  return { elapsedMs: 12345, transactionOpen: true, analysis: parseQueryAnalyzePlan(raw, 'mysql', '8.4.11', 'tree'), results: [{
    columns: [{ key: 'c0', name: 'EXPLAIN', type: 'TEXT' }], rows: [{ c0: raw }], truncated: false, elapsedMs: 12345, statement: "SELECT 'DO_NOT_SAVE_ORIGINAL_SQL'",
  }] };
}

describe('实测计划快照的公共IPC', () => {
  it('同一明确文件入口接受实测快照，严格剥离客户端运行状态并保留原始精度', () => {
    const snapshot = capturePlanSnapshot(actual()), input = commandSchemas['explainFiles.save'].parse({ snapshot }) as CommandMap['explainFiles.save']['input'];
    expect(input.snapshot.kind).toBe('dbark.analyze-snapshot'); expect(input.snapshot.format).toBe('tree');
    const encoded = JSON.stringify(input.snapshot);
    expect(encoded).toContain('0.000000000000000001'); expect(encoded).toContain('1.234567890123456789'); expect(encoded).toContain('9007199254740993');
    for (const key of ['statement', 'elapsedMs', 'transactionOpen', 'analysis', 'nodes', 'sessionId', 'connectionId']) expect(encoded).not.toContain('"' + key + '"');
    expect(encoded).not.toContain('DO_NOT_SAVE_ORIGINAL_SQL');
  });
  it('旧估算快照仍可经原入口保存，不能把旧格式改成实际执行格式', () => {
    const raw = '{"query_block":{"table":{"table_name":"t","rows_examined_per_scan":1}}}';
    const snapshot = captureExplainSnapshot({ elapsedMs: 1, explain: parseExplainPlan(raw, 'mysql', '8.4.11'), results: [{ columns: [{ key: 'c0', name: 'EXPLAIN', type: 'JSON' }], rows: [{ c0: raw }], truncated: false, statement: 'SELECT * FROM t', elapsedMs: 1 }] });
    const input = commandSchemas['explainFiles.save'].parse({ snapshot }) as CommandMap['explainFiles.save']['input'];
    expect(input.snapshot).toEqual(snapshot);
    expect(() => commandSchemas['explainFiles.save'].parse({ snapshot: { ...snapshot, format: 'tree' } })).toThrow();
  });
  it('渲染进程只能传声明快照，不能指定路径、改执行状态或伪装未支持版本', () => {
    const snapshot = capturePlanSnapshot(actual());
    for (const patch of [{ kind: 'dbark.unknown-snapshot' }, { version: 2 }, { format: 'text' }, { dialect: 'mariadb' }, { sql: 'DELETE FROM t' }, { nodes: [] }, { path: 'outside.dbark-plan.json' }]) expect(() => commandSchemas['explainFiles.save'].parse({ snapshot: { ...snapshot, ...patch } })).toThrow();
    expect(() => commandSchemas['explainFiles.save'].parse({ snapshot, path: 'outside.dbark-plan.json' })).toThrow();
    expect(() => commandSchemas['explainFiles.open'].parse({ path: 'outside.dbark-plan.json' })).toThrow();
  });
  it('未知或访问器kind不执行取值代码，不能沿错误格式继续打开', () => {
    const getter = vi.fn(() => 'dbark.analyze-snapshot'), snapshot = capturePlanSnapshot(actual());
    Object.defineProperty(snapshot, 'kind', { enumerable: true, get: getter });
    expect(() => commandSchemas['explainFiles.save'].parse({ snapshot })).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
});
