import { clickSidebarAction } from './sidebar-menu';
import type { RowDataPacket } from 'mysql2/promise';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources } from './desktop-fixture';
import { isolatedDatabase, environment, type LiveContext } from './live-helpers';
import { tableDropZh as text } from '../../src/renderer/locales/tableDrop.zh-CN';
import { assertTableDropLiveTarget } from '../helpers/tableDropTarget';
import { objectUri } from '../../src/shared/workbench';
interface CaseOwner { page: Page; assertCurrent(): void; retain(): void; }
/** 固定本TestInfo与首次捕获的页面/应用；同例重绑、下一例或已关闭对象都不能继续UI。 */
function captureOwner(info: TestInfo): CaseOwner {
  const captured = ownedDesktopResources(info);
  return { page: captured.page, retain: () => retainOwnedDesktopResources(info), assertCurrent: () => {
    const current = ownedDesktopResources(info);
    if (current.page !== captured.page || current.application !== captured.application || current.closed) {
      retainOwnedDesktopResources(info); throw Error('本例删除窗口归属已变化或关闭，停链保留所属资源');
    }
  } };
}
/** 每次获取入口先核归属，始终返回捕获页面，不读取下一例的全局page。 */
const page = (owner: CaseOwner) => { owner.assertCurrent(); return owner.page; };
const dialog = (owner: CaseOwner) => page(owner).getByRole('dialog', { name: text.title, exact: true });
/** 观察请求未知或返回时失去归属即保留，不能借退出或清库替它取消；始终抛原首因。 */
async function observe<T>(owner: CaseOwner, request: () => Promise<T>): Promise<T> {
  owner.assertCurrent();
  try { const value = await request(); owner.assertCurrent(); return value; }
  catch (reason) { try { owner.retain(); } catch { /* 保留标记异常不能覆盖观察请求的原始失败。 */ } throw reason; }
}
/** 通过实际对象树与TableTab进入；不以直连IPC替代产品确认界面。 */
async function open(owner: CaseOwner, context: LiveContext) {
  const connection = page(owner).locator('.connection-node').filter({ has: page(owner).locator('.connection-row').getByText(context.connectionName, { exact: true }) });
  await connection.locator('.connection-row').getByRole('button', { name: context.connectionName, exact: true }).focus(); owner.assertCurrent();
  await clickSidebarAction(connection, { name: '刷新连接', exact: true }, undefined, () => owner.assertCurrent()); owner.assertCurrent();
  await (await (await import('./navigation-menu')).navigationMenuItem(connection.locator('.database-row'), { name: context.database, exact: true }, () => owner.assertCurrent())).click(); owner.assertCurrent();
  await connection.locator('.object-row').getByText('subject', { exact: true }).click(); owner.assertCurrent();
  const table = page(owner).locator('.table-tab:visible'); await expect(table.locator('.loading-overlay')).toHaveCount(0); owner.assertCurrent();
  await (await (await import('./navigation-menu')).navigationMenuItem(table, { name: text.title, exact: true }, () => owner.assertCurrent())).click(); owner.assertCurrent();
  await expect(dialog(owner).getByRole('button', { name: text.preview, exact: true })).toBeEnabled(); owner.assertCurrent();
}
/** 双门非list模式才导入；此文件是未执行验收定义，不代表本轮实库许可或通过。 */
export function registerTableDropUiTests() {
  // 仅正式DROP定义启用本例归属与退出保留；不能用本地状态替代服务器逐ID终态证明。
  test.use({ preserveOnUnconfirmedExit: true });
  test('单表删除真实入口先预览与准确确认，观察目录消失、关闭旧标签且拒绝旧URI导航', async ({}, info) => {
    const owner = captureOwner(info);
    assertTableDropLiveTarget({ host: environment.DBARK_TEST_HOST, port: environment.DBARK_TEST_PORT, tlsFlag: environment.DBARK_TEST_TLS, caPath: environment.DBARK_TEST_CA });
    await isolatedDatabase(async context => {
      owner.assertCurrent();
      const profiles = await page(owner).evaluate(() => window.dbark.invoke('connections.list', {})); owner.assertCurrent();
      const profile = profiles.find(value => value.id === context.connectionId); if (!profile) throw Error('未找到本轮保存连接');
      assertTableDropLiveTarget({ host: environment.DBARK_TEST_HOST, port: environment.DBARK_TEST_PORT, tlsFlag: environment.DBARK_TEST_TLS, caPath: environment.DBARK_TEST_CA }, profile);
      const [facts] = await observe(owner, () => context.observer.query<RowDataPacket[]>('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid')); owner.assertCurrent();
      expect(String(facts[0].version)).toMatch(/^8\.4\.11(?:[-+].*)?$/); expect(Number(facts[0].names)).toBe(0); expect(['linux','debian-linux-gnu']).toContain(String(facts[0].os).toLowerCase());
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(environment.DBARK_TEST_EXPECTED_SERVER_UUID ?? '') || facts[0].uuid !== environment.DBARK_TEST_EXPECTED_SERVER_UUID) throw Error('ROOT尚未绑定本轮已核对服务器UUID，拒绝创建删除测试表');
      const target = `\`${context.database}\`.\`subject\``;
      await observe(owner, () => context.observer.query(`CREATE TABLE ${target}(id BIGINT PRIMARY KEY,note VARCHAR(80)) ENGINE=InnoDB`)); owner.assertCurrent();
      await observe(owner, () => context.observer.query(`INSERT INTO ${target} VALUES(1,'合成待删除数据')`)); owner.assertCurrent();
      await open(owner, context); owner.assertCurrent();
      // 先证明定位器在真实标签上有命中，删除后的零计数才不会因旧CSS类失配而空通过。
      const originalTab = page(owner).locator('.workspace-tab-button .tab-select').getByText('subject', { exact: true });
      await expect(originalTab).toHaveCount(1); owner.assertCurrent();
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog(owner), { name: text.preview, exact: true }, () => owner.assertCurrent())).click(); owner.assertCurrent();
      await expect(dialog(owner).locator('.monaco-editor .view-lines')).toContainText('DROP TABLE'); owner.assertCurrent();
      const submit = dialog(owner).getByRole('button', { name: text.apply, exact: true }); await expect(submit).toBeDisabled(); owner.assertCurrent();
      await dialog(owner).getByLabel(text.confirmation, { exact: true }).fill(context.database + '.subject '); owner.assertCurrent();
      for (const label of [text.ackData,text.ackCommit,text.ackWindow]) { await dialog(owner).getByRole('checkbox', { name: label, exact: true }).check(); owner.assertCurrent(); }
      await expect(submit).toBeDisabled(); owner.assertCurrent(); const [before] = await observe(owner, () => context.observer.query<RowDataPacket[]>('SELECT id FROM '+target)); owner.assertCurrent(); expect(before).toHaveLength(1);
      await dialog(owner).getByLabel(text.confirmation, { exact: true }).fill(context.database + '.subject'); owner.assertCurrent(); await submit.click(); owner.assertCurrent();
      await expect(dialog(owner).getByText(text.succeeded, { exact: true })).toBeVisible(); owner.assertCurrent(); await expect(submit).toBeDisabled(); owner.assertCurrent();
      const [after] = await observe(owner, () => context.observer.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',[context.database,'subject'])); owner.assertCurrent(); expect(after).toHaveLength(0);
      await expect(originalTab).toHaveCount(0); owner.assertCurrent();
      const tasks = await page(owner).evaluate(() => window.dbark.invoke('tasks.list', {})); owner.assertCurrent(); expect(tasks.filter(task => task.kind === 'schema.tableDrop.apply')).toHaveLength(1);
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog(owner), { name: text.close, exact: true }, () => owner.assertCurrent())).click(); owner.assertCurrent();
      // 关闭会等待令牌释放；弹窗卸载之后，App才允许工作区快捷键，不能把click返回当关闭完成。
      await expect(dialog(owner)).toHaveCount(0); owner.assertCurrent();
      // 旧URI本身不写入系统clipboard，人工输入原目标；必须由原产品导航拒绝。
      const connectionId = context.connectionId;
      const uri = objectUri({ connectionId, database: context.database, kind: 'table', name: 'subject' });
      await page(owner).keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+O' : 'Control+Shift+O'); owner.assertCurrent();
      const link = page(owner).getByRole('dialog', { name: '粘贴对象链接', exact: true });
      await expect(link).toBeVisible(); owner.assertCurrent();
      await link.getByLabel('DBArk 对象链接', { exact: true }).fill(uri); owner.assertCurrent(); await (await (await import('./navigation-menu')).navigationMenuItem(link, { name: '打开链接', exact: true }, () => owner.assertCurrent())).click(); owner.assertCurrent();
      await expect(link.getByRole('alert')).toContainText('此名称已退役'); owner.assertCurrent(); await (await (await import('./navigation-menu')).navigationMenuItem(link, {name:'关闭对话框',exact:true}, () => owner.assertCurrent())).click(); owner.assertCurrent();
    }, info, { captureFailureScreenshot: false });
  });
}
