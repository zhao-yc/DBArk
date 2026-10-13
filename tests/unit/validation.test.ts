import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
describe('跨进程边界校验', () => {
  it('拒绝未知命令及继承属性名称', () => { expect(() => validateCommand('constructor', {})).toThrow(); expect(() => validateCommand('exec', {})).toThrow(); });
  it('禁止通过文件API注入本机路径', () => { expect(() => validateCommand('files.preview', { fileToken:'a', format:'csv', encoding:'utf8', filePath:'C:/secret' })).toThrow(); });
  it('约束结果上限并拒绝字符串数值', () => { const input = { sessionId:'a', taskId:'b', sql:'SELECT 1', maxRows:1000 }; expect(validateCommand('query.execute', input)).toEqual(input); expect(() => validateCommand('query.execute', { ...input, maxRows:1e9 })).toThrow(); expect(() => validateCommand('query.execute', { ...input, maxRows:'1000' })).toThrow(); });
});
