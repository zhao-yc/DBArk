import { test, expect, page, desktop, pageErrors, quitDesktop, launchDesktop } from './desktop-fixture';
import { objectUri } from '../../src/shared/workbench';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const manager = () => page.getByRole('dialog', { name: '收藏与虚拟分组', exact: true });
const read = () => page.evaluate(() => window.dbark.invoke('workbench.get', {}));

/** 使用真实连接表单创建不可联网的离线配置，不替换 IPC 或数据库执行结果。 */
async function connection() {
  await page.locator('.app-commandbar').getByRole('button', { name: '新建连接', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建连接', exact: true });
  await dialog.getByLabel('连接名称', { exact: true }).fill('工作台离线连接');
  await dialog.getByLabel('主机地址', { exact: true }).fill('127.0.0.1');
  await dialog.getByLabel('端口', { exact: true }).fill('1');
  await dialog.getByLabel('用户名', { exact: true }).fill('offline');
  await dialog.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(dialog).toBeHidden();
  return (await page.evaluate(() => window.dbark.invoke('connections.list', {})))[0];
}
/** 手动填写完整身份，确保特殊名称经过实际 React 表单和主进程校验。 */
async function addFavorite(label: string, kind: string) {
  await manager().getByRole('button', { name: '添加收藏', exact: true }).click();
  await manager().getByLabel('收藏名称', { exact: true }).fill(label);
  await manager().getByLabel('数据库名称', { exact: true }).fill('库.名/ %?#');
  await manager().getByLabel('对象类型', { exact: true }).selectOption(kind);
  if (kind !== 'database') await manager().getByLabel('对象名称', { exact: true }).fill('__proto__.表`/ 🚢');
  await manager().locator('.workbench-editor').getByRole('button', { name: '保存', exact: true }).click();
  await expect(manager().locator('.workbench-editor')).toHaveCount(0);
}

test('收藏与虚拟分组真实增删改序、链接复制、失效连接及专注模式重启恢复', async ({}, testInfo) => {
  const profile = await connection();
  const initialSettings = await page.evaluate(() => window.dbark.invoke('settings.get', {}));
  await page.keyboard.press(`${modifier}+Shift+B`); await expect(manager()).toBeVisible();
  await manager().getByLabel('虚拟分组名称', { exact: true }).fill('第一组');
  await manager().getByRole('button', { name: '新建虚拟分组', exact: true }).click();
  await expect.poll(async () => (await read()).document.groups.length).toBe(1);
  await manager().getByLabel('虚拟分组名称', { exact: true }).fill('第二组');
  await manager().getByRole('button', { name: '新建虚拟分组', exact: true }).click();
  await expect.poll(async () => (await read()).document.groups.length).toBe(2);
  await manager().getByRole('button', { name: '上移：第二组', exact: true }).click();
  await expect.poll(async () => (await read()).document.groups[0].name).toBe('第二组');
  await manager().getByRole('button', { name: '重命名：第二组', exact: true }).click();
  await manager().getByLabel('虚拟分组名称', { exact: true }).fill('诊断收藏');
  await manager().locator('.workbench-group-form').getByRole('button', { name: '保存', exact: true }).click();
  await expect(manager().getByRole('button', { name: '重命名：诊断收藏', exact: true })).toBeVisible();
  await addFavorite('原型表', 'table'); await addFavorite('同名视图', 'view');
  await manager().getByRole('button', { name: '下移：原型表', exact: true }).click();
  await expect.poll(async () => (await read()).document.favorites[0].label).toBe('同名视图');
  await manager().getByRole('button', { name: '重命名：原型表', exact: true }).click();
  await manager().getByLabel('收藏名称', { exact: true }).fill('诊断表');
  const groups = (await read()).document.groups;
  await manager().getByLabel('所属虚拟分组', { exact: true }).selectOption(groups[0].id);
  await manager().locator('.workbench-editor').getByRole('button', { name: '保存', exact: true }).click();
  await expect(manager().getByRole('button', { name: '复制对象链接：诊断表', exact: true })).toBeVisible();
  await manager().getByRole('button', { name: '复制对象链接：诊断表', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('对象链接已复制');
  const uri = await desktop.evaluate(({ clipboard }) => clipboard.readText());
  expect(uri).toBe(objectUri({ connectionId: profile.id, kind: 'table', database: '库.名/ %?#', name: '__proto__.表`/ 🚢' }));
  expect(uri).not.toContain('offline'); expect(uri).not.toContain('127.0.0.1');
  await manager().getByRole('button', { name: '打开对象：诊断表', exact: true }).click();
  await expect(manager().getByRole('alert')).toContainText('无法连接原连接');
  expect((await page.evaluate(() => window.dbark.invoke('settings.get', {}))).tabs).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('workbench-manager.png') });
  const snapshot = await read();
  await manager().getByRole('button', { name: '关闭对话框', exact: true }).click();
  await expect(page.getByRole('region', { name: '对象收藏', exact: true }).getByRole('button', { name: '诊断表', exact: true })).toBeVisible();
  await page.locator('.app-commandbar').getByRole('button', { name: '进入专注模式', exact: true }).click();
  await expect(page.locator('.sidebar-container')).toBeHidden();
  await expect.poll(async () => (await read()).document.focusMode).toBe(true);
  await quitDesktop(); await launchDesktop();
  await expect(page.locator('.sidebar-container')).toBeHidden();
  expect((await read()).document).toEqual({ ...snapshot.document, focusMode: true });
  await page.keyboard.press(`${modifier}+Shift+L`); await expect(page.locator('.sidebar-container')).toBeVisible();
  await page.keyboard.press(`${modifier}+Shift+B`); await expect(manager()).toBeVisible();
  await manager().getByRole('button', { name: '删除虚拟分组：诊断收藏', exact: true }).click();
  await expect.poll(async () => (await read()).document.favorites.find(item => item.label === '诊断表')?.groupId).toBe(null);
  await manager().getByRole('button', { name: '移除收藏：同名视图', exact: true }).click();
  await expect.poll(async () => (await read()).document.favorites.length).toBe(1);
  await manager().getByRole('button', { name: '关闭对话框', exact: true }).click();
  expect(await page.evaluate(() => window.dbark.invoke('connections.list', {}))).toEqual([profile]);
  expect(await page.evaluate(() => window.dbark.invoke('settings.get', {}))).toEqual(initialSettings);
  // 删除原连接后收藏继续保留，链接打开明确失败且不能回退到别的连接。
  await desktop.evaluate(({ dialog }) => { dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync; });
  await page.getByRole('button', { name: '工作台离线连接', exact: true }).focus();
  await page.getByRole('button', { name: '删除连接', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('connections.list', {}))).length).toBe(0);
  await page.keyboard.press(`${modifier}+Shift+O`);
  const link = page.getByRole('dialog', { name: '粘贴对象链接', exact: true });
  await link.getByLabel('DBArk 对象链接', { exact: true }).fill(uri);
  await link.getByRole('button', { name: '打开链接', exact: true }).click();
  await expect(link.getByRole('alert')).toContainText('原连接不存在');
  await link.getByLabel('DBArk 对象链接', { exact: true }).fill('https://example.com/?sql=DROP%20TABLE');
  await link.getByRole('button', { name: '打开链接', exact: true }).click();
  await expect(link.getByRole('alert')).toContainText('对象链接格式无效');
  await link.getByRole('button', { name: '关闭对话框', exact: true }).click();
  expect((await read()).document.favorites).toHaveLength(1);
  expect(await page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}) }))).toEqual({ tasks: [], history: [] });
  expect(pageErrors).toEqual([]);
  // 最小窗口下所有新增入口都能由键盘访问，专注模式恢复按钮始终存在。
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 680));
  await page.keyboard.press(`${modifier}+Shift+L`); await expect(page.locator('.sidebar-container')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('workbench-focus-minimum.png') });
  await page.locator('.app-commandbar').getByRole('button', { name: '退出专注模式', exact: true }).click();
  await expect(page.locator('.sidebar-container')).toBeVisible();
});
