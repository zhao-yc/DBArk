import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';

const input = { sessionId: 'session', taskId: 'task', sql: 'SELECT 1; SELECT 2;', maxRows: 10 };
describe('当前语句可选协议的严格边界', () => {
  it('缺省保持原请求，0和文档末尾都是有效UTF16位置', () => {
    expect(validateCommand('query.execute', input)).toEqual(input);
    for (const offset of [0, input.sql.length]) expect(validateCommand('query.execute', { ...input, currentStatement: { offset } })).toMatchObject({ currentStatement: { offset } });
  });
  it.each([{}, null, { offset: -1 }, { offset: 0.5 }, { offset: NaN }, { offset: Infinity }, { offset: input.sql.length + 1 }, { offset: '3' }, { offset: 3, sql: '其它SQL' }])('严格拒绝无效currentStatement：%j', currentStatement => {
    expect(() => validateCommand('query.execute', { ...input, currentStatement })).toThrow();
  });
  it('计划和命名参数协议接收原光标，分析请求仍拒绝未知范围', () => {
    expect(() => validateCommand('query.execute', { ...input, currentStatement: { offset: 3 }, all: true })).toThrow();
    const currentStatement = { offset: 3 };
    expect(validateCommand('query.explain', { ...input, currentStatement })).toEqual({ ...input, currentStatement });
    expect(() => validateCommand('query.explain', { ...input, currentStatement: { offset: input.sql.length + 1 } })).toThrow();
    expect(validateCommand('query.executeParameterized', { ...input, parameters: [], currentStatement })).toMatchObject({ currentStatement });
    expect(() => validateCommand('query.analyze', { ...input, acknowledged: true, expectedDatabase: null, currentStatement })).toThrow();
  });
});
