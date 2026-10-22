import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../integration/query-partial-outcome.test.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('query-partial-outcome.test.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const assertion = tree.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === 'assertPartialFailureSourceRange');
if (!assertion) throw Error('缺少原实库验收sourceRange断言');
const context = createContext({ expect });
// 只提取验收断言原文，绝不导入integration或触发vi.mock/凭据/Engine/网络。
runInContext(ts.transpileModule(assertion.getText(tree) + '\nglobalThis.verify=assertPartialFailureSourceRange;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
const verify = context.verify as (outcome: unknown, input: string, start: number, failed: string) => void;
const outcome = (start: number, end: number) => ({ failure: { statementOrdinal: 2, statementsCompleted: 1, message: 'RAM首错', sourceRange: { start, end } } });

describe('实库失败范围验收断言的RAM边界', () => {
  it('明确UTF16半开范围及模板slice必须同时匹配，不接受缺失或多余分隔符', () => {
    const input = 'SELECT 1;\nSELECT missing;\nSELECT tail', failed = 'SELECT missing', start = 10;
    verify(outcome(start, start + failed.length), input, start, failed);
    expect(() => verify({ failure: { statementOrdinal: 2, statementsCompleted: 1 } }, input, start, failed)).toThrow();
    expect(() => verify(outcome(start, start + failed.length + 1), input, start, failed)).toThrow();
    expect(() => verify(outcome(start - 2, start + failed.length), input, start, failed)).toThrow();
  });
  it('重复SQL必须是指定失败那一处，不能用indexOf首个同文本替代', () => {
    const failed = 'SELECT missing', input = failed + ';\n' + failed + ';\nSELECT tail', second = failed.length + 2;
    verify(outcome(second, second + failed.length), input, second, failed);
    expect(() => verify(outcome(0, failed.length), input, second, failed)).toThrow();
  });
  it('emoji前序与CRLF按UTF16保留，字节索引和归一化换行坐标都拒绝', () => {
    const input = "SELECT '😀';\r\nSELECT missing;\r\nSELECT tail", failed = 'SELECT missing', start = 14;
    expect(input.slice(start, start + failed.length)).toBe(failed); verify(outcome(start, start + failed.length), input, start, failed);
    expect(() => verify(outcome(start + 2, start + 2 + failed.length), input, start, failed)).toThrow();
    expect(() => verify(outcome(start - 1, start - 1 + failed.length), input, start, failed)).toThrow();
  });
  it('参数定位保留原模板，不接受展开后CONVERT字面量的坐标或正文', () => {
    const first = 'SELECT :secret AS value', failed = 'INSERT INTO own_table VALUES(:secret)', input = first + ';\n' + failed + ';\nSELECT tail', start = first.length + 2;
    verify(outcome(start, start + failed.length), input, start, failed);
    const expandedStart = "SELECT CONVERT(X'616263646566' USING utf8mb4) AS value".length + 2;
    expect(() => verify(outcome(expandedStart, expandedStart + failed.length), input, start, failed)).toThrow();
    expect(() => verify(outcome(start, start + failed.length), input, start, "INSERT INTO own_table VALUES(CONVERT(X'616263' USING utf8mb4))")).toThrow();
  });
  it('DELIMITER指令和终结符不属于失败语句范围，不能扩大到控制行', () => {
    const input = 'DELIMITER $$\r\nCALL own_proc()$$\r\nDELIMITER ;', failed = 'CALL own_proc()', start = 14;
    expect(input.slice(start, start + failed.length)).toBe(failed); verify(outcome(start, start + failed.length), input, start, failed);
    expect(() => verify(outcome(0, start + failed.length), input, start, failed)).toThrow();
    expect(() => verify(outcome(start, start + failed.length + 2), input, start, failed)).toThrow();
  });
  it('即使数值范围符合期望，原模板slice不同也不放行', () => {
    expect(() => verify(outcome(0, 6), 'WRONG!', 0, 'SELECT')).toThrow();
  });
  it('原实库五类已存在case均独立断言，不新增SQL/连接或放宽原授权', () => {
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(tree) === 'assertPartialFailureSourceRange') calls.push(node); ts.forEachChild(node, visit); }; visit(tree);
    expect(calls).toHaveLength(5);
    expect(calls.map(call => call.arguments[0].getText(tree))).toEqual(['prefix.outcome', 'auto.outcome', 'transaction.outcome', 'parameter.outcome', 'call.outcome']);
    expect(source).toContain("if (!queryPartialEnabled(process.argv, process.env)) { context.skip(); return; }");
    expect(source).toContain('assertQueryPartialClosed(facts)'); expect(source).toContain("await sql('DROP DATABASE ' + db)");
  });
});
