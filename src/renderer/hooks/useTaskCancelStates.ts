import { useEffect, useRef, useState } from 'react';
import type { TaskCancelState } from '../../shared/taskCancelState';
import { invoke } from '../lib';
import { TaskCancelStates } from '../taskCancelStates';

/** 初始渲染保守关闭取消；生命周期内仅保留一个订阅及有界只读请求。 */
export function useTaskCancelStates(taskIds: string[]) {
  const [states, setStates] = useState<ReadonlyMap<string, TaskCancelState>>(new Map());
  const current = useRef<TaskCancelStates | undefined>(undefined);
  const key = JSON.stringify([...new Set(taskIds)].sort());
  const ids = useRef(taskIds); ids.current = taskIds;
  useEffect(() => {
    const controller = new TaskCancelStates({
      subscribe: listener => window.dbark?.onTask(listener) ?? (() => {}),
      read: selected => invoke('tasks.cancelState', { taskIds: selected }),
      changed: setStates
    });
    current.current = controller; controller.start(ids.current);
    return () => { controller.stop(); if (current.current === controller) current.current = undefined; };
  }, []);
  useEffect(() => current.current?.setIds(ids.current), [key]);
  return { states, canCancel: (id: string) => current.current?.canCancel(id) === true };
}
