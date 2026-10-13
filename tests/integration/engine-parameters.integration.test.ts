import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine';
import { identifier } from '../../src/engine/sql';
import type { ConnectionProfile, QueryOutcome, TaskEvent } from '../../src/shared/contracts';
import type { QueryParameter, QueryParameterNames } from '../../src/shared/queryParameters';

// 仅使用显式授权的远程测试实例；此套件不创建 Docker、不连接默认 localhost。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && Boolean(process.env.DBARK_TEST_HOST);
const database = `dbark_parameters_${Date.now()}_${randomUUID().slice(0, 8)}`;
const events: TaskEvent[] = [];
const engine = new Engine(event => events.push(event));
const profile: ConnectionProfile = {
  id: 'parameter-integration', name: '类型参数隔离测试', group: '测试', color: '#5273ff', dialect: 'mysql',
  host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? '3306'), user: process.env.DBARK_TEST_USER ?? 'root', password: process.env.DBARK_TEST_PASSWORD ?? '',
  ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}),
  ...(process.env.DBARK_TEST_SSH === '1' ? { ssh: { enabled: true, host: process.env.DBARK_TEST_SSH_HOST ?? '', port: Number(process.env.DBARK_TEST_SSH_PORT ?? '22'), user: process.env.DBARK_TEST_SSH_USER ?? '', privateKeyPath: process.env.DBARK_TEST_SSH_KEY, hostFingerprint: process.env.DBARK_TEST_SSH_FINGERPRINT } } : {}),
};
let sessionId = '', created = false, capabilities: QueryParameterNames;
/** 参数任务与普通脚本使用相同会话和任务生命周期，只切换公开命令。 */
async function query(sql: string, parameters?: QueryParameter[], session = sessionId, maxRows = 1000): Promise<QueryOutcome> {
  return engine.handle(parameters ? 'query.executeParameterized' : 'query.execute', { sessionId: session, sql, ...(parameters ? { parameters } : {}), taskId: randomUUID(), maxRows });
}
/** 通过位置键取值，避免测试把结果列名误认为唯一键。 */
function firstValues(result: QueryOutcome): unknown[] { return Object.values(result.results.find(item => item.rows.length)!.rows[0]); }

