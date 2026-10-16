import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync,realpathSync } from 'node:fs';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import type { TestInfo } from '@playwright/test';
import { expect, desktop, page, closed, pageErrors, answerDialogs, quitDesktop, preservesUnconfirmedExit, retainOwnedDesktopResources, confirmOwnedDesktopExit } from './desktop-fixture';
import {zh} from '../../src/renderer/locales/zh-CN';

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
export const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/** 严格TLS验收必须显式提供已有CA；不能静默退回明文或关闭证书/主机校验。 */
function tlsCertificate():string|undefined{
  if(environment.DBARK_TEST_TLS!=='1')return undefined;
  if(!environment.DBARK_TEST_CA||!existsSync(environment.DBARK_TEST_CA))throw Error('严格TLS验收缺少明确的本机CA证书');
  return realpathSync(environment.DBARK_TEST_CA);
}
/** 只替换本次原生文件选择的回答；路径授权、文件读取和TLS建连仍走产品原逻辑。 */
async function configureTls(form:ReturnType<typeof page.getByRole>){
  const certificate=tlsCertificate();if(!certificate)return;
  await form.getByRole('button',{name:'TLS / SSL',exact:true}).click();await form.getByLabel(zh.connections.text027,{exact:true}).check();await form.getByLabel(zh.connections.text028,{exact:true}).check();
  await desktop.evaluate(({dialog},path)=>{
    const root=globalThis as typeof globalThis&{__liveTlsOpenDialog?:typeof dialog.showOpenDialog};if(root.__liveTlsOpenDialog)throw Error('TLS文件选择不可交叉覆盖');root.__liveTlsOpenDialog=dialog.showOpenDialog;
    dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[path]}))as typeof dialog.showOpenDialog;
  },certificate);
  try{await form.getByRole('button',{name:'选择CA 证书',exact:true}).click();await expect(form.getByRole('textbox',{name:'CA 证书 选择CA 证书',exact:true})).toHaveValue(certificate);}
  finally{await desktop.evaluate(({dialog})=>{const root=globalThis as typeof globalThis&{__liveTlsOpenDialog?:typeof dialog.showOpenDialog};if(root.__liveTlsOpenDialog){dialog.showOpenDialog=root.__liveTlsOpenDialog;delete root.__liveTlsOpenDialog;}});}
}

/** 浏览器确认框由 Electron 原生接口承接，同时覆盖其同步与异步调用路径。 */
export async function acceptNativeConfirmation() {
  await answerDialogs([]);
  await desktop.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = ((...args: unknown[]) => {
      const options = args.at(-1) as Electron.MessageBoxSyncOptions;
      globalThis.__dbarkE2EDialogs.calls.push({ title: options.title, message: options.message, buttons: options.buttons, response: 0 });
      return 0;
    }) as typeof dialog.showMessageBoxSync;
  });
}

/** 连接表单走真实 UI；测试追踪关闭，避免把临时数据库密码记录进 Playwright 参数轨迹。 */
export async function connectAndCreate(database: string): Promise<Omit<LiveContext, 'observer'>> {
  const connectionName = `E2E ${database}`;
  await page.locator('.app-commandbar').getByRole('button', { name: '新建连接', exact: true }).click();
  const form = page.getByRole('dialog', { name: '新建连接', exact: true });
  await form.getByLabel('连接名称', { exact: true }).fill(connectionName);
  await form.getByLabel('主机地址', { exact: true }).fill(environment.DBARK_TEST_HOST!);
  await form.getByLabel('端口', { exact: true }).fill(environment.DBARK_TEST_PORT ?? '3306');
  await form.getByLabel('用户名', { exact: true }).fill(environment.DBARK_TEST_USER ?? 'root');
  await form.getByLabel('数据库密码', { exact: true }).fill(environment.DBARK_TEST_PASSWORD ?? '');
  await form.getByLabel('连接分组', { exact: true }).fill('隔离数据库验证');
  await configureTls(form);
  await form.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(form.locator('.success-box')).toContainText('连接成功', { timeout: 20000 });
  await form.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(form).toBeHidden();
  const profiles = await page.evaluate(() => window.dbark.invoke('connections.list', {}));
  const connectionId = profiles.find(profile => profile.name === connectionName)!.id;
  const connectionRow = page.locator('.connection-row').filter({ has: page.getByRole('button', { name: connectionName, exact: true }) });
  // 使用既有键盘焦点入口显示操作区，避免窗口切换后残留鼠标位置使悬停状态失效；保持真实可见性和点击检查。
  await connectionRow.getByRole('button', { name: connectionName, exact: true }).focus();
  const createDatabase = connectionRow.getByRole('button', { name: '创建数据库', exact: true });
  await expect(createDatabase).toBeVisible(); await createDatabase.click();
  const create = page.getByRole('dialog', { name: '创建数据库', exact: true });
  await create.getByLabel('数据库名称', { exact: true }).fill(database);
  await expect(create.locator('.monaco-editor .view-lines')).toContainText('CREATE DATABASE');
  await acceptNativeConfirmation();
  await create.getByRole('button', { name: '执行 SQL', exact: true }).click();
  await expect(create).toBeHidden({ timeout: 20000 });
  await connectionRow.getByRole('button', { name: connectionName, exact: true }).click();
  await expect(page.locator('.database-row').getByRole('button', { name: database, exact: true })).toBeVisible();
  return { database, connectionName, connectionId };
}

