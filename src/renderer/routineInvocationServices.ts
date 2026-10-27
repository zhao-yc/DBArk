import { parseRoutineInvocationMetadata, type RoutineInvocationMetadata, type RoutineInvocationTarget } from '../shared/routineInvocation';
import { invoke } from './lib';
import { routineInvocationZh as text } from './locales/routineInvocation.zh-CN';

export interface RoutineInvocationServices { read(target: RoutineInvocationTarget, taskId: string): Promise<RoutineInvocationMetadata>; cancel(taskId: string): Promise<unknown>; }
/** 固定有序目标键不归一化名字，避免连接、库名、种类或特殊字符相互混淆。 */
export function routineInvocationTargetKey(target: RoutineInvocationTarget): string { return JSON.stringify([target.connectionId, target.database, target.name, target.kind]); }
/** 严格解析独立副本，并再次核对准确原目标；错误目录不能成为另一例程的调用草稿。 */
export function parseRoutineInvocationForTarget(value: unknown, target: RoutineInvocationTarget): RoutineInvocationMetadata {
  const metadata = parseRoutineInvocationMetadata(value); if (routineInvocationTargetKey(metadata) !== routineInvocationTargetKey(target)) throw Error(text.target); return metadata;
}
/** 只读目录与取消沿正式任务接口，绝不发送CALL/SELECT或renderer提供的profile。 */
export const routineInvocationServices: RoutineInvocationServices = {
  read: async (target, taskId) => parseRoutineInvocationForTarget(await invoke('metadata.routineInvocation', { ...target, taskId }), target),
  cancel: taskId => invoke('query.cancel', { taskId }),
};
