import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { readRoutineInvocationMetadata, type RoutineInvocationInput, type RoutineInvocationReader } from '../../src/engine/routineInvocationMetadata';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import { routineInvocationLimits } from '../../src/shared/routineInvocation';

type Row = Record<string, unknown>;
const input: RoutineInvocationInput = { connectionId: 'routine-profile', database: 'fixture', name: 'subject', kind: 'procedure', taskId: 'routine-read' };
/** 签名和目录分别固定声明；不调用产品builder生成用作期望的元数据。 */
function fixture(kind: 'procedure' | 'function' = 'procedure') {
  const target = { ...input, kind }, state = {
    cancelled: false, started: 0, ended: 0,
    sqlMode: '', sessionSqlMode: '', quoteShowCreate: 1 as number | string,
    ddl: kind === 'procedure' ? 'CREATE PROCEDURE `subject`(IN `a` bigint unsigned, OUT `b` decimal(20,4), INOUT `c` varchar(20)) BEGIN SELECT a; SELECT c; END' : 'CREATE FUNCTION `subject`(`a` bigint unsigned) RETURNS decimal(20,4) DETERMINISTIC RETURN a',
    parameters: (kind === 'procedure' ? [
      { ordinal: 1, mode: 'IN', parameterName: 'a', type: 'bigint unsigned' },
      { ordinal: 2, mode: 'OUT', parameterName: 'b', type: 'decimal(20,4)' },
      { ordinal: 3, mode: 'INOUT', parameterName: 'c', type: 'varchar(20)' },
    ] : [
      { ordinal: 0, mode: null, parameterName: null, type: 'decimal(20,4)' },
      { ordinal: 1, mode: 'IN', parameterName: 'a', type: 'bigint unsigned' },
    ]).map(row => ({ databaseName: target.database, name: target.name, kind: kind.toUpperCase(), ...row, characterSet: row.type.startsWith('varchar') ? 'utf8mb4' : null, collation: row.type.startsWith('varchar') ? 'utf8mb4_bin' : null })) as Row[],
    routine: { databaseName: target.database, name: target.name, kind: kind.toUpperCase(), sqlMode: '', created: '2026-10-28 00:00:00', altered: '2026-10-28 00:00:00', definer: 'fixture@localhost', securityType: 'DEFINER' } as Row,
    calls: [] as { sql: string; values: readonly Buffer[] }[],
    transform: undefined as ((sql: string, rows: Row[], occurrence: number) => unknown) | undefined,
  };
  const counts = new Map<string, number>();
  const reader: RoutineInvocationReader = async (sql, values) => {
    state.calls.push({ sql, values }); const occurrence = (counts.get(sql) ?? 0) + 1; counts.set(sql, occurrence);
    let rows: Row[];
    if (sql.startsWith('SELECT @@SESSION.sql_mode')) rows = [{ sqlMode: state.sessionSqlMode, quoteShowCreate: state.quoteShowCreate }];
    else if (sql.includes('FROM information_schema.ROUTINES')) rows = [{ ...state.routine, sqlMode: state.sqlMode }];
    else if (sql.includes('FROM information_schema.PARAMETERS')) rows = state.parameters.map(row => ({ ...row }));
    else if (sql.startsWith('SHOW CREATE')) rows = [{ [kind === 'procedure' ? 'Procedure' : 'Function']: target.name, sql_mode: state.sqlMode, [kind === 'procedure' ? 'Create Procedure' : 'Create Function']: state.ddl, character_set_client: 'utf8mb4', collation_connection: 'utf8mb4_bin', 'Database Collation': 'utf8mb4_bin' }];
    else throw Error('替身拒绝未声明的SQL：' + sql);
    return state.transform ? state.transform(sql, rows, occurrence) : rows;
  };
  const context: StructureTaskContext = {
    managed: { broken: false, status: { dialect: 'mysql', version: '8.4.11' } } as StructureTaskContext['managed'],
    checkCancelled() { if (state.cancelled) throw Error('合成原任务取消'); }, report: vi.fn(),
    commandStarted() { state.started++; let finished = false; return () => { if (finished) throw Error('原命令被重复结束'); finished = true; state.ended++; }; },
  };
  return { target, state, context, reader, run: () => readRoutineInvocationMetadata(context, target, reader) };
}

