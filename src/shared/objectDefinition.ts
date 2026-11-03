import { z } from 'zod';
import { definitionTextWithinBudget } from './definitionNavigation';

export const objectDefinitionLimits = { active: 2, identifierUnits: 512, ddlBytes: 2 * 1024 * 1024, rowBytes: 2 * 1024 * 1024 + 16 * 1024 } as const;
export const objectDefinitionTaskPrefix = 'object-definition:';
export interface ObjectDefinitionInput { connectionId: string; sessionId?: string; database?: string; table: string; taskId: string; }
export interface ObjectDefinitionOutput { request: ObjectDefinitionInput; database: string; name: string; kind: 'table' | 'view'; temporary: boolean; ddl: string; revision?: number; }

/** 仅拒绝无损Unicode无法表达的名称；合法补充平面字符不变成替换字符。 */
export function objectDefinitionIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= objectDefinitionLimits.identifierUnits && !value.includes('\0') && wellFormed(value);
}

/** ES2022运行时逐码元检查代理对，避免依赖更新版本String扩展。 */
function wellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

/** 在schema读取前拒绝额外隐藏字段、访问器及非普通对象，不执行不可信getter。 */
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('对象定义参数无效');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw Error('对象定义参数无效');
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error('对象定义参数无效');
    result[key] = descriptor.value;
  }
  return result;
}
const id = z.string().min(1).max(200).refine(value => !value.includes('\0') && wellFormed(value), '对象定义编号无效');
const identifier = z.string().refine(objectDefinitionIdentifier, '对象名须为1～512个有效Unicode字符且不能含NUL');
export const objectDefinitionInputSchema = z.preprocess((value, context) => {
  try { return fields(value, ['connectionId', 'table', 'taskId'], ['sessionId', 'database']); }
  catch { context.addIssue({ code: 'custom', message: '对象定义参数无效' }); return z.NEVER; }
}, z.object({ connectionId: id, sessionId: id.optional(), database: identifier.optional(), table: identifier, taskId: id.refine(value => value.startsWith(objectDefinitionTaskPrefix) && value.length > objectDefinitionTaskPrefix.length, '对象定义任务编号前缀无效或缺少后缀') }).strict());

/** DDL沿用完整定义原文约束：2MiB、合法Unicode；NUL不做替换或截断。 */
export function objectDefinitionDdl(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && definitionTextWithinBudget(value);
}

export const objectDefinitionOutputSchema = z.preprocess((value, context) => {
  try { return fields(value, ['request', 'database', 'name', 'kind', 'temporary', 'ddl'], ['revision']); }
  catch { context.addIssue({ code: 'custom', message: '对象定义回包无效' }); return z.NEVER; }
}, z.object({ request: objectDefinitionInputSchema, database: identifier, name: identifier, kind: z.enum(['table', 'view']), temporary: z.boolean(), ddl: z.string().refine(objectDefinitionDdl, '对象定义不完整或超限'), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() }).strict());

/** SQLite目录只按ASCII折叠，非ASCII字符不套用JavaScript的Unicode小写规则。 */
function sqliteFold(value: string): string { return value.replace(/[A-Z]/g, character => character.toLowerCase()); }

/** Main只交付原请求的完整确认；方言来自可信配置，不能由回包自行声明。 */
export function assertObjectDefinitionOutput(value: unknown, input: ObjectDefinitionInput, dialect: 'mysql' | 'mariadb' | 'sqlite' = 'mysql'): asserts value is ObjectDefinitionOutput {
  try {
    const output = fields(value, ['request', 'database', 'name', 'kind', 'temporary', 'ddl'], ['revision']);
    const request = objectDefinitionInputSchema.parse(output.request);
    const expected = objectDefinitionInputSchema.parse(input);
    if (request.connectionId !== expected.connectionId || request.sessionId !== expected.sessionId || request.database !== expected.database || request.table !== expected.table || request.taskId !== expected.taskId) throw Error();
    const sqlite = dialect === 'sqlite';
    if (!objectDefinitionIdentifier(output.database) || !objectDefinitionIdentifier(output.name) || (sqlite ? sqliteFold(output.name) !== sqliteFold(expected.table) : output.name !== expected.table) || expected.database !== undefined && (sqlite ? sqliteFold(output.database) !== sqliteFold(expected.database) : output.database !== expected.database) || sqlite && !['main', 'temp'].includes(output.database) || !['table', 'view'].includes(output.kind as string) || typeof output.temporary !== 'boolean' || output.temporary && !expected.sessionId || !objectDefinitionDdl(output.ddl)) throw Error();
    if (sqlite && (output.temporary !== (output.database === 'temp') || !expected.sessionId && output.database !== 'main')) throw Error();
    if (!sqlite && output.temporary && output.kind !== 'table') throw Error();
    if (Object.hasOwn(output, 'revision') && (!expected.sessionId || !Number.isSafeInteger(output.revision) || (output.revision as number) < 0)) throw Error();
  } catch { throw Error('对象完整定义回包无效，请重新读取'); }
}
