import { expect, it, vi } from 'vitest';
import type { editor } from 'monaco-editor';
import { analyzeStatementNavigation, type StatementNavigationResult } from '../../src/shared/statementNavigation';
import { sqlStatementFoldingProvider, statementFoldingRanges } from '../../src/renderer/sqlStatementFolding';

/** 用原 UTF-16 偏移模拟 Monaco 模型，仅替换界面与线程端口。 */
function model(source: string) {
  const lines = source.split('\r\n');
  let version = 1;
  return {
    port: {
      getValue: () => source, getValueLength: () => source.length, getLineCount: () => lines.length,
      getVersionId: () => version, isDisposed: () => false,
      getPositionAt: (offset: number) => {
        const before = source.slice(0, offset).split('\r\n');
        return { lineNumber: before.length, column: before.at(-1)!.length + 1 };
      },
      getLineContent: (line: number) => lines[line - 1],
    } as editor.ITextModel,
    change: () => { version++; },
  };
}

it('按完整多行语句折叠，保留同行的后续语句及分隔符指令', () => {
  const source = "DELIMITER $$\r\nCREATE PROCEDURE p() BEGIN\r\nSELECT '😀;';\r\nEND$$\r\nDELIMITER ;\r\nSELECT\r\n1\r\n; SELECT 2;";
  const result = analyzeStatementNavigation(source, 'mysql');
  if (result.status !== 'ready') throw Error('测试脚本不能分段');
  expect(statementFoldingRanges(model(source).port, result.statements)).toEqual([{ start: 2, end: 4 }, { start: 6, end: 7 }]);
});

it('精确模型可复用同版本范围，变更期间的回包不能成为折叠范围', async () => {
  const source = 'SELECT\r\n1;';
  const fixture = model(source);
  let finish!: (value: StatementNavigationResult) => void;
  const result = analyzeStatementNavigation(source, 'sqlite');
  const analyze = vi.fn().mockImplementationOnce(() => new Promise<StatementNavigationResult>(resolve => { finish = resolve; })).mockResolvedValue(result);
  const provider = sqlStatementFoldingProvider({ getModel: () => fixture.port }, 'sqlite', { analyze }, () => true);
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  expect(await provider.provideFoldingRanges(model(source).port, {}, token)).toBeUndefined();
  const old = provider.provideFoldingRanges(fixture.port, {}, token);
  fixture.change();
  finish(result);
  expect(await old).toBeUndefined();
  expect(await provider.provideFoldingRanges(fixture.port, {}, token)).toEqual([{ start: 1, end: 2 }]);
  expect(await provider.provideFoldingRanges(fixture.port, {}, token)).toEqual([{ start: 1, end: 2 }]);
  expect(analyze).toHaveBeenCalledTimes(2);
});
