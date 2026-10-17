import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync,realpathSync } from 'node:fs';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import type { TestInfo, Page, ElectronApplication } from '@playwright/test';
import { expect, pageErrors, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit } from './desktop-fixture';
import { databaseCreateZh as databaseText } from '../../src/renderer/locales/databaseCreate.zh-CN';
import {zh} from '../../src/renderer/locales/zh-CN';
import { assertDefaultEncodingLiveTarget } from '../helpers/tableDefaultEncodingTarget';

// W03定义导航新准备门：默认关闭，只使用显式环境参数；不读取本地.env或创建账号。
export const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_W03_DEFINITION_NAVIGATION_TEST === '1';
export const environment: Record<string, string | undefined> = { ...process.env };
export interface LiveOwner { page: Page; desktop: ElectronApplication; assertCurrent(): void; }
export interface LiveContext extends LiveOwner { observer: Connection; database: string; connectionName: string; connectionId: string; }
export const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/** 严格TLS验收必须显式提供已有CA；不能静默退回明文或关闭证书/主机校验。 */
function tlsCertificate():string|undefined{
  if(environment.DBARK_TEST_TLS!=='1')return undefined;
  if(!environment.DBARK_TEST_CA||!existsSync(environment.DBARK_TEST_CA))throw Error('严格TLS验收缺少明确的本机CA证书');
  return realpathSync(environment.DBARK_TEST_CA);
}
/** 只替换本次原生文件选择的回答；路径授权、文件读取和TLS建连仍走产品原逻辑。 */
async function configureTls(form: ReturnType<Page['getByRole']>, owner: LiveOwner){
  const desktop = owner.desktop; owner.assertCurrent();
  const certificate=tlsCertificate();if(!certificate)return;
  await form.getByRole('button',{name:'TLS / SSL',exact:true}).click();owner.assertCurrent();await form.getByLabel(zh.connections.text027,{exact:true}).check();owner.assertCurrent();await form.getByLabel(zh.connections.text028,{exact:true}).check(); owner.assertCurrent();
  await desktop.evaluate(({dialog},path)=>{
    const root=globalThis as typeof globalThis&{__liveTlsOpenDialog?:typeof dialog.showOpenDialog};if(root.__liveTlsOpenDialog)throw Error('TLS文件选择不可交叉覆盖');root.__liveTlsOpenDialog=dialog.showOpenDialog;
    dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[path]}))as typeof dialog.showOpenDialog;
  },certificate); owner.assertCurrent();
  try{await form.getByRole('button',{name:'选择CA 证书',exact:true}).click();owner.assertCurrent();await expect(form.getByRole('textbox',{name:'CA 证书 选择CA 证书',exact:true})).toHaveValue(certificate);}
  finally{owner.assertCurrent();await desktop.evaluate(({dialog})=>{const root=globalThis as typeof globalThis&{__liveTlsOpenDialog?:typeof dialog.showOpenDialog};if(root.__liveTlsOpenDialog){dialog.showOpenDialog=root.__liveTlsOpenDialog;delete root.__liveTlsOpenDialog;}});}
}

