import { sidebarMenuItem } from './sidebar-menu';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync,realpathSync } from 'node:fs';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import type { TestInfo, Page, ElectronApplication } from '@playwright/test';
import { expect, desktop, page, closed, pageErrors, answerDialogs, quitDesktop, preservesUnconfirmedExit, retainOwnedDesktopResources, confirmOwnedDesktopExit, ownedDesktopResources } from './desktop-fixture';
import {zh} from '../../src/renderer/locales/zh-CN';
import {databaseCreateZh as databaseText} from '../../src/renderer/locales/databaseCreate.zh-CN';

// 必须由调用者显式启用；仅有本地凭据文件时仍跳过，CI 不会自动连接私有服务器。
export const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1';
export const environment: Record<string, string | undefined> = { ...process.env };
if (enabled && existsSync('.cache/dbark-test.env')) {
  for (const line of readFileSync('.cache/dbark-test.env', 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match || environment[match[1]] !== undefined) continue;
    const value = match[2];
    environment[match[1]] = /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
  }
}

export interface LiveContext { observer: Connection; database: string; connectionName: string; connectionId: string; }
/** 仅显式严格模式传入；捕获页面/应用与活动TestInfo校验一起跨越准备阶段的await。 */
interface LiveDesktopOwner { page: Page; application: ElectronApplication; assertCurrent(): void; }
export const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/** 严格TLS验收必须显式提供已有CA；不能静默退回明文或关闭证书/主机校验。 */
function tlsCertificate():string|undefined{
  if(environment.DBARK_TEST_TLS!=='1')return undefined;
  if(!environment.DBARK_TEST_CA||!existsSync(environment.DBARK_TEST_CA))throw Error('严格TLS验收缺少明确的本机CA证书');
  return realpathSync(environment.DBARK_TEST_CA);
}
/** 只替换本次原生文件选择的回答；路径授权、文件读取和TLS建连仍走产品原逻辑。 */
async function configureTls(form:ReturnType<typeof page.getByRole>,owner?:LiveDesktopOwner){
  owner?.assertCurrent();
  const certificate=tlsCertificate();if(!certificate)return;
  await (await (await import('./navigation-menu')).navigationMenuItem(form, {name:'TLS / SSL',exact:true}, owner ? () => owner.assertCurrent() : undefined)).click();owner?.assertCurrent();
  await form.getByLabel(zh.connections.text027,{exact:true}).check();owner?.assertCurrent();
  await form.getByLabel(zh.connections.text028,{exact:true}).check();owner?.assertCurrent();
  const application=owner?owner.application:desktop;
  await application.evaluate(({dialog},path)=>{
    const root=globalThis as typeof globalThis&{__liveTlsOpenDialog?:typeof dialog.showOpenDialog};if(root.__liveTlsOpenDialog)throw Error('TLS文件选择不可交叉覆盖');root.__liveTlsOpenDialog=dialog.showOpenDialog;
    dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[path]}))as typeof dialog.showOpenDialog;
  },certificate);
  owner?.assertCurrent();
  let failed=false,originalFailure:unknown;
  try{await (await (await import('./navigation-menu')).navigationMenuItem(form, {name:'选择CA 证书',exact:true}, owner ? () => owner.assertCurrent() : undefined)).click();owner?.assertCurrent();await expect(form.getByRole('textbox',{name:'CA 证书 选择CA 证书',exact:true})).toHaveValue(certificate);owner?.assertCurrent();}
  catch(reason){failed=true;originalFailure=reason;throw reason;}
  finally{
    try{owner?.assertCurrent();await (owner?application:desktop).evaluate(({dialog})=>{const root=globalThis as typeof globalThis&{__liveTlsOpenDialog?:typeof dialog.showOpenDialog};if(root.__liveTlsOpenDialog){dialog.showOpenDialog=root.__liveTlsOpenDialog;delete root.__liveTlsOpenDialog;}});owner?.assertCurrent();}
    catch(cleanupFailure){
      // 显式模式的TLS操作和归属校验同时失败时保留原对象；默认错误覆盖行为不改。
      if(owner&&failed)throw new AggregateError([originalFailure,cleanupFailure],'TLS准备失败且本例归属或恢复未确认',{cause:originalFailure});
      throw cleanupFailure;
    }
  }
}

