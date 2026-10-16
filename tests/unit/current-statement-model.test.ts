import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as monaco from 'monaco-editor';
import { beforeAll, describe, expect, it } from 'vitest';
import { currentSqlStatement, sqlStatementRanges } from '../../src/engine/currentStatement';

type BufferPort = { dispose(): void };
let Builder: new () => { acceptChunk(value: string): void; finish(): { create(eol: number): { textBuffer: BufferPort } } };
let prototype: monaco.editor.ITextModel;

/** 只加载真实Monaco文本缓冲和模型原型；不创建浏览器、GUI或系统剪贴板端口。 */
beforeAll(async () => {
  const require = createRequire(import.meta.url), root = dirname(require.resolve('monaco-editor/package.json'));
  const buffer = await import(/* @vite-ignore */ pathToFileURL(join(root, 'esm/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.js')).href);
  const model = await import(/* @vite-ignore */ pathToFileURL(join(root, 'esm/vs/editor/common/model/textModel.js')).href);
  Builder = buffer.PieceTreeTextBufferBuilder; prototype = model.TextModel.prototype;
});

/** getValue/getPositionAt/getOffsetAt/validateRange均使用安装版本的真实实现。 */
function model(source: string) {
  const builder = new Builder(); builder.acceptChunk(source); const { textBuffer } = builder.finish().create(1);
  const instance = Object.assign(Object.create(prototype), { _buffer: textBuffer, _isDisposed: false, _versionId: 7, _isTooLargeForHeapOperation: false }) as monaco.editor.ITextModel;
  return { instance, dispose: () => textBuffer.dispose() };
}

describe('真实Monaco原文与UTF16范围往返', () => {
  it.each([
    ['LF', "SELECT '🧭';\nSELECT '第二句';"],
    ['CRLF', "SELECT '🧭';\r\nSELECT '第二句';\r\n"],
    ['混合换行', "SELECT '🧭';\r\nSELECT '第二句';\nSELECT '第三句';"],
    ['DELIMITER过程体', "DELIMITER $$\r\nCREATE PROCEDURE p() BEGIN SELECT '🧭;'; SELECT '第二句'; END$$\r\nDELIMITER ;\r\nCALL p();"],
    ['重复语句', "SELECT '🧭';\nSELECT '第二句';\nSELECT '第二句';"],
  ])('%s只用模型真实正文和位置解析，不用tab.sql或码点数推算', (_name, draft) => {
    const f = model(draft); try {
      const source = f.instance.getValue(), offset = source.indexOf('第二句'), position = f.instance.getPositionAt(offset);
      expect(f.instance.getOffsetAt(position)).toBe(offset); expect(f.instance.getVersionId()).toBe(7);
      const range = currentSqlStatement(source, f.instance.getOffsetAt(position), { noBackslashEscapes: false, ansiQuotes: false })!;
      const start = f.instance.getPositionAt(range.start), end = f.instance.getPositionAt(range.end);
      const validated = f.instance.validateRange({ startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column });
      expect(f.instance.getOffsetAt({ lineNumber: validated.startLineNumber, column: validated.startColumn })).toBe(range.start);
      expect(f.instance.getOffsetAt({ lineNumber: validated.endLineNumber, column: validated.endColumn })).toBe(range.end);
      expect(f.instance.getValueInRange(validated)).toBe(range.sql); expect(source.slice(range.start, range.end)).toBe(range.sql);
      expect(sqlStatementRanges(source, { noBackslashEscapes: false, ansiQuotes: false })).toContainEqual(range);
    } finally { f.dispose(); }
  });
});
