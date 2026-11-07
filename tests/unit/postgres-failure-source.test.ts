import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresEngine } from '../../src/engine/postgres/engine';
import { PostgresConnection } from '../../src/engine/postgres/connection';
import { DatabaseError } from 'pg';
import type { QueryOutcome, TaskEvent } from '../../src/shared/contracts';
import type { QueryParameter } from '../../src/shared/queryParameters';

let engine: PostgresEngine, sent: string[], events: TaskEvent[], next: number;
let scenario: (sql: string, values?: unknown[]) => Promise<unknown>;
let managed: PostgresConnection, session: {id: string; connectionId: string; managed: PostgresConnection; completion?: Promise<any>};
const ok = (statement: string) => ({columns: [], rows: [], statement, postgresCommand: 'SELECT', elapsedMs: 1});

beforeEach(() => {
  sent = []; events = []; next = 0; scenario = async () => { throw Error('预期失败'); };
  // 仅替换物理连接，实际驱动分发、逐句扫描、终态和 sourceRange 均由产品引擎产生。
  managed = {broken: false, standardStrings: true, database: 'db', close: vi.fn(async () => {}),
    state: () => ({transactionOpen: false, transactionKnown: true, broken: false}),
    error: (reason: unknown) => reason instanceof Error ? reason : Error('未知错误'),
    query: async (sql: string, values?: unknown[]) => { sent.push(sql); return scenario(sql, values); },
  } as unknown as PostgresConnection;
  engine = new PostgresEngine(event => events.push(event));
  session = {id: 's', connectionId: 'c', managed};
  (engine as unknown as {sessions: Map<string, typeof session>}).sessions.set('s', session);
});
afterEach(async () => { await engine.closeAll(); });
function execute(sql: string, options: {parameters?: QueryParameter[]; currentStatement?: {offset: number}} = {}): Promise<QueryOutcome> {
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
