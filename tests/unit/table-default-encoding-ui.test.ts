import { describe, expect, it } from 'vitest';
import { changeDefaultCharset, defaultEncodingSelectable, sameTableDefaultEncodingTarget, tableDefaultEncodingAckLabel, tableDefaultEncodingAcksComplete, tableDefaultEncodingFailure, TableDefaultEncodingRequestFence } from '../../src/renderer/tableDefaultEncodingUi';
import { assertTableDefaultEncodingTargetAvailable } from '../../src/renderer/tableDefaultEncodingServices';
import { sameTableEncodingPair } from '../../src/shared/tableDefaultEncoding';
const current = { charset: 'utf8mb4', collation: 'utf8mb4_bin' }, candidates = [current, { charset: 'utf8mb4', collation: 'utf8mb4_general_ci' }, { charset: 'latin1', collation: 'latin1_bin' }];
describe('默认编码真实候选、同步围栏与目标保护', () => {
  it('字符集变化清空不匹配规则，不猜新字符集默认，完整配对才可预览', () => {
    const changed = changeDefaultCharset(current, 'latin1', candidates); expect(changed).toEqual({ charset: 'latin1', collation: '' }); expect(defaultEncodingSelectable(changed, candidates)).toBe(false);
    expect(defaultEncodingSelectable({ charset: 'latin1', collation: 'utf8mb4_bin' }, candidates)).toBe(false);
    expect(defaultEncodingSelectable({ charset: 'latin1', collation: 'latin1_bin' }, candidates)).toBe(true);
    expect(sameTableEncodingPair({ ...current }, current)).toBe(true); expect(sameTableEncodingPair({ ...current, charset: 'UTF8MB4' }, current)).toBe(false);
  });
  it('三项中文风险全部匹配，重复/未知/原型属性/额外确认都不能执行', () => {
    const required = ['ddl-implicit-commit', 'external-ddl-window', 'table-default-only']; expect(tableDefaultEncodingAcksComplete(required, new Set(required))).toBe(true);
    for (const id of required) expect(tableDefaultEncodingAckLabel(id)).toMatch(/[\u4e00-\u9fff]/);
    for (const bad of [[], required.slice(0, 2), [...required, required[0]], ['__proto__', 'constructor', 'other']]) expect(tableDefaultEncodingAcksComplete(bad, new Set(bad))).toBe(false);
    expect(tableDefaultEncodingAckLabel('__proto__')).toBeUndefined(); expect(tableDefaultEncodingAcksComplete(required, new Set([...required, 'extra']))).toBe(false);
  });
  it('双击、取消和卸载不接受迟到响应，取消不提前放开busy', () => {
    const guard = new TableDefaultEncodingRequestFence(), first = guard.begin('one')!; expect(guard.begin('two')).toBeUndefined(); expect(guard.cancel()).toBe('one'); expect(guard.busy).toBe(true); expect(guard.accepts(first)).toBe(false);
    guard.finish(first); const next = guard.begin('two')!; expect(guard.accepts(first)).toBe(false); expect(guard.accepts(next)).toBe(true); expect(guard.dispose()).toBe('two'); expect(guard.begin('three')).toBeUndefined();
  });
  it('Promise失败不代表未发送，保留DDL完成而定义未核验的状态', () => {
    expect(tableDefaultEncodingFailure(null, false)).toBe('notSent'); expect(tableDefaultEncodingFailure(null, true)).toBe('unknown');
    expect(tableDefaultEncodingFailure({ phase: 'verifying', ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, outcome: 'succeeded' }, true)).toBe('verificationFailed');
  });
  it('同目标隐藏页数据草稿或活动任务阻止入口，精确大小写和其他表独立', () => {
    const target = { connectionId: 'c', database: 'db', table: 't' }, workspace = { settings: { tabs: [{ id: 'hidden', kind: 'table' as const, title: 't', ...target }] }, dirtyTabs: { hidden: true }, activeJobs: {} };
    expect(() => assertTableDefaultEncodingTargetAvailable(target, workspace)).toThrow('草稿'); expect(() => assertTableDefaultEncodingTargetAvailable({ ...target, table: 'T' }, workspace)).not.toThrow();
    expect(() => assertTableDefaultEncodingTargetAvailable(target, { ...workspace, dirtyTabs: {}, activeJobs: { hidden: true } })).toThrow('活动操作'); expect(sameTableDefaultEncodingTarget(target, { ...target, database: 'DB' })).toBe(false);
  });
});
