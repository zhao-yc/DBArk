import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { planTableTruncate, assertTableTruncateConfirmation } from '../../src/engine/tableTruncateSql';
import { tableTruncateAcknowledgements, tableTruncateAcksComplete } from '../../src/shared/tableTruncate';
import { assertTableTruncateTargetAvailable } from '../../src/renderer/tableTruncateServices';
import { tableTruncateAckLabel, sameTableTruncateTarget } from '../../src/renderer/tableTruncateUi';

const target = { connectionId: 'connection', database: 'db', table: 't' };
describe('清空专用计划与IPC拒绝反例', () => {
  it('SQL只从可信ASCII元组生成，拒绝系统库、引用和任意SQL', () => {
    expect(planTableTruncate(target)).toBe('TRUNCATE TABLE `db`.`t`;');
    for (const database of ['mysql', 'MYSQL', 'sys', 'information_schema', 'performance_schema', 'db.x', 'db`', '库']) expect(() => planTableTruncate({ ...target, database })).toThrow();
    for (const table of ['', 't;DROP TABLE x', 't.x', 't`', 't '.trimEnd() + ' ', '表']) expect(() => planTableTruncate({ ...target, table })).toThrow();
    for (const confirmation of ['DB.t', 'db.T', ' db.t', 'db.t ', '`db`.`t`', 'db.t;']) expect(() => assertTableTruncateConfirmation(target, confirmation)).toThrow();
    expect(() => assertTableTruncateConfirmation(target, 'db.t')).not.toThrow();
  });
  it('应用没有目标、SQL或连接修订入口，预览也不能携带任意SQL', () => {
    const apply = { previewToken: 'p', confirmation: 'db.t', acknowledgements: [...tableTruncateAcknowledgements], taskId: 'task' };
    expect(() => validateCommand('schema.tableTruncate.apply', apply)).not.toThrow();
    for (const extra of [{ sql: 'DELETE FROM t' }, target, { connectionRevision: 99 }]) expect(() => validateCommand('schema.tableTruncate.apply', { ...apply, ...extra })).toThrow();
    expect(() => validateCommand('schema.tableTruncate.preview', { snapshotId: 's', taskId: 'task', sql: 'TRUNCATE t' })).toThrow();
    expect(() => validateCommand('schema.tableTruncate.release', {})).toThrow();
  });
  it('三项风险必须准确齐全，拒绝重复、额外和原型属性', () => {
    const required = [...tableTruncateAcknowledgements]; expect(tableTruncateAcksComplete(required, required)).toBe(true);
    for (const values of [[], required.slice(0, 2), [...required, required[0]], [...required, '__proto__'], ['constructor', 'toString', '__proto__']]) {
      expect(tableTruncateAcksComplete(required, values)).toBe(false);
      expect(() => validateCommand('schema.tableTruncate.apply', { previewToken: 'p', confirmation: 'db.t', acknowledgements: values, taskId: 'task' })).toThrow();
    }
    expect(tableTruncateAckLabel('__proto__')).toBeUndefined(); expect(tableTruncateAcksComplete([...required, required[0]], required)).toBe(false);
  });
  it('同目标隐藏页的数据、布局或活动任务阻断，尚未结束的格输入也阻断', () => {
    const workspace = { settings: { tabs: [{ ...target, id: 'hidden', kind: 'table' as const, title: 't' }] }, dirtyTabs: {}, activeJobs: {}, tableLayoutDrafts: {} };
    expect(() => assertTableTruncateTargetAvailable(target, workspace, false)).not.toThrow();
    for (const extra of [{ dirtyTabs: { hidden: true } }, { tableLayoutDrafts: { hidden: true } }, { activeJobs: { hidden: true } }]) expect(() => assertTableTruncateTargetAvailable(target, { ...workspace, ...extra }, false)).toThrow();
    expect(() => assertTableTruncateTargetAvailable(target, workspace, true)).toThrow('输入');
    expect(() => assertTableTruncateTargetAvailable({ ...target, table: 'T' }, { ...workspace, dirtyTabs: { hidden: true } }, false)).not.toThrow();
    expect(sameTableTruncateTarget(target, { ...target, database: 'DB' })).toBe(false);
  });
});
