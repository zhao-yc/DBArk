import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresEngine } from '../../src/engine/postgres/engine';
import { PostgresConnection } from '../../src/engine/postgres/connection';
import { DatabaseError } from 'pg';
import type { QueryOutcome, TaskEvent } from '../../src/shared/contracts';
import type { QueryParameter } from '../../src/shared/queryParameters';
import { queryScriptReportSchema } from '../../src/shared/queryContinueOnError';
import { canContinuePostgresQueryError } from '../../src/engine/postgres/queryContinue';
import { postgresNoticeReportSchema } from '../../src/shared/postgresNotices';

let engine: PostgresEngine, sent: string[], events: TaskEvent[], next: number;
type Notice = (value: unknown, redact: (value: string) => string) => void;
let scenario: (sql: string, values?: unknown[], notice?: Notice) => Promise<unknown>;
let managed: PostgresConnection, session: {id: string; connectionId: string; managed: PostgresConnection; completion?: Promise<any>};
const ok = (statement: string) => ({columns: [], rows: [], statement, postgresCommand: 'SELECT', elapsedMs: 1});

beforeEach(() => {
  sent = []; events = []; next = 0; scenario = async () => { throw Error('预期失败'); };
  // 仅替换物理连接，实际驱动分发、逐句扫描、终态和 sourceRange 均由产品引擎产生。
  managed = {broken: false, standardStrings: true, database: 'db', close: vi.fn(async () => {}),
    state: () => ({transactionOpen: false, transactionKnown: true, broken: false}),
    error: (reason: unknown) => reason instanceof Error ? reason : Error('未知错误'),
    query: async (sql: string, values?: unknown[], _budget?: unknown, _rows?: unknown, _protocol?: unknown, notice?: Notice) => { sent.push(sql); return scenario(sql, values, notice); },
  } as unknown as PostgresConnection;
  engine = new PostgresEngine(event => events.push(event));
  session = {id: 's', connectionId: 'c', managed};
  (engine as unknown as {sessions: Map<string, typeof session>}).sessions.set('s', session);
});
afterEach(async () => { await engine.closeAll(); });
function execute(sql: string, options: {parameters?: QueryParameter[]; currentStatement?: {offset: number}; continueOnError?: boolean} = {}): Promise<QueryOutcome> {
  return engine.handle(options.parameters ? 'query.executeParameterized' : 'query.execute', {sessionId: 's', taskId: 'range-' + ++next, sql, maxRows: 100, ...options});
}

