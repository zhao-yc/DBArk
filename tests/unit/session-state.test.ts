import { describe, expect, it } from 'vitest';
import { observeSessionError, observeSessionState, type ManagedConnection } from '../../src/engine/connection';
import { namedParameterTokens } from '../../src/shared/queryParameters';
import { SqlScriptScanner } from '../../src/engine/sql';

/** 只模拟服务器已确认的模式和状态；测试不发送附加 SQL 伪造诊断状态。 */
function managed(): ManagedConnection { return { sqlMode: '', serverStatus: 2, sqlModeTracking: true, broken: false } as ManagedConnection; }

describe('协议模式缓存的确定性与失效边界', () => {
  it('ERR 保留最后事务标志但标记未知，不猜测 NBE；下一份成功协议状态恢复可确认范围', () => {
    const active = managed(); active.serverStatus = 3;
    observeSessionError(active);
    expect(active.serverStatus).toBe(3); expect(active.transactionStateKnown).toBe(false); expect(active.noBackslashEscapesKnown).toBe(false); expect(active.sqlMode).toBeUndefined(); expect(active.broken).toBe(false);
    observeSessionState(active, { serverStatus: 514 });
    expect(active.serverStatus).toBe(514); expect(active.transactionStateKnown).toBe(true); expect(active.noBackslashEscapesKnown).toBe(false); expect(active.sqlMode).toBeUndefined();
  });
  it('完整模式报告和 EOF 事务位同步缓存，不改变物理连接状态', () => {
    const active = managed();
    observeSessionState(active, { sql: 'SET sql_mode=@future', serverStatus: 515, stateChanges: { systemVariables: { sql_mode: 'NO_BACKSLASH_ESCAPES,ANSI_QUOTES' } } });
    expect(active.sqlMode).toBe('NO_BACKSLASH_ESCAPES,ANSI_QUOTES'); expect(active.serverStatus).toBe(515);
    observeSessionState(active, { serverStatus: 514 });
    expect(active.sqlMode).toBe('NO_BACKSLASH_ESCAPES,ANSI_QUOTES'); expect(active.serverStatus).toBe(514); expect(active.broken).toBe(false);
  });
  it.each([
    "SET SESSION session_track_system_variables=''", 'SET @@SESSION.`session_track_system_variables` = @empty',
    '/*说明*/ CALL procedure_name()', '/*!50000 CALL procedure_name() */', 'EXECUTE prepared_name',
    "SET SESSION sql_mode='ANSI_QUOTES'",
  ])('没有完整报告时 %s 使两种词法模式不确定，但不回滚或关闭连接', sql => {
    const active = managed();
    observeSessionState(active, { sql, serverStatus: 3 });
    expect(active.sqlMode).toBeUndefined(); expect(active.serverStatus).toBe(3); expect(active.broken).toBe(false); expect(active.noBackslashEscapesKnown).toBe(false);
    observeSessionState(active, { sql: 'ROLLBACK', serverStatus: 2 });
    expect(active.noBackslashEscapesKnown).toBe(false); expect(active.transactionStateKnown).toBe(true);
  });
  it('普通字符串、注释和存储过程定义中的 CALL 不误判为已调用', () => {
    for (const sql of ["INSERT INTO t VALUES ('CALL p()')", '/*CALL p()*/ SET @value=1', "CREATE PROCEDURE p() BEGIN SET sql_mode='ANSI_QUOTES'; END", "SELECT 'session_track_system_variables'"]) {
      const active = managed(); observeSessionState(active, { sql, serverStatus: 2 }); expect(active.sqlMode).toBe('');
    }
  });
  it('CALL 报告真实恢复后的模式时保留可判定状态，之后正常解析模式敏感 SQL', () => {
    const active = managed();
    observeSessionState(active, { sql: 'CALL change_mode()', serverStatus: 2, stateChanges: { systemVariables: { sql_mode: '' } } });
    expect(active.sqlMode).toBe('');
  });
  it('无模式记录但 EOF 反斜线状态不符时失效，随后真实模式报告可以恢复', () => {
    const active = managed(); observeSessionState(active, { serverStatus: 514 }); expect(active.sqlMode).toBeUndefined();
    observeSessionState(active, { serverStatus: 514, sql: 'SET sql_mode=@future', stateChanges: { systemVariables: { sql_mode: 'NO_BACKSLASH_ESCAPES' } } });
    expect(active.sqlMode).toBe('NO_BACKSLASH_ESCAPES');
    expect(active.noBackslashEscapesKnown).toBe(true);
  });
  it('CALL 恢复模式与陈旧 NBE 位矛盾后，后续 EOF 不会使字面量变成参数', () => {
    const active = managed();
    observeSessionState(active, { sql: 'CALL change_mode()', serverStatus: 16898, stateChanges: { systemVariables: { sql_mode: '' } } });
    for (const serverStatus of [514, 515, 2]) {
      expect(active.sqlMode).toBeUndefined(); expect(active.noBackslashEscapesKnown).toBe(false);
      const mode = { noBackslashEscapes: Boolean((active.serverStatus ?? 0) & 512), noBackslashEscapesKnown: active.noBackslashEscapesKnown, ansiQuotes: false, ansiQuotesKnown: false };
      expect(() => namedParameterTokens("SELECT 'a\\', :ghost -- '\n", mode)).toThrow('歧义');
      observeSessionState(active, { sql: 'SELECT 1', serverStatus });
      expect(active.transactionStateKnown).toBe(true);
    }
    expect(active.noBackslashEscapesKnown).toBe(false);
    observeSessionState(active, { sql: 'SET sql_mode=@mode', serverStatus: 2, stateChanges: { systemVariables: { sql_mode: '' } } });
    expect(active.sqlMode).toBe(''); expect(active.noBackslashEscapesKnown).toBe(true);
    expect(namedParameterTokens("SELECT 'a\\', :ghost -- '\n", { noBackslashEscapes: false, ansiQuotes: false })).toEqual([]);
  });
  it('缺少同包状态位的模式报告不能用旧状态猜测一致性', () => {
    const active = managed();
    observeSessionState(active, { stateChanges: { systemVariables: { sql_mode: '' } } });
    expect(active.sqlMode).toBeUndefined(); expect(active.noBackslashEscapesKnown).toBe(false);
  });
  it('明确关闭跟踪优先于同一包里的模式快照，避免相信未来不会更新的值', () => {
    const active = managed();
    observeSessionState(active, { sql: 'SET session_track_system_variables=@empty', serverStatus: 2, stateChanges: { systemVariables: { sql_mode: '', session_track_system_variables: '' } } });
    expect(active.sqlMode).toBeUndefined(); expect(active.sqlModeTracking).toBe(false); expect(active.noBackslashEscapesKnown).toBe(false);
  });
});

