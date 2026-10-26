import { describe, expect, it } from 'vitest';
import {
  canContinueQueryError, formatQueryScriptError, queryContinueOnErrorLimits, queryScriptReportSchema,
  queryScriptReportSummary, truncateQueryScriptMessage, type QueryScriptReport,
} from '../../src/shared/queryContinueOnError';

/** 合成mysql2服务器ERR形状只校分类合同，真实来源仍由Engine原驱动围栏证明。 */
function serverError(patch: Record<string, unknown> = {}): Error {
  return Object.assign(new Error('服务器失败详情'), { errno: 1064, sqlState: '42000', code: 'ER_PARSE_ERROR' }, patch);
}
const report: QueryScriptReport = {
  mode: 'continue-on-error', statementsAttempted: 4, statementsCompleted: 2, reachedEnd: true,
  errors: [
    { kind: 'server', statementOrdinal: 2, statementsCompleted: 1, message: '第2条失败', sourceRange: { start: 10, end: 20 } },
    { kind: 'server', statementOrdinal: 4, statementsCompleted: 2, message: '第4条失败' },
  ],
};
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

describe('续执行只接受明确的非致命服务器ERR', () => {
  it.each([
    {}, { errno: 1062, sqlState: '23000', code: 'ER_DUP_ENTRY' },
    { errno: 1146, sqlState: '42S02', code: 'ER_NO_SUCH_TABLE' },
    { errno: 1142, sqlState: '42000', code: 'ER_TABLEACCESS_DENIED_ERROR', fatal: false },
    { errno: 1213, sqlState: '40001', code: 'ER_LOCK_DEADLOCK' },
  ])('规范服务器错误第%#项允许进入Engine的后续恢复门', patch => {
    expect(canContinueQueryError(serverError(patch))).toBe(true);
  });
  it.each([
    { errno: '1064' }, { errno: 0 }, { errno: -1 }, { errno: 1.5 }, { errno: NaN }, { errno: Infinity }, { errno: 65536 }, { errno: 1064n },
    { sqlState: '42s02' }, { sqlState: '4200' }, { sqlState: '420000' }, { sqlState: ' 42000' }, { sqlState: '00000' }, { sqlState: 42000 },
    { code: 'ECONNRESET' }, { code: 'CR_SERVER_LOST' }, { code: 'er_parse_error' }, { code: 'ER_' }, { code: 'ER_PARSE_ERROR;SELECT' }, { code: 'ER_' + 'A'.repeat(94) },
    { fatal: true }, { fatal: 1 }, { fatal: 'false' }, { fatal: null },
  ])('非规范或本地错误第%#项不做宽松转换', patch => {
    expect(canContinueQueryError(serverError(patch))).toBe(false);
  });
  it.each([1040, 1053, 1077, 1079, 1080, 1129, 1130, 1152, 1153, 1154, 1155, 1156, 1157, 1158, 1159, 1160, 1161, 1184, 1317, 1927, 1969, 2006, 2013, 2014, 2027, 2055, 3024, 4031])('中断、超时或连接errno %s必须停止', errno => {
    expect(canContinueQueryError(serverError({ errno }))).toBe(false);
  });
  it.each(['08000', '08001', '08S01', '70100'])('连接或中断SQLSTATE %s必须停止', sqlState => {
    expect(canContinueQueryError(serverError({ sqlState }))).toBe(false);
  });
  it.each(['ER_QUERY_INTERRUPTED', 'ER_CONNECTION_KILLED', 'ER_QUERY_TIMEOUT', 'ER_STATEMENT_TIMEOUT', 'ER_CLIENT_INTERACTION_TIMEOUT', 'ER_SERVER_SHUTDOWN', 'ER_NET_READ_ERROR', 'ER_NET_PACKET_TOO_LARGE', 'ER_ABORTING_CONNECTION', 'ER_NEW_ABORTING_CONNECTION', 'ER_FORCING_CLOSE'])('服务器错误码%s不能借不同errno绕过停止', code => {
    expect(canContinueQueryError(serverError({ code }))).toBe(false);
  });
  it('网络、本地解析或预算错误以及普通对象不能假冒服务器ERR', () => {
    for (const error of [new Error('脚本解析失败'), Object.assign(new Error('结果预算已耗尽'), { code: 'RESULT_BUDGET' }), Object.assign(new Error('网络连接断开'), { code: 'ECONNRESET' }), { errno: 1064, sqlState: '42000', code: 'ER_PARSE_ERROR' }, null, undefined, '1064', 1064]) {
      expect(canContinueQueryError(error)).toBe(false);
    }
    for (const key of ['errno', 'sqlState', 'code']) {
      const error = serverError(); Reflect.deleteProperty(error, key);
      expect(canContinueQueryError(error)).toBe(false);
    }
  });
  it('拒绝访问器和继承错误码，不执行其getter或字符串化', () => {
    let reads = 0;
    for (const key of ['errno', 'sqlState', 'code', 'fatal']) {
      const error = serverError(); Object.defineProperty(error, key, { get() { reads++; throw Error('不应读取'); } });
      expect(canContinueQueryError(error)).toBe(false);
    }
    const error = serverError(); Reflect.deleteProperty(error, 'code'); Object.setPrototypeOf(error, Object.assign(Object.create(Error.prototype), { code: 'ER_PARSE_ERROR' }));
    expect(canContinueQueryError(error)).toBe(false); expect(reads).toBe(0);
  });
});

