import { describe, expect, it } from 'vitest';
import { queryResultTitle } from '../../src/shared/queryResultTitle';
import { SqlScriptScanner } from '../../src/shared/sqlScriptScanner';

describe('查询结果自定义名称', () => {
  it('从每条真实分段模板读取名称，空名称与未命名语句仍使用序号', () => {
    const sql = "-- 说明\r\n-- NAME: 月度;汇总 🚢\r\nSELECT :month; /*name: 明细 */ SELECT 'NAME: 数据'; SELECT 3; -- NAME: \nSELECT 4;";
    const statements = new SqlScriptScanner().push(sql, true);
    expect(statements.map(statement => queryResultTitle(statement))).toEqual(['月度;汇总 🚢', '明细', undefined, undefined]);
    expect(statements[0]).toContain('SELECT :month');
  });

  it('只读语句头，尊重方言的注释边界和第一个标记', () => {
    expect(queryResultTitle('# 说明\n/* 普通注释 */ -- NAME: 第一组\n-- NAME: 第二组\nSELECT 1')).toBe('第一组');
    expect(queryResultTitle('--NAME: 明细\nSELECT 1')).toBeUndefined();
    expect(queryResultTitle('--NAME: 明细\nSELECT 1', true)).toBe('明细');
    expect(queryResultTitle('# 说明\n-- NAME: 明细\nSELECT 1', true)).toBeUndefined();
    expect(queryResultTitle("SELECT '/*NAME: 伪造 */' /*NAME: 伪造 */")).toBeUndefined();
    for (const token of ['/*!80000 SELECT 1 */', '/*M! SELECT 1 */', '/*+ 注释 */']) {
      expect(queryResultTitle(`${token} /*NAME: 不读取 */ SELECT 2`)).toBeUndefined();
    }
  });

  it('显示有限纯文本，拒绝超长、换行、双向控制符和不完整注释', () => {
    const title = '数'.repeat(80);
    expect(queryResultTitle(`/*NAME: ${title} */ SELECT 1`)).toBe(title);
    expect(queryResultTitle('/*NAME: <b>原文</b> */ SELECT 1')).toBe('<b>原文</b>');
    for (const invalid of [`${title}据`, '甲\n乙', '甲\u202E乙', '甲\u0000乙', '甲\ud800乙']) {
      expect(queryResultTitle(`/*NAME: ${invalid} */ SELECT 1`)).toBeUndefined();
    }
    expect(queryResultTitle('/*NAME: 未闭合 SELECT 1')).toBeUndefined();
    expect(queryResultTitle(`${' '.repeat(4096)}-- NAME: 超出范围\nSELECT 1`)).toBeUndefined();
    expect(queryResultTitle(`${' '.repeat(4080)}-- NAME: 越过边界的行注释\nSELECT 1`)).toBeUndefined();
  });
});