describe.skipIf(!enabled)('远程类型参数查询', () => {
  beforeAll(async () => {
    await engine.handle('connections.open', { id: profile.id, profile });
    const admin = (await engine.handle('sessions.open', { connectionId: profile.id })).sessionId;
    await query(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`, undefined, admin); created = true;
    await engine.handle('sessions.close', { sessionId: admin });
    sessionId = (await engine.handle('sessions.open', { connectionId: profile.id, database })).sessionId;
    capabilities = await engine.handle('query.parameterNames', { sessionId, sql: 'SELECT :v' });
    await query('CREATE TABLE parameter_values (id INT PRIMARY KEY, big_value DECIMAL(65,0), amount DECIMAL(65,30), message LONGTEXT, happened DATETIME(6), elapsed TIME(6), day_value DATE, payload BLOB, enabled BOOLEAN, empty_value VARCHAR(10)) ENGINE=InnoDB');
  });
  afterAll(async () => {
    try {
      if (sessionId) await engine.handle('sessions.close', { sessionId });
      if (created) {
        const cleanup = (await engine.handle('sessions.open', { connectionId: profile.id })).sessionId;
        await query(`DROP DATABASE ${identifier(database)}`, undefined, cleanup);
      }
    } finally { await engine.closeAll(); }
  });

  it('DML 写入九种类型并完整往返 Unicode/NUL、数值精度、微秒和二进制', async () => {
    const message = "中文🙂'\0; DROP TABLE parameter_values; -- /* */ \\";
    const amount = '12345678901234567890.123456789012345678901234567890';
    await query('INSERT INTO parameter_values VALUES (1,:big,:amount,:text,:dt,:time,:date,:binary,:bool,:null)', [
      { name: 'big', type: 'integer', value: '18446744073709551615' }, { name: 'amount', type: 'decimal', value: amount }, { name: 'text', type: 'text', value: message },
      { name: 'dt', type: 'datetime', value: '2026-10-14 12:34:56.123456' }, { name: 'time', type: 'time', value: '-125:34:56.654321' }, { name: 'date', type: 'date', value: '2000-02-29' },
      { name: 'binary', type: 'binary', value: '00017fff' }, { name: 'bool', type: 'boolean', value: 'true' }, { name: 'null', type: 'null' },
    ]);
    const values = firstValues(await query('SELECT big_value,amount,message,happened,elapsed,day_value,HEX(payload),enabled,empty_value FROM parameter_values WHERE id=1'));
    expect(values.slice(0, 7)).toEqual(['18446744073709551615', amount, message, '2026-10-14 12:34:56.123456', '-125:34:56.654321', '2000-02-29', '00017FFF']);
    expect(String(values[7])).toBe('1'); expect(values[8]).toBeNull();
  });

  it('重复值、LIMIT 整数及客户端分隔符存储程序共享正确词法规则', async () => {
    const result = await query('SELECT :v = :v AS equal_value LIMIT :count', [{ name: 'v', type: 'text', value: "'分号;" }, { name: 'count', type: 'integer', value: '1' }]);
    expect(String(firstValues(result)[0])).toBe('1');
    const sql = 'DELIMITER $$\nCREATE PROCEDURE parameter_proc() BEGIN SELECT :v AS first_parameter; SELECT :v AS second_parameter; END$$\nDELIMITER ;\nCALL parameter_proc(); DROP PROCEDURE parameter_proc;';
    const procedure = await query(sql, [{ name: 'v', type: 'text', value: '过程中的参数值' }]);
    expect(procedure.results.filter(item => item.rows.length).map(item => item.rows[0].c0)).toEqual(['过程中的参数值', '过程中的参数值']);
  });

  it('注释内伪参数被跳过，可执行版本注释内参数实际绑定', async () => {
    const preview = await engine.handle('query.parameterNames', { sessionId, sql: "/*!50000 SELECT :v AS value */; SELECT ':ghost' /* :ghost */" });
    expect(preview.names).toEqual(['v']);
    expect(firstValues(await query('/*!50000 SELECT :v AS value */', [{ name: 'v', type: 'integer', value: '9223372036854775807' }]))[0]).toBe('9223372036854775807');
    if (capabilities.allowTimeEndpointFraction) expect(firstValues(await query('/*M!100000 SELECT :v AS value */', [{ name: 'v', type: 'text', value: 'MariaDB' }]))[0]).toBe('MariaDB');
  });

  it('根据实际服务器能力处理 38 位小数及 TIME 极值，越界在写入前拒绝', async () => {
    const fraction = '0.' + '12345678901234567890123456789012345678'.slice(0, capabilities.maxDecimalScale);
    expect(firstValues(await query('SELECT :v AS precise', [{ name: 'v', type: 'decimal', value: fraction }]))[0]).toBe(fraction);
    const end = capabilities.allowTimeEndpointFraction ? '838:59:59.999999' : '838:59:59.000000';
    expect(firstValues(await query('SELECT :v AS duration', [{ name: 'v', type: 'time', value: end }]))[0]).toBe(end);
    await expect(query('INSERT INTO parameter_values(id) VALUES (100); SELECT :v', [{ name: 'v', type: 'time', value: '839:00:00' }])).rejects.toThrow();
    expect(firstValues(await query('SELECT COUNT(*) FROM parameter_values WHERE id=100')).map(String)).toEqual(['0']);
  });

  it('静态及动态模式切换后重新识别字符串和双引号标识符', async () => {
    try {
      const sql = "SET SESSION sql_mode='NO_BACKSLASH_ESCAPES'; SELECT 'path\\' AS path, :v AS value";
      expect((await engine.handle('query.parameterNames', { sessionId, sql })).names).toEqual(['v']);
      expect(firstValues(await query(sql, [{ name: 'v', type: 'text', value: '模式值' }]))).toEqual(['path\\', '模式值']);
      await query("SET SESSION sql_mode=''; SET @future_mode='NO_BACKSLASH_ESCAPES'");
      const dynamic = "SET SESSION sql_mode=@future_mode; SELECT 'path\\' AS path, :v AS value";
      expect((await engine.handle('query.parameterNames', { sessionId, sql: dynamic })).warnings.length).toBeGreaterThan(0);
      expect(firstValues(await query(dynamic, [{ name: 'v', type: 'integer', value: '42' }])).map(String)).toEqual(['path\\', '42']);
      const ansi = 'SET SESSION sql_mode=\'ANSI_QUOTES\'; SELECT :v AS "path\\"';
      expect(firstValues(await query(ansi, [{ name: 'v', type: 'text', value: '双引号' }]))).toEqual(['双引号']);
    } finally { await query("SET SESSION sql_mode=''"); }
  });

  it('显式事务仍由标签独占，回滚与行数预算不受参数替换影响', async () => {
    const other = (await engine.handle('sessions.open', { connectionId: profile.id, database })).sessionId;
    try {
      const outcome = await query('START TRANSACTION; INSERT INTO parameter_values(id,message) VALUES (10,:v)', [{ name: 'v', type: 'text', value: '待回滚' }]);
      expect(outcome.transactionOpen).toBe(true);
      expect(firstValues(await query('SELECT COUNT(*) FROM parameter_values WHERE id=10', undefined, other)).map(String)).toEqual(['0']);
      await query('ROLLBACK');
      expect(firstValues(await query('SELECT COUNT(*) FROM parameter_values WHERE id=10')).map(String)).toEqual(['0']);
      const bounded = await query('SELECT :v UNION ALL SELECT :v; SELECT :v UNION ALL SELECT :v', [{ name: 'v', type: 'integer', value: '42' }], sessionId, 3);
      expect(bounded.results.map(result => result.rows.length)).toEqual([2, 1]); expect(bounded.results[1].truncated).toBe(true);
    } finally { await engine.handle('sessions.close', { sessionId: other }); }
  });

  it('类型错误、缺参及多余参数均不会执行第一条写入', async () => {
    for (const parameters of [[{ name: 'v', type: 'integer', value: '1;DROP TABLE parameter_values' }], [], [{ name: 'v', type: 'null' }, { name: 'unused', type: 'null' }]] as QueryParameter[][]) {
      await expect(query('INSERT INTO parameter_values(id) VALUES (11); SELECT :v', parameters)).rejects.toThrow();
      expect(firstValues(await query('SELECT COUNT(*) FROM parameter_values WHERE id=11')).map(String)).toEqual(['0']);
    }
  });

  it('内部模式同步与事务状态读取不覆盖 ROW_COUNT、FOUND_ROWS 或警告诊断', async () => {
    const sameScript = await query('INSERT INTO parameter_values(id,message) VALUES (20,:v); SELECT ROW_COUNT()', [{ name: 'v', type: 'text', value: '诊断测试' }]);
    expect(firstValues(sameScript).map(String)).toEqual(['1']);
    await query('UPDATE parameter_values SET message=:v WHERE id=20', [{ name: 'v', type: 'text', value: '跨任务更新' }]);
    expect(firstValues(await query('SELECT ROW_COUNT()')).map(String)).toEqual(['1']);
    const found = await query('SELECT SQL_CALC_FOUND_ROWS id FROM parameter_values WHERE id=20 LIMIT 0; SELECT FOUND_ROWS()', []);
    expect(firstValues(found).map(String)).toEqual(['1']);
    const warnings = await query("SELECT CAST(:v AS UNSIGNED); SHOW WARNINGS", [{ name: 'v', type: 'text', value: '不是数字' }]);
    const warningRows = warnings.results.at(-1)!.rows;
    expect(warningRows.length).toBeGreaterThan(0); expect(Object.values(warningRows[0]).map(String).join(' ')).toContain('不是数字');
  });

  it('参数写入错误隐藏原值且不重放，后续语句停止，模板留在结果中', async () => {
    await query('CREATE TABLE parameter_unique (value VARCHAR(64) PRIMARY KEY)');
    const secret = '仅本标签秘密_' + randomUUID();
    await query('INSERT INTO parameter_unique VALUES (:v)', [{ name: 'v', type: 'text', value: secret }]);
    events.length = 0;
    await expect(query('INSERT INTO parameter_unique VALUES (:v); INSERT INTO parameter_values(id) VALUES (12)', [{ name: 'v', type: 'text', value: secret }])).rejects.toThrow('ER_DUP_ENTRY');
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(firstValues(await query('SELECT COUNT(*) FROM parameter_values WHERE id=12')).map(String)).toEqual(['0']);
    const output = await query('SELECT :v AS value', [{ name: 'v', type: 'text', value: secret }]);
    expect(output.results[0].statement).toBe('SELECT :v AS value');
  });

  it('参数任务可取消且释放标签会话，不发送脚本后续写入', async () => {
    const taskId = randomUUID();
    const running = engine.handle('query.executeParameterized', { sessionId, sql: 'SELECT SLEEP(:delay); INSERT INTO parameter_values(id) VALUES (99)', parameters: [{ name: 'delay', type: 'integer', value: '30' }], taskId, maxRows: 10 });
    const failed = expect(running).rejects.toThrow('取消');
    // 留出网络发送时间后取消长查询；完整生命周期由引擎等待 KILL 控制连接结束。
    await new Promise(resolve => setTimeout(resolve, 400));
    await engine.handle('query.cancel', { taskId }); await failed;
    expect(events.filter(event => event.taskId === taskId).at(-1)?.status).toBe('cancelled');
    expect(firstValues(await query('SELECT COUNT(*) FROM parameter_values WHERE id=99')).map(String)).toEqual(['0']);
  });

  it.each(['direct', 'prepared', 'call'] as const)('%s 关闭自身跟踪后仍支持无歧义 SQL，并拒绝猜测 ANSI 引号边界', async source => {
    const isolated = (await engine.handle('sessions.open', { connectionId: profile.id, database })).sessionId;
    try {
      await query("SET sql_mode=''; START TRANSACTION", undefined, isolated);
      if (source === 'direct') await query("SET SESSION session_track_system_variables=''", undefined, isolated);
      else if (source === 'prepared') {
        await query('SET @disable_sql=:sql; PREPARE disable_stmt FROM @disable_sql; EXECUTE disable_stmt', [{ name: 'sql', type: 'text', value: "SET SESSION session_track_system_variables=''" }], isolated);
      } else {
        await query("DELIMITER $$\nCREATE PROCEDURE disable_protocol_tracking() BEGIN SET SESSION session_track_system_variables=''; END$$\nDELIMITER ;\nCALL disable_protocol_tracking()", undefined, isolated);
        // CREATE PROCEDURE 会隐式提交；重新开始事务，验证不确定模式本身没有断开会话。
        await query('START TRANSACTION', undefined, isolated);
      }
      await query("SET sql_mode='ANSI_QUOTES'", undefined, isolated);
      const names = await engine.handle('query.parameterNames', { sessionId: isolated, sql: 'SELECT :v' });
      expect(names.ansiQuotesKnown).toBe(false); expect(names.noBackslashEscapesKnown).toBe(false); expect(names.names).toEqual(['v']);
      expect(firstValues(await query('SELECT :v AS value', [{ name: 'v', type: 'integer', value: '42' }], isolated)).map(String)).toEqual(['42']);
      await expect(query('SELECT :v AS "path\\"', [{ name: 'v', type: 'text', value: '不能猜测' }], isolated)).rejects.toThrow('歧义');
      expect(await engine.handle('query.sessionState', { sessionId: isolated })).toEqual({ transactionOpen: true, transactionKnown: true, broken: false });
      await engine.handle('query.transaction', { sessionId: isolated, action: 'rollback' });
      expect(await engine.handle('query.sessionState', { sessionId: isolated })).toEqual({ transactionOpen: false, transactionKnown: true, broken: false });
    } finally { await engine.handle('sessions.close', { sessionId: isolated }); }
  });

  it('正常 CALL 后简单查询保持支持，服务器报告的恢复模式使动态 SQL 模式脚本继续执行', async () => {
    const isolated = (await engine.handle('sessions.open', { connectionId: profile.id, database })).sessionId;
    try {
      await query("SET sql_mode='';", undefined, isolated);
      await query('DELIMITER $$\nCREATE PROCEDURE ordinary_protocol_call() BEGIN SELECT 7; END$$\nCREATE PROCEDURE mode_protocol_call() BEGIN SET sql_mode=\'ANSI_QUOTES\'; END$$\nDELIMITER ;', undefined, isolated);
      const ordinary = await query('CALL ordinary_protocol_call(); SELECT :v AS value', [{ name: 'v', type: 'integer', value: '42' }], isolated);
      expect(ordinary.results.filter(item => item.rows.length).map(item => String(item.rows[0].c0))).toEqual(['7', '42']);
      // CALL 内 SET 的临时模式由服务器恢复并报告，后续字符串按调用方实际模式解释。
      await query('CALL mode_protocol_call()', undefined, isolated);
      const names = await engine.handle('query.parameterNames', { sessionId: isolated, sql: 'SELECT :v' });
      expect(names.ansiQuotesKnown).toBe(true); expect(names.ansiQuotes).toBe(false);
      expect(firstValues(await query('SELECT "普通字符串" AS value, :v AS parameter_value', [{ name: 'v', type: 'integer', value: '1' }], isolated)).map(String)).toEqual(['普通字符串', '1']);
    } finally { await engine.handle('sessions.close', { sessionId: isolated }); }
  });

  it.each([{ tracking: true, prepared: false }, { tracking: false, prepared: false }, { tracking: true, prepared: true }, { tracking: false, prepared: true }])('CALL 恢复模式但 NBE 位过时：$tracking 跟踪/$prepared 预处理时拒绝字面参数歧义，后续 EOF 不恢复信任', async ({ tracking, prepared }) => {
    const isolated = (await engine.handle('sessions.open', { connectionId: profile.id, database })).sessionId;
    const procedure = `stale_nbe_${tracking ? 'tracked' : 'untracked'}_${prepared ? 'prepared' : 'direct'}`;
    try {
      await query("SET sql_mode=''", undefined, isolated);
      await query(`DELIMITER $$\nCREATE PROCEDURE ${procedure}() BEGIN SELECT 7; SET SESSION sql_mode='ANSI_QUOTES,NO_BACKSLASH_ESCAPES'; END$$\nDELIMITER ;`, undefined, isolated);
      if (!tracking) await query("SET SESSION session_track_system_variables=''", undefined, isolated);
      if (prepared) await query(`SET @call_sql='CALL ${procedure}()'; PREPARE call_mode_stmt FROM @call_sql; EXECUTE call_mode_stmt`, undefined, isolated);
      else await query(`CALL ${procedure}()`, undefined, isolated);
      // 五库均曾把字符串中的 :ghost 错绑定；实际模式已恢复，但 EOF 的 NBE 位仍然过时。
      const template = "SELECT 'a\\', :ghost -- '\n";
      for (let index = 0; index < 3; index++) {
        const names = await engine.handle('query.parameterNames', { sessionId: isolated, sql: 'SELECT :v' });
        expect(names.ansiQuotesKnown).toBe(false); expect(names.noBackslashEscapesKnown).toBe(false);
        await expect(engine.handle('query.parameterNames', { sessionId: isolated, sql: template })).rejects.toThrow('歧义');
        await expect(query(template, [{ name: 'ghost', type: 'integer', value: '7' }], isolated)).rejects.toThrow('歧义');
        expect(firstValues(await query('SELECT @@SESSION.sql_mode, :v', [{ name: 'v', type: 'integer', value: '42' }], isolated)).map(String)).toEqual(['', '42']);
      }
      await query('START TRANSACTION', undefined, isolated);
      expect(await engine.handle('query.sessionState', { sessionId: isolated })).toEqual({ transactionOpen: true, transactionKnown: true, broken: false });
      await engine.handle('query.transaction', { sessionId: isolated, action: 'rollback' });
      expect(await engine.handle('query.sessionState', { sessionId: isolated })).toEqual({ transactionOpen: false, transactionKnown: true, broken: false });
      expect((await engine.handle('query.parameterNames', { sessionId: isolated, sql: 'SELECT :v' })).noBackslashEscapesKnown).toBe(false);
      // 用户显式恢复跟踪并改模式，新的完整一致报告可以恢复词法信任；引擎不补发隐藏 SQL。
      await query("SET SESSION session_track_system_variables='sql_mode,session_track_system_variables'; SET SESSION sql_mode='NO_BACKSLASH_ESCAPES'; SET SESSION sql_mode=''", undefined, isolated);
      const restored = await engine.handle('query.parameterNames', { sessionId: isolated, sql: template });
      expect(restored.names).toEqual([]); expect(restored.noBackslashEscapesKnown).toBe(true);
      expect(firstValues(await query(template, [], isolated))).toEqual(["a', :ghost -- "]);
    } finally { await engine.handle('sessions.close', { sessionId: isolated }); }
  });

  it('写入失败后会话状态接口保留未提交事务且不覆盖后续 ROW_COUNT', async () => {
    const isolated = (await engine.handle('sessions.open', { connectionId: profile.id, database })).sessionId;
    try {
      await query('START TRANSACTION; INSERT INTO parameter_values(id) VALUES (31)', undefined, isolated);
      expect(await engine.handle('query.sessionState', { sessionId: isolated })).toEqual({ transactionOpen: true, transactionKnown: true, broken: false });
      expect(firstValues(await query('SELECT ROW_COUNT()', undefined, isolated)).map(String)).toEqual(['1']);
      await expect(query('INSERT INTO parameter_values(id) VALUES (:id)', [{ name: 'id', type: 'integer', value: '31' }], isolated)).rejects.toThrow('ER_DUP_ENTRY');
      expect(await engine.handle('query.sessionState', { sessionId: isolated })).toEqual({ transactionOpen: true, transactionKnown: false, broken: false });
      await engine.handle('query.transaction', { sessionId: isolated, action: 'rollback' });
      expect(await engine.handle('query.sessionState', { sessionId: isolated })).toEqual({ transactionOpen: false, transactionKnown: true, broken: false });
    } finally { await engine.handle('sessions.close', { sessionId: isolated }); }
  });

  it('CALL 改模式/关闭跟踪后报 ERR 时使用四候选，不能猜测旧反斜线模式或事务状态', async () => {
    const isolated = (await engine.handle('sessions.open', { connectionId: profile.id, database })).sessionId;
    try {
      await query("SET sql_mode='';", undefined, isolated);
      await query("DELIMITER $$\nCREATE PROCEDURE fail_protocol_mode() BEGIN SET SESSION sql_mode='ANSI_QUOTES,NO_BACKSLASH_ESCAPES'; SET SESSION session_track_system_variables=''; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='预期的模式异常'; END$$\nDELIMITER ;\nSTART TRANSACTION", undefined, isolated);
      await expect(query('CALL fail_protocol_mode()', undefined, isolated)).rejects.toThrow('预期的模式异常');
      expect(await engine.handle('query.sessionState', { sessionId: isolated })).toEqual({ transactionOpen: true, transactionKnown: false, broken: false });
      const names = await engine.handle('query.parameterNames', { sessionId: isolated, sql: 'SELECT :v' });
      expect(names.ansiQuotesKnown).toBe(false); expect(names.noBackslashEscapesKnown).toBe(false);
      await expect(query("SELECT 'path\\' AS value, :v", [{ name: 'v', type: 'integer', value: '1' }], isolated)).rejects.toThrow('歧义');
      expect(firstValues(await query('SELECT :v AS value', [{ name: 'v', type: 'integer', value: '42' }], isolated)).map(String)).toEqual(['42']);
      expect((await engine.handle('query.parameterNames', { sessionId: isolated, sql: 'SELECT :v' })).noBackslashEscapesKnown).toBe(false);
      await engine.handle('query.transaction', { sessionId: isolated, action: 'rollback' });
      expect(await engine.handle('query.sessionState', { sessionId: isolated })).toEqual({ transactionOpen: false, transactionKnown: true, broken: false });
    } finally { await engine.handle('sessions.close', { sessionId: isolated }); }
  });

  it('失败 DDL 发生隐式提交时不把旧事务标志冒充当前状态', async () => {
    const isolated = (await engine.handle('sessions.open', { connectionId: profile.id, database })).sessionId;
    try {
      await query('START TRANSACTION; INSERT INTO parameter_values(id) VALUES (32)', undefined, isolated);
      await expect(query('CREATE TABLE parameter_values (id INT)', undefined, isolated)).rejects.toThrow();
      const state = await engine.handle('query.sessionState', { sessionId: isolated });
      expect(state.transactionKnown).toBe(false); expect(state.broken).toBe(false);
      await engine.handle('query.transaction', { sessionId: isolated, action: 'rollback' });
      expect(await engine.handle('query.sessionState', { sessionId: isolated })).toEqual({ transactionOpen: false, transactionKnown: true, broken: false });
      expect(firstValues(await query('SELECT COUNT(*) FROM parameter_values WHERE id=32', undefined, isolated)).map(String)).toEqual(['1']);
    } finally { await engine.handle('sessions.close', { sessionId: isolated }); }
  });
});