describe('错误摘要和有类型参数脱敏', () => {
  it('参数化错误只保留规范code，原message/sqlMessage/sql绝不进入报告', () => {
    const error = serverError({ sqlMessage: '重复参数 TOP_SECRET_EXPANDED', sql: "INSERT INTO t VALUES('TOP_SECRET_EXPANDED')" });
    error.message = '参数值 TOP_SECRET_EXPANDED 无效';
    const safe = formatQueryScriptError(error, true);
    expect(safe).toContain('ER_PARSE_ERROR'); expect(safe).toContain('详情已隐藏');
    for (const literal of ['TOP_SECRET_EXPANDED', 'INSERT INTO', '1064', '42000']) expect(safe).not.toContain(literal);
    expect(formatQueryScriptError(Object.assign(new Error('TOP_SECRET_EXPANDED'), { code: 'INVALID PARAM TOP_SECRET_EXPANDED' }), true)).not.toContain('TOP_SECRET_EXPANDED');
    expect(formatQueryScriptError('TOP_SECRET_EXPANDED', true)).not.toContain('TOP_SECRET_EXPANDED');
  });
  it('普通脚本保留有界原错误，不借用“首错停止”的旧文案', () => {
    const text = formatQueryScriptError(serverError()); expect(text).toContain('ER_PARSE_ERROR'); expect(text).toContain('服务器失败详情');
    expect(text).not.toContain('首错'); expect(text).not.toContain('此前已提交语句保留');
    expect(formatQueryScriptError('本地解析失败')).toContain('本地解析失败');
    expect(formatQueryScriptError(null)).toContain('未取得可展示的错误详情');
  });
  it('格式化未知对象不调用getter或toString，参数模式连message都不读取', () => {
    let reads = 0;
    const error = new Error();
    Object.defineProperty(error, 'message', { get() { reads++; throw Error('隐藏'); } });
    expect(formatQueryScriptError(error, true)).toContain('详情已隐藏');
    expect(formatQueryScriptError(error)).toContain('未取得可展示的错误详情');
    expect(formatQueryScriptError({ toString() { reads++; return '敏感'; } })).not.toContain('敏感');
    expect(reads).toBe(0);
  });
  it.each(['a'.repeat(20000), '汉'.repeat(10000), '😀'.repeat(10000), '\0'.repeat(10000), '\n'.repeat(10000), '\\"'.repeat(10000)])('第%#项原文与JSON转义同时有界，且不拆代理对', source => {
    const output = truncateQueryScriptMessage(source);
    expect(output.length).toBeLessThanOrEqual(4096); expect(bytes(output)).toBeLessThanOrEqual(4096); expect(bytes(JSON.stringify(output)) - 2).toBeLessThanOrEqual(4096);
    expect(source.startsWith(output)).toBe(true); expect(/[\uD800-\uDBFF]$/u.test(output)).toBe(false);
    const formatted = formatQueryScriptError(new Error(source)); expect(formatted.length).toBeLessThanOrEqual(4096); expect(bytes(formatted)).toBeLessThanOrEqual(4096);
  });
  it('小预算边界、空串和混合代理对不越界，非法预算明确拒绝', () => {
    expect(truncateQueryScriptMessage('😀a', 1, 4)).toBe(''); expect(truncateQueryScriptMessage('😀a', 2, 4)).toBe('😀');
    expect(truncateQueryScriptMessage('😀a', 3, 5)).toBe('😀a'); expect(truncateQueryScriptMessage('', 0, 0)).toBe('');
    expect(truncateQueryScriptMessage('\0a', 2, 6)).toBe('\0');
    for (const budget of [-1, 1.5, NaN, Infinity, 4097]) {
      expect(() => truncateQueryScriptMessage('x', budget)).toThrow(); expect(() => truncateQueryScriptMessage('x', 4096, budget)).toThrow();
    }
  });
});

