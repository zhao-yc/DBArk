import { describe, expect, it } from 'vitest';
import { SqlFileImportPositions } from '../../src/engine/sqlFileImportPosition';
import { SqlScriptScanner } from '../../src/engine/sql';

describe('SQL文件有界UTF16位置', () => {
  it('CRLF跨块和代理对仍对应原scanner范围，不按字节或码点计列', () => {
    const positions = new SqlFileImportPositions(); positions.append('SELECT 1;\r'); positions.append('\n  SELECT \'😀\';');
    expect(positions.locate({ start: 13, end: 24 })).toEqual({ start: { offset: 13, line: 2, column: 3 }, end: { offset: 24, line: 2, column: 14 } });
    expect(positions.locate({ start: 13, end: 24 })).toBeUndefined();
  });
  it('DELIMITER与重复原文直接使用scanner给出的不同offset', () => {
    const text = 'DELIMITER $$\r\nSELECT 1$$\r\nSELECT 1$$\r\n';
    const scanner = new SqlScriptScanner(), positions = new SqlFileImportPositions(); positions.append(text);
    const statements = scanner.pushLocated(text, true);
    expect(statements).toHaveLength(2);
    expect(statements.map(item => positions.locate(item.sourceRange)?.start)).toEqual([{ offset: 14, line: 2, column: 1 }, { offset: 26, line: 3, column: 1 }]);
  });
  it('超过固定窗口的起点不伪造位置，后续尾窗位置仍准确', () => {
    const positions = new SqlFileImportPositions(8); positions.append('a\r\nb\n' + 'x'.repeat(20)); positions.append('y');
    expect(positions.locate({ start: 0, end: 1 })).toBeUndefined();
    expect(positions.locate({ start: 25, end: 26 })).toEqual({ start: { offset: 25, line: 3, column: 21 }, end: { offset: 26, line: 3, column: 22 } });
    expect(positions.locate({ start: 25, end: 24 })).toBeUndefined();
  });
  it('合法超过256Ki语句跨64Ki块仍保留原始起点及结束列', () => {
    const text = '/*' + 'a'.repeat(300 * 1024) + '*/\r\n SELECT 1;';
    const positions = new SqlFileImportPositions(), scanner = new SqlScriptScanner();
    let found: ReturnType<SqlScriptScanner['pushLocated']> = [];
    for (let offset = 0; offset < text.length; offset += 64 * 1024) {
      const chunk = text.slice(offset, offset + 64 * 1024); positions.append(chunk);
      found = scanner.pushLocated(chunk, offset + chunk.length === text.length, 1);
      if (!found.length) positions.discardBefore(scanner.retainedSourceOffset);
    }
    expect(found).toHaveLength(1);
    expect(positions.locate(found[0].sourceRange)).toEqual({ start: { offset: 0, line: 1, column: 1 }, end: { offset: text.length - 1, line: 2, column: 10 } });
  });
  it('大量连续DELIMITER前缀按scanner floor释放，尾SQL位置仍为原文件坐标', () => {
    const positions = new SqlFileImportPositions(), scanner = new SqlScriptScanner(); let offset = 0;
    for (let index = 0; index < 1000; index++) {
      const chunk = 'DELIMITER $$\r\n'; positions.append(chunk); offset += chunk.length;
      expect(scanner.pushLocated(chunk, false, 1)).toEqual([]); positions.discardBefore(scanner.retainedSourceOffset);
      expect((positions as any).buffered).toBe(0);
    }
    positions.append('SELECT 1$$'); const [item] = scanner.pushLocated('SELECT 1$$', true, 1);
    expect(positions.locate(item.sourceRange)).toEqual({ start: { offset, line: 1001, column: 1 }, end: { offset: offset + 8, line: 1001, column: 9 } });
  });
});