/** 浏览器确认框由 Electron 原生接口承接，同时覆盖其同步与异步调用路径。 */
export async function acceptNativeConfirmation(owner?:LiveDesktopOwner) {
  owner?.assertCurrent();
  await answerDialogs([],owner?owner.application:desktop);owner?.assertCurrent();
  await (owner?owner.application:desktop).evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = ((...args: unknown[]) => {
      const options = args.at(-1) as Electron.MessageBoxSyncOptions;
      globalThis.__dbarkE2EDialogs.calls.push({ title: options.title, message: options.message, buttons: options.buttons, response: 0 });
      return 0;
    }) as typeof dialog.showMessageBoxSync;
  });
  owner?.assertCurrent();
}

/** 连接表单走真实 UI；测试追踪关闭，避免把临时数据库密码记录进 Playwright 参数轨迹。 */
export async function connectAndCreate(database: string, owner?: LiveDesktopOwner): Promise<Omit<LiveContext, 'observer'>> {
  const connectionName = `E2E ${database}`;
  // 非严格分支仍按原时点读取全局page；严格分支始终只返回捕获页面，不降级回全局。
  const targetPage = () => { owner?.assertCurrent(); return owner ? owner.page : page; };
  await (await (await import('./navigation-menu')).navigationMenuItem(targetPage().locator('.navigation-toolbar'), { name: '新建连接', exact: true }, owner ? () => owner.assertCurrent() : undefined)).click();owner?.assertCurrent();
  const form = targetPage().getByRole('dialog', { name: '新建连接', exact: true });
  await form.getByLabel('连接名称', { exact: true }).fill(connectionName);owner?.assertCurrent();
  await form.getByLabel('主机地址', { exact: true }).fill(environment.DBARK_TEST_HOST!);owner?.assertCurrent();
  await form.getByLabel('端口', { exact: true }).fill(environment.DBARK_TEST_PORT ?? '3306');owner?.assertCurrent();
  await form.getByLabel('用户名', { exact: true }).fill(environment.DBARK_TEST_USER ?? 'root');owner?.assertCurrent();
  await form.getByLabel('数据库密码', { exact: true }).fill(environment.DBARK_TEST_PASSWORD ?? '');owner?.assertCurrent();
  await form.getByLabel('连接分组', { exact: true }).fill('隔离数据库验证');owner?.assertCurrent();
  await configureTls(form,owner);owner?.assertCurrent();
  await (await (await import('./navigation-menu')).navigationMenuItem(form, { name: '测试连接', exact: true }, owner ? () => owner.assertCurrent() : undefined)).click();owner?.assertCurrent();
  await expect(form.locator('.success-box')).toContainText('连接成功', { timeout: 20000 });owner?.assertCurrent();
  await (await (await import('./navigation-menu')).navigationMenuItem(form, { name: '保存连接', exact: true }, owner ? () => owner.assertCurrent() : undefined)).click();owner?.assertCurrent();
  await expect(form).toBeHidden();owner?.assertCurrent();
  const profiles = await targetPage().evaluate(() => window.dbark.invoke('connections.list', {}));owner?.assertCurrent();
  const connectionId = profiles.find(profile => profile.name === connectionName)!.id;
  const connectionRow = targetPage().locator('.connection-row').filter({ has: targetPage().getByRole('button', { name: connectionName, exact: true }) });
  // 聚焦保留真实键盘入口，再从该连接的真实右键菜单进入创建数据库。
  await connectionRow.getByRole('button', { name: connectionName, exact: true }).focus();owner?.assertCurrent();
  const createDatabase = await sidebarMenuItem(connectionRow, { name: '创建数据库', exact: true }, owner ? () => owner.assertCurrent() : undefined);
  await expect(createDatabase).toBeVisible();owner?.assertCurrent(); await createDatabase.click();owner?.assertCurrent();
  const create = targetPage().getByRole('dialog', { name: '创建数据库', exact: true });
  await create.getByLabel('数据库名称', { exact: true }).fill(database);owner?.assertCurrent();
  // 走新建库真实目录、预览与准确确认；保持utf8mb4/bin显式配对，不使用SQL或IPC替代表单。
  await create.getByRole('combobox', { name: databaseText.charset, exact: true }).selectOption('utf8mb4');owner?.assertCurrent();
  await create.getByRole('combobox', { name: databaseText.collation, exact: true }).selectOption('utf8mb4_bin');owner?.assertCurrent();
  await (await (await import('./navigation-menu')).navigationMenuItem(create, { name: databaseText.preview, exact: true }, owner ? () => owner.assertCurrent() : undefined)).click();owner?.assertCurrent();
  await expect(create.locator('.monaco-editor .view-lines')).toContainText('CREATE DATABASE');owner?.assertCurrent();
  await create.getByRole('textbox', { name: databaseText.confirmation, exact: true }).fill(database);owner?.assertCurrent();
  await create.getByRole('checkbox', { name: databaseText.ackDdl, exact: true }).check();owner?.assertCurrent();
  await create.getByRole('checkbox', { name: databaseText.ackCreate, exact: true }).check();owner?.assertCurrent();
  await (await (await import('./navigation-menu')).navigationMenuItem(create, { name: databaseText.apply, exact: true }, owner ? () => owner.assertCurrent() : undefined)).click();owner?.assertCurrent();
  await expect(create.getByRole('status')).toHaveText(databaseText.succeeded, { timeout: 20000 });owner?.assertCurrent();
  await (await (await import('./navigation-menu')).navigationMenuItem(create, { name: '关闭', exact: true }, owner ? () => owner.assertCurrent() : undefined)).click();owner?.assertCurrent();
  await expect(create).toBeHidden({ timeout: 20000 });owner?.assertCurrent();
  await (await (await import('./navigation-menu')).navigationMenuItem(connectionRow, { name: connectionName, exact: true }, owner ? () => owner.assertCurrent() : undefined)).click();owner?.assertCurrent();
  await expect(targetPage().locator('.database-row').getByRole('button', { name: database, exact: true })).toBeVisible();owner?.assertCurrent();
  return { database, connectionName, connectionId };
}

