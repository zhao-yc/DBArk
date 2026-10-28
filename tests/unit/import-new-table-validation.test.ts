import { describe, expect, it } from 'vitest';
import { validateCommand } from '../../src/shared/validation';

const expectedSource = { sha256: 'a'.repeat(64), bytes: 14 };
const input = { connectionId: '连接', database: '库', table: '新表', fileToken: '原选择', taskId: '原任务', format: 'csv', encoding: 'utf8', mapping: { id: 'id' }, transactionMode: 'atomic', expectedSource };
describe('新表导入的正式IPC来源边界', () => {
  it('原字节指纹只允许CSV或JSON整文件新增；旧无指纹批次仍兼容', () => {
    for (const format of ['csv', 'json']) expect(validateCommand('files.import', { ...input, format })).toMatchObject({ expectedSource, transactionMode: 'atomic' });
    const { expectedSource: _source, transactionMode: _mode, ...old } = input; expect(validateCommand('files.import', old)).toMatchObject({ format: 'csv' });
    for (const patch of [{ transactionMode: undefined }, { transactionMode: 'batch' }, { format: 'sql' }, { conflict: undefined }, { expectedSource: undefined }, { expectedSource: { ...expectedSource, path: '禁止任意路径' } }]) expect(() => validateCommand('files.import', { ...input, ...patch })).toThrow();
  });
  it('原文件期望拒绝继承、隐藏、访问器及显式undefined，getter完全不执行', () => {
    const { expectedSource: _expected, ...base } = input; let reads = 0;
    const accessor = { ...base }; Object.defineProperty(accessor, 'expectedSource', { enumerable: true, get() { reads++; return expectedSource; } });
    const hidden = { ...base }; Object.defineProperty(hidden, 'expectedSource', { value: expectedSource });
    const inherited = Object.assign(Object.create({ expectedSource }), base);
    for (const value of [accessor, hidden, inherited, { ...base, expectedSource: undefined }]) expect(() => validateCommand('files.import', value)).toThrow();
    expect(reads).toBe(0);
  });
  it('独立扫描不接受路径、连接或DDL输入；CSV专属参数不得混入JSON', () => {
    const scan = { fileToken: '已选择', taskId: '扫描', format: 'csv', encoding: 'utf8', csvHasHeader: false, csvDelimiter: ';' };
    expect(validateCommand('files.inspectImport', scan)).toMatchObject(scan);
    for (const patch of [{ filePath: '禁止任意路径' }, { connectionId: '不需要连接' }, { sql: 'CREATE TABLE' }, { format: 'json' }, { csvHasHeader: undefined }]) expect(() => validateCommand('files.inspectImport', { ...scan, ...patch })).toThrow();
  });
  it('预检保留原指纹及空键、原型同名源字段，目标仍为可靠显式名称', () => {
    const { transactionMode: _mode, ...preflight } = input;
    const mapping = Object.fromEntries([['', 'empty_key'], ['__proto__', 'prototype_key'], ['constructor', 'constructor_key']]);
    const result = validateCommand('files.preflight', { ...preflight, mapping }) as { mapping: Record<string, string>; expectedSource: unknown };
    expect(result.expectedSource).toEqual(expectedSource); expect(Object.keys(result.mapping)).toEqual(['', '__proto__', 'constructor']); expect(Object.getOwnPropertyDescriptor(result.mapping, '__proto__')?.value).toBe('prototype_key');
    const { expectedSource: _source, ...ordinary } = preflight;
    expect(() => validateCommand('files.preflight', { ...ordinary, mapping })).toThrow();
  });
});
