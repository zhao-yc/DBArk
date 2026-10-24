import { z } from 'zod';

export const fileImportTransactionModeSchema = z.enum(['batch', 'atomic']);
export type FileImportTransactionMode = z.infer<typeof fileImportTransactionModeSchema>;
export const fileImportTransactionText = {
  invalid: '事务模式仅支持 batch 或 atomic，且只适用于 CSV/JSON 导入',
  atomicScope: '整文件原子提交仅覆盖目标 InnoDB 事务；触发器写入非事务表或外部副作用不保证回滚',
  transactionUnknown: '无法确认目标写入仍在同一事务内；未自动重放，请核对服务器',
  lockFailed: '整文件原子提交需要目标表 SELECT 权限以持有元数据锁；读取失败，未降级为分批提交',
  commitUnknown: '提交结果未确认，请核对数据库；未自动重放，不能宣称已回滚',
  rollbackUnknown: '回滚结果未确认，请核对数据库；不能宣称已回滚，未自动重放',
  committedCleanup: '服务器已确认导入提交，但附加收尾失败；请核对连接资源，不要重复导入',
} as const;

/** 自有字段先核类型和适用格式；省略保持历史分批模式，显式undefined不算省略。 */
export function fileImportTransactionMode(format: string, input: object): FileImportTransactionMode {
  const descriptor = Object.getOwnPropertyDescriptor(input, 'transactionMode');
  if (!descriptor) { if ('transactionMode' in input) throw Error(fileImportTransactionText.invalid); return 'batch'; }
  if (!('value' in descriptor) || !descriptor.enumerable || !['csv', 'json'].includes(format) || !fileImportTransactionModeSchema.safeParse(descriptor.value).success) throw Error(fileImportTransactionText.invalid);
  return descriptor.value as FileImportTransactionMode;
}
