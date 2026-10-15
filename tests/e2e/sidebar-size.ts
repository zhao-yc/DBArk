import { expect, page } from './desktop-fixture';
import { zh } from '../../src/renderer/locales/zh-CN';

/** 经正式偏好设置缩窄侧栏，验收真实布局；不改DOM、样式或工作区内部状态。 */
export async function narrowSidebar(): Promise<void> {
  await page.getByRole('button', { name: zh.app.text009, exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel(zh.app.text022, { exact: true }).fill('180');
  await form.getByRole('button', { name: zh.common.done, exact: true }).click();
  await expect(page.locator('.sidebar-container')).toHaveCSS('width', '180px');
}
