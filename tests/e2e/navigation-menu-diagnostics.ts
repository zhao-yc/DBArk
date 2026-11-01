import type { Page } from '@playwright/test';

/** 只记录菜单交互事件和DOM增删；不截屏、不读输入值、不拦截事件或调用产品处理器。 */
export async function observeNavigationMenu(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = window as typeof window & { __dbarkNavigationMenuEvents?: unknown[] };
    if (root.__dbarkNavigationMenuEvents) return;
    const events: unknown[] = []; root.__dbarkNavigationMenuEvents = events;
    const describe = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return { window: target === window, document: target === document };
      const ancestors: { tag: string; id: string; class: string | null }[] = [];
      for (let parent = target.parentElement; parent && ancestors.length < 5; parent = parent.parentElement) ancestors.push({ tag: parent.tagName, id: parent.id, class: parent.getAttribute('class') });
      return { tag: target.tagName, id: target.id, role: target.getAttribute('role'), class: target.getAttribute('class'), label: target.getAttribute('aria-label'), style: target.getAttribute('style')?.slice(0, 512), scrollTop: target.scrollTop, scrollLeft: target.scrollLeft, ancestors };
    };
    const record = (kind: string, target: EventTarget | null) => {
      if (events.length >= 256) events.shift();
      events.push({ at: performance.now(), kind, target: describe(target), active: describe(document.activeElement), menus: [...document.querySelectorAll('.action-menu-panel')].map(node => ({ label: node.getAttribute('aria-label'), submenu: node.classList.contains('action-menu-submenu') })), triggers: [...document.querySelectorAll('.action-menu-trigger[aria-expanded="true"]')].map(node => node.getAttribute('aria-label')) });
    };
    for (const kind of ['scroll', 'pointerdown', 'pointerup', 'click', 'focusin', 'focusout']) document.addEventListener(kind, event => record(kind, event.target), true);
    for (const kind of ['blur', 'focus', 'resize']) window.addEventListener(kind, event => record(kind, event.target));
    const menu = (node: Node) => node instanceof Element && (node.matches('.action-menu-panel') || !!node.querySelector('.action-menu-panel'));
    new MutationObserver(records => {
      if (records.some(change => [...change.addedNodes, ...change.removedNodes].some(menu))) record('菜单DOM增删', null);
    }).observe(document.body, { childList: true, subtree: true });
    record('开始只读观察', null);
  });
}

/** 失败时只读带回原事件顺序；窗口已失效则由调用方保留原错误，不重建窗口。 */
export async function readNavigationMenuObservation(page: Page): Promise<unknown> {
  return page.evaluate(() => ({ events: (window as typeof window & { __dbarkNavigationMenuEvents?: unknown[] }).__dbarkNavigationMenuEvents ?? [], menuCount: document.querySelectorAll('.action-menu-panel').length }));
}
