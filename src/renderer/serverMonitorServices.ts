import { invoke } from './lib';
import type { ServerMonitorServices } from './serverMonitorController';
import { serverMonitorZhCN as t } from './serverMonitorZh';

/** 一次界面目标的正式端口；范围和取消均绑定原任务，不接受SQL或凭据。 */
export function createServerMonitorServices(connectionId: string, isCurrent: () => boolean, request: typeof invoke = invoke): ServerMonitorServices {
  const active = new Map<string, { submitted: boolean; cancelled: boolean; cancellation?: Promise<unknown> }>();
  let invalid = false;
  const check = () => { if (!isCurrent()) invalid = true; if (invalid) throw Error(t.targetUnavailable); };
  return {
    async read(input) {
      check();
      if (input.connectionId !== connectionId || active.size || !input.taskId) throw Error(t.targetUnavailable);
      const owned = { submitted: false, cancelled: false } as { submitted: boolean; cancelled: boolean; cancellation?: Promise<unknown> };
      active.set(input.taskId, owned);
      try {
        // 取消或换连接可能发生在服务进入至IPC投递之间；投递前活读目标，不重开额外测试连接。
        await Promise.resolve(); check(); if (owned.cancelled) throw Error(t.cancelled);
        owned.submitted = true;
        const snapshot = await request('serverMonitor.read', input);
        check(); if (owned.cancelled) throw Error(t.cancelled);
        return snapshot;
      } finally { active.delete(input.taskId); }
    },
    cancel(taskId) {
      const owned = active.get(taskId); if (!owned) return Promise.resolve();
      owned.cancelled = true;
      if (!owned.submitted) return Promise.resolve();
      return owned.cancellation ??= Promise.resolve().then(() => request('query.cancel', { taskId }));
    },
  };
}