/** 连接表单走真实 UI；测试追踪关闭，避免把临时数据库密码记录进 Playwright 参数轨迹。 */
export async function connectAndCreate(database: string, owner: LiveOwner): Promise<Omit<LiveContext, 'observer'>> {
  const page = owner.page; owner.assertCurrent();
  const connectionName = `E2E ${database}`;
  await page.locator('.app-commandbar').getByRole('button', { name: '新建连接', exact: true }).click(); owner.assertCurrent();
  const form = page.getByRole('dialog', { name: '新建连接', exact: true });
  await form.getByLabel('连接名称', { exact: true }).fill(connectionName); owner.assertCurrent();
  await form.getByLabel('主机地址', { exact: true }).fill(environment.DBARK_TEST_HOST!); owner.assertCurrent();
  await form.getByLabel('端口', { exact: true }).fill(environment.DBARK_TEST_PORT ?? '3306'); owner.assertCurrent();
  await form.getByLabel('用户名', { exact: true }).fill(environment.DBARK_TEST_USER ?? 'root'); owner.assertCurrent();
  await form.getByLabel('数据库密码', { exact: true }).fill(environment.DBARK_TEST_PASSWORD ?? ''); owner.assertCurrent();
  await form.getByLabel('连接分组', { exact: true }).fill('隔离数据库验证'); owner.assertCurrent();
  await configureTls(form, owner); owner.assertCurrent();
  await form.getByRole('button', { name: '测试连接', exact: true }).click(); owner.assertCurrent();
  await expect(form.locator('.success-box')).toContainText('连接成功', { timeout: 20000 }); owner.assertCurrent();
  await form.getByRole('button', { name: '保存连接', exact: true }).click(); owner.assertCurrent();
  await expect(form).toBeHidden(); owner.assertCurrent();
  const profiles = await page.evaluate(() => window.dbark.invoke('connections.list', {})); owner.assertCurrent();
  const saved = profiles.find(profile => profile.name === connectionName)!;
  const connectionId = saved.id;
  const status = await page.evaluate(id => window.dbark.invoke('connections.open', { id }), connectionId); owner.assertCurrent();
  assertDefaultEncodingLiveTarget({ host: environment.DBARK_TEST_HOST, port: environment.DBARK_TEST_PORT, tlsFlag: environment.DBARK_TEST_TLS, caPath: environment.DBARK_TEST_CA }, saved);
  const expected: Record<string, [string, RegExp]> = { '13357': ['mysql', /^5\.7\./], '13380': ['mysql', /^8\.0\./], '13384': ['mysql', /^8\.4\./], '13484': ['mysql', /^8\.4\./], '13310': ['mariadb', /^10\.11\./], '13311': ['mariadb', /^11\.4\./] };
  const target = expected[String(saved.port)];
  if (!target || status.dialect !== target[0] || !target[1].test(status.version.replace(/^5\.5\.5-/, ''))) throw Error('定义导航端口与实际方言/版本不符');
  console.info(JSON.stringify({ 正式界面版本: status.version, 方言: status.dialect, 端口: saved.port, 定义导航实跑: true }));
  const connectionRow = page.locator('.connection-row').filter({ has: page.getByRole('button', { name: connectionName, exact: true }) });
  // 使用既有键盘焦点入口显示操作区，避免窗口切换后残留鼠标位置使悬停状态失效；保持真实可见性和点击检查。
  await connectionRow.getByRole('button', { name: connectionName, exact: true }).focus(); owner.assertCurrent();
  const createDatabase = connectionRow.getByRole('button', { name: '创建数据库', exact: true });
  await expect(createDatabase).toBeVisible(); await createDatabase.click(); owner.assertCurrent();
  const create = page.getByRole('dialog', { name: '创建数据库', exact: true });
  await create.getByLabel('数据库名称', { exact: true }).fill(database); owner.assertCurrent();
  // 复用实际目录配对、只读预览和完整名称确认，不能使用已移除的通用执行按钮。
  await create.getByRole('combobox', { name: databaseText.charset, exact: true }).selectOption('utf8mb4'); owner.assertCurrent();
  await create.getByRole('combobox', { name: databaseText.collation, exact: true }).selectOption('utf8mb4_bin'); owner.assertCurrent();
  await create.getByRole('button', { name: databaseText.preview, exact: true }).click(); owner.assertCurrent();
  await expect(create.locator('.monaco-editor .view-lines')).toContainText('CREATE DATABASE'); owner.assertCurrent();
  await create.getByRole('textbox', { name: databaseText.confirmation, exact: true }).fill(database); owner.assertCurrent();
  await create.getByRole('checkbox', { name: databaseText.ackDdl, exact: true }).check(); owner.assertCurrent();
  await create.getByRole('checkbox', { name: databaseText.ackCreate, exact: true }).check(); owner.assertCurrent();
  await create.getByRole('button', { name: databaseText.apply, exact: true }).click(); owner.assertCurrent();
  await expect(create.getByRole('status')).toHaveText(databaseText.succeeded, { timeout: 20000 }); owner.assertCurrent();
  await create.getByRole('button', { name: '关闭', exact: true }).click(); owner.assertCurrent();
  await expect(create).toBeHidden(); owner.assertCurrent();
  await connectionRow.getByRole('button', { name: connectionName, exact: true }).click(); owner.assertCurrent();
  await expect(page.locator('.database-row').getByRole('button', { name: database, exact: true })).toBeVisible(); owner.assertCurrent();
  return { database, connectionName, connectionId, ...owner };
}

