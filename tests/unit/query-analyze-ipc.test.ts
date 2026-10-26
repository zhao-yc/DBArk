import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine';
import { commandSchemas } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import type { QueryResult } from '../../src/shared/contracts';

const input = { sessionId: 'session', taskId: 'task', sql: 'SELECT 1', maxRows: 100, acknowledged: true as const, expectedDatabase: 'original' };

/** 使用合成会话、任务和驱动端口执行真实Engine分支；不冒充物理连接或事务验收。 */
function fixture(version = '8.4.11') {
  const engine = new Engine(), managed = { status: { dialect: 'mysql', version }, completionDatabase: { known: true, database: 'original' as string | null }, broken: false, serverStatus: 2, connection: { destroy: vi.fn() } };
  const internal = engine as any;
  const session = vi.spyOn(internal, 'withSession').mockImplementation(async (...args: any[]) => args[1](managed));
  const task = vi.spyOn(internal, 'runTask').mockImplementation(async (...args: any[]) => args[3]({ id: 'task', managed }));
  vi.spyOn(internal, 'checkCancelled').mockImplementation(() => {});
  const mode = vi.spyOn(internal, 'sqlMode').mockResolvedValue({ ansiQuotes: false, noBackslashEscapes: false });
  const stream = vi.spyOn(internal, 'streamQuery').mockImplementation(async (...args: any[]): Promise<QueryResult[]> => [{
    columns: [{ key: 'c0', name: 'EXPLAIN', type: 'TEXT' }], rows: [{ c0: '-> Rows fetched before execution  (cost=0..0 rows=1) (actual time=0..0 rows=1 loops=1)\n' }],
    statement: args[1], elapsedMs: 1, truncated: false,
  }]);
  return { engine, managed, mode, stream, session, task };
}

describe('实际分析IPC与原会话确认范围', () => {
  it('独立白名单命令必须明确确认，不能扩展旧估算格式为分析', () => {
    expect(publicCommands['query.analyze']).toBe(true);
    expect(commandSchemas['query.analyze'].safeParse(input).success).toBe(true);
    expect(commandSchemas['query.analyze'].safeParse({ ...input, expectedDatabase: null }).success).toBe(true);
    for (const patch of [{ acknowledged: false }, { acknowledged: undefined }, { expectedDatabase: undefined }, { expectedDatabase: '' }, { expectedDatabase: {} }, { maxRows: 0 }, { profile: {} }, { format: 'auto' }]) {
      expect(commandSchemas['query.analyze'].safeParse({ ...input, ...patch }).success).toBe(false);
    }
    expect(commandSchemas['query.explain'].safeParse({ sessionId: 's', taskId: 't', sql: 'SELECT 1', maxRows: 1, format: 'analyze' }).success).toBe(false);
  });
  it('发送同一会话的一次分析并报告实际SQL，用真实状态包返回事务状态', async () => {
    const f = fixture(); f.managed.serverStatus = 3;
    const result = await f.engine.handle('query.analyze', input);
    expect(f.stream).toHaveBeenCalledTimes(1);
    expect(f.stream.mock.calls[0][1]).toBe('EXPLAIN ANALYZE FORMAT=TREE SELECT 1');
    expect(f.stream.mock.calls[0][5]).toBe('EXPLAIN ANALYZE FORMAT=TREE SELECT 1');
    expect(f.stream.mock.calls[0][6]).toBe(true);
    expect(result.transactionOpen).toBe(true); expect(result.analysis?.nodes.length).toBe(1); expect(result.explain).toBeUndefined();
  });
  it.each([false, undefined])('即使绕过公开校验，确认值%s也不能发送SQL', async acknowledged => {
    const f = fixture(); await expect(f.engine.handle('query.analyze', { ...input, acknowledged })).rejects.toThrow('确认');
    expect(f.mode).not.toHaveBeenCalled(); expect(f.stream).not.toHaveBeenCalled();
  });
  it.each(['changed', null])('确认默认库%s与原会话不同时，在读模式之前拒绝', async expectedDatabase => {
    const f = fixture(); await expect(f.engine.handle('query.analyze', { ...input, expectedDatabase })).rejects.toThrow('默认库');
    expect(f.mode).not.toHaveBeenCalled(); expect(f.stream).not.toHaveBeenCalled();
  });
  it('模式读取期间切库也拒绝，不能把旧确认带到新库', async () => {
    const f = fixture(); f.mode.mockImplementation(async () => { f.managed.completionDatabase.database = 'other'; return { ansiQuotes: false, noBackslashEscapes: false }; });
    await expect(f.engine.handle('query.analyze', input)).rejects.toThrow('默认库'); expect(f.stream).not.toHaveBeenCalled();
  });
  it('未知默认库及不支持版本不发送任何用户分析SQL', async () => {
    const unknown = fixture(); unknown.managed.completionDatabase.known = false;
    await expect(unknown.engine.handle('query.analyze', input)).rejects.toThrow('默认库'); expect(unknown.stream).not.toHaveBeenCalled();
    const old = fixture('5.7.44'); await expect(old.engine.handle('query.analyze', input)).rejects.toThrow('8.0.18'); expect(old.mode).not.toHaveBeenCalled(); expect(old.stream).not.toHaveBeenCalled();
  });
});

