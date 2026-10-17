import { describe, expect, it, vi } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import { tableCopyDataAcknowledgements } from '../../src/shared/tableCopyData';
import { tableCopyDataAcksComplete, tableCopyDataFailure, tableCopyDataStage } from '../../src/renderer/tableCopyDataUi';
import { tableCopyDataServices } from '../../src/renderer/tableCopyDataServices';
import { tableCopyDataZh as text } from '../../src/renderer/locales/tableCopyData.zh-CN';
const apply = { mode: 'structure-and-data', previewToken: 'token', confirmation: 'db.t_copy', acknowledgements: [...tableCopyDataAcknowledgements], taskId: 'task' };
describe('数据复制专用合同、预加载白名单和阶段语义', () => {
  it.each(['get', 'preview', 'apply', 'release'] as const)('%s专用命令在白名单内', action => expect(publicCommands['schema.tableCopyData.' + action as keyof typeof publicCommands]).toBe(true));
  it('固定模式以及准确五项确认才可通过严格合同；SQL、目标覆盖和连接修订不能注入', () => {
    expect(validateCommand('schema.tableCopyData.apply', apply)).toEqual(apply);
    for (const changed of [{ mode: undefined }, { mode: 'structure-only' }, { sql: 'DROP TABLE t' }, { newName: 'other' }, { connectionRevision: 7 }, { acknowledgements: [] }, { acknowledgements: [...tableCopyDataAcknowledgements, tableCopyDataAcknowledgements[0]] }, { acknowledgements: ['ddl-implicit-commit', 'copy-empty-scope', 'external-ddl-window'] }]) expect(() => validateCommand('schema.tableCopyData.apply', { ...apply, ...changed })).toThrow('参数无效');
    expect(() => validateCommand('schema.tableCopyStructure.apply', apply)).toThrow('参数无效');
  });
  it('新名不trim，不拆跨库路径，预览不接受SQL或模式替代', () => {
    const input = { mode: 'structure-and-data', snapshotId: 's', newName: 't_copy', taskId: 't' };
    expect(validateCommand('schema.tableCopyData.preview', input)).toEqual(input);
    for (const newName of ['t_copy ', 'other.t', 't;DROP', 't`']) expect(() => validateCommand('schema.tableCopyData.preview', { ...input, newName })).toThrow();
    expect(() => validateCommand('schema.tableCopyData.preview', { ...input, mode: 'structure-only' })).toThrow();
  });
  it('精确五项集合不能由空表确认、重复、缺项或原型字段替代', () => {
    expect(tableCopyDataAcksComplete(tableCopyDataAcknowledgements, new Set(tableCopyDataAcknowledgements))).toBe(true);
    for (const required of [[], tableCopyDataAcknowledgements.slice(1), [...tableCopyDataAcknowledgements.slice(1), '__proto__'], Array(5).fill('retain-unknown')]) expect(tableCopyDataAcksComplete(required, new Set(required))).toBe(false);
  });
  it('建表、INSERT和COMMIT发送均不是已提交证据；数据成功后close失败仍保留成功事实', () => {
    const progress = { phase: 'executing' as const, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, outcome: 'unknown' as const };
    expect(tableCopyDataFailure(progress, true)).toBe('verificationFailed'); expect(tableCopyDataStage(progress)).toBe(text.created);
    expect(tableCopyDataStage({ ...progress, insertCompleted: true })).toBe(text.insertFinished);
    expect(tableCopyDataStage({ ...progress, commitSubmitted: true })).toBe(text.commitUnknown);
    expect(tableCopyDataFailure({ ...progress, dataCompleted: true }, true)).toBe('succeeded'); expect(tableCopyDataStage({ ...progress, dataCompleted: true })).toBe(text.dataCommitted);
    expect(tableCopyDataFailure(null, true)).toBe('unknown'); expect(tableCopyDataFailure(null, false)).toBe('notSent');
  });
  it('生产服务逐次投递本用途命令与原任务取消，不使用SQL查询接口或空表fallback', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window'), invoke = vi.fn(async (_command: string, _input: unknown) => ({})), onTask = vi.fn(() => () => {});
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { dbark: { invoke, onTask } } });
    try { await tableCopyDataServices.apply(apply as any); await tableCopyDataServices.cancel({ taskId: 'task' }); tableCopyDataServices.subscribe(() => {}); expect(invoke.mock.calls.map(call => call[0])).toEqual(['schema.tableCopyData.apply', 'query.cancel']); expect(onTask).toHaveBeenCalledTimes(1); }
    finally { if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else delete (globalThis as any).window; }
  });
});
