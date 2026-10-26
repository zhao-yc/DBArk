import { z } from 'zod';
import type { QueryFailure } from './queryFailure';

/** 续执行报告只记录有界失败事实，不保存参数展开值或宣称所有SQL已提交。 */
export interface QueryScriptReport {
  mode: 'continue-on-error';
  statementsAttempted: number;
  statementsCompleted: number;
  reachedEnd: boolean;
  errors: Array<QueryFailure & { kind: 'server' | 'stopped' }>;
  stopReason?: string;
}
export const queryContinueOnErrorLimits = {
  errors: 100, errorMessageUnits: 4096, errorMessageBytes: 4096, stopReasonUnits: 4096, totalBytes: 512 * 1024,
} as const;
const encoder = new TextEncoder();

/** 读取Error自有数据字段，不执行未知错误对象的getter或字符串化钩子。 */
function data(error: unknown, key: string): unknown {
  if (!error || typeof error !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

// 除网络SQLSTATE外，还覆盖服务器以HY000/70100返回的关闭、取消和超时。
const stopErrnos = new Set([1040, 1053, 1077, 1079, 1080, 1129, 1130, 1152, 1153, 1154, 1155, 1156, 1157, 1158, 1159, 1160, 1161, 1184, 1317, 1927, 1969, 2006, 2013, 2014, 2027, 2055, 3024, 4031]);
const stopCodes = new Set(['ER_QUERY_INTERRUPTED', 'ER_CONNECTION_KILLED', 'ER_QUERY_TIMEOUT', 'ER_STATEMENT_TIMEOUT', 'ER_SERVER_SHUTDOWN', 'ER_CLIENT_INTERACTION_TIMEOUT']);

/** 只筛选mysql2服务器ERR形状；调用者仍须证明来自本条原驱动ERR，不能凭形状接纳本地伪造错误。 */
export function canContinueQueryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const errno = data(error, 'errno'), sqlState = data(error, 'sqlState'), code = data(error, 'code'), fatal = data(error, 'fatal');
  if (typeof errno !== 'number' || !Number.isInteger(errno) || errno < 1 || errno > 65535 || stopErrnos.has(errno)) return false;
  if (typeof sqlState !== 'string' || !/^[A-Z0-9]{5}$/u.test(sqlState) || sqlState === '00000' || sqlState.startsWith('08') || sqlState === '70100') return false;
  if (typeof code !== 'string' || !/^ER_[A-Z0-9_]{1,93}$/u.test(code) || stopCodes.has(code) || /^ER_(?:NET_|ABORTING_CONNECTION|NEW_ABORTING_CONNECTION|FORCING_CLOSE|NORMAL_SHUTDOWN|SHUTDOWN_COMPLETE)/u.test(code)) return false;
  // 真正ERR的fatal通常未设置；异常类型不能通过字符串/数字强制转换蒙混。
  if (fatal !== undefined && fatal !== false) return false;
  for (const key of ['errno', 'sqlState', 'code', 'fatal']) {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    if (descriptor && !('value' in descriptor)) return false;
  }
  return true;
}

/** 同时限制UTF16、原文UTF8和JSON转义预算；仅截断原文，不拆代理对或生成等长巨大副本。 */
export function truncateQueryScriptMessage(value: string, maxUnits: number = queryContinueOnErrorLimits.errorMessageUnits, maxBytes: number = queryContinueOnErrorLimits.errorMessageBytes): string {
  if (typeof value !== 'string' || !Number.isSafeInteger(maxUnits) || maxUnits < 0 || maxUnits > queryContinueOnErrorLimits.errorMessageUnits || !Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > queryContinueOnErrorLimits.errorMessageBytes) throw Error('脚本错误摘要预算无效');
  let candidate = value.slice(0, maxUnits);
  if (candidate.length < value.length && /[\uD800-\uDBFF]/u.test(candidate.at(-1) ?? '') && /[\uDC00-\uDFFF]/u.test(value[candidate.length] ?? '')) candidate = candidate.slice(0, -1);
  const fits = (text: string) => encoder.encode(text).byteLength <= maxBytes && encoder.encode(JSON.stringify(text)).byteLength - 2 <= maxBytes;
  if (fits(candidate)) return candidate;
  let low = 0, high = candidate.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(candidate.slice(0, middle))) low = middle; else high = middle - 1;
  }
  if (low > 0 && /[\uD800-\uDBFF]/u.test(candidate[low - 1]) && /[\uDC00-\uDFFF]/u.test(candidate[low] ?? '')) low--;
  return candidate.slice(0, low);
}