const contextInput = { sessionId: 'session', taskId: 'task' };
const databaseDiagnostic = 'SELECT DATABASE() AS __dbark_analyze_database';

/** 诊断结果只模拟原streamQuery返回，不注入用户SQL，也不替代引擎的形状和库名校验。 */
function databaseResult(value: string | null = '真实默认库'): QueryResult[] {
  return [{ columns: [{ key: 'c0', name: '__dbark_analyze_database', type: 'VARCHAR' }], rows: [{ c0: value }], elapsedMs: 1, statement: databaseDiagnostic, truncated: false }];
}

describe('实际分析上下文只读诊断IPC', () => {
  it('公开输入只有会话与任务编号，拒绝任意SQL、目标和格式字段', () => {
    expect(publicCommands['query.analyzeContext']).toBe(true);
    expect(commandSchemas['query.analyzeContext'].parse(contextInput)).toEqual(contextInput);
    for (const patch of [
      { sql: 'DELETE FROM forbidden' }, { database: 'other' }, { expectedDatabase: 'other' }, { connectionId: 'other' },
      { profile: { host: 'other' } }, { maxRows: 100 }, { format: 'auto' }, { acknowledged: true },
      { sessionId: undefined }, { sessionId: '' }, { taskId: undefined }, { taskId: '' },
    ]) expect(commandSchemas['query.analyzeContext'].safeParse({ ...contextInput, ...patch }).success).toBe(false);
  });

  it.each(['真实默认库', null])('从当前会话读取%s并恢复错误后未知缓存，保留事务且不报告用户执行SQL', async database => {
    const f = fixture(); f.managed.completionDatabase = { known: false, database: '错误前旧库' }; f.managed.serverStatus = 3;
    f.stream.mockResolvedValue(databaseResult(database));
    const state = await f.engine.handle('query.analyzeContext', contextInput);
    expect(state).toMatchObject({ databaseKnown: true, database, dialect: 'mysql', serverVersion: '8.4.11', broken: false, busy: false });
    expect(Object.hasOwn(state, 'database')).toBe(true);
    expect(f.managed.completionDatabase).toEqual({ known: true, database }); expect(f.managed.serverStatus).toBe(3);
    expect(f.session).toHaveBeenCalledExactlyOnceWith('session', expect.any(Function));
    expect(f.task.mock.calls[0][0]).toBe('task'); expect(f.task.mock.calls[0][1]).toBe(f.managed);
    expect(f.stream).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'task', managed: f.managed }), databaseDiagnostic, 1, 0, { remainingRows: 1, remainingBytes: 4096, remainingResults: 1 });
    expect(f.stream.mock.calls[0][6]).not.toBe(true);
    expect(f.mode).not.toHaveBeenCalled(); expect(f.managed.connection.destroy).not.toHaveBeenCalled();
  });

  it('MariaDB同样只读取常量诊断，返回当前握手方言和版本而非配置猜测', async () => {
    const f = fixture('5.5.5-10.11.15-MariaDB'); f.managed.status.dialect = 'mariadb';
    f.managed.completionDatabase.known = false; f.stream.mockResolvedValue(databaseResult('maria库'));
    const state = await f.engine.handle('query.analyzeContext', contextInput);
    expect(state).toMatchObject({ databaseKnown: true, database: 'maria库', dialect: 'mariadb', serverVersion: '5.5.5-10.11.15-MariaDB' });
    expect(f.stream).toHaveBeenCalledTimes(1); expect(f.stream.mock.calls[0][1]).toBe(databaseDiagnostic);
    expect(f.stream.mock.calls[0][6]).not.toBe(true); expect(f.mode).not.toHaveBeenCalled();
  });

  it.each([
    ['mysql', '5.7.44'], ['mysql', '8.0.17'], ['mysql', '未知版本'], ['mariadb', '10.0.38'], ['mariadb', '未知版本'],
  ] as const)('不支持的真实版本%s %s在任何诊断SQL前拒绝', async (dialect, version) => {
    const f = fixture(version); f.managed.status.dialect = dialect; f.managed.completionDatabase.known = false;
    await expect(f.engine.handle('query.analyzeContext', contextInput)).rejects.toThrow();
    expect(f.stream).not.toHaveBeenCalled(); expect(f.mode).not.toHaveBeenCalled();
    expect(f.managed.completionDatabase.known).toBe(false); expect(f.managed.connection.destroy).not.toHaveBeenCalled();
  });

  it.each(['none', 'no-rows', 'two-results', 'two-rows', 'no-columns', 'two-columns', 'missing-cell', 'truncated'] as const)('未知或不完整诊断结果%s不能采用为可信库', async shape => {
    const f = fixture(), rows = shape === 'none' ? [] : databaseResult(); f.managed.completionDatabase.known = false;
    if (shape === 'no-rows') rows[0].rows = [];
    if (shape === 'two-results') rows.push(...databaseResult());
    if (shape === 'two-rows') rows[0].rows.push({ c0: '另一个库' });
    if (shape === 'no-columns') rows[0].columns = [];
    if (shape === 'two-columns') rows[0].columns.push({ key: 'c1', name: 'unknown', type: 'VARCHAR' });
    if (shape === 'missing-cell') rows[0].rows = [{}];
    if (shape === 'truncated') rows[0].truncated = true;
    f.stream.mockResolvedValue(rows);
    await expect(f.engine.handle('query.analyzeContext', contextInput)).rejects.toThrow();
    expect(f.stream).toHaveBeenCalledTimes(1); expect(f.stream.mock.calls[0][1]).toBe(databaseDiagnostic);
    expect(f.managed.completionDatabase.known).toBe(false); expect(f.mode).not.toHaveBeenCalled();
  });

  it.each(['', 'a'.repeat(65), '包含\0字符', '孤立\uD800字符', 1, true, { base64: 'AA==' }])('非合法库名或非文本诊断值%j不能恢复可信缓存', async database => {
    const f = fixture(), rows = databaseResult(); f.managed.completionDatabase.known = false;
    rows[0].rows[0].c0 = database as any; f.stream.mockResolvedValue(rows);
    await expect(f.engine.handle('query.analyzeContext', contextInput)).rejects.toThrow();
    expect(f.stream).toHaveBeenCalledTimes(1); expect(f.stream.mock.calls[0][1]).toBe(databaseDiagnostic);
    expect(f.managed.completionDatabase.known).toBe(false); expect(f.mode).not.toHaveBeenCalled();
  });

  it('原驱动失败原样返回，不重试、不恢复旧库，也不发送事务命令', async () => {
    const f = fixture(), failure = Object.assign(new Error('原诊断连接中断'), { code: 'ECONNRESET' });
    f.managed.completionDatabase.known = false; f.stream.mockRejectedValue(failure);
    await expect(f.engine.handle('query.analyzeContext', contextInput)).rejects.toBe(failure);
    expect(f.stream).toHaveBeenCalledTimes(1); expect(f.stream.mock.calls[0][1]).toBe(databaseDiagnostic);
    expect(f.managed.completionDatabase.known).toBe(false); expect(f.mode).not.toHaveBeenCalled();
  });
});
