import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';
describe('跨进程边界校验', () => {
  it('拒绝未知命令及继承属性名称', () => { expect(() => validateCommand('constructor', {})).toThrow(); expect(() => validateCommand('exec', {})).toThrow(); });
  it('渲染进程不能调用内部连接配置检查命令', () => { expect(() => validateCommand('__connections.prepareSave', { id: 'test', profile: {} })).toThrow(); });
  it('禁止通过文件API注入本机路径', () => { expect(() => validateCommand('files.preview', { fileToken:'a', format:'csv', encoding:'utf8', filePath:'C:/secret' })).toThrow(); });
  it('约束结果上限并拒绝字符串数值', () => { const input = { sessionId:'a', taskId:'b', sql:'SELECT 1', maxRows:1000 }; expect(validateCommand('query.execute', input)).toEqual(input); expect(() => validateCommand('query.execute', { ...input, maxRows:1e9 })).toThrow(); expect(() => validateCommand('query.execute', { ...input, maxRows:'1000' })).toThrow(); });
  it('公共参数边界接纳 MariaDB 精度和 TIME 极值，实际能力由固定会话校验', () => {
    const input = { sessionId: 'a', taskId: 'b', sql: 'SELECT :v, :duration', maxRows: 10, parameters: [{ name: 'v', type: 'decimal', value: '0.12345678901234567890123456789012345678' }, { name: 'duration', type: 'time', value: '838:59:59.999999' }] };
    expect(validateCommand('query.executeParameterized', input)).toEqual(input);
    expect(() => validateCommand('query.executeParameterized', { ...input, parameters: [...input.parameters, input.parameters[0]] })).toThrow(/重复/);
    expect(() => validateCommand('query.executeParameterized', { ...input, parameters: [{ name: 'v', type: 'integer', value: '1; DELETE FROM t' }] })).toThrow();
    expect(() => validateCommand('query.executeParameterized', { ...input, parameters: [{ name: 'v', type: 'null', value: '不应接受' }] })).toThrow();
  });
});
