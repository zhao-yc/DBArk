import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { UiCommandId } from '../shared/uiCommands';
import { UiCommandRegistry, updateCommandPageContext, type UiCommandPageContext, type UiCommandHandler } from './uiCommandRegistry';
import { errorMessage, invoke } from './lib';
import { useWorkspace } from './store';

export type { UiCommandHandler } from './uiCommandRegistry';
export const uiCommands = new UiCommandRegistry();

/** 保持页面处理器常驻；只同步当前目标和真实可用性，不转移SQL或文件权限。 */
export function useUiCommandScope(scopeId: string, handlers: Partial<Record<UiCommandId, UiCommandHandler>>, options: { active?: boolean; contextKey?: string } = {}): void {
  const owner = useRef<object>({});
  const pageOwner = useRef<UiCommandPageContext | undefined>(undefined);
  useLayoutEffect(() => {
    const workspace = useWorkspace.getState(), tabId = scopeId.startsWith('tab:') ? scopeId.slice(4) : scopeId.startsWith('tab-files:') ? scopeId.slice(10) : undefined;
    const tab = tabId ? workspace.settings.tabs.find(item => item.id === tabId) : undefined;
    const profile = tab && workspace.connections.find(item => item.id === tab.connectionId), version = tab ? workspace.connectionVersions[tab.connectionId] ?? 0 : 0;
    pageOwner.current = updateCommandPageContext(pageOwner.current, tab, profile, version);
    // 同步store已经切页但React尚未提交时，也不能用旧scope调用另一页的命令。
    const isCurrent = tabId ? () => {
      const now = useWorkspace.getState();
      return now.settings.activeTabId === tabId && now.settings.tabs.find(item => item.id === tabId) === tab
        && !!tab && now.connections.find(item => item.id === tab.connectionId) === profile && (now.connectionVersions[tab.connectionId] ?? 0) === version;
    } : undefined;
    uiCommands.update(scopeId, owner.current, { handlers, active: options.active ?? true, contextKey: JSON.stringify([options.contextKey ?? '', pageOwner.current.generation]), isCurrent });
  });
  useLayoutEffect(() => { const token = owner.current; return () => uiCommands.remove(scopeId, token); }, [scopeId]);
}

/** 工具栏和原生菜单消费同一代次及处理器，状态改变后旧闭包自动失效。 */
export function useUiCommands() {
  const snapshot = useSyncExternalStore(uiCommands.subscribe, uiCommands.getSnapshot, uiCommands.getSnapshot);
  return {
    snapshot,
    enabled: (id: UiCommandId) => snapshot.commands.find(item => item.id === id)?.enabled ?? false,
    checked: (id: UiCommandId) => snapshot.commands.find(item => item.id === id)?.checked ?? false,
    run: (id: UiCommandId) => { void uiCommands.execute({ id, revision: snapshot.revision }).catch(reason => useWorkspace.getState().notify(errorMessage(reason), true)); }
  };
}

/** 唯一原生菜单桥接；模态生命周期和工作区代次变化同步撤销旧菜单。 */
export function useUiCommandRuntime(): void {
  useEffect(() => {
    let alive = true, queued = false;
    const modal = () => !!document.querySelector('[role="dialog"], [role="alertdialog"]');
    uiCommands.setBlocked(modal());
    const sync = () => {
      if (queued || !alive) return; queued = true;
      queueMicrotask(() => {
        queued = false; if (!alive) return;
        void invoke('app.menuState', uiCommands.getSnapshot()).catch(reason => {
          if (alive) useWorkspace.getState().notify(errorMessage(reason), true);
        });
      });
    };
    const off = uiCommands.subscribe(sync); sync();
    const observer = new MutationObserver(records => {
      const ownsModal = (node: Node) => node.nodeType === 1 && ((node as Element).matches('[role="dialog"], [role="alertdialog"]') || !!(node as Element).querySelector('[role="dialog"], [role="alertdialog"]'));
      const changed = records.some(record => record.type === 'attributes'
        ? ['dialog', 'alertdialog'].includes(record.oldValue ?? '') || ownsModal(record.target)
        : [...record.addedNodes, ...record.removedNodes].some(ownsModal));
      if (changed) uiCommands.setBlocked(modal(), true);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['role'] });
    const offNative = window.dbark?.onCommand(event => {
      if (modal()) { uiCommands.setBlocked(true); return; }
      void uiCommands.execute(event).catch(reason => useWorkspace.getState().notify(errorMessage(reason), true));
    });
    const offInternal = window.dbark?.onMenu(action => { if (action === 'refresh-command-state') uiCommands.invalidate(); });
    let previous = useWorkspace.getState();
    const offStore = useWorkspace.subscribe(next => {
      const changed = next.settings.activeTabId !== previous.settings.activeTabId || next.connections !== previous.connections
        || next.connectionVersions !== previous.connectionVersions || next.selection !== previous.selection;
      previous = next; if (changed) uiCommands.invalidate();
    });
    return () => { alive = false; observer.disconnect(); off(); offNative?.(); offInternal?.(); offStore(); uiCommands.setBlocked(true); };
  }, []);
}