/** 外部观察连接仅用于断言和清理，不替代被测应用的连接、查询或提交链路。 */
export async function isolatedDatabase(body: (context: LiveContext) => Promise<void>, testInfo: TestInfo, options: { captureFailureScreenshot?: boolean } = {}) {
  const strictExit = preservesUnconfirmedExit(testInfo);
  if (strictExit) ownedDesktopResources(testInfo); // 旧TestInfo先拒绝，不能先建观察连接或打开下一例表单。
  if (!environment.DBARK_TEST_HOST || !environment.DBARK_TEST_USER) throw new Error('启用实库 E2E 时必须提供已核对服务器的测试连接配置');
  const database = `dbark_e2e_${Date.now().toString(36)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
  const certificate=tlsCertificate();
  const observer = await mysql.createConnection({ host: environment.DBARK_TEST_HOST, port: Number(environment.DBARK_TEST_PORT ?? 3306), user: environment.DBARK_TEST_USER, password: environment.DBARK_TEST_PASSWORD, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, connectTimeout: 15000,...(certificate?{ssl:{ca:readFileSync(certificate),rejectUnauthorized:true,verifyIdentity:true}}:{}) });
  let failed = false, originalFailure: unknown;
  try {
    if (strictExit) ownedDesktopResources(testInfo);
    const captured = strictExit ? ownedDesktopResources(testInfo) : undefined;
    const context = await connectAndCreate(database, captured ? { page: captured.page, application: captured.application, assertCurrent: () => { ownedDesktopResources(testInfo); } } : undefined);
    if (strictExit) ownedDesktopResources(testInfo);
    await body({ observer, ...context });
    if (strictExit) ownedDesktopResources(testInfo);
    expect(pageErrors).toEqual([]);
  } catch (error) {
    if (strictExit) { failed = true; originalFailure = error; }
    // 默认保留原截图；新CALL用例显式关闭，避免编辑器参数进入公共失败图片，不代理截图接口。
    if (strictExit) {
      try { const owner = ownedDesktopResources(testInfo); if (!owner.closed && options.captureFailureScreenshot !== false) await owner.page.screenshot({ path: testInfo.outputPath('live-failure.png') }); } catch { /* 截图失效不覆盖原异常，归属失配仍由停链状态约束。 */ }
    } else if (!closed && options.captureFailureScreenshot !== false) await page.screenshot({ path: testInfo.outputPath('live-failure.png') }).catch(() => undefined);
    throw error;
  } finally {
    if (strictExit) {
      try {
        // 只核本例独立应用的结构写入；未终态或读取未知时先停链，不借退出请求取消它。
        const owner = ownedDesktopResources(testInfo);
        if (!owner.closed) {
          const tasks = await owner.page.evaluate(() => window.dbark.invoke('tasks.list', {})); ownedDesktopResources(testInfo);
          if (tasks.some(task => ['schema.tableTruncate.apply', 'schema.tableDrop.apply', 'schema.databaseCreate.apply', 'schema.columns.apply'].includes(task.kind) && task.status !== 'completed')) throw new Error('本例结构apply尚未终态或未确认成功，保留数据库、观察连接和原生现场');
        }
        await confirmOwnedDesktopExit(testInfo);
        ownedDesktopResources(testInfo);
        if (!/^dbark_e2e_[a-z0-9_]+$/.test(database)) throw new Error('拒绝清理非 E2E 隔离库');
        await observer.query({ sql: `DROP DATABASE IF EXISTS \`${database}\``, timeout: 15000 });
        ownedDesktopResources(testInfo);
        const [remaining] = await observer.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
        ownedDesktopResources(testInfo); expect(remaining).toHaveLength(0); await observer.end();
      } catch (cleanupFailure) {
        retainOwnedDesktopResources(testInfo);
        if (failed) throw new AggregateError([originalFailure, cleanupFailure], '原用例失败且退出或清理未确认，保留所属资源', { cause: originalFailure });
        throw cleanupFailure;
      }
    } else {
    // 先退出应用，释放可能尚未回滚的会话，再清理本例唯一库；不触碰引擎测试库。
    try { if (!closed) { await answerDialogs([1, 1]); await quitDesktop(); } }
    finally {
      try {
        if (!/^dbark_e2e_[a-z0-9_]+$/.test(database)) throw new Error('拒绝清理非 E2E 隔离库');
        await observer.query({ sql: `DROP DATABASE IF EXISTS \`${database}\``, timeout: 15000 });
        const [remaining] = await observer.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
        expect(remaining).toHaveLength(0);
      } finally { await observer.end(); }
    }
  }
  }
}

