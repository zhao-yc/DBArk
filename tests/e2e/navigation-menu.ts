import { expect, type Locator, type Page } from '@playwright/test';

type Options = Parameters<Locator['getByRole']>[1];

/** 通过真实工具栏更多及分组子菜单定位动作；原超时和owner检查由调用方保持。 */
export async function navigationMenuItem(scope: Page | Locator, options: Options, assertCurrent?: () => void): Promise<Locator> {
  return navigationMenuControl(scope, 'button', 'menuitem', options, assertCurrent);
}

/** 结果上限等设置通过真实分组菜单进入，不要求工具栏常驻输入框。 */
export async function navigationMenuInput(scope: Page | Locator, options: Options, assertCurrent?: () => void): Promise<Locator> {
  return navigationMenuControl(scope, 'spinbutton', 'spinbutton', options, assertCurrent);
}

/** 仅展开会话菜单中的原执行选项，选中状态仍由调用方原check/uncheck断言验证。 */
export async function navigationMenuCheckbox(scope: Page | Locator, options: Options, assertCurrent?: () => void): Promise<Locator> {
  return navigationMenuControl(scope, 'checkbox', 'checkbox', options, assertCurrent);
}

/** 输入框与动作共用原owner检查；仅控件角色不同，不额外执行业务。 */
async function navigationMenuControl(scope: Page | Locator, directRole: 'button' | 'spinbutton' | 'checkbox', menuRole: 'menuitem' | 'spinbutton' | 'checkbox', options: Options, assertCurrent?: () => void): Promise<Locator> {
  const page = 'page' in scope ? scope.page() : scope;
  const current = () => { assertCurrent?.(); if (page.isClosed()) throw Error('原菜单所属页面已关闭'); };
  /** 每个新增异步边界仍核原owner，不能在旧页面失效后继续展开其它菜单。 */
  async function observe<T>(operation: () => Promise<T>): Promise<T> { current(); const value = await operation(); current(); return value; }
  current();
  const direct = scope.getByRole(directRole, options);
  if (await observe(() => direct.count()) > 0) return direct;
  const items = page.locator('.action-menu-panel').getByRole(menuRole, options);
  if (await observe(() => items.count()) > 0) return items;
  const triggers = scope.locator('.action-menu-trigger:visible');
  const count = await observe(() => triggers.count());
  for (let index = 0; index < count; index++) {
    const trigger = triggers.nth(index);
    if (await observe(() => trigger.isDisabled())) continue;
    if (await observe(() => trigger.getAttribute('aria-expanded')) !== 'true') await observe(() => trigger.click());
    if (await observe(() => items.count()) > 0) return items;
    const sections = page.locator('.action-menu-panel:not(.action-menu-submenu) [role="menuitem"][aria-haspopup="menu"]');
    const length = await observe(() => sections.count());
    for (let section = 0; section < length; section++) {
      const item = sections.nth(section); if (await observe(() => item.isDisabled())) continue;
      await observe(() => item.click());
      if (await observe(() => items.count()) > 0) return items;
    }
    if (await observe(() => trigger.getAttribute('aria-expanded')) === 'true') await observe(() => trigger.click());
    current();
  }
  // 仍交给原定位器及原超时失败，不退化成猜测其它页面的动作。
  return direct;
}

/** 保留原click选项，动作仍只通过产品原菜单项执行一次。 */
export async function clickNavigationAction(scope: Page | Locator, options: Options, clickOptions?: Parameters<Locator['click']>[0], assertCurrent?: () => void): Promise<void> {
  const item = await navigationMenuItem(scope, options, assertCurrent); assertCurrent?.();
  await expect(item).toHaveCount(1); assertCurrent?.(); await item.click(clickOptions); assertCurrent?.();
}

/** 只用于已有VM注册及RAM接线：不加载Playwright、不启动窗口。 */
export type NavigationMenuItemOptions = Options;
