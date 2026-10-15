import { describe, expect, it } from 'vitest';
import { streamExecutionAllowed, streamResultSelection } from '../../src/renderer/queryStreamExport';
import { queryExportFileFormat, queryCsvResultFile } from '../../src/shared/queryStreamExport';
import { resolveFileToken } from '../../src/main/fileTokens';

describe('完整 SQL 流式导出最终确认', () => {
  it('JSON 保留全部结果，CSV 只按一基行结果集序号选择', () => {
    expect(streamResultSelection('json', '无关')).toEqual({ kind: 'all' });
    expect(streamResultSelection('csv-zip', '无关')).toEqual({ kind: 'all' });
    expect(streamResultSelection('csv', '2')).toEqual({ kind: 'row-result', ordinal: 2 });
    expect(streamResultSelection('csv', '200')).toEqual({ kind: 'row-result', ordinal: 200 });
  });
  it('多CSV使用ZIP授权而非CSV令牌，固定包内路径有界且不接收用户名称', () => {
    const files = new Map([['zip', { path: '/selected/all.zip', purpose: 'export', format: 'zip' }], ['csv', { path: '/selected/one.csv', purpose: 'export', format: 'csv' }]]);
    expect(resolveFileToken(files, 'zip', 'export', queryExportFileFormat('csv-zip'))).toBe('/selected/all.zip');
    expect(() => resolveFileToken(files, 'csv', 'export', queryExportFileFormat('csv-zip'))).toThrow('未授权');
    expect(queryExportFileFormat('json')).toBe('json'); expect(queryExportFileFormat('csv')).toBe('csv'); expect(queryCsvResultFile(1)).toBe('results/rows-001.csv'); expect(queryCsvResultFile(200)).toBe('results/rows-200.csv');
    for (const ordinal of [0, -1, 1.5, 201, NaN]) expect(() => queryCsvResultFile(ordinal)).toThrow();
  });
  it('拒绝零、负数、小数、指数、前导零与超出多结果预算的序号', () => {
    for (const value of ['0', '-1', '1.5', '1e2', '01', '201', '', ' 1']) expect(() => streamResultSelection('csv', value)).toThrow();
  });
  it('必须先选文件并确认新执行，二进制模式还需独立诊断确认', () => {
    expect(streamExecutionAllowed(undefined, true, 'text-strict', false, false, false)).toBe(false);
    expect(streamExecutionAllowed('授权文件', false, 'text-strict', false, false, false)).toBe(false);
    expect(streamExecutionAllowed('授权文件', true, 'text-strict', false, false, false)).toBe(true);
    expect(streamExecutionAllowed('授权文件', true, 'binary-explicit', false, false, false)).toBe(false);
    expect(streamExecutionAllowed('授权文件', true, 'binary-explicit', true, false, false)).toBe(true);
  });
  it('运行未settle或文件已提交不能再次执行，失败清确认后不能自动重试', () => {
    expect(streamExecutionAllowed('授权文件', true, 'text-strict', false, true, false)).toBe(false);
    expect(streamExecutionAllowed('授权文件', true, 'text-strict', false, false, true)).toBe(false);
    expect(streamExecutionAllowed('授权文件', false, 'binary-explicit', false, false, false)).toBe(false);
  });
});