/** 观察及清理始终绑定本例原始页面、应用和连接；未知结果保留现场。 */
export async function isolatedDatabase(body: (context: LiveContext) => Promise<void>, testInfo: TestInfo) {
  if (!enabled) throw Error('W03定义导航核心/UI双开关未显式开启');
  const captured = ownedDesktopResources(testInfo);
  const owner: LiveOwner = { page: captured.page, desktop: captured.application, assertCurrent() {
    const current = ownedDesktopResources(testInfo);
    if (current.page !== captured.page || current.application !== captured.application) { retainOwnedDesktopResources(testInfo); throw Error('W03定义导航本例归属失效，保留现场'); }
  } };
  assertDefaultEncodingLiveTarget({ host: environment.DBARK_TEST_HOST, port: environment.DBARK_TEST_PORT, tlsFlag: environment.DBARK_TEST_TLS, caPath: environment.DBARK_TEST_CA });
  if (!environment.DBARK_TEST_USER) throw Error('W03定义导航必须显式提供已核对的账号');
  const database = `dbark_e2e_defnav_${Date.now().toString(36)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`, certificate = tlsCertificate();
  const raw = await mysql.createConnection({ host: environment.DBARK_TEST_HOST, port: Number(environment.DBARK_TEST_PORT), user: environment.DBARK_TEST_USER, password: environment.DBARK_TEST_PASSWORD, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, connectTimeout: 15000, ...(certificate ? { ssl: { ca: readFileSync(certificate), rejectUnauthorized: true, verifyIdentity: true } } : {}) });
  // 每次观察都核归属；查询未知时禁止后续DROP、退出或借新例句柄清理。
  const observer = new Proxy(raw, { get(target, key) {
    if (key !== 'query') { const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; }
    return async (...args: unknown[]) => { owner.assertCurrent(); try { const value = await (target.query as Function).apply(target, args); owner.assertCurrent(); return value; } catch (reason) { retainOwnedDesktopResources(testInfo); throw reason; } };
  } });
  let ownsName = false, primary: { reason: unknown } | undefined;
  try {
    owner.assertCurrent();
    const [existing] = await observer.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
    expect(existing).toHaveLength(0); ownsName = true;
    const context = await connectAndCreate(database, owner); owner.assertCurrent();
    await body({ observer, ...context }); owner.assertCurrent(); expect(pageErrors).toEqual([]);
  } catch (reason) { primary = { reason }; throw reason; }
  finally {
    try {
      owner.assertCurrent(); const current = ownedDesktopResources(testInfo);
      if (!current.closed) {
        const tasks = await captured.page.evaluate(() => window.dbark.invoke('tasks.list', {})); owner.assertCurrent();
        if (tasks.some(task => task.kind.startsWith('schema.databaseCreate.') && (task.kind.endsWith('.apply') ? task.status !== 'completed' : !['completed', 'failed', 'cancelled'].includes(task.status)))) throw Error('W03建库任务未确认终态，保留现场');
      }
      await confirmOwnedDesktopExit(testInfo); owner.assertCurrent();
      if (ownsName) {
        if (!/^dbark_e2e_defnav_[a-z0-9_]+$/.test(database)) throw Error('拒绝清理非本例W03数据库');
        await observer.query({ sql: `DROP DATABASE IF EXISTS \`${database}\``, timeout: 15000 });
        const [remaining] = await observer.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]); expect(remaining).toHaveLength(0);
      }
      await raw.end(); owner.assertCurrent();
    } catch (reason) {
      retainOwnedDesktopResources(testInfo);
      if (primary) throw new AggregateError([primary.reason, reason], 'W03原失败及收尾未确认，保留所属资源', { cause: primary.reason });
      throw reason;
    }
  }
}