describe('PostgreSQL 失败范围沿用实际执行的原文偏移', () => {
  it('真实连接错误重复脱敏保持 SQLSTATE，不泄露密码或读取状态访问器', () => {
    const connection = new PostgresConnection({id: 'c', name: '仅错误转换', group: '', color: '', dialect: 'postgresql',
      host: 'invalid', port: 1, user: 'unit', password: '受保护密码'});
    const reason = Object.assign(new DatabaseError('不能转换受保护密码', 0, 'error'), {severity: 'ERROR', code: '22P02'});
    const first = connection.error(reason), second = connection.error(first);
    expect(first).toHaveProperty('postgresSqlState', '22P02'); expect(second).toHaveProperty('postgresSqlState', '22P02');
    expect(second.message).not.toContain('受保护密码');
    const getter = vi.fn(() => '22P02'), unknown = Error('未知状态'); Object.defineProperty(unknown, 'postgresSqlState', {get: getter});
    expect(connection.error(unknown)).not.toHaveProperty('postgresSqlState'); expect(getter).not.toHaveBeenCalled();
  });
  it('重复语句失败只定位第二份原文，前置 CRLF 和 emoji 按 UTF16 保留', async () => {
    const sql = "/* 😀 */ SELECT same;\r\n/* 😀 */ SELECT same;\r\nSELECT tail;";
    scenario = async statement => { if (sent.length === 2) throw Error('失败'); return ok(statement); };
    const output = await execute(sql), start = sql.lastIndexOf('SELECT same'), end = sql.indexOf(';', start);
    expect(output.failure).toMatchObject({statementOrdinal: 2, statementsCompleted: 1, sourceRange: {start, end}});
    expect(sql.slice(start, end)).toBe('SELECT same'); expect(sent[1]).toBe('\r\n/* 😀 */ SELECT same');
    expect(sent).toHaveLength(2); expect(output.results).toHaveLength(1);
    expect(events.at(-1)?.status).toBe('failed');
  });
  it('当前语句的范围相对完整脚本，非首句不增加前句偏移两次', async () => {
    const sql = "SELECT '🧭';\r\nSELECT missing;\r\nSELECT tail;", start = sql.indexOf('SELECT missing'), end = sql.indexOf(';', start);
    const output = await execute(sql, {currentStatement: {offset: sql.indexOf('missing')}});
    expect(output.failure?.sourceRange).toEqual({start, end}); expect(sent).toEqual(['\r\n' + sql.slice(start, end)]);
  });
  it('选区载荷只给相对范围，保留嵌套注释和 dollar 正文中的分号', async () => {
    const sql = '/* 外 /* 内 */ */ SELECT $$🧭;$$;\r\nSELECT missing;';
    scenario = async statement => { if (sent.length === 2) throw Error('失败'); return ok(statement); };
    const output = await execute(sql), start = sql.indexOf('SELECT missing');
    expect(output.failure?.sourceRange).toEqual({start, end: sql.length - 1}); expect(sent).toHaveLength(2);
  });
  it('位置绑定失败范围仍是原模板，不按展开值长度计算', async () => {
    const sql = '  SELECT $1::int;';
    (managed as unknown as {error(reason: unknown): Error}).error = () => Object.assign(Error('不能转换不在模板的值😀'), {postgresSqlState: '22P02'});
    scenario = async (_statement, values) => { expect(values).toEqual(['不在模板的值😀']); throw Error('不能转换不在模板的值😀'); };
    const output = await execute(sql, {parameters: [{name: 'p1', type: 'text', value: '不在模板的值😀'}]});
    expect(output.failure?.sourceRange).toEqual({start: 2, end: sql.length - 1});
    expect(sent).toEqual([sql.slice(0, -1)]); expect(JSON.stringify(events)).not.toContain('不在模板的值');
    expect(JSON.stringify(output.failure)).not.toContain('不在模板的值'); expect(output.failure?.message).toContain('SQLSTATE 22P02');
  });
  it('参数校验或 COPY 拒绝可定位已扫描的语句，不发送拒绝内容或尾部', async () => {
    for (const sql of ['SELECT $2;', 'COPY subject TO STDOUT;']) {
      const output = await execute(sql, {parameters: []}); expect(output.failure?.sourceRange).toEqual({start: 0, end: sql.length - 1});
    }
    expect(sent).toEqual([]);
  });
  it('每句按实际字符串模式重新扫描，范围来自同一轮解析', async () => {
    const sql = String.raw`SET standard_conforming_strings=off; SELECT 'a\';b'; SELECT missing;`;
    scenario = async statement => {
      if (sent.length === 1) (managed as unknown as {standardStrings: boolean}).standardStrings = false;
      if (sent.length === 3) throw Error('失败'); return ok(statement);
    };
    const output = await execute(sql), start = sql.lastIndexOf('SELECT');
    expect(output.failure?.sourceRange).toEqual({start, end: sql.length - 1});
    expect(sent[1]).toBe(String.raw` SELECT 'a\';b'`);
  });
  it('前句成功后尾部未闭合不遗留前句范围；纯词法失败也不给猜测范围', async () => {
    scenario = async statement => ok(statement);
    for (const sql of ["SELECT 1; SELECT '未闭合", "SELECT '未闭合", 'SELECT 1; /* 未闭合']) {
      const output = await execute(sql); expect(output.failure).toBeDefined(); expect(output.failure).not.toHaveProperty('sourceRange');
    }
  });
  it('在目录等待期间取消，不发送用户 SQL 或公布范围', async () => {
    let finish!: () => void; session.completion = new Promise<void>(resolve => { finish = resolve; });
    const pending = execute('SELECT 1;'); await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));
    await engine.handle('query.cancel', {taskId: 'range-1'}); finish();
    expect((await pending).failure).not.toHaveProperty('sourceRange'); expect(sent).toEqual([]); expect(events.at(-1)?.status).toBe('cancelled');
  });
  it('完整成功没有失败范围字段，原 SQL 及完整结果保持', async () => {
    scenario = async statement => ok(statement); const output = await execute('SELECT 1;SELECT 2;');
    expect(output).not.toHaveProperty('failure'); expect(output.results.map(result => result.statement)).toEqual(['SELECT 1', 'SELECT 2']);
  });
});

