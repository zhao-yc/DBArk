import type { ResultSetHeader } from 'mysql2';
import { execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier, qualified } from '../../src/engine/sql';

export const generatedWarningTableName = 'warning_generated_rows';
export interface GeneratedWarningProbe {
  state: 'ok' | 'overflow-error';
  warningStatus: number | null;
  diagnosticCodes: number[];
  storedGuard: string | null;
  okWarning: boolean;
  errorCode?: string;
  errorNumber?: number;
  sqlState?: string;
}

/** 只允许现有专项生成的随机库和一个固定表名；夹具不拥有建连、认证或模式修改入口。 */
function target(database: string): string {
  if (!/^dbark_file_import_[a-f0-9]{12}$/.test(database)) throw new Error('生成列警告夹具只允许本轮文件导入隔离库');
  return qualified(database, generatedWarningTableName);
}

/** id=501 计算出超出有符号 TINYINT 的 128；是否返回 OK 警告必须由真实服务器探测。 */
export function generatedWarningCreateSql(database: string): string {
  return `CREATE TABLE ${target(database)} (id INT PRIMARY KEY,${identifier('value')} VARCHAR(30),warning_guard TINYINT GENERATED ALWAYS AS (CASE WHEN id=501 THEN 128 ELSE 1 END) STORED) ENGINE=InnoDB`;
}

/** 原样执行真实预处理 INSERT，紧随其后读取诊断；不能把 ERR 包或缺失警告字段认作 OK 警告。 */
export async function probeGeneratedColumnWarning(managed: ManagedConnection, database: string): Promise<GeneratedWarningProbe> {
  const table = target(database), profile = managed.profile;
  if (profile.database !== database || profile.host !== '192.168.31.200' || ![13357, 13380, 13384, 13310, 13311, 13484].includes(profile.port) || profile.port === 13484 && !profile.tls?.enabled) throw new Error('生成列警告探针必须使用统筹注入的本轮专用连接');
  const mode = (await execute<{ mode: string }[]>(managed, 'SELECT @@SESSION.sql_mode AS mode')).rows;
  if (mode.length !== 1 || mode[0].mode !== '') throw new Error('生成列警告探针要求本轮专用非严格会话，不能修改 GLOBAL 或借用其它会话');
  await execute(managed, 'START TRANSACTION');
  try {
    const safe = (await execute<ResultSetHeader>(managed, `INSERT INTO ${table} (id,${identifier('value')}) VALUES (?,?)`, ['500', 'probe-safe'])).rows;
    const safeDiagnostics = (await execute<{ Code: number }[]>(managed, 'SHOW WARNINGS LIMIT 32')).rows;
    if (safe.affectedRows !== 1 || safe.warningStatus !== 0 || safeDiagnostics.length) throw new Error('生成列警告夹具的正常行未得到无警告 OK，不能用于批次边界验收');
    let warningStatus: number | null = null, state: GeneratedWarningProbe['state'] = 'ok', serverError: Pick<GeneratedWarningProbe, 'errorCode' | 'errorNumber' | 'sqlState'> = {};
    try {
      const result = (await execute<ResultSetHeader>(managed, `INSERT INTO ${table} (id,${identifier('value')}) VALUES (?,?)`, ['501', 'probe-warning'])).rows;
      if (result.affectedRows !== 1) throw new Error('生成列警告探针 INSERT 未写入恰好一行');
      warningStatus = Number.isInteger(result.warningStatus) ? result.warningStatus : null;
    } catch (reason) {
      // 只记录预期的真实越界 ERR；断网、权限、语法和其它错误仍使专项失败。
      const error = reason as { code?: string; errno?: number; sqlState?: string };
      if (error.errno !== 1264 || error.sqlState !== '22003') throw reason;
      state = 'overflow-error'; serverError = { errorCode: error.code, errorNumber: error.errno, sqlState: error.sqlState };
    }
    // 本语句必须紧接风险 INSERT；任何 SELECT 都会改变当前连接诊断区。
    const diagnostics = (await execute<{ Code: number }[]>(managed, 'SHOW WARNINGS LIMIT 32')).rows;
    const actual = (await execute<{ id: string | number; guard: string }[]>(managed, `SELECT id,CAST(warning_guard AS CHAR) AS guard FROM ${table} WHERE id IN (500,501) ORDER BY id`)).rows;
    if (String(actual[0]?.id) !== '500' || actual[0]?.guard !== '1' || actual.length !== (state === 'ok' ? 2 : 1)) throw new Error('生成列警告探针的事务内实际行与 OK/ERR 状态不符');
    const storedGuard = state === 'ok' ? actual[1]?.guard ?? null : null, diagnosticCodes = diagnostics.map(row => Number(row.Code));
    return { state, warningStatus, diagnosticCodes, storedGuard, okWarning: state === 'ok' && typeof warningStatus === 'number' && warningStatus > 0 && diagnosticCodes.includes(1264) && storedGuard === '127', ...serverError };
  } finally {
    // 能力探测永不提交；独立旁观者的零行确认和连接关闭由原专项逐项执行。
    await execute(managed, 'ROLLBACK');
  }
}