describe('例程调用目录独立只读核验', () => {
  it('完整IN/OUT/INOUT目录、原定义和模式双读，输出摘要而不执行任何调用或返回body', async () => {
    const f = fixture(), result = await f.run();
    expect(result).toEqual({ connectionId: input.connectionId, database: input.database, name: input.name, kind: 'procedure', parameters: [
      { ordinal: 1, name: 'a', mode: 'IN', type: 'bigint unsigned' },
      { ordinal: 2, name: 'b', mode: 'OUT', type: 'decimal(20,4)' },
      { ordinal: 3, name: 'c', mode: 'INOUT', type: 'varchar(20)' },
    ], fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(f.state.calls).toHaveLength(8); expect(f.state.started).toBe(8); expect(f.state.ended).toBe(8);
    expect(f.state.calls.every(call => /^(?:SELECT|SHOW CREATE)\b/.test(call.sql))).toBe(true);
    expect(f.state.calls.some(call => /^(?:CALL|SET|INSERT|UPDATE|DELETE|COMMIT|ROLLBACK|CREATE|DROP)\b/.test(call.sql))).toBe(false);
    expect(f.state.calls.filter(call => call.sql.includes('information_schema.')).every(call => call.values.length === 2 && Buffer.isBuffer(call.values[0]) && call.values[0].equals(Buffer.from(input.database)) && call.values[1].equals(Buffer.from(input.name)))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('BEGIN'); expect(result).not.toHaveProperty('sqlMode'); expect(result).not.toHaveProperty('definition');
    await expect(f.run()).resolves.toEqual(result);
  });

  it('带反斜线、反引号和中文的目标按字节绑定，在NBE模式也不拼值进目录SQL', async () => {
    const f = fixture(); f.target.database = '例\\库'; f.target.name = '过`程\\名';
    Object.assign(f.state.routine, { databaseName: f.target.database, name: f.target.name });
    f.state.parameters.forEach(row => { row.databaseName = f.target.database; row.name = f.target.name; });
    f.state.sqlMode = f.state.sessionSqlMode = 'NO_BACKSLASH_ESCAPES';
    f.state.ddl = f.state.ddl.replace('`subject`', '`过``程\\名`');
    expect(await f.run()).toMatchObject({ database: f.target.database, name: f.target.name });
    const calls = f.state.calls.filter(call => call.sql.includes('FROM information_schema.'));
    expect(calls.every(call => !call.sql.includes(f.target.database) && !call.sql.includes(f.target.name) && call.values[0].equals(Buffer.from(f.target.database)) && call.values[1].equals(Buffer.from(f.target.name)))).toBe(true);
    expect(f.state.calls.filter(call => call.sql.startsWith('SHOW CREATE')).map(call => call.sql)).toEqual(Array(2).fill('SHOW CREATE PROCEDURE `例\\库`.`过``程\\名`'));
  });

  it('函数ordinal0单独作为返回类型，不错列实参；目录序号可以是精确十进制字符串', async () => {
    const f = fixture('function'); f.state.parameters.forEach(row => { row.ordinal = String(row.ordinal); });
    expect(await f.run()).toMatchObject({ kind: 'function', returnType: 'decimal(20,4)', parameters: [{ ordinal: 1, name: 'a', mode: 'IN', type: 'bigint unsigned' }] });
    expect(f.state.calls.find(call => call.sql.includes('FROM information_schema.PARAMETERS'))!.sql).toMatch(/LIMIT 202$/);
  });

  it('函数200实参之外仍保留一个返回目录行，LIMIT202用于检测额外行', async () => {
    const f = fixture('function');
    const names = Array.from({ length: 200 }, (_, index) => 'p' + (index + 1));
    f.state.ddl = 'CREATE FUNCTION `subject`(' + names.map(name => '`' + name + '` int').join(',') + ') RETURNS int DETERMINISTIC RETURN 1';
    f.state.parameters = [{ ...f.state.parameters[0], type: 'int' }, ...names.map((name, index) => ({ ...f.state.parameters[1], ordinal: index + 1, parameterName: name, type: 'int' }))];
    expect((await f.run()).parameters).toHaveLength(200);
    expect(f.state.calls.find(call => call.sql.includes('FROM information_schema.PARAMETERS'))!.sql).toMatch(/LIMIT 202$/);
    f.state.parameters.push({ ...f.state.parameters[1], ordinal: 201, parameterName: 'p201' });
    await expect(f.run()).rejects.toThrow();
  });

  it.each(['procedure', 'function'] as const)('有真实SHOW CREATE签名才能确认零参%s', async kind => {
    const f = fixture(kind);
    f.state.ddl = kind === 'procedure' ? 'CREATE PROCEDURE `subject`() SELECT 1' : 'CREATE FUNCTION `subject`() RETURNS int DETERMINISTIC RETURN 1';
    f.state.parameters = kind === 'procedure' ? [] : [{ databaseName: input.database, name: input.name, kind: 'FUNCTION', ordinal: 0, mode: null, parameterName: null, type: 'int', characterSet: null, collation: null }];
    expect((await f.run()).parameters).toEqual([]);
  });

  it('权限过滤掉参数不能伪装为零参；空SHOW CREATE也拒绝', async () => {
    const f = fixture(); f.state.parameters = []; await expect(f.run()).rejects.toThrow();
    const empty = fixture(); empty.state.transform = (sql, rows) => sql.startsWith('SHOW CREATE') ? [{ ...rows[0], 'Create Procedure': null }] : rows;
    await expect(empty.run()).rejects.toThrow(); expect(empty.state.started).toBe(empty.state.ended);
  });

  it.each(['错误目标', '目录模式不符', '类型与签名不符'] as const)('拒绝%s，不把SHOW CREATE或目录任一来源当作完整证明', async reason => {
    const f = fixture();
    if (reason === '错误目标') f.state.transform = (sql, rows) => sql.startsWith('SHOW CREATE') ? [{ ...rows[0], Procedure: 'other' }] : rows;
    else if (reason === '目录模式不符') f.state.transform = (sql, rows) => sql.includes('FROM information_schema.ROUTINES') ? [{ ...rows[0], sqlMode: 'ANSI_QUOTES' }] : rows;
    else f.state.parameters[0].type = 'int';
    await expect(f.run()).rejects.toThrow(); expect(f.state.started).toBe(f.state.ended);
  });

  it.each([
    ['乱序', (rows: Row[]) => [rows[1], rows[0], rows[2]]],
    ['缺序号', (rows: Row[]) => [rows[0], rows[2]]],
    ['重复序号', (rows: Row[]) => [rows[0], { ...rows[1], ordinal: 1 }, rows[2]]],
    ['重复名字', (rows: Row[]) => [rows[0], { ...rows[1], parameterName: 'a' }, rows[2]]],
    ['未知方向', (rows: Row[]) => [{ ...rows[0], mode: 'UNKNOWN' }, ...rows.slice(1)]],
    ['错库', (rows: Row[]) => [{ ...rows[0], databaseName: 'other' }, ...rows.slice(1)]],
    ['错例程', (rows: Row[]) => [{ ...rows[0], name: 'other' }, ...rows.slice(1)]],
    ['错种类', (rows: Row[]) => [{ ...rows[0], kind: 'FUNCTION' }, ...rows.slice(1)]],
    ['指数序号', (rows: Row[]) => [{ ...rows[0], ordinal: '1e0' }, ...rows.slice(1)]],
  ] as const)('拒绝%s目录，不靠排序或过滤修复原回包', async (_name, modify) => {
    const f = fixture(); f.state.parameters = modify(f.state.parameters); await expect(f.run()).rejects.toThrow(); expect(f.state.started).toBe(f.state.ended);
  });

  it.each(['ROUTINES', 'PARAMETERS', 'SHOW CREATE', 'session'] as const)('前后%s变化使整份预览失效', async source => {
    const f = fixture(); f.state.transform = (sql, rows, occurrence) => {
      if (occurrence !== 2) return rows;
      if (source === 'ROUTINES' && sql.includes('FROM information_schema.ROUTINES')) return [{ ...rows[0], altered: '2026-10-28 00:00:01' }];
      if (source === 'PARAMETERS' && sql.includes('FROM information_schema.PARAMETERS')) return rows.map((row, index) => index ? row : { ...row, type: 'int' });
      if (source === 'SHOW CREATE' && sql.startsWith('SHOW CREATE')) return [{ ...rows[0], 'Create Procedure': f.state.ddl + ' ' }];
      if (source === 'session' && sql.startsWith('SELECT @@SESSION.sql_mode')) return [{ ...rows[0], sqlMode: 'ANSI_QUOTES' }];
      return rows;
    };
    await expect(f.run()).rejects.toThrow(); expect(f.state.started).toBe(f.state.ended);
  });

  it('指纹覆盖未显示body及目录编码；稳定签名也不能复用不同定义', async () => {
    const original = fixture(), before = await original.run(), body = fixture(), encoding = fixture();
    body.state.ddl = body.state.ddl.replace('SELECT a;', 'SELECT a + 1;'); encoding.state.parameters[2].collation = 'utf8mb4_general_ci';
    expect((await body.run()).fingerprint).not.toBe(before.fingerprint); expect((await encoding.run()).fingerprint).not.toBe(before.fingerprint);
  });

  it('超过完整定义或目录行预算明确拒绝，不截断后继续', async () => {
    const huge = fixture(); huge.state.ddl += ' '.repeat(routineInvocationLimits.definitionBytes); await expect(huge.run()).rejects.toThrow();
    const extra = fixture(); extra.state.parameters = Array.from({ length: routineInvocationLimits.parameters + 1 }, (_, index) => ({ ...extra.state.parameters[0], ordinal: index + 1, parameterName: 'p' + index })); await expect(extra.run()).rejects.toThrow();
  });

  it('读取错误保留原异常且不重试，取消发生后也不继续后续目录命令', async () => {
    const f = fixture(), error = Error('原始目录权限拒绝'); let calls = 0;
    await expect(readRoutineInvocationMetadata(f.context, f.target, async () => { calls++; throw error; })).rejects.toBe(error);
    expect(calls).toBe(1); expect(f.state.started).toBe(f.state.ended);
    const cancelled = fixture(); cancelled.state.transform = (sql, rows) => { if (sql.includes('FROM information_schema.ROUTINES')) cancelled.state.cancelled = true; return rows; };
    await expect(cancelled.run()).rejects.toThrow('合成原任务取消'); expect(cancelled.state.calls).toHaveLength(2); expect(cancelled.state.started).toBe(cancelled.state.ended);
  });

  it('访问器目录在读取前拒绝且零getter执行；取消前置拒绝不发送命令', async () => {
    const f = fixture(), getter = vi.fn(() => 'fixture');
    f.state.transform = (sql, rows) => { if (!sql.includes('FROM information_schema.ROUTINES')) return rows; const row = { ...rows[0] }; Object.defineProperty(row, 'databaseName', { enumerable: true, get: getter }); return [row]; };
    await expect(f.run()).rejects.toThrow(); expect(getter).not.toHaveBeenCalled();
    const early = fixture(); early.state.cancelled = true; await expect(early.run()).rejects.toThrow('合成原任务取消'); expect(early.state.calls).toHaveLength(0); expect(early.state.started).toBe(0);
  });

  it('实际driver回调在取消ACK后尚未到达时保持命令占用，终态只结束一次', async () => {
    const f = fixture(), connection = new EventEmitter(); let callback: ((error: Error | null, rows: unknown, fields: unknown[]) => void) | undefined;
    const query = vi.fn((_sql: string, ...args: unknown[]) => { callback = args.at(-1) as typeof callback; });
    f.context.managed.connection = Object.assign(connection, { query }) as unknown as StructureTaskContext['managed']['connection'];
    const pending = readRoutineInvocationMetadata(f.context, f.target); const observed = pending.catch(error => error);
    expect(query).toHaveBeenCalledTimes(1); expect(f.state.started).toBe(1); expect(f.state.ended).toBe(0);
    f.state.cancelled = true; await Promise.resolve(); expect(f.state.ended).toBe(0);
    callback!(null, [{ sqlMode: '', quoteShowCreate: 1 }], []); expect(await observed).toBeInstanceOf(Error); expect(f.state.ended).toBe(1);
    callback!(null, [{ sqlMode: '', quoteShowCreate: 1 }], []); expect(f.state.ended).toBe(1); expect(query).toHaveBeenCalledTimes(1);
    expect(connection.listenerCount('error')).toBe(0); expect(connection.listenerCount('end')).toBe(0);
  });
});