describe('续执行报告严格有界且不伪报到达末尾', () => {
  it('保留每条服务器失败的真实序号、成功计数和原范围，原QueryFailure字段不改名', () => {
    const parsed = queryScriptReportSchema.parse(report); expect(parsed).toEqual(report); expect(parsed.errors).not.toBe(report.errors);
    const summary = queryScriptReportSummary(parsed); expect(summary).toContain('已尝试处理4条'); expect(summary).toContain('完成2条'); expect(summary).toContain('已到脚本末尾');
    expect(summary).toContain('完成不代表事务已提交'); expect(summary).not.toContain('首错停止'); expect(summary).not.toContain('脚本提前停止');
  });
  it('没有失败的空脚本和完整成功脚本都能表达，不能因此虚构事务提交', () => {
    for (const statementsCompleted of [0, 5]) expect(queryScriptReportSchema.parse({ mode: 'continue-on-error', statementsAttempted: statementsCompleted, statementsCompleted, reachedEnd: true, errors: [] })).toMatchObject({ reachedEnd: true, errors: [] });
  });
  it('模式恢复失败或达到错误上限可保留末条server，加stopReason提前停止而非伪造另一失败', () => {
    const stopped = { ...report, reachedEnd: false, stopReason: '无法恢复原会话SQL模式，已停止' };
    expect(queryScriptReportSchema.parse(stopped)).toEqual(stopped); expect(queryScriptReportSummary(stopped)).toContain('脚本提前停止');
    const errors = Array.from({ length: 100 }, (_, index) => ({ kind: 'server' as const, statementOrdinal: index + 1, statementsCompleted: 0, message: formatQueryScriptError(new Error('\0'.repeat(10000))) }));
    const full = { mode: 'continue-on-error' as const, statementsAttempted: 100, statementsCompleted: 0, reachedEnd: false, errors, stopReason: '已达100项错误上限' };
    expect(queryScriptReportSchema.safeParse(full).success).toBe(true); expect(bytes(JSON.stringify(full))).toBeLessThan(queryContinueOnErrorLimits.totalBytes);
  });
  it('投递前本地停止可记录下一条序号，但不能宣称其已完成或已经物理发送', () => {
    const stopped = { ...report, reachedEnd: false, stopReason: '尾部解析失败', errors: [...report.errors, { kind: 'stopped', statementOrdinal: 5, statementsCompleted: 2, message: '尾部解析失败' }] };
    expect(queryScriptReportSchema.safeParse(stopped).success).toBe(true);
    expect(queryScriptReportSummary(stopped as QueryScriptReport)).not.toContain('已发送');
  });
  it.each([
    { mode: 'stop-on-error' }, { statementsAttempted: -1 }, { statementsCompleted: 5 }, { statementsAttempted: 1.5 },
    { reachedEnd: 'true' }, { reachedEnd: false }, { stopReason: '已停止' }, { sql: 'SELECT secret' }, { parameters: ['secret'] },
  ])('第%#项计数、状态或未知字段错误必须拒绝', patch => {
    expect(queryScriptReportSchema.safeParse({ ...report, ...patch }).success).toBe(false);
  });
  it.each([
    { statementOrdinal: 0 }, { statementOrdinal: 5 }, { statementOrdinal: '2' }, { statementsCompleted: 2 },
    { statementsCompleted: -1 }, { kind: 'network' }, { message: '' }, { message: 'a'.repeat(4097) }, { message: '汉'.repeat(1366) },
    { sql: 'SELECT secret' }, { errno: 1064 }, { sourceRange: { start: 5, end: 4 } }, { sourceRange: { start: -1, end: 2 } }, { sourceRange: { start: 0, end: 1, sql: 'secret' } },
  ])('第%#项失败记录不规范、越界或带私密字段必须拒绝', patch => {
    expect(queryScriptReportSchema.safeParse({ ...report, errors: [{ ...report.errors[0], ...patch }] }).success).toBe(false);
  });
  it('失败序号必须递增、成功计数不得倒退，stopped只能位于最终停止记录', () => {
    expect(queryScriptReportSchema.safeParse({ ...report, errors: [...report.errors].reverse() }).success).toBe(false);
    expect(queryScriptReportSchema.safeParse({ ...report, errors: [report.errors[0], report.errors[0]] }).success).toBe(false);
    expect(queryScriptReportSchema.safeParse({ ...report, errors: [report.errors[0], { ...report.errors[1], statementsCompleted: 0 }] }).success).toBe(false);
    expect(queryScriptReportSchema.safeParse({ ...report, reachedEnd: false, stopReason: '停止', errors: [{ ...report.errors[0], kind: 'stopped' }, report.errors[1]] }).success).toBe(false);
    expect(queryScriptReportSchema.safeParse({ ...report, errors: [{ ...report.errors[0], kind: 'stopped' }] }).success).toBe(false);
    expect(queryScriptReportSchema.safeParse({ ...report, errors: Array.from({ length: 101 }, (_, index) => ({ ...report.errors[0], statementOrdinal: index + 2 })), statementsAttempted: 102 }).success).toBe(false);
  });
  it('最终按完整JSON而非原文长度核512KiB，防止转义后预算膨胀', () => {
    const errors = Array.from({ length: 100 }, (_, index) => ({ kind: 'server', statementOrdinal: index + 1, statementsCompleted: 0, message: '\0'.repeat(4096) }));
    const oversized = { mode: 'continue-on-error', statementsAttempted: 100, statementsCompleted: 0, reachedEnd: false, errors, stopReason: '停止' };
    expect(bytes(errors[0].message)).toBe(4096); expect(bytes(JSON.stringify(oversized))).toBeGreaterThan(queryContinueOnErrorLimits.totalBytes);
    expect(queryScriptReportSchema.safeParse(oversized).success).toBe(false);
  });
});
