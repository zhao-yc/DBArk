import { postgresNoticeHiddenMessage, postgresNoticeLevels, postgresNoticeLimits, postgresNoticeUnknownLevel, type PostgresNoticeEntry, type PostgresNoticeReport } from '../../shared/postgresNotices';
import { truncateQueryScriptMessage } from '../../shared/queryContinueOnError';
import type { QueryFailureSourceRange } from '../../shared/queryFailure';

/** 只读取驱动消息的自有字符串，不执行访问器，也不保留整个 NoticeMessage 或 SQL。 */
function stringField(value: unknown, name: string): string | undefined {
  if (!value || typeof value !== 'object') return;
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor && 'value' in descriptor && typeof descriptor.value === 'string' ? descriptor.value : undefined;
}

/** 一次用户执行的消息旁路：达到预算继续排空协议，但只增加省略计数，不影响原 SQL。 */
export class PostgresNoticeCollector {
  private received = 0;
  private bytes = 1024;
  private saturated = false;
  private truncated = false;
  private readonly entries: PostgresNoticeEntry[] = [];
  constructor(private readonly parameterized: boolean) {}

  record(statementOrdinal: number, sourceRange: QueryFailureSourceRange | undefined, raw: unknown, redact: (value: string) => string): void {
    this.received = Math.min(Number.MAX_SAFE_INTEGER, this.received + 1);
    if (this.saturated || this.entries.length >= postgresNoticeLimits.entries) { this.truncated = true; return; }
    try {
      const severity = stringField(raw, 'severity'), sqlState = stringField(raw, 'code');
      let cut = false;
      const bounded = (input: string, limit: number) => {
        const clean = redact(input), value = truncateQueryScriptMessage(clean, limit, limit); cut ||= value !== clean; return value;
      };
      const message = this.parameterized ? postgresNoticeHiddenMessage : stringField(raw, 'message');
      if (message === undefined || !Number.isInteger(statementOrdinal) || statementOrdinal < 1 || statementOrdinal > 1000) throw Error('消息形状无效');
      // 驱动只提供可能已本地化的级别；参数模式仅接受已知固定值，其余级别不猜测、不透传。
      const displayLevel = this.parameterized ? postgresNoticeLevels.find(level => level === severity) : severity && bounded(severity, 64);
      const entry: PostgresNoticeEntry = {sequence: this.received, statementOrdinal,
        severity: displayLevel || postgresNoticeUnknownLevel,
        ...(sqlState && /^[0-9A-Z]{5}$/.test(sqlState) ? {sqlState} : {}),
        message: this.parameterized ? message : bounded(message, postgresNoticeLimits.message), truncated: false,
        ...(sourceRange ? {sourceRange: {...sourceRange}} : {}),
      };
      if (!this.parameterized) for (const [source, target] of [['detail', 'detail'], ['hint', 'hint'], ['where', 'context']] as const) {
        const value = stringField(raw, source); if (value !== undefined) entry[target] = bounded(value, postgresNoticeLimits.field);
      }
      entry.truncated = cut;
      const bytes = new TextEncoder().encode(JSON.stringify(entry)).byteLength + 1;
      if (this.bytes + bytes > postgresNoticeLimits.bytes) { this.saturated = true; this.truncated = true; return; }
      this.entries.push(entry); this.bytes += bytes; this.truncated ||= cut;
    } catch { this.truncated = true; }
  }

  /** 空报告省略字段；返回纯值副本，关闭查询后不依赖驱动对象或监听器。 */
  report(): PostgresNoticeReport | undefined {
    if (!this.received) return;
    return {received: this.received, omitted: this.received - this.entries.length, truncated: this.truncated, redacted: this.parameterized,
      entries: this.entries.map(entry => ({...entry, ...(entry.sourceRange ? {sourceRange: {...entry.sourceRange}} : {})}))};
  }
}
