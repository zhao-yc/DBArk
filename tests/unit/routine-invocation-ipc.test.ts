import { describe, expect, it, vi } from 'vitest';
import { publicCommands } from '../../src/shared/commands';
import { validateCommand } from '../../src/shared/validation';
import type { CommandMap } from '../../src/shared/contracts';
import { parseRoutineInvocationMetadata } from '../../src/shared/routineInvocation';

const input: CommandMap['metadata.routineInvocation']['input'] = { connectionId: 'saved-profile', database: '例`程库', name: '过程?名', kind: 'procedure', taskId: 'read-once' };
const output: CommandMap['metadata.routineInvocation']['output'] = { connectionId: input.connectionId, database: input.database, name: input.name, kind: input.kind, parameters: [{ ordinal: 1, name: '__proto__', mode: 'INOUT', type: 'bigint unsigned' }], fingerprint: 'a'.repeat(64) };

describe('例程只读目录公开IPC契约', () => {
  it('preload白名单公开固定命令，入参保留完整目标与必填任务编号', () => {
    expect(publicCommands['metadata.routineInvocation']).toBe(true);
    expect(validateCommand('metadata.routineInvocation', input)).toEqual(input);
    expect(validateCommand('metadata.routineInvocation', { ...input, kind: 'function' })).toEqual({ ...input, kind: 'function' });
  });

  it.each([
    { taskId: undefined }, { taskId: '' }, { kind: 'table' }, { kind: 'PROCEDURE' },
    { database: '' }, { name: '' }, { name: 'a'.repeat(65) }, { database: 'a'.repeat(65) },
    { name: 'bad\0name' }, { name: '\ud800' }, { connectionId: '' },
    { profile: { password: '不应进入公开IPC' } }, { sql: 'CALL anything()' }, { parameters: [] }, { fingerprint: 'a'.repeat(64) },
  ])('拒绝缺失、未知或越界输入，不接受renderer配置/SQL：%j', patch => {
    expect(() => validateCommand('metadata.routineInvocation', { ...input, ...patch })).toThrow();
  });

  it('output校验克隆纯元数据，不传播DDL/sql_mode和访问器', () => {
    const result = parseRoutineInvocationMetadata(output); expect(result).toEqual(output); expect(result).not.toBe(output); expect(result.parameters).not.toBe(output.parameters);
    for (const patch of [{ definition: 'CREATE PROCEDURE subject() SELECT 1' }, { sqlMode: '' }, { profile: {} }, { fingerprint: 'A'.repeat(64) }, { parameters: [{ ...output.parameters[0], ordinal: 2 }] }]) expect(() => parseRoutineInvocationMetadata({ ...output, ...patch })).toThrow();
    const getter = vi.fn(() => input.database), supplied = { ...output }; Object.defineProperty(supplied, 'database', { enumerable: true, get: getter });
    expect(() => parseRoutineInvocationMetadata(supplied)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });

  it('函数返回信息必填且不混进ordinal0输入；过程禁止返回类型字段', () => {
    expect(() => parseRoutineInvocationMetadata({ ...output, returnType: 'int' })).toThrow();
    expect(() => parseRoutineInvocationMetadata({ ...output, kind: 'function' })).toThrow();
    const fn = { ...output, kind: 'function', parameters: [{ ...output.parameters[0], mode: 'IN' }], returnType: 'decimal(20,4)' };
    expect(parseRoutineInvocationMetadata(fn)).toEqual(fn);
    expect(() => parseRoutineInvocationMetadata({ ...fn, parameters: [{ ...fn.parameters[0], ordinal: 0 }] })).toThrow();
  });
});