describe('ANSI 未知时的双候选词法', () => {
  it('ERR 后四种模式都须同意边界，安全参数可继续，单引号反斜线歧义不能放行', () => {
    const mode = { noBackslashEscapes: false, ansiQuotes: false, ansiQuotesKnown: false, noBackslashEscapesKnown: false };
    expect(namedParameterTokens('SELECT :v', mode).map(token => token.name)).toEqual(['v']);
    expect(() => namedParameterTokens("SELECT 'path\\', :v", mode)).toThrow('歧义');
    const scanner = new SqlScriptScanner(false, false, false, false);
    expect(scanner.push('SELECT :v; ROLLBACK;', true, 1)).toEqual(['SELECT :v']);
    expect(scanner.push('', true, 1)).toEqual(['ROLLBACK']);
    expect(() => new SqlScriptScanner(false, false, false, false).push("SELECT 'path\\';", true, 1)).toThrow('歧义');
  });
  it('跨块保留两套状态，DELIMITER 存储程序和普通标签不受限制', () => {
    const scanner = new SqlScriptScanner(false, false, false); const result: string[] = [];
    const sql = 'DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT :v; END$$\nDELIMITER ;\nCALL p(); SELECT :v;';
    for (const char of sql) { let next = scanner.push(char, false, 1); while (next.length) { result.push(...next); next = scanner.push('', false, 1); } }
    result.push(...scanner.push('', true, 1)); result.push(...scanner.push('', true, 1));
    expect(result).toEqual(['CREATE PROCEDURE p() BEGIN SELECT :v; END', 'CALL p()', 'SELECT :v']);
  });
  it('分句边界存在歧义时，不先发送任何候选语句', () => {
    const scanner = new SqlScriptScanner(false, false, false);
    expect(() => scanner.push('SELECT "path\\"; INSERT INTO t VALUES (1)', true, 1)).toThrow('歧义');
  });
  it('分句一致但参数处于不同引用范围也拒绝绑定', () => {
    const mode = { noBackslashEscapes: false, ansiQuotes: false, ansiQuotesKnown: false };
    expect(() => namedParameterTokens('SELECT "a\\" :v "b\\""', mode)).toThrow('歧义');
    expect(namedParameterTokens('SELECT :v, "name"', mode).map(token => token.name)).toEqual(['v']);
  });
});
