import { completionLimits } from './sqlCompletion';
import { sqliteCompletionLimits } from './sqliteCompletion';

export type PhysicalObjectTokenContext = { status: 'blocked'; reason: string } | { status: 'ready'; tokens: { start: number; end: number; value: string; kind: string; closed?: boolean }[]; target: { start: number; end: number } };

export interface PhysicalObjectRange { start: number; end: number; }
export type PhysicalObjectAnalysis = { status: 'blocked'; reason: string } | {
  status: 'ready'; target: PhysicalObjectRange;
  object: { table: string; database?: string; tableRange: PhysicalObjectRange; databaseRange?: PhysicalObjectRange };
};

/** 只接受固定字段的普通记录；线程不得夹带URI、SQL、动作或目录结果。 */
function record(value: unknown, keys: string): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys;
}
/** 名称按UTF8字节累计预算，不能借多字节名称绕过传输上限。 */
function bytes(value: string): number { let total = 0; for (const character of value) { const point = character.codePointAt(0)!; total += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4; } return total; }

/** 回包只证明消息与原文token一致；物理角色仍由独占Worker中的原方言作用域解析负责。 */
export function validPhysicalObjectTokens(value: unknown, source: string, offset: number, dialect: 'mysql' | 'sqlite', context: PhysicalObjectTokenContext): value is PhysicalObjectAnalysis {
  if (record(value, 'reason,status') && value.status === 'blocked') return typeof value.reason === 'string' && /^[a-z-]{1,64}$/.test(value.reason);
  const limits = dialect === 'sqlite' ? sqliteCompletionLimits : completionLimits;
  if (typeof source !== 'string' || source.length > limits.sourceUnits || !Number.isSafeInteger(offset) || offset < 0 || offset > source.length || !record(value, 'object,status,target') || value.status !== 'ready') return false;
  const object = value.object;
  if (!object || typeof object !== 'object' || Array.isArray(object)) return false;
  const qualified = Object.hasOwn(object, 'database');
  if (!record(object, qualified ? 'database,databaseRange,table,tableRange' : 'table,tableRange')) return false;
  const name = (value: unknown): value is string => typeof value === 'string' && (dialect === 'mysql' ? value.length > 0 && value.length <= 64 && !/[\0\ud800-\udfff]/.test(value) : value.length > 0 && value.length <= sqliteCompletionLimits.nameUnits && !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
  if (!name(object.table) || qualified && (!name(object.database) || dialect === 'sqlite' && !['main', 'temp'].includes(object.database.replace(/[A-Z]/g, character => character.toLowerCase())))) return false;
  if (bytes(object.table) + (qualified ? bytes(object.database as string) : 0) > 4096) return false;
  if (context.status !== 'ready') return false;
  const tokens = context.tokens, origin = context.target;
  /** 范围必须对应同语句的完整单个名称，不接收跨词、截断或别条语句的位置。 */
  const tokenAt = (value: unknown) => record(value, 'end,start') && Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end) ? tokens.find(token => token.closed !== false && ['id', 'word', 'identifier'].includes(token.kind) && token.start === value.start && token.end === value.end) : undefined;
  const target = tokenAt(value.target), table = tokenAt(object.tableRange), database = qualified ? tokenAt(object.databaseRange) : undefined;
  if (!target || target.start !== origin.start || target.end !== origin.end || !table || table.value !== object.table || qualified && (!database || database.value !== object.database)) return false;
  // 限定名必须保持真实的两段相邻token，中间必须是方言词法确认的唯一点号。
  if (database) {
    const index = tokens.indexOf(database);
    if (tokens[index + 1]?.kind !== 'symbol' || tokens[index + 1]?.value !== '.' || tokens[index + 2] !== table) return false;
  }
  return true;
}
