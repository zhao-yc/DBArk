import { useEffect, useLayoutEffect, useRef } from 'react';
import { createExternalObjectUriConsumer } from './externalObjectUris';
import type { OpenWorkbenchTarget } from './workbenchNavigation';
import { invoke } from './lib';
import { useWorkspace } from './store';

/** 系统入口只在工作区就绪后握手，模态和关闭协商结束时唤醒原意图。 */
export function useExternalObjectUris(ready: boolean, open: OpenWorkbenchTarget, blocked: boolean): void {
  const blockedRef = useRef(blocked);
  const consumerRef = useRef<ReturnType<typeof createExternalObjectUriConsumer> | null>(null);
  useLayoutEffect(() => { blockedRef.current = blocked; consumerRef.current?.wake(); });
  useEffect(() => {
    // 旧预加载或组件隔离环境未提供系统入口时，不伪造协议能力。
    if (!ready || typeof window.dbark?.onObjectUri !== 'function') return;
    let epoch = 0;
    let previous = useWorkspace.getState();
    let previousTab = previous.settings.tabs.find(tab => tab.id === previous.settings.activeTabId);
    const consumer = createExternalObjectUriConsumer({
      ready: () => invoke('workbench.protocolReady', {}),
      take: () => invoke('workbench.protocolTake', {}),
      resolve: id => invoke('workbench.protocolResolve', { id }),
      commit: id => invoke('workbench.protocolCommit', { id }),
      finish: id => invoke('workbench.protocolFinish', { id }),
      open,
      canNavigate: () => !blockedRef.current && !document.querySelector('[role="dialog"], [role="alertdialog"]'),
      captureIntent: () => epoch,
      isIntentCurrent: scope => scope === epoch,
      notify: message => useWorkspace.getState().notify(message, true)
    });
    consumerRef.current = consumer;
    // 引用和单调代次一起记录，切走再切回也不能复活旧请求；任务进度不撤销意图。
    const unsubscribeWorkspace = useWorkspace.subscribe(current => {
      const tab = current.settings.tabs.find(item => item.id === current.settings.activeTabId);
      if (current.selection !== previous.selection || current.settings.activeTabId !== previous.settings.activeTabId || tab !== previousTab
        || current.connections !== previous.connections || current.connectionVersions !== previous.connectionVersions) epoch++;
      previous = current; previousTab = tab;
      consumer.wake();
    });
    const unsubscribe = window.dbark.onObjectUri(() => consumer.signal());
    // 原生入口不轮询。模态节点移除仅重核当前本地等待，不追加数据库请求。
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(() => consumer.wake()) : undefined;
    observer?.observe(document.body, { childList: true, subtree: true });
    consumer.start();
    return () => {
      consumer.dispose(); unsubscribe(); unsubscribeWorkspace(); observer?.disconnect();
      if (consumerRef.current === consumer) consumerRef.current = null;
    };
  }, [ready, open]);
}
