import type { ResultSetHeader } from 'mysql2';
import { execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier, qualified } from '../../src/engine/sql';

export const timestampWarningTableName = 'timestamp_warning_rows';
export const timestampWarningSafeValue = '2026-10-16 10:20:30.123456';
export const timestampWarningOverflowValue = '9999-01-01 00:00:00.000000';
export interface TimestampWarningProbe {
  state: 'ok' | 'range-error';
  warningStatus: number | null;
  diagnosticCodes: number[];
  storedValue: string | null;
  okWarning: boolean;
  errorCode?: string;
  errorNumber?: number;
  sqlState?: string;
}

/** 表和库均沿用专项固定范围；不能让可变目标进入能力探针。 */
function target(database: string): string {
  if (!/^dbark_file_import_[a-f0-9]{12}$/.test(database)) throw new Error('时间戳警告夹具只允许本轮文件导入隔离库');
  return qualified(database, timestampWarningTableName);
}

/** 普通 TIMESTAMP 字段不依赖触发器或生成列；实际范围及诊断由原内核返回。 */
export function timestampWarningCreateSql(database: string): string {
  return `CREATE TABLE ${target(database)} (id INT PRIMARY KEY,${identifier('value')} TIMESTAMP(6) NULL) ENGINE=InnoDB`;
}

/** 用真实预处理写入合法日历但超存储范围的时间戳，下一条语句必须读取真实诊断。 */
export async function probeTimestampRangeWarning(managed: ManagedConnection, database: string): Promise<TimestampWarningProbe> {
  const table = target(database), profile = managed.profile;
  if (profile.database !== database || profile.host !== '192.168.31.200' || ![13357, 13380, 13384, 13310, 13311, 13484].includes(profile.port) || profile.port === 13484 && !profile.tls?.enabled) throw new Error('时间戳探针必须使用统筹注入的本轮专用连接');
  const mode = (await execute<{ mode: string }[]>(managed, 'SELECT @@SESSION.sql_mode AS mode')).rows;
  if (mode.length !== 1 || mode[0].mode !== '') throw new Error('时间戳探针要求本轮专用非严格会话，不能修改 GLOBAL 或借用其它会话');
  await execute(managed, 'START TRANSACTION');
  try {
    const safe = (await execute<ResultSetHeader>(managed, `INSERT INTO ${table} (id,${identifier('value')}) VALUES (?,?)`, ['500', timestampWarningSafeValue])).rows;
    const safeDiagnostics = (await execute<{ Code: number }[]>(managed, 'SHOW WARNINGS LIMIT 32')).rows;
    if (safe.affectedRows !== 1 || safe.warningStatus !== 0 || safeDiagnostics.length) throw new Error('时间戳正常行未得到无警告 OK，不能用于批次边界验收');
    let warningStatus: number | null = null, state: TimestampWarningProbe['state'] = 'ok', serverError: Pick<TimestampWarningProbe, 'errorCode' | 'errorNumber' | 'sqlState'> = {};
    try {
      const result = (await execute<ResultSetHeader>(managed, `INSERT INTO ${table} (id,${identifier('value')}) VALUES (?,?)`, ['501', timestampWarningOverflowValue])).rows;
      if (result.affectedRows !== 1) throw new Error('时间戳警告探针 INSERT 未写入恰好一行');
      warningStatus = Number.isInteger(result.warningStatus) ? result.warningStatus : null;
    } catch (reason) {
      // 预期范围/时间错误如实记录；其它权限、语法、网络错误仍直接失败。
      const error = reason as { code?: string; errno?: number; sqlState?: string };
      if (!(error.errno === 1264 && error.sqlState === '22003' || error.errno === 1292 && error.sqlState === '22007')) throw reason;
      state = 'range-error'; serverError = { errorCode: error.code, errorNumber: error.errno, sqlState: error.sqlState };
    }
    const diagnostics = (await execute<{ Code: number }[]>(managed, 'SHOW WARNINGS LIMIT 32')).rows;
    // 诊断先保存，再用真实 SELECT 确认正常行及风险行实际存储内容，不能据预测补出数据。
    const actual = (await execute<{ id: string | number; value: string | null }[]>(managed, `SELECT id,CAST(${identifier('value')} AS CHAR) AS ${identifier('value')} FROM ${table} WHERE id IN (500,501) ORDER BY id`)).rows;
    if (String(actual[0]?.id) !== '500' || actual[0]?.value !== timestampWarningSafeValue || actual.length !== (state === 'ok' ? 2 : 1)) throw new Error('时间戳探针事务内实际行与 OK/ERR 状态不符');
    const storedValue = state === 'ok' ? actual[1]?.value ?? null : null, diagnosticCodes = diagnostics.map(row => Number(row.Code));
    return { state, warningStatus, diagnosticCodes, storedValue, okWarning: state === 'ok' && typeof warningStatus === 'number' && warningStatus > 0 && diagnosticCodes.some(code => code === 1264 || code === 1292) && storedValue !== timestampWarningOverflowValue, ...serverError };
  } finally {
    // 成功、预期 ERR、异常均回滚；调用方另用旁观连接核对零行并严格关闭此连接。
    await execute(managed, 'ROLLBACK');
  }
}
