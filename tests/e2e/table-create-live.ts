import type { Page, TestInfo } from '@playwright/test';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources } from './desktop-fixture';
import { isolatedDatabase, environment } from './live-helpers';
import { assertDefaultEncodingLiveTarget } from '../helpers/tableDefaultEncodingTarget';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { tableCreateZh as text } from '../../src/renderer/locales/tableCreate.zh-CN';
interface Owner { page: Page; assertCurrent(): void; retain(): void; }
/** 继承严格TestInfo状态，不读取或退出另一用例的全局窗口。 */
function ownerOf(info: TestInfo): Owner {
  const captured = ownedDesktopResources(info);
  return { page: captured.page, retain: () => retainOwnedDesktopResources(info), assertCurrent() { const current = ownedDesktopResources(info); if (current.page !== captured.page || current.application !== captured.application || current.closed) { retainOwnedDesktopResources(info); throw Error('本例新建窗口归属失效，保留现场'); } } };
}
const page = (owner: Owner) => { owner.assertCurrent(); return owner.page; };
/** 观察SQL结果未知时保留原首因；不允许退出/清库代替确认本次服务器结果。 */
async function observe<T>(owner: Owner, action: () => Promise<T>): Promise<T> { owner.assertCurrent(); try { const result = await action(); owner.assertCurrent(); return result; } catch (reason) { try { owner.retain(); } catch { /* 保留失败不能覆盖首因。 */ } throw reason; } }
/** 新用途在本例afterEach先核终态，覆盖超时后自动桌面夹具的入口；不修改共享清理判断。 */
async function assertCreateSettled(info: TestInfo): Promise<void> {
  try {
    const before = ownedDesktopResources(info); if (before.closed) return;
    const tasks = await before.page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    const after = ownedDesktopResources(info);
    if (after.application !== before.application || after.page !== before.page || after.closed || tasks.some(task => task.kind === 'schema.tableCreate.apply' && task.status !== 'completed')) throw Error('本例新建表apply或窗口终态未确认，保留库和原生现场');
  } catch (reason) { try { retainOwnedDesktopResources(info); } catch { /* 保留错误不覆盖未知首因。 */ } throw reason; }
}
/** 本用途先用无默认库的只读连接核Root身份；不进入会先建库的共享隔离helper。 */
async function preflightCreateTarget(owner: Owner): Promise<void> {
  owner.assertCurrent();
  if (!environment.DBARK_TEST_HOST || !environment.DBARK_TEST_USER || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(environment.DBARK_TEST_EXPECTED_SERVER_UUID ?? '')) throw Error('Root尚未绑定本轮实际服务器UUID和测试账号');
  const observer = await observe(owner, () => mysql.createConnection({ host: environment.DBARK_TEST_HOST, port: Number(environment.DBARK_TEST_PORT), user: environment.DBARK_TEST_USER, password: environment.DBARK_TEST_PASSWORD, charset: 'utf8mb4', connectTimeout: 15000, ...(environment.DBARK_TEST_TLS === '1' ? { ssl: { ca: readFileSync(environment.DBARK_TEST_CA!), rejectUnauthorized: true, verifyIdentity: true } } : {}) }));
  let failure: unknown;
  try {
    const [facts] = await observe(owner, () => observer.query<RowDataPacket[]>('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid'));
    if (facts.length !== 1 || !/^8\.4\.11(?:[-+].*)?$/.test(String(facts[0].version)) || !['linux', 'debian-linux-gnu'].includes(String(facts[0].os).toLowerCase()) || ![0, '0'].includes(facts[0].names) || facts[0].uuid !== environment.DBARK_TEST_EXPECTED_SERVER_UUID) throw Error('Root尚未绑定本轮实际服务器UUID、准确8.4.11/Linux目标；未创建隔离库');
  } catch (reason) { failure = reason; throw reason; }
  finally {
    // 预检收尾未知时停止，不把读取成功或取消ACK当成可继续建库的资源事实。
    try { await observe(owner, () => observer.end()); }
    catch (reason) { if (failure) throw new AggregateError([failure, reason], '原身份预检失败且只读连接收尾未确认', { cause: failure }); throw reason; }
  }
}
/** 仅双门且非list才注册；Root未来独占正式执行，本文不构成实库通过证据。 */
export function registerTableCreateUiTests() {
  test.use({ preserveOnUnconfirmedExit: true });
  test.afterEach(async ({}, info) => { await assertCreateSettled(info); });
  test('新建表复用设计器、准确确认一次CREATE，主键唯一索引与精确默认经目录核对', async ({}, info) => {
    const owner = ownerOf(info); owner.assertCurrent();
    assertDefaultEncodingLiveTarget({ host: environment.DBARK_TEST_HOST, port: environment.DBARK_TEST_PORT, tlsFlag: environment.DBARK_TEST_TLS, caPath: environment.DBARK_TEST_CA });
    await preflightCreateTarget(owner); owner.assertCurrent();
    await isolatedDatabase(async context => {
      owner.assertCurrent(); let failure: unknown;
      try {
        const [facts] = await observe(owner, () => context.observer.query<RowDataPacket[]>('SELECT @@version AS version,@@server_uuid AS uuid')); owner.assertCurrent();
        expect(String(facts[0].version)).toMatch(/^8\.4\./); if (!environment.DBARK_TEST_EXPECTED_SERVER_UUID || facts[0].uuid !== environment.DBARK_TEST_EXPECTED_SERVER_UUID) throw Error('Root尚未绑定本轮实际服务器UUID');
        const connection = page(owner).locator('.connection-node').filter({ has: page(owner).getByRole('button', { name: context.connectionName, exact: true }) });
        const database = connection.locator('.database-row').filter({ has: page(owner).getByRole('button', { name: context.database, exact: true }) });
        // 先实际展开原库目录，再验证创建后的刷新；聚焦折叠节点不代表目录已展开。
        await database.getByRole('button', { name: context.database, exact: true }).click(); owner.assertCurrent();
        await expect(database.getByRole('button', { name: context.database, exact: true })).toHaveAttribute('aria-expanded', 'true'); owner.assertCurrent();
        await database.getByRole('button', { name: context.database, exact: true }).focus(); owner.assertCurrent();
        await database.getByRole('button', { name: zh.sidebar.text017, exact: true }).click(); owner.assertCurrent();
        const designer = page(owner).getByRole('dialog', { name: formatText(zh.schema.text009, context.database), exact: true });
        await designer.getByLabel(zh.schema.text010, { exact: true }).fill('daily_new_table'); owner.assertCurrent();
        await designer.getByRole('button', { name: zh.schema.text027, exact: true }).click(); owner.assertCurrent();
        await designer.getByLabel(formatText(zh.schema.text018, 2), { exact: true }).fill('amount'); owner.assertCurrent();
        await designer.getByLabel(formatText(zh.schema.text019, 2), { exact: true }).fill('decimal(30,12)'); owner.assertCurrent();
        await designer.getByLabel(formatText(zh.schema.text020, 2), { exact: true }).uncheck(); owner.assertCurrent();
        await designer.getByLabel(formatText(zh.schema.text022, 2), { exact: true }).fill('123456789012345678.123456789012'); owner.assertCurrent();
        await designer.getByRole('button', { name: new RegExp('^' + zh.common.indexes) }).click(); owner.assertCurrent();
        await designer.getByRole('button', { name: zh.schema.text036, exact: true }).click(); owner.assertCurrent();
        await designer.getByLabel(formatText(zh.schema.text031, 2), { exact: true }).fill('uq_amount'); owner.assertCurrent();
        await designer.getByLabel(formatText(zh.schema.text033, 2), { exact: true }).check(); owner.assertCurrent();
        await designer.getByLabel(formatText(zh.schema.text034, 2), { exact: true }).fill('amount'); owner.assertCurrent();
        await designer.getByRole('button', { name: zh.schema.text049, exact: true }).click(); owner.assertCurrent();
        const confirmation = page(owner).getByRole('dialog', { name: text.title, exact: true });
        await expect(confirmation.locator('.monaco-editor .view-lines')).toContainText('CREATE TABLE'); owner.assertCurrent();
        // 预览只读：仅观察本例合成库的准确目标，任何apply之前都必须仍不存在。
        const [absent] = await observe(owner, () => context.observer.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [context.database, 'daily_new_table'])); owner.assertCurrent();
        expect(absent).toHaveLength(0);
        await confirmation.getByLabel(text.confirmation, { exact: true }).fill(context.database + '.daily_new_table '); owner.assertCurrent();
        for (const label of [text.ackDdl, text.ackCreate]) { await confirmation.getByRole('checkbox', { name: label, exact: true }).check(); owner.assertCurrent(); }
        await expect(confirmation.getByRole('button', { name: text.apply, exact: true })).toBeDisabled(); owner.assertCurrent();
        await confirmation.getByLabel(text.confirmation, { exact: true }).fill(context.database + '.daily_new_table'); owner.assertCurrent();
        await confirmation.getByRole('button', { name: text.apply, exact: true }).click(); owner.assertCurrent();
        await expect(confirmation.getByRole('status')).toHaveText(text.succeeded); owner.assertCurrent();
        // 成功提示之外再核本例唯一apply及终态；任务读取未知同样停链保留现场。
        const tasks = await observe(owner, () => page(owner).evaluate(() => window.dbark.invoke('tasks.list', {}))); owner.assertCurrent();
        const applies = tasks.filter(task => task.kind === 'schema.tableCreate.apply'); expect(applies).toHaveLength(1); expect(applies[0].status).toBe('completed');
        await expect(confirmation.getByRole('button', { name: text.apply, exact: true })).toBeDisabled(); owner.assertCurrent();
        const [columns] = await observe(owner, () => context.observer.query<RowDataPacket[]>('SELECT COLUMN_NAME,COLUMN_TYPE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [context.database, 'daily_new_table'])); owner.assertCurrent();
        expect(columns.map(row => row.COLUMN_NAME)).toEqual(['id', 'amount']); expect(columns[1].COLUMN_DEFAULT).toBe('123456789012345678.123456789012');
        const [indexes] = await observe(owner, () => context.observer.query<RowDataPacket[]>('SELECT INDEX_NAME,NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY INDEX_NAME', [context.database, 'daily_new_table'])); owner.assertCurrent();
        expect(indexes.map(row => [row.INDEX_NAME, Number(row.NON_UNIQUE)])).toEqual([['PRIMARY', 0], ['uq_amount', 0]]);
        await confirmation.getByRole('button', { name: text.close, exact: true }).click(); owner.assertCurrent();
        await expect(confirmation).toHaveCount(0); owner.assertCurrent();
        // 仅核原连接对象树的准确新表，确认完成回调已刷新；不切换或重绑其它目标。
        await expect(connection.locator('.object-row').getByText('daily_new_table', { exact: true })).toBeVisible(); owner.assertCurrent();
      } catch (reason) { failure = reason; throw reason; }
      finally {
        // 新用途不修改共享helper：在返回其收尾链前，本例先核专用apply成功终态；未知立即保留。
        try { const tasks = await page(owner).evaluate(() => window.dbark.invoke('tasks.list', {})); owner.assertCurrent(); if (tasks.some(task => task.kind === 'schema.tableCreate.apply' && task.status !== 'completed')) throw Error('本例新建表apply未确认成功，保留库和原生现场'); }
        catch (reason) { owner.retain(); if (failure) throw new AggregateError([failure, reason], '原失败与新建表终态未知均保留', { cause: failure }); throw reason; }
      }
    }, info, { captureFailureScreenshot: false });
  });
}