const serverError = (code = '42703', message = '预期服务端错误') => Object.assign(Error(message), {postgresSqlState: code});
it('消息沿实际发送语句的范围，首错前收到的消息保留但不进入任务事件', async () => {
  const sql = 'SELECT 1;\r\n/* 前导😀 */ SELECT missing;\r\nSELECT tail;';
  scenario = async (statement, _values, notice) => {
    notice?.({severity: 'NOTICE', code: '00000', message: '只在结果内存显示'}, value => value);
    if (statement.includes('missing')) throw serverError();
    return ok(statement);
  };
  const result = await execute(sql), report = postgresNoticeReportSchema.parse(result.postgresNotices);
  expect(report.entries.map(entry => [entry.statementOrdinal, sql.slice(entry.sourceRange!.start, entry.sourceRange!.end)])).toEqual([[1, 'SELECT 1'], [2, 'SELECT missing']]);
  expect(result.results).toHaveLength(1); expect(result.failure?.statementOrdinal).toBe(2); expect(sent).toHaveLength(2);
  expect(JSON.stringify(events)).not.toContain('只在结果内存显示');
});
it('遇错继续按实际语句编号保留前后消息，参数回包隐藏消息内原值', async () => {
  scenario = async (statement, values, notice) => {
    notice?.({severity: 'NOTICE', code: '00000', message: values ? String(values[0]) : '原消息'}, value => value);
    if (statement.includes('missing')) throw serverError(); return ok(statement);
  };
  const output = await execute('SELECT missing; SELECT 2;', {continueOnError: true});
  expect(output.postgresNotices?.entries.map(item => item.statementOrdinal)).toEqual([1, 2]); expect(output.scriptReport?.reachedEnd).toBe(true);
  const bound = await execute('SELECT $1::text', {parameters: [{name: 'p1', type: 'text', value: '参数保密值'}]});
  expect(postgresNoticeReportSchema.parse(bound.postgresNotices).redacted).toBe(true); expect(JSON.stringify(bound)).not.toContain('参数保密值');
});
describe('PostgreSQL 显式遇错继续仍使用原协议事务', () => {
  it.each(['00000', '01000', '02000', '08006', '53300', '54000', '57014', '57P01', '58000', 'XX000'])('%s必须停止，不使用其它驱动的错误分类', code => {
    expect(canContinuePostgresQueryError(serverError(code), {broken: false, transactionKnown: true}, false)).toBe(false);
  });
  it('普通服务器错误允许继续，失败事务25P02也保留；取消或未知状态不准入', () => {
    for (const code of ['42703', '23505', '25P02', '40001', 'P0001']) expect(canContinuePostgresQueryError(serverError(code), {broken: false, transactionKnown: true}, false)).toBe(true);
    expect(canContinuePostgresQueryError(Error('本地错误'), {broken: false, transactionKnown: true}, false)).toBe(false);
    expect(canContinuePostgresQueryError(serverError(), {broken: false, transactionKnown: false}, false)).toBe(false);
    expect(canContinuePostgresQueryError(serverError(), {broken: true, transactionKnown: true}, false)).toBe(false);
    expect(canContinuePostgresQueryError(serverError(), {broken: false, transactionKnown: true}, true)).toBe(false);
    const getter = vi.fn(() => '42703'), error = Error('访问器'); Object.defineProperty(error, 'postgresSqlState', {get: getter});
    expect(canContinuePostgresQueryError(error, {broken: false, transactionKnown: true}, false)).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
  it('多处错误有原序号和范围，保留成功结果，终态及报告仍记失败', async () => {
    const sql = 'SELECT 1; SELECT missing; SELECT 2; SELECT other;';
    scenario = async statement => { if (/missing|other/.test(statement)) throw serverError(); return ok(statement); };
    const output = await execute(sql, {continueOnError: true}), report = queryScriptReportSchema.parse(output.scriptReport);
    expect(report).toMatchObject({statementsAttempted: 4, statementsCompleted: 2, reachedEnd: true});
    expect(report.errors.map(error => [error.statementOrdinal, error.statementsCompleted, error.kind])).toEqual([[2, 1, 'server'], [4, 2, 'server']]);
    expect(report.errors.map(error => sql.slice(error.sourceRange!.start, error.sourceRange!.end))).toEqual(['SELECT missing', 'SELECT other']);
    expect(output.results).toHaveLength(2); expect(sent).toHaveLength(4); expect(events.at(-1)?.status).toBe('failed'); expect(output.failure?.message).toContain('已到脚本末尾');
    expect(output.postgresResultSources?.map(item => [item.statementOrdinal, sql.slice(item.sourceRange.start, item.sourceRange.end)]))
      .toEqual([[1, 'SELECT 1'], [3, 'SELECT 2']]);
  });
  it('原事务失败后继续记录错误，仅脚本显式ROLLBACK才能恢复，不注入补偿SQL', async () => {
    const state = {transactionOpen: false, transactionKnown: true, transactionFailed: false, broken: false};
    managed.state = () => state;
    scenario = async statement => {
      if (statement === 'BEGIN') state.transactionOpen = true;
      else if (statement.trim() === 'ROLLBACK') { state.transactionOpen = false; state.transactionFailed = false; }
      else if (statement.includes('missing')) { state.transactionFailed = true; throw serverError(); }
      else if (state.transactionFailed) throw serverError('25P02');
      return ok(statement);
    };
    const sql = 'BEGIN; SELECT missing; SELECT 2; ROLLBACK; SELECT 3;';
    const output = await execute(sql, {continueOnError: true});
    expect(queryScriptReportSchema.parse(output.scriptReport)).toMatchObject({statementsAttempted: 5, statementsCompleted: 3, reachedEnd: true});
    expect(sent).toEqual(['BEGIN', ' SELECT missing', ' SELECT 2', ' ROLLBACK', ' SELECT 3']); expect(state.transactionOpen).toBe(false);
  });
  it('参数错误报告只保留SQLSTATE，不发布值或失败填写', async () => {
    scenario = async () => { throw serverError('22P02', '错误包含秘密参数😀'); };
    const output = await execute('SELECT $1::int', {continueOnError: true, parameters: [{name: 'p1', type: 'text', value: '秘密参数😀'}]});
    expect(queryScriptReportSchema.parse(output.scriptReport)).toMatchObject({statementsAttempted: 1, statementsCompleted: 0, reachedEnd: true});
    expect(output.scriptReport?.errors[0].message).toContain('22P02'); expect(JSON.stringify(output)).not.toContain('秘密参数'); expect(JSON.stringify(events)).not.toContain('秘密参数');
  });
  it('词法失败只加停止项，不沿用前一个错误范围', async () => {
    scenario = async () => { throw serverError(); };
    const output = await execute("SELECT missing; SELECT '未闭合", {continueOnError: true});
    const report = queryScriptReportSchema.parse(output.scriptReport);
    expect(report).toMatchObject({statementsAttempted: 1, statementsCompleted: 0, reachedEnd: false});
    expect(report.errors.map(error => error.kind)).toEqual(['server', 'stopped']); expect(report.errors[1]).not.toHaveProperty('sourceRange'); expect(sent).toHaveLength(1);
  });
  it('100项错误到限即停，不发送第101句', async () => {
    scenario = async () => { throw serverError(); };
    const output = await execute('SELECT missing;'.repeat(101), {continueOnError: true});
    expect(queryScriptReportSchema.parse(output.scriptReport)).toMatchObject({statementsAttempted: 100, statementsCompleted: 0, reachedEnd: false, stopReason: expect.stringContaining('100')});
    expect(output.scriptReport?.errors).toHaveLength(100); expect(sent).toHaveLength(100);
  });
  it('超时和本地断线停在原语句，后继不发送', async () => {
    for (const error of [serverError('57014'), Error('连接中断')]) {
      const before = sent.length; scenario = async () => { throw error; };
      const output = await execute('SELECT waiting; SELECT tail;', {continueOnError: true});
      expect(queryScriptReportSchema.parse(output.scriptReport)).toMatchObject({statementsAttempted: 1, statementsCompleted: 0, reachedEnd: false});
      expect(output.scriptReport?.errors[0].kind).toBe('stopped'); expect(sent.length - before).toBe(1);
    }
  });
  it('成功结果后的状态未知保留已完成事实，停止范围不能冒充该句失败', async () => {
    let known = true; managed.state = () => ({transactionOpen: false, transactionKnown: known, transactionFailed: false, broken: false});
    scenario = async statement => { known = false; return ok(statement); };
    const output = await execute('SELECT 1; SELECT tail;', {continueOnError: true});
    expect(queryScriptReportSchema.parse(output.scriptReport)).toMatchObject({statementsAttempted: 1, statementsCompleted: 1, reachedEnd: false});
    expect(output.scriptReport?.errors[0]).toMatchObject({statementOrdinal: 2, kind: 'stopped'}); expect(output.scriptReport?.errors[0]).not.toHaveProperty('sourceRange'); expect(output.results).toHaveLength(1);
  });
  it('等待补全时取消有终态报告且零用户SQL', async () => {
    let finish!: () => void; session.completion = new Promise<void>(resolve => { finish = resolve; });
    const pending = execute('SELECT 1', {continueOnError: true}); await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));
    await engine.handle('query.cancel', {taskId: 'range-1'}); finish();
    expect(queryScriptReportSchema.parse((await pending).scriptReport)).toMatchObject({statementsAttempted: 0, statementsCompleted: 0, reachedEnd: false}); expect(sent).toEqual([]); expect(events.at(-1)?.status).toBe('cancelled');
  });
});
