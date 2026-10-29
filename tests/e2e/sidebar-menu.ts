import { expect, type Locator } from '@playwright/test';

type MenuItemOptions = Parameters<Locator['getByRole']>[1];
type ClickOptions = Parameters<Locator['click']>[0];

/** 真实右键打开指定节点菜单；连接容器只取自身行，避免误选其下的数据库或对象。 */
export async function sidebarMenuItem(row: Locator, options: MenuItemOptions, assertCurrent?: () => void): Promise<Locator> {
  assertCurrent?.();
  const directRow = row.locator(':scope > .connection-row');
  const anchor = await directRow.count() === 1 ? directRow : row;
  assertCurrent?.();
  await expect(anchor).toHaveCount(1);
  assertCurrent?.();
  await anchor.click({ button: 'right' });
  assertCurrent?.();
  const menu = anchor.page().locator('.sidebar-context-menu:not(.sidebar-context-child-menu)');
  await expect(menu).toBeVisible();
  assertCurrent?.();
  let item = menu.getByRole('menuitem', options);
  if (await item.count()) { assertCurrent?.(); return item; }
  assertCurrent?.();
  // 分组只展开真实产品子菜单，不读取隐藏按钮或调用组件内部动作。
  const groups = menu.locator(':scope > .sidebar-context-submenu > button[aria-haspopup="menu"]');
  const count = await groups.count();
  assertCurrent?.();
  for (let index = 0; index < count; index++) {
    await groups.nth(index).click();
    assertCurrent?.();
    await expect(menu.locator('[data-sidebar-submenu]')).toBeVisible();
    assertCurrent?.();
    item = menu.getByRole('menuitem', options);
    if (await item.count()) { assertCurrent?.(); return item; }
    assertCurrent?.();
  }
  // 缺少动作仍交由原调用方的严格定位、断言和超时报告，不放宽失败政策。
  return item;
}

/** 所有操作仍经产品菜单点击，保留调用方的点击选项和资源归属检查。 */
export async function clickSidebarAction(row: Locator, options: MenuItemOptions, clickOptions?: ClickOptions, assertCurrent?: () => void): Promise<void> {
  const item = await sidebarMenuItem(row, options, assertCurrent);
  assertCurrent?.();
  await item.click(clickOptions);
  assertCurrent?.();
}
