import { tableRenameZh } from './locales/tableRename.zh-CN';
import type { TableRenameTarget } from '../shared/tableRename';
import { zh } from './locales/zh-CN';
import type { DatabaseObject } from '../shared/contracts';
import type { WorkbenchTarget } from '../shared/workbench';
import { invoke } from './lib';
import { useWorkspace } from './store';

export interface WorkbenchOpenOptions { signal?: AbortSignal; }
export type OpenWorkbenchTarget = (target: WorkbenchTarget, options?: WorkbenchOpenOptions) => Promise<boolean>;
export interface WorkbenchDefinitionTarget { connectionId: string; database: string; object: DatabaseObject; readOnly: true; }

/** 收藏与对象链接共用请求代次；只允许最新且仍有界面归属的显式导航落地。 */
export function createWorkbenchNavigation(openDefinition: (target: WorkbenchDefinitionTarget) => void) {
  let generation = 0, disposed = false;
  const retired = new Set<string>(), key = (target: TableRenameTarget) => JSON.stringify([target.connectionId, target.database, target.table]);
  const blocked = (target: WorkbenchTarget) => target.kind === 'table' && retired.has(key({ connectionId: target.connectionId, database: target.database, table: target.name }));
  return {
    /** 新导航在首个 await 前占用代次；过期成功和过期错误都不能改变当前界面。 */
    async open(target: WorkbenchTarget, options?: WorkbenchOpenOptions): Promise<boolean> {
      const current = ++generation;
      const valid = () => !disposed && current === generation && !options?.signal?.aborted;
      if (!valid()) return false;
      if (blocked(target)) throw new Error(tableRenameZh.oldLink);
      let resolved: WorkbenchTarget;
      try { resolved = await invoke('workbench.resolve', target); }
      catch (error) { if (!valid()) return false; throw error; }
      if (!valid()) return false;
      if (blocked(resolved)) throw new Error(tableRenameZh.oldLink);
      const workspace = useWorkspace.getState();
      workspace.select({ connectionId: resolved.connectionId, database: resolved.database });
      if (resolved.kind === 'database') workspace.openTab({ kind: 'query', title: zh.common.unnamedQuery, connectionId: resolved.connectionId, database: resolved.database, sql: '' });
      else if (resolved.kind === 'table' || resolved.kind === 'view') workspace.openTab({ kind: 'table', title: resolved.name, connectionId: resolved.connectionId, database: resolved.database, table: resolved.name });
      else openDefinition({ connectionId: resolved.connectionId, database: resolved.database, object: { kind: resolved.kind, name: resolved.name }, readOnly: true });
      return true;
    },
    /** 打开另一导航表单或关闭表单时撤销旧意图，不把连接修订当成请求代次。 */
    invalidate(): void { generation++; },
    /** 已重命名的名称在当前窗口不再通过旧收藏/链接复活；同步废弃所有迟到解析。 */
    retireTable(target: TableRenameTarget): void { retired.add(key(target)); generation++; },
    /** 应用卸载后禁止迟到响应写工作区；仅废弃结果，不声称已取消数据库读取。 */
    dispose(): void { disposed = true; generation++; },
    /** 兼容 React 效果清理后重新挂接，旧代次仍然失效。 */
    activate(): void { disposed = false; generation++; }
  };
}
