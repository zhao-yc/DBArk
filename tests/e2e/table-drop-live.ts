import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, page } from './desktop-fixture';
import { isolatedDatabase, environment, type LiveContext } from './live-helpers';
import { tableDropZh as text } from '../../src/renderer/locales/tableDrop.zh-CN';
import { assertTableDropLiveTarget } from '../helpers/tableDropTarget';
import { objectUri } from '../../src/shared/workbench';
const dialog = () => page.getByRole('dialog', { name: text.title, exact: true });
/** 通过实际对象树与TableTab进入；不以直连IPC替代产品确认界面。 */
async function open(context: LiveContext) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) });
  await connection.locator('.connection-row').getByRole('button', { name: context.connectionName, exact: true }).focus();
  await connection.getByRole('button', { name: '刷新连接', exact: true }).click();
  await connection.locator('.database-row').getByRole('button', { name: context.database, exact: true }).click();
  await connection.locator('.object-row').getByText('subject', { exact: true }).click();
  const table = page.locator('.table-tab:visible'); await expect(table.locator('.loading-overlay')).toHaveCount(0);
  await table.getByRole('button', { name: text.title, exact: true }).click();
  await expect(dialog().getByRole('button', { name: text.preview, exact: true })).toBeEnabled();
}
/** 双门非list模式才导入；此文件是未执行验收定义，不代表本轮实库许可或通过。 */
export function registerTableDropUiTests() {
  // 仅正式DROP定义启用本例归属与退出保留；不能用本地状态替代服务器逐ID终态证明。
  test.use({ preserveOnUnconfirmedExit: true });
  test('单表删除真实入口先预览与准确确认，观察目录消失、关闭旧标签且拒绝旧URI导航', async ({}, info) => {
    assertTableDropLiveTarget({ host: environment.DBARK_TEST_HOST, port: environment.DBARK_TEST_PORT, tlsFlag: environment.DBARK_TEST_TLS, caPath: environment.DBARK_TEST_CA });
    await isolatedDatabase(async context => {
      const profiles = await page.evaluate(() => window.dbark.invoke('connections.list', {}));
      const profile = profiles.find(value => value.id === context.connectionId); if (!profile) throw Error('未找到本轮保存连接');
      assertTableDropLiveTarget({ host: environment.DBARK_TEST_HOST, port: environment.DBARK_TEST_PORT, tlsFlag: environment.DBARK_TEST_TLS, caPath: environment.DBARK_TEST_CA }, profile);
      const [facts] = await context.observer.query<RowDataPacket[]>('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid');
      expect(String(facts[0].version)).toMatch(/^8\.4\.11(?:[-+].*)?$/); expect(Number(facts[0].names)).toBe(0); expect(['linux','debian-linux-gnu']).toContain(String(facts[0].os).toLowerCase());
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(environment.DBARK_TEST_EXPECTED_SERVER_UUID ?? '') || facts[0].uuid !== environment.DBARK_TEST_EXPECTED_SERVER_UUID) throw Error('ROOT尚未绑定本轮已核对服务器UUID，拒绝创建删除测试表');
      const target = `\`${context.database}\`.\`subject\``;
      await context.observer.query(`CREATE TABLE ${target}(id BIGINT PRIMARY KEY,note VARCHAR(80)) ENGINE=InnoDB`);
      await context.observer.query(`INSERT INTO ${target} VALUES(1,'合成待删除数据')`);
      await open(context); await dialog().getByRole('button', { name: text.preview, exact: true }).click();
      await expect(dialog().locator('.monaco-editor .view-lines')).toContainText('DROP TABLE');
      const submit = dialog().getByRole('button', { name: text.apply, exact: true }); await expect(submit).toBeDisabled();
      await dialog().getByLabel(text.confirmation, { exact: true }).fill(context.database + '.subject ');
      for (const label of [text.ackData,text.ackCommit,text.ackWindow]) await dialog().getByRole('checkbox', { name: label, exact: true }).check();
      await expect(submit).toBeDisabled(); const [before] = await context.observer.query<RowDataPacket[]>('SELECT id FROM '+target); expect(before).toHaveLength(1);
      await dialog().getByLabel(text.confirmation, { exact: true }).fill(context.database + '.subject'); await submit.click();
      await expect(dialog().getByText(text.succeeded, { exact: true })).toBeVisible(); await expect(submit).toBeDisabled();
      const [after] = await context.observer.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',[context.database,'subject']); expect(after).toHaveLength(0);
      await expect(page.locator('.workspace-tab-button').getByText('subject',{exact:true})).toHaveCount(0);
      const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); expect(tasks.filter(task => task.kind === 'schema.tableDrop.apply')).toHaveLength(1);
      await dialog().getByRole('button', { name: text.close, exact: true }).click();
      // 旧URI本身不写入系统clipboard，人工输入原目标；必须由原产品导航拒绝。
      const connectionId = context.connectionId;
      const uri = objectUri({ connectionId, database: context.database, kind: 'table', name: 'subject' });
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+O' : 'Control+Shift+O');
      const link = page.getByRole('dialog', { name: '粘贴对象链接', exact: true });
      await link.getByLabel('DBArk 对象链接', { exact: true }).fill(uri); await link.getByRole('button', { name: '打开链接', exact: true }).click();
      await expect(link.getByRole('alert')).toContainText('此名称已退役'); await link.getByRole('button', {name:'关闭对话框',exact:true}).click();
    }, info, { captureFailureScreenshot: false });
  });
}
