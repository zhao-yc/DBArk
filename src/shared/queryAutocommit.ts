import { z } from 'zod';
import { queryTransactionSettingsSnapshotSchema, type QueryTransactionSettingsSnapshot } from './queryTransactionSettings';

/** 自动提交仅作用于原会话；不接受SQL、GLOBAL作用域、宽松布尔值或继承字段。 */
export const queryAutocommitApplySchema = z.preprocess((value, context) => {
  const keys = ['sessionId', 'taskId', 'expected', 'autocommit', 'allowImplicitCommit'];
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length) throw Error();
    const copy: Record<string, unknown> = Object.create(null);
    for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error(); copy[key] = descriptor.value; }
    return copy;
  } catch { context.addIssue({ code: 'custom', message: '自动提交设置必须包含完整的原会话快照和明确确认' }); return z.NEVER; }
}, z.object({ sessionId: z.string().min(1).max(200), taskId: z.string().min(1).max(200), expected: queryTransactionSettingsSnapshotSchema, autocommit: z.boolean(), allowImplicitCommit: z.boolean() }).strict()).superRefine((input, context) => {
  if (input.autocommit && !input.expected.autocommit && input.expected.transactionOpen && !input.allowImplicitCommit) context.addIssue({ code: 'custom', message: '开启自动提交将提交当前事务，必须明确确认' });
});
export type QueryAutocommitApplyInput = z.infer<typeof queryAutocommitApplySchema>;

/** 快照来自单次SET的完整确认包；附加收尾失败不能抹掉已经确认的提交事实。 */
export const queryAutocommitOutputSchema = z.object({ confirmed: z.literal(true), changed: z.boolean(), implicitCommitAcknowledged: z.boolean(), snapshot: queryTransactionSettingsSnapshotSchema, cleanupWarning: z.string().min(1).max(2048).optional() }).strict().superRefine((value, context) => {
  if (value.implicitCommitAcknowledged && (!value.changed || !value.snapshot.autocommit || value.snapshot.transactionOpen)) context.addIssue({ code: 'custom', message: '自动提交确认与事务提交事实不一致' });
});
export type QueryAutocommitOutput = z.infer<typeof queryAutocommitOutputSchema>;

/** 回执必须属于完整原上下文及明确选择，不以仅相同的ON/OFF冒充成功。 */
export function checkQueryAutocommitOutput(raw: unknown, expected: QueryTransactionSettingsSnapshot, enabled: boolean): QueryAutocommitOutput {
  const before = queryTransactionSettingsSnapshotSchema.parse(expected), value = queryAutocommitOutputSchema.parse(raw), changed = before.autocommit !== enabled;
  if (value.changed !== changed || value.snapshot.autocommit !== enabled || value.snapshot.transactionOpen !== (changed && enabled ? false : before.transactionOpen) || value.implicitCommitAcknowledged !== (changed && enabled && before.transactionOpen)) throw Error('自动提交回执与原确认不一致');
  for (const key of ['dialect', 'serverVersion', 'serverConnectionId', 'database', 'isolation', 'readOnly'] as const) if (value.snapshot[key] !== before[key]) throw Error('自动提交回执的原会话身份或默认设置已变化');
  return value;
}

/** 主任务记录和界面共用准确事实；不把无活动事务的切换虚报为数据提交。 */
export function queryAutocommitConfirmedMessage(value: QueryAutocommitOutput): string {
  return `服务器已确认自动提交${value.snapshot.autocommit ? '开启' : '关闭'}${value.changed ? '' : '（原值保持，未发送SET）'}${value.implicitCommitAcknowledged ? '；原活动事务已确认提交' : ''}${value.cleanupWarning ? '；' + value.cleanupWarning : ''}`;
}
/** 未取得确认包时既不假定修改失败，也不重放可能已经提交的SET。 */
export function queryAutocommitMayHaveChanged(reason: unknown): Error {
  return new Error('自动提交设置或原事务提交结果未知，请核对原会话；不会自动重试或重放。' + (reason instanceof Error ? reason.message : String(reason)).slice(0, 1024), { cause: reason });
}
/** 已确认结果保留原事实，仅附加有界收尾说明；不重新发送任何命令。 */
export function queryAutocommitCleanup(value: QueryAutocommitOutput, reason: unknown): QueryAutocommitOutput {
  const message = reason instanceof Error ? reason.message : String(reason);
  return queryAutocommitOutputSchema.parse({ ...value, cleanupWarning: ('设置已确认，附加收尾异常，请显式重新读取核对；不会自动重试。' + message).slice(0, 2048) });
}
