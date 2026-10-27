import { z } from 'zod';
import { parseTableDraftPayload, parseTableDraftTarget, type TableDraftTarget } from './tableDraft';
import type { RowChange } from './contracts';

export interface TableDraftVerifyInput extends TableDraftTarget { taskId: string; metadataKey: string; changes: RowChange[]; }
/** IPC外壳只读取普通对象的自有数据字段，不让校验器先触发访问器。 */
function fields(value: unknown, names: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('草稿请求无效');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) throw Error('草稿请求字段无效');
  return Object.fromEntries(names.map(name => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw Error('草稿请求不能包含访问器');
    return [name, descriptor.value];
  }));
}
/** 描述符检查先于解析，错误统一转为跨进程可呈现的校验错误。 */
function schema<T>(parse: (value: unknown) => T) { return z.unknown().transform((value, context) => { try { return parse(value); } catch (reason) { context.addIssue({ code: 'custom', message: reason instanceof Error ? reason.message : '草稿请求无效' }); return z.NEVER; } }); }
export const tableDraftSaveSchema = schema(value => ({ payload: parseTableDraftPayload(fields(value, ['payload']).payload) }));
export const tableDraftOpenSchema = schema(value => ({ target: parseTableDraftTarget(fields(value, ['target']).target) }));
export const tableDraftVerifySchema = schema<TableDraftVerifyInput>(value => {
  const input = fields(value, ['connectionId', 'database', 'table', 'taskId', 'metadataKey', 'changes']);
  const target = parseTableDraftTarget({ connectionId: input.connectionId, database: input.database, table: input.table });
  const payload = parseTableDraftPayload({ target, metadataKey: input.metadataKey, changes: input.changes });
  if (typeof input.taskId !== 'string' || !z.string().uuid().safeParse(input.taskId).success) throw Error('草稿核验任务编号无效');
  return { ...target, taskId: input.taskId, metadataKey: payload.metadataKey, changes: payload.changes };
});
