import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
import { validateQueryParameters } from '../../src/shared/queryParameters';
import { validateSqliteQueryParameters } from '../../src/shared/sqliteQueryParameters';

const input = (parameters: unknown[]) => ({ sessionId: 'sqlite:original', taskId: 'parameter-task', sql: 'SELECT :value', maxRows: 1000, parameters });
describe('类型参数公共IPC与驱动边界', () => {
  it('公共IPC允许已实现驱动严格集合，并保留MySQL大整数与SQLite早年日期各自执行限制', () => {
    const mysql = [{ name: 'value', type: 'integer' as const, value: '18446744073709551615' }], sqlite = [{ name: 'value', type: 'date' as const, value: '0001-01-01' }];
    expect(validateCommand('query.executeParameterized', input(mysql))).toEqual(input(mysql)); expect(validateCommand('query.executeParameterized', input(sqlite))).toEqual(input(sqlite));
    expect(() => validateSqliteQueryParameters(mysql)).toThrow('64'); expect(() => validateQueryParameters(sqlite, 38, true)).toThrow();
  });
  it('不能用自报dialect、绑定map或额外SQL字段改变原受限契约', () => {
    for (const extra of [{ dialect: 'sqlite' }, { namedParameters: { ':value': '隐私值' } }, { currentStatement: { offset: 0, sql: 'SELECT 2' } }, { executable: 'SQL' }]) expect(() => validateCommand('query.executeParameterized', { ...input([]), ...extra })).toThrow();
  });
  it('当前语句识别和执行共用受限 UTF-16 光标字段', () => {
    const currentStatement = { offset: 7 };
    const preview = { sessionId: 'sqlite:original', sql: 'SELECT :value' };
    expect(validateCommand('query.parameterNames', { ...preview, currentStatement })).toEqual({ ...preview, currentStatement });
    expect(validateCommand('query.executeParameterized', { ...input([]), currentStatement })).toEqual({ ...input([]), currentStatement });
    for (const offset of [-1, 1.5, 99]) {
      expect(() => validateCommand('query.parameterNames', { ...preview, currentStatement: { offset } })).toThrow();
      expect(() => validateCommand('query.executeParameterized', { ...input([]), currentStatement: { offset } })).toThrow();
    }
  });
  it.each([
    [{ name: 'value', type: 'integer', value: '1; DROP TABLE t' }], [{ name: 'value', type: 'date', value: '0000-01-01' }], [{ name: 'value', type: 'null', value: '不允许' }],
    [{ name: 'value', type: 'text', value: 'a' }, { name: 'value', type: 'text', value: 'b' }], [{ name: 'value', type: 'binary', value: '0' }], [{ name: 'value', type: 'text', value: '\uD800' }],
  ].map(parameters => ({ parameters })))('所有驱动都拒绝的整组$parameters仍在IPC层拒绝', ({ parameters }) => {
    expect(() => validateCommand('query.executeParameterized', input(parameters))).toThrow();
  });
});
