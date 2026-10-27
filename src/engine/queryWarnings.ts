import { queryWarningsLimits, type QueryWarningCondition, type QueryStatementWarnings, type QueryWarningsReport } from '../shared/queryWarnings';
import type { QueryFailureSourceRange } from '../shared/queryFailure';
import { truncateQueryScriptMessage } from '../shared/queryContinueOnError';

export const queryWarningsCountSql = 'SHOW COUNT(*) WARNINGS';
export const queryWarningsDetailsSql = 'SHOW WARNINGS LIMIT 101';
export interface QueryWarningsContext {
  query(sql: string): Promise<{ rows: unknown; fields: readonly { name: string }[] }>;
  check(): void;
  broken(): boolean;
}
interface Statement { statementOrdinal: number; sourceRange?: QueryFailureSourceRange; status: 'completed' | 'failed'; }

/** 非负计数只接受精确安全整数，不能把驱动异常或丢精度值当零。 */
function count(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^(?:0|[1-9]\d{0,15})$/.test(value)) {
    const parsed = Number(value); if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw Error('警告计数格式未知');
}

/** 原始Message只在本进程临时存在；先脱敏，再计算任何报告JSON或字节预算。 */
export class QueryWarningCollector {
  readonly report: QueryWarningsReport = { collection: 'explicit', statements: [], omittedStatements: 0, truncated: false };
  private stopped = false;
  /** 参数隐私策略在原任务创建时冻结，采集期间不再从界面读取。 */
  constructor(private readonly parameterized: boolean) {}

  /** 预算只停止诊断，不停止用户脚本；预留空间给计数增长和明确不完整标记。 */
  private begin(statement: Statement): QueryStatementWarnings | undefined {
    if (this.stopped || this.report.statements.length >= queryWarningsLimits.statements || Buffer.byteLength(JSON.stringify(this.report)) >= queryWarningsLimits.totalBytes - 1024) {
      this.stopped = true; this.report.omittedStatements++; this.report.truncated = true; return;
    }
    return { ...statement, ...(statement.sourceRange ? { sourceRange: { ...statement.sourceRange } } : {}), conditions: [], truncated: false };
  }

  /** 提交已脱敏的有界组；任何截断都显式展示，绝不通过回退扩大预算。 */
  private finish(group: QueryStatementWarnings): void {
    const base = Buffer.byteLength(JSON.stringify(this.report));
    while (group.conditions.length && base + Buffer.byteLength(JSON.stringify(group)) > queryWarningsLimits.totalBytes - 1024) {
      group.conditions.pop(); group.truncated = true; this.stopped = true;
    }
    if (base + Buffer.byteLength(JSON.stringify(group)) > queryWarningsLimits.totalBytes - 512) {
      this.stopped = true; this.report.omittedStatements++; this.report.truncated = true; return;
    }
    this.report.statements.push(group);
    if (group.truncated || group.unavailable) this.report.truncated = true;
  }

  /** 取消、断线或没有原命令终态时不向会话发送SHOW，也不补造完整诊断。 */
  unavailable(statement: Statement): void {
    const group = this.begin(statement); if (!group) return;
    group.truncated = true; group.unavailable = '原命令状态不允许读取警告，未发送额外诊断'; this.finish(group);
  }

  /** 每条原SQL结束后读取同一会话；内部SHOW不成为用户语句或结果。 */
  async capture(statement: Statement, context: QueryWarningsContext): Promise<void> {
    context.check();
    const group = this.begin(statement); if (!group) return;
    try {
      context.check();
      const counted = await context.query(queryWarningsCountSql);
      context.check();
      if (!Array.isArray(counted.rows) || counted.rows.length !== 1 || !counted.rows[0] || typeof counted.rows[0] !== 'object' || Array.isArray(counted.rows[0]) || !Array.isArray(counted.fields) || counted.fields.length !== 1) throw Error('警告计数结果不完整');
      const row = counted.rows[0] as Record<string, unknown>, keys = Object.keys(row);
      if (keys.length !== 1 || keys[0] !== counted.fields[0].name) throw Error('警告计数列不明确');
      group.warningCount = count(row[keys[0]]);
      if (group.warningCount > 0) {
        context.check();
        const details = await context.query(queryWarningsDetailsSql);
        context.check();
        const names = ['Level', 'Code', 'Message'];
        if (!Array.isArray(details.rows) || details.rows.length > queryWarningsLimits.conditions + 1 || !Array.isArray(details.fields) || details.fields.length !== 3 || details.fields.some((field, index) => field.name !== names[index])) throw Error('警告明细结果不完整');
        for (const item of details.rows.slice(0, queryWarningsLimits.conditions)) {
          if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 3 || names.some(name => !Object.hasOwn(item, name))) throw Error('警告明细形状未知');
          const raw = item as Record<string, unknown>, code = count(raw.Code);
          if (!['Note', 'Warning', 'Error'].includes(raw.Level as string) || code < 1 || code > 65535) throw Error('警告级别或代码未知');
          const condition: QueryWarningCondition = { level: raw.Level as string, code };
          if (this.parameterized) condition.messageHidden = true;
          else {
            if (typeof raw.Message !== 'string') throw Error('警告正文格式未知');
            const message = truncateQueryScriptMessage(raw.Message, queryWarningsLimits.messageBytes, queryWarningsLimits.messageBytes);
            condition.message = message;
            if (message !== raw.Message) { condition.messageTruncated = true; group.truncated = true; }
          }
          group.conditions.push(condition);
        }
        if (details.rows.length > queryWarningsLimits.conditions || group.conditions.length < group.warningCount || group.conditions.length > group.warningCount) group.truncated = true;
      }
    } catch {
      // 此检查保持真实取消拒绝；原Message/sqlMessage/stack从不进入可持久化报告。
      context.check();
      group.truncated = true; group.unavailable = '警告采集未完整完成；原语句的执行事实保留，未自动重试';
      this.finish(group);
      if (context.broken()) throw Error('原连接已断开，警告采集未完成；原语句可能已执行，不会自动重连或重放');
      return;
    }
    this.finish(group);
  }
}
