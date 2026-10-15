import { describe, expect, it, vi } from 'vitest';
import { isResultBinaryCell } from '../../src/renderer/components/ResultsGrid';
import { ownCell } from '../../src/renderer/lib';
import type { CellValue, ResultColumn } from '../../src/shared/contracts';

// 本套只验证实际结果谓词，隔离工作区模块的window卸载监听，不替换字节判断。
vi.mock('../../src/renderer/store', () => ({ useWorkspace: () => { throw Error('纯谓词测试不应挂载工作区'); } }));

describe('只读结果的字节识别不猜测协议类型', () => {
  it.each(['BLOB', 'LONG_BLOB', 'VAR_STRING', 'BIT'])('协议%s不改变真实字符串与NULL判定', type => {
    const column: ResultColumn = { key: 'c0', name: 'note', type }, row = { c0: 'TEXT正文' };
    expect(isResultBinaryCell(ownCell(row, column.key))).toBe(false); expect(isResultBinaryCell(null)).toBe(false);
  });
  it.each([undefined, null, '', '0x00ff', 'base64:AP+A', 0, false] as (CellValue | undefined)[])('标量或缺省值%s不伪装成字节', value => { expect(isResultBinaryCell(value)).toBe(false); });
  it.each(['', 'AP+A'])('真实binary包装%s保留，包括空二进制', base64 => { expect(isResultBinaryCell({ type: 'binary', base64 })).toBe(true); });
  it('重复别名仍按唯一内部键区分文本、NULL、字节和零字节，标题显示名称不参与取值', () => {
    const columns: ResultColumn[] = ['c0', 'c1', 'c2', 'c3'].map(key => ({ key, name: '重复别名', type: 'BLOB' }));
    const row = { c0: '正文', c1: { type: 'binary' as const, base64: 'AP+A' }, c2: null, c3: { type: 'binary' as const, base64: '' } };
    expect(columns.map(column => isResultBinaryCell(ownCell(row, column.key)))).toEqual([false, true, false, true]); expect(ownCell(row, columns[1].key)).toEqual({ type: 'binary', base64: 'AP+A' });
  });
});
