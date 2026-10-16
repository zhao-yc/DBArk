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
  it('其它查询命令不能偷带当前语句标志或未知顶层字段', () => {
    expect(() => validateCommand('query.execute', { ...input, currentStatement: { offset: 3 }, all: true })).toThrow();
    expect(() => validateCommand('query.explain', { ...input, currentStatement: { offset: 3 } })).toThrow();
    expect(() => validateCommand('query.executeParameterized', { ...input, parameters: [], currentStatement: { offset: 3 } })).toThrow();
  });
});
