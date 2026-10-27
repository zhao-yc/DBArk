import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { validateCommand, commandSchemas } from '../../src/shared/validation';
import { queryWarningsLimits, queryWarningsReportSchema, type QueryWarningsReport } from '../../src/shared/queryWarnings';
import type { CommandMap } from '../../src/shared/contracts';

const base = { sessionId: '原查询会话', taskId: '本次任务', sql: 'SELECT 1', maxRows: 100 };
const condition = { level: 'Warning', code: 1265, message: '值已截断' };
const report: QueryWarningsReport = { collection: 'explicit', statements: [{ statementOrdinal: 1, sourceRange: { start: 0, end: 8 }, status: 'completed', warningCount: 1, conditions: [condition], truncated: false }], omittedStatements: 0, truncated: false };

/** 只提取真实Main准入函数，验证解析快照；不模拟Electron、数据库或后续broker执行。 */
function mainValidation(): (command: string, input: unknown) => unknown {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const target = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'validateMainCommand');
  if (!target) throw Error('未找到正式Main准入函数');
  const context = createContext({ validateCommand, rendererSettingsCurrent: true });
  runInContext(ts.transpileModule(target.getText(tree) + '\nglobalThis.parseMain=validateMainCommand;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.parseMain as (command: string, input: unknown) => unknown;
}

describe('显式警告采集仅扩展普通和类型参数查询输入', () => {
  it.each(['query.execute', 'query.executeParameterized'] as const)('%s保持旧输入形状，true/false只接受真正boolean', command => {
    const input = command === 'query.executeParameterized' ? { ...base, parameters: [] } : base;
    expect(commandSchemas[command].parse(input)).toEqual(input);
    expect(commandSchemas[command].parse({ ...input, collectWarnings: false })).toEqual({ ...input, collectWarnings: false });
    expect(commandSchemas[command].parse({ ...input, collectWarnings: true })).toEqual({ ...input, collectWarnings: true });
    expect(commandSchemas[command].parse({ ...input, collectWarnings: true, continueOnError: true })).toMatchObject({ collectWarnings: true, continueOnError: true });
    for (const value of [0, 1, 'true', 'false', 'ON', 'OFF', null, [], {}, 1n]) expect(commandSchemas[command].safeParse({ ...input, collectWarnings: value }).success).toBe(false);
    for (const extra of [{ warningSql: 'SHOW WARNINGS' }, { warnings: report }, { warningLimit: 1000 }, { warningSessionId: '另一个会话' }, { format: 'warnings' }]) expect(commandSchemas[command].safeParse({ ...input, ...extra }).success).toBe(false);
  });
  it('当前语句可开启采集，不能把警告标志扩展到执行计划、实际分析或流式导出', () => {
    expect(commandSchemas['query.execute'].safeParse({ ...base, currentStatement: { offset: 2 }, collectWarnings: true }).success).toBe(true);
    const variants = [
      ['query.explain', base],
      ['query.analyze', { ...base, acknowledged: true, expectedDatabase: null }],
      ['query.exportStream', { sessionId: base.sessionId, taskId: base.taskId, sql: base.sql, fileToken: '导出能力', format: 'json', encoding: 'utf8', protocol: 'text-strict', resultSelection: { kind: 'all' } }],
    ] as const;
    for (const [command, input] of variants) {
      expect(commandSchemas[command].safeParse(input).success).toBe(true);
      expect(commandSchemas[command].safeParse({ ...input, collectWarnings: true }).success).toBe(false);
    }
    expect(commandSchemas['query.parameterNames'].safeParse({ sessionId: base.sessionId, sql: base.sql, collectWarnings: true }).success).toBe(false);
  });
  it('正式Main准入独立复制输入，原payload迟到修改不能改变已捕获选项或参数', () => {
    const parse = mainValidation();
    const source: CommandMap['query.executeParameterized']['input'] = { ...base, collectWarnings: true, continueOnError: true, parameters: [{ name: 'v', type: 'text', value: '初始参数' }] };
    const admitted = parse('query.executeParameterized', source) as typeof source;
    source.collectWarnings = false; source.continueOnError = false; source.sql = 'DELETE FROM other'; source.parameters[0].value = '迟到参数';
    expect(admitted).toMatchObject({ collectWarnings: true, continueOnError: true, sql: base.sql, parameters: [{ name: 'v', type: 'text', value: '初始参数' }] });
    const old = parse('query.execute', base); expect(old).toEqual(base); expect(old).not.toHaveProperty('collectWarnings');
  });
});

describe('警告报告严格有界且不把未知数量补零', () => {
  it('冻结限额为每语句100条件、200语句组及512KiB整报告', () => {
    expect(Object.isFrozen(queryWarningsLimits)).toBe(true);
    expect(queryWarningsLimits).toEqual({ statements: 200, conditions: 100, messageBytes: 4096, totalBytes: 512 * 1024 });
    expect(queryWarningsReportSchema.parse(report)).toEqual(report);
  });
  it('失败原语句、空原文、隐藏参数消息和部分采集不可用分别保留', () => {
    const unknown = { ...report, statements: [{ statementOrdinal: 3, status: 'failed', conditions: [], truncated: false, unavailable: '原诊断暂不可用' }] };
    const parsed = queryWarningsReportSchema.parse(unknown); expect(parsed.statements[0]).not.toHaveProperty('warningCount'); expect(parsed.statements[0].status).toBe('failed');
    const hidden = { ...report, statements: [{ ...report.statements[0], conditions: [{ level: 'Warning', code: 1265, messageHidden: true }] }] };
    expect(queryWarningsReportSchema.parse(hidden).statements[0].conditions[0]).not.toHaveProperty('message');
    expect(queryWarningsReportSchema.parse({ ...report, statements: [{ ...report.statements[0], conditions: [{ ...condition, message: '' }] }] }).statements[0].conditions[0].message).toBe('');
    expect(queryWarningsReportSchema.safeParse({ ...report, statements: [{ ...report.statements[0], truncated: true, unavailable: '仅保留前序条件' }] }).success).toBe(true);
    expect(queryWarningsReportSchema.safeParse({ collection: 'explicit', statements: [], omittedStatements: 15, truncated: true }).success).toBe(true);
  });
  it.each([
    { messageHidden: true }, { messageHidden: true, message: '' }, { messageHidden: true, messageTruncated: true },
    { messageHidden: false }, { messageTruncated: false }, { code: -1 }, { code: 1.5 }, { code: 65536 }, { code: '1265' },
    { level: '' }, { level: 'a'.repeat(33) }, { sql: 'expanded secret' }, { message: 'a'.repeat(4097) }, { message: '汉'.repeat(1366) },
  ])('第%#项隐藏标志、代码或消息预算错误必须拒绝', patch => {
    expect(queryWarningsReportSchema.safeParse({ ...report, statements: [{ ...report.statements[0], conditions: [{ ...condition, ...patch }] }] }).success).toBe(false);
  });
  it('截断标志需要有界消息，不能出现无原文的截断条件', () => {
    expect(queryWarningsReportSchema.safeParse({ ...report, statements: [{ ...report.statements[0], conditions: [{ level: 'Warning', code: 1265, messageTruncated: true }] }] }).success).toBe(false);
    expect(queryWarningsReportSchema.safeParse({ ...report, statements: [{ ...report.statements[0], conditions: [{ ...condition, messageTruncated: true }] }] }).success).toBe(true);
  });
  it.each([
    { statementOrdinal: 0 }, { statementOrdinal: 1.5 }, { status: 'success' }, { warningCount: -1 }, { warningCount: '1' },
    { warningCount: null }, { truncated: 1 }, { unavailable: '' }, { unavailable: '汉'.repeat(1366) },
    { sourceRange: { start: 5, end: 4 } }, { sourceRange: { start: 0, end: 1, sql: '不保存' } }, { sql: '不保存原SQL' },
  ])('第%#项语句组的未知字段或非规范值拒绝', patch => {
    expect(queryWarningsReportSchema.safeParse({ ...report, statements: [{ ...report.statements[0], ...patch }] }).success).toBe(false);
  });
  it('语句序号允许采集遗漏造成间隔，但不能倒退或重复', () => {
    const statements = [1, 3, 7].map(statementOrdinal => ({ ...report.statements[0], statementOrdinal }));
    expect(queryWarningsReportSchema.safeParse({ ...report, statements, omittedStatements: 4, truncated: true }).success).toBe(true);
    expect(queryWarningsReportSchema.safeParse({ ...report, statements: [...statements].reverse() }).success).toBe(false);
    expect(queryWarningsReportSchema.safeParse({ ...report, statements: [statements[0], statements[0]] }).success).toBe(false);
  });
  it('200组和每组100条件是独立上限，整报告超512KiB或转义膨胀仍拒绝', () => {
    const groups = Array.from({ length: 200 }, (_, index) => ({ ...report.statements[0], statementOrdinal: index + 1, conditions: [] }));
    expect(queryWarningsReportSchema.safeParse({ ...report, statements: groups }).success).toBe(true);
    expect(queryWarningsReportSchema.safeParse({ ...report, statements: [...groups, { ...groups[0], statementOrdinal: 201 }] }).success).toBe(false);
    expect(queryWarningsReportSchema.safeParse({ ...report, statements: [{ ...report.statements[0], conditions: Array(100).fill(condition) }] }).success).toBe(true);
    expect(queryWarningsReportSchema.safeParse({ ...report, statements: [{ ...report.statements[0], conditions: Array(101).fill(condition) }] }).success).toBe(false);
    for (const message of ['a'.repeat(4096), '\0'.repeat(4096)]) {
      const oversized = { ...report, statements: [1, 2].map(statementOrdinal => ({ ...report.statements[0], statementOrdinal, conditions: Array.from({ length: 100 }, () => ({ ...condition, message })) })) };
      expect(new TextEncoder().encode(message).byteLength).toBe(4096);
      expect(queryWarningsReportSchema.safeParse(oversized).success).toBe(false);
    }
  });
  it.each([{ collection: 'automatic' }, { omittedStatements: -1 }, { omittedStatements: 1.5 }, { truncated: 'true' }, { sql: '不保存' }, { sessionId: '不保存' }, { parameters: [] }])('第%#项报告外层字段错误拒绝', patch => {
    expect(queryWarningsReportSchema.safeParse({ ...report, ...patch }).success).toBe(false);
  });
});