/** 类型参数错误统一隐藏原message/sql/sqlMessage，只留下mysql2常量错误码，杜绝展开值进入报告。 */
export function formatQueryScriptError(error: unknown, parameterized = false): string {
  const rawCode = data(error, 'code'), code = typeof rawCode === 'string' && /^ER_[A-Z0-9_]{1,93}$/u.test(rawCode) ? rawCode : undefined;
  if (parameterized) return code ? `SQL语句失败（${code}）；有类型参数错误详情已隐藏。` : 'SQL语句未完成；有类型参数错误详情已隐藏。';
  const message = typeof error === 'string' ? error : data(error, 'message');
  const detail = typeof message === 'string' && message.length ? message : '未取得可展示的错误详情';
  return truncateQueryScriptMessage(`SQL语句未完成${code ? `（${code}）` : ''}：${detail}`);
}

const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);
const message = z.string().min(1).max(queryContinueOnErrorLimits.errorMessageUnits).refine(value => value.length <= queryContinueOnErrorLimits.errorMessageUnits && encoder.encode(value).byteLength <= queryContinueOnErrorLimits.errorMessageBytes, '脚本错误详情超过字节上限');
const errorSchema = z.object({
  kind: z.enum(['server', 'stopped']), statementOrdinal: integer.refine(value => value > 0, '失败语句序号必须为正整数'), statementsCompleted: integer,
  message, sourceRange: z.object({ start: integer, end: integer }).strict().refine(value => value.end >= value.start, '失败语句范围无效').optional(),
}).strict();
/** 先拒绝超量数组，避免Zod先遍历任意多的失败记录才报告max限制。 */
const errorsSchema = z.preprocess((value, context) => {
  if (!Array.isArray(value) || value.length > queryContinueOnErrorLimits.errors) { context.addIssue({ code: 'custom', message: '脚本错误记录必须为至多100项的数组' }); return z.NEVER; }
  return value;
}, z.array(errorSchema).max(queryContinueOnErrorLimits.errors));

/** 报告只接受有限完整事实；停止记录可发生在下一条投递前，不能把序号强等同物理发送次数。 */
export const queryScriptReportSchema = z.object({
  mode: z.literal('continue-on-error'), statementsAttempted: integer, statementsCompleted: integer, reachedEnd: z.boolean(),
  errors: errorsSchema, stopReason: message.optional(),
}).strict().superRefine((report, context) => {
  const invalid = (text: string) => context.addIssue({ code: 'custom', message: text });
  // 上层长度失败已经记录错误，不能再为超长原文创建JSON/UTF8巨大副本。
  if (report.errors.some(error => error.message.length > queryContinueOnErrorLimits.errorMessageUnits) || (report.stopReason?.length ?? 0) > queryContinueOnErrorLimits.stopReasonUnits) return;
  if (report.statementsCompleted > report.statementsAttempted) invalid('已完成数不能大于尝试处理数');
  if (report.reachedEnd && (report.stopReason !== undefined || report.errors.some(error => error.kind === 'stopped'))) invalid('已到脚本末尾不能同时声明提前停止');
  if (!report.reachedEnd && report.stopReason === undefined) invalid('提前停止必须保留停止原因');
  let previousOrdinal = 0, previousCompleted = 0, stopped = false;
  for (const error of report.errors) {
    if (stopped || error.statementOrdinal <= previousOrdinal || error.statementsCompleted < previousCompleted || error.statementsCompleted > report.statementsCompleted || error.statementsCompleted >= error.statementOrdinal) invalid('失败顺序或已完成数不一致');
    if (error.statementOrdinal > report.statementsAttempted + (error.kind === 'stopped' ? 1 : 0)) invalid('失败序号超出脚本处理范围');
    previousOrdinal = error.statementOrdinal; previousCompleted = error.statementsCompleted; stopped = error.kind === 'stopped';
  }
  if (encoder.encode(JSON.stringify(report)).byteLength > queryContinueOnErrorLimits.totalBytes) invalid('脚本续执行报告超过512 KiB总预算');
});

/** 续执行摘要明确区分到达末尾与中途停止；完成表示语句成功，不代表事务已提交。 */
export function queryScriptReportSummary(report: QueryScriptReport): string {
  const value = queryScriptReportSchema.parse(report);
  return `已尝试处理${value.statementsAttempted}条语句，完成${value.statementsCompleted}条，记录${value.errors.length}项错误；${value.reachedEnd ? '已到脚本末尾' : '脚本提前停止'}。此前已提交的操作保留，未自动回滚或重放；完成不代表事务已提交。`;
}
