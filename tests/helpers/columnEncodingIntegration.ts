import type { ManagedConnection } from '../../src/engine/connection';
import {
  bindDatabaseEncodingTarget, databaseEncodingGate, watchDatabaseEncodingConnection,
  type DatabaseEncodingConnectionFact, type DatabaseEncodingLifetime,
} from './databaseDefaultEncodingIntegration';

export const columnEncodingIntegrationGate = 'DBARK_COLUMN_ENCODING_TEST';

/** 专属双门只映射原六实例身份合同；不加载凭据文件，也不按版本跳过已开放的类型。 */
export function bindColumnEncodingTarget(read: () => Record<string, string | undefined>, id: string) {
  return bindDatabaseEncodingTarget(() => {
    const raw = read();
    if (Object.hasOwn(raw, databaseEncodingGate)) throw Error('列字符集验收不能同时开启数据库编码用途');
    return { ...raw, [databaseEncodingGate]: raw[columnEncodingIntegrationGate] };
  }, id);
}

export interface ColumnEncodingPreflight {
  rowCount?: string; lossy?: string; defaultLossy?: string; maxConvertedBytes?: string;
}
export interface ColumnEncodingConnectionFact extends DatabaseEncodingConnectionFact {
  modeReads: string[]; ddlModes: (string | undefined)[];
  ddlWarnings: (number | undefined)[]; ddlErrors: (number | undefined)[];
  preflights: ColumnEncodingPreflight[];
}

/** 在原严格旁观器之外只留模式、警告和聚合计数；原方法、参数、回调及响应全部透传。 */
export function watchColumnEncodingConnection(managed: ManagedConnection, scope: string, owner: DatabaseEncodingLifetime, allowedSql: () => string | undefined): ColumnEncodingConnectionFact {
  const fact: ColumnEncodingConnectionFact = Object.assign(watchDatabaseEncodingConnection(managed, scope, owner, allowedSql), {
    modeReads: [] as string[], ddlModes: [] as (string | undefined)[],
    ddlWarnings: [] as (number | undefined)[], ddlErrors: [] as (number | undefined)[],
    preflights: [] as ColumnEncodingPreflight[],
  });
  for (const method of ['query', 'execute'] as const) {
    const original = fact.native[method];
    fact.native[method] = function (...args: unknown[]) {
      const text = typeof args[0] === 'string' ? args[0] : '', callback = args.at(-1);
      const ddl = /^ALTER\b/i.test(text);
      if (ddl) fact.ddlModes.push(fact.modeReads.at(-1));
      if (typeof callback === 'function') {
        args[args.length - 1] = function (this: unknown, ...result: unknown[]) {
          const [error, rows] = result;
          if (ddl) {
            const header = rows && typeof rows === 'object' ? rows as Record<string, unknown> : undefined;
            const failure = error && typeof error === 'object' ? error as Record<string, unknown> : undefined;
            fact.ddlWarnings.push(typeof header?.warningStatus === 'number' ? header.warningStatus : undefined);
            fact.ddlErrors.push(typeof failure?.errno === 'number' ? failure.errno : undefined);
          }
          if (!error && Array.isArray(rows) && rows.length === 1 && rows[0] && typeof rows[0] === 'object') {
            const row = rows[0] as Record<string, unknown>;
            if (/^SELECT @@SESSION\.sql_mode AS sqlMode(?:,|$)/.test(text) && typeof row.sqlMode === 'string') fact.modeReads.push(row.sqlMode);
            if (/^SELECT CAST\(COUNT\(\*\) AS CHAR\) AS rowCount,/.test(text) && / AS defaultLossy,/.test(text)) {
              const counts: ColumnEncodingPreflight = {};
              for (const key of ['rowCount', 'lossy', 'defaultLossy', 'maxConvertedBytes'] as const) {
                if (typeof row[key] === 'string' && /^(?:0|[1-9]\d{0,19})$/.test(row[key])) counts[key] = row[key];
              }
              fact.preflights.push(counts);
            }
          }
          return callback.apply(this, result);
        };
      }
      return original.apply(fact.native, args);
    };
  }
  return fact;
}

// 原120秒owner、原managed身份、原流close和精确收尾直接沿用，不能用新期限替换。
export {
  databaseEncodingLifetime as columnEncodingLifetime,
  loadDatabaseEncodingModules as loadColumnEncodingModules,
  assertDatabaseEncodingIdentity as assertColumnEncodingIdentity,
  assertDatabaseEncodingReleased as assertColumnEncodingReleased,
  closeDatabaseEncodingObserver as closeColumnEncodingObserver,
  type DatabaseEncodingLifetime as ColumnEncodingLifetime,
} from './databaseDefaultEncodingIntegration';
