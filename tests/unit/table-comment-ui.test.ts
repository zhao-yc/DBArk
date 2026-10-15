import { describe, expect, it } from 'vitest';
import { sameTableCommentTarget, tableCommentAckLabel, tableCommentAcksComplete, tableCommentFailure, TableCommentRequestFence } from '../../src/renderer/tableCommentUi';
import { assertTableCommentTargetAvailable } from '../../src/renderer/tableCommentServices';

describe('表注释前端围栏与精确目标保护', () => {
  it('双击、取消与卸载不接受迟到结果，不在取消请求返回时释放busy', () => {
    const guard = new TableCommentRequestFence(), old = guard.begin('one')!;
    expect(guard.begin('two')).toBeUndefined(); expect(guard.accepts(old)).toBe(true);
    expect(guard.cancel()).toBe('one'); expect(guard.busy).toBe(true); expect(guard.accepts(old)).toBe(false);
    guard.finish(old); const next = guard.begin('two')!; expect(guard.accepts(old)).toBe(false); expect(guard.accepts(next)).toBe(true);
    expect(guard.dispose()).toBe('two'); expect(guard.begin('three')).toBeUndefined(); expect(guard.accepts(next)).toBe(false);
  });
  it('只接受完整两项已知风险，拒绝额外、重复和原型属性名', () => {
    const required = ['ddl-implicit-commit', 'external-ddl-window'];
    expect(tableCommentAcksComplete(required, new Set(required))).toBe(true);
    for (const value of [[], required.slice(0, 1), [...required, required[0]], ['__proto__', 'constructor']]) expect(tableCommentAcksComplete(value, new Set(value))).toBe(false);
    expect(tableCommentAckLabel('__proto__')).toBeUndefined(); expect(tableCommentAckLabel('constructor')).toBeUndefined();
    expect(tableCommentAcksComplete(required, new Set([...required, 'unknown']))).toBe(false);
  });
  it('拒绝Promise不能伪报未执行，保留已完成但未核验事实', () => {
    expect(tableCommentFailure(null, false)).toBe('notSent'); expect(tableCommentFailure(null, true)).toBe('unknown');
    expect(tableCommentFailure({ phase: 'rechecking', outcome: 'not-sent', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false }, true)).toBe('notSent');
    expect(tableCommentFailure({ phase: 'releasing', outcome: 'succeeded', ddlSubmitted: true, ddlCompleted: true, definitionVerified: false }, true)).toBe('verificationFailed');
  });
  it('同目标隐藏页的数据草稿和活动任务都阻断入口，其他目标不受影响', () => {
    const target = { connectionId: 'c', database: 'db', table: 't' }, workspace = { settings: { tabs: [{ id: 'hidden', kind: 'table' as const, title: 't', ...target }] }, dirtyTabs: { hidden: true }, activeJobs: {} };
    expect(() => assertTableCommentTargetAvailable(target, workspace)).toThrow('草稿');
    expect(() => assertTableCommentTargetAvailable({ ...target, table: 'T' }, workspace)).not.toThrow();
    expect(() => assertTableCommentTargetAvailable(target, { ...workspace, dirtyTabs: {}, activeJobs: { hidden: true } })).toThrow('活动操作');
    expect(sameTableCommentTarget(target, { ...target, database: 'DB' })).toBe(false);
  });
});
