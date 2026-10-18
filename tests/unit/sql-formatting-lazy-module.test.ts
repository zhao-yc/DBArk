import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => { let resolve!: () => void; return { calls: 0, ready: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() }; });
vi.mock('../../src/renderer/sqlFormattingRoles', async () => { state.calls++; await state.ready; return { sqlFormattingNameRanges() { throw Error('真实角色拒绝'); } }; });
import { planSqlFormatting, prepareSqlFormattingRoles } from '../../src/renderer/sqlFormatting';
import { DeferredUpperSqlFormatting } from '../../src/renderer/sqlFormattingDeferred';

it('默认导入和preserve保持同步且不初始化角色模块；只有显式准备upper才加载，未准备不能绕过证明', async () => {
  const source = 'select MiXeD from T;'; expect(DeferredUpperSqlFormatting).toBeTypeOf('function'); expect(state.calls).toBe(0);
  const plan = planSqlFormatting(source, 0, source.length); expect(plan?.text).toContain('select'); expect(plan).not.toBeInstanceOf(Promise); expect(state.calls).toBe(0);
  expect(() => planSqlFormatting(source, 0, source.length, '\n', { keywordCase: 'upper' })).toThrow(); expect(state.calls).toBe(0);
  const loading = prepareSqlFormattingRoles(); await vi.waitFor(() => expect(state.calls).toBe(1));
  expect(planSqlFormatting(source, 0, source.length)?.text).toContain('select'); state.resolve(); await loading;
  expect(() => planSqlFormatting(source, 0, source.length, '\n', { keywordCase: 'upper' })).toThrow('SQL 格式化失败');
});
