import { clickSidebarAction } from './sidebar-menu';
import type { RowDataPacket } from 'mysql2/promise';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources } from './desktop-fixture';
import { isolatedDatabase, environment, type LiveContext } from './live-helpers';
import { tableTruncateZh as text } from '../../src/renderer/locales/tableTruncate.zh-CN';
import { assertTableTruncateLiveTarget } from '../helpers/tableTruncateTarget';
interface CaseOwner { page: Page; assertCurrent(): void; retain(): void; }
/** 固定本TestInfo捕获的页面和应用；旧用例、同例重绑或已关闭窗口均停链保留。 */
function captureOwner(info: TestInfo): CaseOwner {
  const captured = ownedDesktopResources(info);
  return { page: captured.page, retain: () => retainOwnedDesktopResources(info), assertCurrent: () => {
    const current = ownedDesktopResources(info);
    if (current.page !== captured.page || current.application !== captured.application || current.closed) {
      retainOwnedDesktopResources(info); throw Error('本例清空窗口归属已变化或关闭，停链保留所属资源');
    }
  } };
}
/** 每次取得窗口或弹窗先核本例归属，不读取下一例的全局page。 */
const page = (owner: CaseOwner) => { owner.assertCurrent(); return owner.page; };
const dialog = (owner: CaseOwner) => page(owner).getByRole('dialog', { name: text.title, exact: true });
/** 观察SQL未知或迟到结果失去归属时保留原首因；禁止后续退出、清库或重放请求。 */
async function observe<T>(owner: CaseOwner, request: () => Promise<T>): Promise<T> {
  owner.assertCurrent();
  try { const value = await request(); owner.assertCurrent(); return value; }
  catch (reason) { try { owner.retain(); } catch { /* 保留失败不能覆盖观察请求的原首因。 */ } throw reason; }
}
/** 使用实际对象树和TableTab入口，不通过IPC替代预览/确认/提交。 */
async function open(owner: CaseOwner, context: LiveContext, name: string) {
  const connection = page(owner).locator('.connection-node').filter({ has: page(owner).locator('.connection-row').getByText(context.connectionName, { exact: true }) });
  await connection.locator('.connection-row').getByRole('button', { name: context.connectionName, exact: true }).focus(); owner.assertCurrent();
  await clickSidebarAction(connection, { name: '刷新连接', exact: true }, undefined, () => owner.assertCurrent()); owner.assertCurrent();
  await (await (await import('./navigation-menu')).navigationMenuItem(connection.locator('.database-row'), { name: context.database, exact: true }, () => owner.assertCurrent())).click(); owner.assertCurrent();
  await connection.locator('.object-row').filter({ has: page(owner).getByText(name, { exact: true }) }).getByText(name, { exact: true }).click(); owner.assertCurrent();
  const table = page(owner).locator('.table-tab:visible'); await expect(table.locator('.loading-overlay')).toHaveCount(0); owner.assertCurrent();
  await (await (await import('./navigation-menu')).navigationMenuItem(table, { name: text.title, exact: true }, () => owner.assertCurrent())).click(); owner.assertCurrent();
  await expect(dialog(owner).getByRole('button', { name: text.preview, exact: true })).toBeEnabled(); owner.assertCurrent();
}
/** 只有入口双开关才加载此模块；执行权由ROOT另行安排，不是本片交付时的实库证据。 */
export function registerTableTruncateUiTests() {
  // 仅本例启用：退出未确认即停止清库、关闭观察连接和自动强制清理。
  test.use({ preserveOnUnconfirmedExit: true });
  test('真实UI准确表名与完整风险确认；旧预览不能双发，数据和自增经观察连接核对', async ({}, info) => {
    const owner = captureOwner(info); owner.assertCurrent();
    assertTableTruncateLiveTarget({ host: environment.DBARK_TEST_HOST, port: environment.DBARK_TEST_PORT, tlsFlag: environment.DBARK_TEST_TLS, caPath: environment.DBARK_TEST_CA });
    await isolatedDatabase(async context => {
      owner.assertCurrent();
      const [status] = await observe(owner, () => context.observer.query<RowDataPacket[]>('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names')); owner.assertCurrent();
      expect(String(status[0].version)).toMatch(/^8\.4\.11(?:[-+].*)?$/); expect(Number(status[0].names)).toBe(0); expect(['linux', 'debian-linux-gnu']).toContain(String(status[0].os).toLowerCase());
      const table = `\`${context.database}\`.\`basic\``;
      await observe(owner, () => context.observer.query(`CREATE TABLE ${table}(id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,s VARCHAR(80)) ENGINE=InnoDB AUTO_INCREMENT=20`)); owner.assertCurrent();
      await observe(owner, () => context.observer.query(`INSERT INTO ${table}(s) VALUES('合成数据')`)); owner.assertCurrent();
      await open(owner, context, 'basic'); owner.assertCurrent();
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog(owner), { name: text.preview, exact: true }, () => owner.assertCurrent())).click(); owner.assertCurrent();
      await expect(dialog(owner).locator('.monaco-editor .view-lines')).toContainText('TRUNCATE TABLE'); owner.assertCurrent();
      const submit = dialog(owner).getByRole('button', { name: text.apply, exact: true }); await expect(submit).toBeDisabled(); owner.assertCurrent();
      await dialog(owner).getByLabel(text.confirmation, { exact: true }).fill(context.database + '.basic '); owner.assertCurrent();
      for (const label of [text.ackData, text.ackCounter, text.ackWindow]) { await dialog(owner).getByRole('checkbox', { name: label, exact: true }).check(); owner.assertCurrent(); }
      await expect(submit).toBeDisabled(); owner.assertCurrent();
      const [before] = await observe(owner, () => context.observer.query<RowDataPacket[]>('SELECT id FROM ' + table)); owner.assertCurrent(); expect(before).toHaveLength(1);
      await dialog(owner).getByLabel(text.confirmation, { exact: true }).fill(context.database + '.basic'); owner.assertCurrent();
      await submit.click(); owner.assertCurrent();
      await expect(dialog(owner).getByText(text.succeeded, { exact: true })).toBeVisible(); owner.assertCurrent();
      await expect(submit).toBeDisabled(); owner.assertCurrent();
      const [after] = await observe(owner, () => context.observer.query<RowDataPacket[]>('SELECT id FROM ' + table)); owner.assertCurrent(); expect(after).toHaveLength(0);
      await observe(owner, () => context.observer.query(`INSERT INTO ${table}(s) VALUES('重置后')`)); owner.assertCurrent();
      const [next] = await observe(owner, () => context.observer.query<RowDataPacket[]>('SELECT id FROM ' + table)); owner.assertCurrent(); expect(String(next[0].id)).toBe('1');
      const tasks = await page(owner).evaluate(() => window.dbark.invoke('tasks.list', {})); owner.assertCurrent(); expect(tasks.filter(task => task.kind === 'schema.tableTruncate.apply')).toHaveLength(1);
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog(owner), { name: text.close, exact: true }, () => owner.assertCurrent())).click(); owner.assertCurrent();
      // click响应不代表预览/快照令牌已经释放；弹窗实际卸载后才返回到严格退出夹具。
      await expect(dialog(owner)).toHaveCount(0); owner.assertCurrent();
    }, info, { captureFailureScreenshot: false });
  });
}
