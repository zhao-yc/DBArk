import { describe, expect, it } from 'vitest';
import { tableCopyStructureAcknowledgements, validateTableCopyStructureName, tableCopyStructureConfirmation } from '../../src/shared/tableCopyStructure';
import { planTableCopyStructure } from '../../src/engine/tableCopyStructureSql';
import { tableCopyStructureAckLabel, tableCopyStructureAcksComplete, tableCopyStructureFailure, TableCopyStructureRequestFence, sameTableCopyStructureTarget } from '../../src/renderer/tableCopyStructureUi';
import { assertTableCopyStructureTargetAvailable } from '../../src/renderer/tableCopyStructureServices';
import { validateCommand } from '../../src/shared/validation';
const target = { connectionId: 'c', database: 'db', table: 'source' };
describe('复制结构名称、公开协议及界面围栏', () => {
  it.each(['', ' target', 'target ', 'a.b', 'a;b', '`quoted`', '中文', '1abc', 'a\0b', 'a'.repeat(65), 'a\n'])('准确名称%j拒绝，不修剪、不跨库、不补后缀', value => expect(() => validateTableCopyStructureName(value)).toThrow());
  it('仅生成同库唯一CREATE LIKE，不复制数据或附属对象', () => {
    expect(planTableCopyStructure(target, 'new_table')).toEqual({ newName: 'new_table', sql: 'CREATE TABLE `db`.`new_table` LIKE `db`.`source`;' }); expect(tableCopyStructureConfirmation(target, 'new_table')).toBe('db.new_table');
    for (const value of ['source', 'SOURCE']) expect(() => planTableCopyStructure(target, value)).toThrow('源表');
    for (const database of ['mysql', 'information_schema', 'sys', 'performance_schema', 'a.b', '中文']) expect(() => planTableCopyStructure({ ...target, database }, 'new_table')).toThrow();
  });
  it('公共schema不接受客户端SQL、修订、路径或目标；精确确认和三项风险必须完整', () => {
    const preview = { snapshotId: 's', newName: 'new_table', taskId: 'p' }, apply = { previewToken: 'p', taskId: 'a', confirmation: 'db.new_table', acknowledgements: [...tableCopyStructureAcknowledgements] };
    expect(() => validateCommand('schema.tableCopyStructure.preview', preview)).not.toThrow(); expect(() => validateCommand('schema.tableCopyStructure.apply', apply)).not.toThrow();
    for (const extra of [{ sql: 'DROP TABLE source' }, { connectionRevision: 1 }, { database: 'elsewhere' }, { filePath: 'path' }]) { expect(() => validateCommand('schema.tableCopyStructure.preview', { ...preview, ...extra })).toThrow(); expect(() => validateCommand('schema.tableCopyStructure.apply', { ...apply, ...extra })).toThrow(); }
    for (const acknowledgements of [[], tableCopyStructureAcknowledgements.slice(1), ['ddl-implicit-commit', 'copy-empty-scope', 'copy-empty-scope'], ['__proto__']]) expect(() => validateCommand('schema.tableCopyStructure.apply', { ...apply, acknowledgements })).toThrow();
  });
  it('未知/重复风险不授权；Promise失败只能结合可信进度区分未发送或未知', () => {
    expect(tableCopyStructureAcksComplete(tableCopyStructureAcknowledgements, new Set(tableCopyStructureAcknowledgements))).toBe(true); expect(tableCopyStructureAckLabel('__proto__')).toBeUndefined();
    expect(tableCopyStructureAcksComplete(['__proto__'], new Set(['__proto__']))).toBe(false); expect(tableCopyStructureAcksComplete([...tableCopyStructureAcknowledgements, tableCopyStructureAcknowledgements[0]], new Set(tableCopyStructureAcknowledgements))).toBe(false);
    expect(tableCopyStructureFailure(null, true)).toBe('unknown'); expect(tableCopyStructureFailure(null, false)).toBe('notSent'); expect(tableCopyStructureFailure({ phase: 'releasing', ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' }, true)).toBe('succeeded');
  });
  it('源和目标均使用精确隐藏页保护；数据、列布局、活动任务不能被覆盖', () => {
    const tab = { id: 'hidden', kind: 'table' as const, title: 'source', ...target }, workspace = { settings: { tabs: [tab] }, dirtyTabs: { hidden: true }, activeJobs: {} };
    expect(() => assertTableCopyStructureTargetAvailable(target, workspace)).toThrow('草稿'); expect(() => assertTableCopyStructureTargetAvailable(target, { ...workspace, dirtyTabs: {}, activeJobs: { hidden: true } })).toThrow('活动任务'); expect(() => assertTableCopyStructureTargetAvailable(target, { ...workspace, dirtyTabs: {}, tableLayoutDrafts: { hidden: true } })).toThrow('列布局');
    expect(() => assertTableCopyStructureTargetAvailable({ ...target, table: 'SOURCE' }, workspace)).not.toThrow(); expect(sameTableCopyStructureTarget(target, { ...target, database: 'DB' })).toBe(false);
  });
  it('同一同步围栏不重复提交，取消ACK不提前释放，销毁后迟到响应不可接受', () => {
    const fence = new TableCopyStructureRequestFence(), first = fence.begin('one')!; expect(fence.begin('two')).toBeUndefined(); expect(fence.cancel()).toBe('one'); expect(fence.busy).toBe(true); expect(fence.accepts(first)).toBe(false); fence.finish(first); const next = fence.begin('next')!; fence.dispose(); expect(fence.accepts(next)).toBe(false); expect(fence.begin('late')).toBeUndefined();
  });
});
