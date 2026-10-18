import type { QueryFileTaskState } from '../queryFileTasks';
import { canCancelQueryFileTask, cancelQueryFileTask } from '../queryFileTasks';
import { queryFilesZh as text } from '../locales/queryFiles.zh-CN';

/** 文件面板与任务中心共用真实任务编号；按钮点击再次检查提交点，不使用旧渲染的取消权限。 */
export function QueryFileTaskProgress({ task }: { task: QueryFileTaskState }) {
  const cancellation = !task.running ? '' : task.cancelState === 'pending' ? text.cancelPending : task.cancelState === 'confirmed' ? text.cancelConfirmed : task.cancelState === 'denied' ? text.cancelDenied : task.cancelState === 'unknown' ? text.cancelUnknown : '';
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} aria-label={text.taskTitle} role="status"><span>{text.taskPhases[task.phase]}</span><span className="muted small">{text.taskBytes}：{task.bytesProcessed}{task.totalBytes === undefined ? '' : ` / ${task.totalBytes}`}</span>{task.wrote !== 'no' && <span>{task.wrote === 'yes' ? task.status === 'completed' ? text.taskSaved : text.wroteYes : text.wroteUnknown}</span>}{cancellation && <span>{cancellation}</span>}{task.running && <button disabled={!canCancelQueryFileTask(task.taskId)} onClick={() => void cancelQueryFileTask(task.taskId)}>{text.cancelOperation}</button>}</div>;
}