/** 外部观察连接仅用于断言和清理，不替代被测应用的连接、查询或提交链路。 */
export async function isolatedDatabase(body: (context: LiveContext) => Promise<void>, testInfo: TestInfo, options: { captureFailureScreenshot?: boolean } = {}) {
  if (!environment.DBARK_TEST_HOST || !environment.DBARK_TEST_USER) throw new Error('启用实库 E2E 时必须提供已核对服务器的测试连接配置');
  const database = `dbark_e2e_${Date.now().toString(36)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
  const certificate=tlsCertificate();
  const observer = await mysql.createConnection({ host: environment.DBARK_TEST_HOST, port: Number(environment.DBARK_TEST_PORT ?? 3306), user: environment.DBARK_TEST_USER, password: environment.DBARK_TEST_PASSWORD, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, connectTimeout: 15000,...(certificate?{ssl:{ca:readFileSync(certificate),rejectUnauthorized:true,verifyIdentity:true}}:{}) });
  const strictExit = preservesUnconfirmedExit(testInfo); let failed = false, originalFailure: unknown;
  try {
    const context = await connectAndCreate(database);
    await body({ observer, ...context });
    expect(pageErrors).toEqual([]);
  } catch (error) {
    if (strictExit) { failed = true; originalFailure = error; }
    // 默认保留原截图；新CALL用例显式关闭，避免编辑器参数进入公共失败图片，不代理截图接口。
    if (!closed && options.captureFailureScreenshot !== false) await page.screenshot({ path: testInfo.outputPath('live-failure.png') }).catch(() => undefined);
    throw error;
  } finally {
    if (strictExit) {
      try {
        // 只核本例独立应用的TRUNCATE投递；未终态或读取未知时先停链，不借退出请求取消它。
        if (!closed) {
          const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
          if (tasks.some(task => task.kind === 'schema.tableTruncate.apply' && !['completed', 'failed', 'cancelled'].includes(task.status))) throw new Error('本例清空apply尚未终态，保留数据库、观察连接和原生现场');
        }
        await confirmOwnedDesktopExit(testInfo);
        if (!/^dbark_e2e_[a-z0-9_]+$/.test(database)) throw new Error('拒绝清理非 E2E 隔离库');
        await observer.query({ sql: `DROP DATABASE IF EXISTS \`${database}\``, timeout: 15000 });
        const [remaining] = await observer.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
        expect(remaining).toHaveLength(0); await observer.end();
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
  // 数据库节点沿用同一 focus-within 操作入口，不依赖鼠标在其他窗口关闭前的位置。
  await row.getByRole('button', { name: database, exact: true }).focus();
  const newQuery = row.getByRole('button', { name: '新建数据库查询', exact: true });
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
  await query.getByRole('button', { name: '执行全部', exact: true }).click();
  await expect(query.getByRole('button', { name: '停止', exact: true })).toBeDisabled({ timeout: 20000 });
  await expect(query.locator('.error-box')).toHaveCount(0);
}

/** 捕获同一次完整DOM读取，避免先等到表头、下一次读取却落在表格重绘的空帧；不重发SQL。 */
export async function readRenderedResult(complete:(text:string)=>boolean):Promise<string>{
  let snapshot:string|undefined;
  await expect.poll(async()=>{const text=await page.locator('.query-tab:visible .result-body').innerText();if(text&&complete(text))snapshot=text;return snapshot;},{message:'等待同一次界面读取含完整预期列和值，保留实际SQL执行次数'}).toBeDefined();
  return snapshot!;
}
