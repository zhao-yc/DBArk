import { z } from 'zod';

/** 只读取消状态不携带目标、SQL或可由界面回传的执行证据。 */
export const taskCancelStateSchema = z.enum(['allowed', 'checking', 'confirming', 'finished']);
export type TaskCancelState = z.infer<typeof taskCancelStateSchema>;
const taskId = z.string().min(1).max(200);
export const taskCancelInputSchema = z.object({ taskIds: z.array(taskId).max(200) }).strict();
export const taskCancelSnapshotSchema = z.array(z.object({ taskId, state: taskCancelStateSchema }).strict()).max(200);
export type TaskCancelSnapshot = z.infer<typeof taskCancelSnapshotSchema>;