/** 选中数据库节点后通过对象树新建查询，确保 SQL 会话绑定正确的库。 */
export async function openDatabaseQuery(database: string) {
  const row = page.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
  // 数据库节点聚焦后通过真实右键菜单新建查询，不触发节点展开。
  await row.getByRole('button', { name: database, exact: true }).focus();
  const newQuery = (await sidebarMenuItem(row, { name: '新建数据库查询', exact: true }));
  await expect(newQuery).toBeVisible(); await newQuery.click();
  await expect(page.locator('.query-tab:visible .monaco-editor')).toBeVisible();
}

/** 使用 Monaco 的真实键盘输入，不通过内部模型或 IPC 绕过编辑器。 */
export async function writeSql(source: string) {
  const input = page.locator('.query-tab:visible .monaco-editor').getByRole('textbox');
  await input.focus(); await page.keyboard.press(`${modifier}+A`); await page.keyboard.insertText(source);
}

/** 执行全部 SQL 并等待任务结束，任何可见数据库错误都必须使验收失败。 */
export async function executeSql(source: string) {
  await writeSql(source);
  const query = page.locator('.query-tab:visible');
  await (await (await import('./navigation-menu')).navigationMenuItem(query, { name: '执行全部', exact: true })).click();
  await expect(query.getByRole('button', { name: '停止', exact: true })).toBeDisabled({ timeout: 20000 });
  await expect(query.locator('.error-box')).toHaveCount(0);
}

/** 捕获同一次完整DOM读取，避免先等到表头、下一次读取却落在表格重绘的空帧；不重发SQL。 */
export async function readRenderedResult(complete:(text:string)=>boolean):Promise<string>{
  let snapshot:string|undefined;
  await expect.poll(async()=>{const text=await page.locator('.query-tab:visible .result-body').innerText();if(text&&complete(text))snapshot=text;return snapshot;},{message:'等待同一次界面读取含完整预期列和值，保留实际SQL执行次数'}).toBeDefined();
  return snapshot!;
}
