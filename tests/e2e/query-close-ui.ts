import { expect, type Locator, type Page } from '@playwright/test';
/** 明确丢弃测试草稿；兼容空标签/表的原关闭与非空查询三选，不重放点击。 */
export async function discardTestTab(page: Page, button: Locator): Promise<void> {
  const before = await page.locator('.tab-close').count();
  const dialog = page.getByRole('dialog', { name: '关闭查询', exact: true });
  await button.click();
  await expect.poll(async () => await dialog.isVisible() || await page.locator('.tab-close').count() === before - 1).toBe(true);
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: '直接关闭', exact: true }).click();
  await expect(page.locator('.tab-close')).toHaveCount(before - 1);
}
