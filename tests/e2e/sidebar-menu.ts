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
  const menu = anchor.page().locator('.sidebar-context-menu');
  await expect(menu).toBeVisible();
  assertCurrent?.();
  return menu.getByRole('menuitem', options);
}

/** 所有操作仍经产品菜单点击，保留调用方的点击选项和资源归属检查。 */
export async function clickSidebarAction(row: Locator, options: MenuItemOptions, clickOptions?: ClickOptions, assertCurrent?: () => void): Promise<void> {
  const item = await sidebarMenuItem(row, options, assertCurrent);
  assertCurrent?.();
  await item.click(clickOptions);
  assertCurrent?.();
}
