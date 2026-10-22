import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { EngineCommand, QueryOutcome, TaskEvent } from '../../src/shared/contracts';
import { queryPartialEnabled, bindQueryPartialTarget, queryPartialLifetime, loadQueryPartialModules, assertQueryPartialIdentity, watchQueryPartialConnection, assertQueryPartialCommands, assertQueryPartialClosed, closeQueryPartialObserver, verifyQueryPartialPrecision, queryPartialValues as v, type QueryPartialConnectionFact, type QueryPartialSqlPlan, type QueryPartialLifetime } from '../helpers/queryPartialIntegration';

const audit = vi.hoisted(() => ({ watch: undefined as undefined | ((managed: ManagedConnection, scope: string) => void), check: undefined as undefined | (() => void), scope: '' }));
/** 只旁观真实connect，顺序loader确保Engine与此异步mock工厂属于同一模块图。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => {
    if (!audit.watch || !audit.check || !audit.scope) throw Error('部分查询连接缺少本轮原owner');
    audit.check(); const scope = audit.scope, managed = await actual.connect(...args); audit.watch(managed, scope); audit.check(); return managed;
  } };
});
let owner: QueryPartialLifetime | undefined, retained = false, complete = false;
afterEach(() => { if (owner && !complete) { retained = true; owner.stop(); } owner?.end(); });

describe.sequential('查询首错保留完整前序结果六实例专项（Root逐端口运行）', () => {
  it('真实精度前序、autocommit保留、用户回滚、参数隐私及CALL首错丢弃当前语句', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (!queryPartialEnabled(process.argv, process.env)) { context.skip(); return; }
    if (retained) throw Error('部分查询前例停链，禁止重跑或重连');
    const binding = bindQueryPartialTarget(() => process.env, 'qpartial-' + context.task.id), lifetime = owner = queryPartialLifetime(context, binding, () => { retained = true; });
    const facts: QueryPartialConnectionFact[] = [], events: TaskEvent[] = [];
    let plan: QueryPartialSqlPlan = { allowed: new Set(), forbiddenTails: new Set() }, observer: ManagedConnection | undefined, engine: import('../../src/engine/index').Engine | undefined;
    let database = '', marker = '', created: 'absent' | 'unknown' | 'confirmed' = 'absent', sessionId = '', sequence = 0;
    audit.check = lifetime.check; audit.watch = (managed, scope) => { facts.push(watchQueryPartialConnection(managed, scope, lifetime, () => plan)); };
    try {
      const { connection, engine: module } = await lifetime.step(loadQueryPartialModules);
      const quote = await lifetime.step(() => import('../../src/engine/sql')), crypto = await lifetime.step(() => import('node:crypto'));
      database = 'dbark_qpartial_' + crypto.randomUUID().replaceAll('-', ''); marker = 'dbark-qpartial-owner:' + crypto.randomUUID().replaceAll('-', '');
      if (!/^dbark_qpartial_[a-f0-9]{32}$/.test(database)) throw Error('部分查询本轮随机资源计划不符');
      process.stdout.write(JSON.stringify({ 专项: '查询部分失败', 阶段: '原资源计划', 数据库: database, 所有者标记: marker, 端口: binding.profile.port }) + '\n');
      const db = quote.identifier(database), table = (name: 'precision_row' | 'ledger' | 'unique_values') => db + '.' + quote.identifier(name), procedure = db + '.`partial_fail`';
      const tail = `UPDATE ${table('ledger')} SET note='TAIL_FORBIDDEN' WHERE id=0`, tails = new Set([tail]);
      const setPlan = (allowed: readonly string[]) => { plan = { allowed: new Set(allowed), forbiddenTails: tails }; };
      /** 每个查询等待原query.end，不以Engine Promise或error事件替代原终包。 */
      const drained = async () => { for (const fact of facts) for (const command of fact.commands) if (!command.ended) await lifetime.step(() => command.terminal); assertQueryPartialCommands(facts); };
      const sql = async <T = Record<string, unknown>[]>(text: string, values: (string | number | boolean | null | Buffer)[] = []) => {
        audit.scope = 'observer'; setPlan([text]); const result = await lifetime.step(() => connection.execute<T>(observer!, text, values)); await drained(); return result.rows;
      };
      audit.scope = 'observer'; observer = await lifetime.step(() => connection.connect(binding.profile));
      const identity = await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames'), uuid = binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined;
      assertQueryPartialIdentity(identity, binding, observer.status, uuid);
      engine = new module.Engine(event => events.push(event));
      /** 所有任务保留原session，预期错误在原step内部接住；不自动重试、不创建替代连接。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>, nativeSql: readonly string[] = []) => {
        audit.scope = 'engine-' + ++sequence; setPlan(nativeSql);
        const result = await lifetime.step(async (): Promise<{ value?: T; error?: unknown }> => { try { return { value: await engine!.handle(command, input) as T }; } catch (error) { return { error }; } });
        await drained(); return result;
      };
      const task = () => crypto.randomUUID();
      // 先实测Engine连接确实进入原observer，未证明前不创建资源。
      const opened = await invoke('connections.open', { id: binding.profile.id, profile: binding.profile }); expect(opened.error).toBeUndefined();
      expect(facts.filter(fact => fact.scope.startsWith('engine-'))).toHaveLength(1); const probe = facts.at(-1)!; await lifetime.step(() => probe.closed); assertQueryPartialClosed([probe]);
      expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [database])).toHaveLength(0);
      created = 'unknown'; await sql(`CREATE DATABASE ${db} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`); created = 'confirmed';
      await sql(`CREATE TABLE ${table('precision_row')}(id BIGINT UNSIGNED NOT NULL PRIMARY KEY,signed_value BIGINT NOT NULL,amount DECIMAL(65,30) NOT NULL,happened DATETIME(6) NOT NULL,note TEXT,nullable_value TEXT,payload BLOB) ENGINE=InnoDB COMMENT='${marker}'`);
      await sql(`CREATE TABLE ${table('ledger')}(id INT PRIMARY KEY,note VARCHAR(160)) ENGINE=InnoDB COMMENT='${marker}'`);
      await sql(`CREATE TABLE ${table('unique_values')}(value VARCHAR(160) PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin COMMENT='${marker}'`);
      await sql(`INSERT INTO ${table('precision_row')} VALUES(${v.big},${v.signed},${v.decimal},'${v.happened}',CONVERT(X'${Buffer.from(v.note).toString('hex')}' USING utf8mb4),NULL,X'${v.blobHex}')`);
      await sql(`INSERT INTO ${table('ledger')} VALUES(0,'${marker}')`);
      const parameterLiteral = `CONVERT(X'${Buffer.from(v.parameter).toString('hex')}' USING utf8mb4)`;
      await sql(`INSERT INTO ${table('unique_values')} VALUES(${parameterLiteral})`);
      await sql(`CREATE PROCEDURE ${procedure}() SQL SECURITY INVOKER COMMENT '${marker}' BEGIN SELECT 'CALL_EARLY_ONLY' AS partial_only; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic qpartial signal'; END`);
      const session = await invoke<{ sessionId: string }>('sessions.open', { connectionId: binding.profile.id, database }); expect(session.error).toBeUndefined(); sessionId = session.value!.sessionId;
      const sessionFact = facts.at(-1)!; expect(sessionFact.scope.startsWith('engine-')).toBe(true); expect(sessionFact.closeCalls).toBe(0);
      const precision = `SELECT id AS repeated,signed_value AS repeated,amount,happened,note,nullable_value,payload FROM ${table('precision_row')} ORDER BY id`, second = "SELECT 'SECOND_COMPLETE' AS complete_value", missing = 'SELECT * FROM ' + db + '.' + quote.identifier('missing_qpartial');
      const execute = async (statements: string[], command: 'query.execute' | 'query.executeParameterized' = 'query.execute', parameters?: { name: string; type: 'text'; value: string }[], nativeSql = statements.filter(sql => sql !== tail)) => {
        const taskId = task(), result = await invoke<QueryOutcome>(command, { sessionId, sql: statements.join(';\n'), maxRows: 1000, taskId, ...(parameters ? { parameters } : {}) }, nativeSql);
        expect(result.error).toBeUndefined(); expect(events.filter(event => event.taskId === taskId && event.status !== 'running').map(event => event.status)).toEqual(['failed']);
        return { outcome: result.value!, taskId };
      };
      const prefix = await execute([precision, second, missing, tail]); verifyQueryPartialPrecision(prefix.outcome, 2);
      expect(prefix.outcome.results[1].rows).toEqual([{ c0: 'SECOND_COMPLETE' }]); expect(prefix.outcome.failure).toMatchObject({ statementOrdinal: 3, statementsCompleted: 2 }); expect(Object.hasOwn(prefix.outcome, 'transactionOpen')).toBe(false);
      const cacheBefore = sessionFact.commands.length, state = await invoke<{ transactionKnown: boolean; broken: boolean }>('query.sessionState', { sessionId });
      expect(state.error).toBeUndefined(); expect(state.value).toMatchObject({ transactionKnown: false, broken: false }); expect(sessionFact.commands.length).toBe(cacheBefore);
      const insertCommitted = `INSERT INTO ${table('ledger')} VALUES(1,'committed-prefix')`, auto = await execute([insertCommitted, missing, tail]);
      expect(auto.outcome.failure).toMatchObject({ statementOrdinal: 2, statementsCompleted: 1 }); expect(auto.outcome.results).toHaveLength(1); expect(auto.outcome.results[0].affectedRows).toBe(1);
      expect(await sql(`SELECT id,note FROM ${table('ledger')} ORDER BY id`)).toEqual([{ id: 0, note: marker }, { id: 1, note: 'committed-prefix' }]);
      expect(sessionFact.commands.some(command => command.sql === 'ROLLBACK')).toBe(false);
      const begun = await invoke('query.transaction', { sessionId, action: 'begin' }, ['START TRANSACTION']); expect(begun.error).toBeUndefined();
      const insertPending = `INSERT INTO ${table('ledger')} VALUES(2,'pending-user-rollback')`, transaction = await execute([insertPending, missing, tail]);
      expect(transaction.outcome.failure).toMatchObject({ statementOrdinal: 2, statementsCompleted: 1 }); expect(transaction.outcome.results[0].affectedRows).toBe(1);
      const countBeforeCache = sessionFact.commands.length, txnCache = await invoke<{ transactionKnown: boolean }>('query.sessionState', { sessionId }); expect(txnCache.value?.transactionKnown).toBe(false); expect(sessionFact.commands.length).toBe(countBeforeCache);
      expect(await sql(`SELECT id FROM ${table('ledger')} WHERE id=2`)).toEqual([]); expect(sessionFact.commands.some(command => command.sql === 'ROLLBACK')).toBe(false);
      const rollback = await invoke('query.transaction', { sessionId, action: 'rollback' }, ['ROLLBACK']); expect(rollback.error).toBeUndefined(); expect(sessionFact.commands.at(-1)?.sql).toBe('ROLLBACK');
      expect(await sql(`SELECT id FROM ${table('ledger')} WHERE id=2`)).toEqual([]);
      const templateFirst = 'SELECT :secret AS parameter_value', templateDuplicate = `INSERT INTO ${table('unique_values')} VALUES(:secret)`;
      const parameter = await execute([templateFirst, templateDuplicate, tail], 'query.executeParameterized', [{ name: 'secret', type: 'text', value: v.parameter }], [`SELECT ${parameterLiteral} AS parameter_value`, `INSERT INTO ${table('unique_values')} VALUES(${parameterLiteral})`]);
      expect(parameter.outcome.results).toHaveLength(1); expect(parameter.outcome.results[0].rows).toEqual([{ c0: v.parameter }]); expect(parameter.outcome.results[0].statement).toBe(templateFirst);
      const exposedPrefix = '仅合成参数不进入错误摘要_中文';
      expect(parameter.outcome.failure).toMatchObject({ statementOrdinal: 2, statementsCompleted: 1 }); expect(parameter.outcome.failure!.message).not.toContain(v.parameter); expect(parameter.outcome.failure!.message).not.toContain(exposedPrefix);
      const failedParameterEvent = events.filter(event => event.taskId === parameter.taskId && event.status === 'failed')[0]; expect(failedParameterEvent.message).not.toContain(v.parameter); expect(failedParameterEvent.message).not.toContain(exposedPrefix);
      // 5.7实测ERR把emoji显示成?，但前面的完整中文参数仍被回显；分别证明原错误与部分/完整脱敏。
      const parameterError = sessionFact.commands.at(-1)!; expect(parameterError.errors).toHaveLength(1); expect(parameterError.errors[0].errno).toBe(1062); expect(parameterError.errors[0].code).toBe('ER_DUP_ENTRY'); expect(parameterError.errors[0].message).toContain(exposedPrefix);
      const callSql = `CALL ${procedure}()`, call = await execute([precision, callSql, tail]); verifyQueryPartialPrecision(call.outcome, 1); expect(call.outcome.failure).toMatchObject({ statementOrdinal: 2, statementsCompleted: 1 }); expect(JSON.stringify(call.outcome.results)).not.toContain('CALL_EARLY_ONLY');
      const callFact = sessionFact.commands.at(-1)!; expect(callFact.sql).toBe(callSql); expect(callFact.fields).toBeGreaterThan(0); expect(callFact.rows).toBeGreaterThan(0); expect(callFact.errors).toHaveLength(1); expect(callFact.ended).toBe(true);
      const schemaTask = task(), schema = await invoke('schema.apply', { connectionId: binding.profile.id, database, taskId: schemaTask, sql: `SELECT 1;\n${missing}` }, ['SELECT 1', missing]); expect(schema.error).toBeInstanceOf(Error); expect(schema.value).toBeUndefined();
      const schemaFact = facts.at(-1)!; expect(schemaFact).not.toBe(sessionFact); await lifetime.step(() => schemaFact.closed); assertQueryPartialClosed([schemaFact]);
      expect(events.filter(event => event.taskId === schemaTask && event.status !== 'running').map(event => event.status)).toEqual(['failed']);
      const recoveredTask = task(), recovered = await invoke<QueryOutcome>('query.execute', { sessionId, taskId: recoveredTask, sql: 'SELECT 77 AS recovered', maxRows: 10 }, ['SELECT 77 AS recovered']); expect(recovered.error).toBeUndefined(); expect(recovered.value?.failure).toBeUndefined(); expect(recovered.value?.results[0].rows).toEqual([{ c0: 77 }]);
      expect(events.filter(event => event.taskId === recoveredTask && event.status !== 'running').map(event => event.status)).toEqual(['completed']);
      const closed = await invoke('sessions.close', { sessionId }); expect(closed.error).toBeUndefined(); await lifetime.step(() => sessionFact.closed); assertQueryPartialClosed([sessionFact]);
      await lifetime.step(() => engine!.closeAll()); const engineFacts = facts.filter(fact => fact.scope !== 'observer'); assertQueryPartialClosed(engineFacts);
      const originalIds = [...new Set(engineFacts.map(fact => fact.id))]; if (!originalIds.length) throw Error('部分查询原会话线程证据缺失');
      expect(await sql(`SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (${originalIds.join(',')})`)).toEqual([]);
      expect(await sql(`SELECT id,note FROM ${table('ledger')} ORDER BY id`)).toEqual([{ id: 0, note: marker }, { id: 1, note: 'committed-prefix' }]);
      const owned = await sql('SELECT TABLE_NAME AS name,TABLE_COMMENT AS marker,TABLE_TYPE AS kind FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY TABLE_NAME', [database]);
      expect(owned).toEqual(['ledger', 'precision_row', 'unique_values'].map(name => ({ name, marker, kind: 'BASE TABLE' })));
      expect(await sql('SELECT ROUTINE_NAME AS name,ROUTINE_TYPE AS kind,ROUTINE_COMMENT AS marker FROM information_schema.ROUTINES WHERE BINARY ROUTINE_SCHEMA=BINARY ?', [database])).toEqual([{ name: 'partial_fail', kind: 'PROCEDURE', marker }]);
      for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) expect(await sql(`SELECT 1 FROM information_schema.${view} WHERE BINARY ${column}=BINARY ? LIMIT 1`, [database])).toHaveLength(0);
      assertQueryPartialCommands(facts); if (created !== 'confirmed' || !/^dbark_qpartial_[a-f0-9]{32}$/.test(database)) throw Error('部分查询数据库归属不完整，拒绝DROP');
      await sql('DROP DATABASE ' + db); created = 'absent'; expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [database])).toEqual([]);
      await lifetime.step(() => closeQueryPartialObserver(observer!)); await lifetime.step(() => facts[0].closed); assertQueryPartialClosed(facts);
      process.stdout.write(JSON.stringify({ 专项: '查询部分失败', 端口: binding.profile.port, 方言: observer.status.dialect, 版本: observer.status.version, 严格TLS: !!binding.profile.tls?.enabled, 完整前序精度: true, 后句原驱动投递: facts.flatMap(fact => fact.commands).filter(command => command.sql === tail).length, 尾句阻断次数: facts.reduce((sum, fact) => sum + fact.tailsBlocked, 0), 自动提交保留: true, 显式用户回滚: true, 错误事务缓存: '未知；未伪装ERR确认', 参数错误隐藏: true, CALL失败语句早期行被丢弃: true, schemaApply仍拒绝: true, 长查询取消: '本专项未验；原取消实库专项另行验收', 原线程全部关闭: true, 已清理数据库: database, 数据库残留: 0, 原任务线程残留: 0, observer原线程: facts[0].id }) + '\n');
      lifetime.finish(); complete = true; audit.watch = undefined; audit.check = undefined; audit.scope = '';
    } catch (error) {
      retained = true; lifetime.stop();
      process.stdout.write(JSON.stringify({ 专项: '查询部分失败', 保留现场: true, 数据库: database, 数据库状态: created, 原线程: facts.map(fact => ({ id: fact.id, pending: fact.pending, closeReturned: fact.closeReturned, sawClose: fact.sawClose, tailsBlocked: fact.tailsBlocked })) }) + '\n');
      throw error;
    }
  });
});
