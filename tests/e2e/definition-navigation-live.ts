import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync,realpathSync } from 'node:fs';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import type { TestInfo, Page, ElectronApplication } from '@playwright/test';
import { expect, pageErrors, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit } from './desktop-fixture';
import { databaseCreateZh as databaseText } from '../../src/renderer/locales/databaseCreate.zh-CN';
import {zh} from '../../src/renderer/locales/zh-CN';
import { assertDefaultEncodingLiveTarget } from '../helpers/tableDefaultEncodingTarget';
import { closeMysqlConnection } from '../../src/engine/connection';

// W03定义导航新准备门：默认关闭，只使用显式环境参数；不读取本地.env或创建账号。
export const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_W03_DEFINITION_NAVIGATION_TEST === '1';
export const environment: Record<string, string | undefined> = { ...process.env };
export interface LiveOwner { page: Page; desktop: ElectronApplication; assertCurrent(): void; retain?(): void; submitting?(): void; created?(): void; }
export interface LiveContext extends LiveOwner { observer: Connection; database: string; connectionName: string; connectionId: string; }
export const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

interface DefinitionActivity { active: boolean; retained: boolean; deadline: number; retain(): void; check(): void; }
const activities = new WeakMap<TestInfo, DefinitionActivity>();
/** 原期限锚定TestInfo开始时间；本地永久锁先落定，通知异常或noop不能恢复权限。 */
export function beginDefinitionNavigationCase(info: TestInfo): DefinitionActivity {
  const previous = activities.get(info); if (previous) return previous;
  // 已核对当前Playwright内部起点；未知版本缺少此事实时拒绝开启，不能从helper重新计时。
  const start = (info as TestInfo & { _startWallTime?: number })._startWallTime, budget = Math.min(info.timeout || 90000, 90000);
  const state: DefinitionActivity = { active: true, retained: false, deadline: typeof start === 'number' && Number.isFinite(start) ? start + budget : NaN,
    retain() { if (state.retained) return; state.retained = true; try { retainOwnedDesktopResources(info); } catch { /* 本地锁已经落定，通知失败不能覆盖首因。 */ } },
    check() { if (!Number.isFinite(state.deadline) || state.retained || !state.active || Date.now() >= state.deadline || ['timedOut', 'interrupted', 'skipped'].includes(info.status ?? '')) { state.retain(); throw Error('W03本例已停链或原期限已到，保留所属资源'); } },
  }; activities.set(info, state); return state;
}
/** 框架已结束而异步body仍活动时先停链；之后迟到finally不能退出或删除。 */
export function finishDefinitionNavigationCase(info: TestInfo): void {
  const state = activities.get(info); if (!state) return;
  if (state.active || Date.now() >= state.deadline || ['timedOut', 'interrupted', 'skipped'].includes(info.status ?? '')) state.retain();
  state.active = false; if (state.retained) throw Error('W03本例收尾未确认，保留所属资源');
}

type CreateReceipt = { phase: 'absent' | 'unknown' | 'confirmed'; safe: boolean; restore(): void };
type CreateRoot = typeof globalThis & { __dbarkDefinitionCreate?: CreateReceipt };
/** 旁观本例原窗口的真实preview/apply回包，只记录准确目标的ACK，不制造或改写结果。 */
async function watchCreate(owner: LiveOwner, connectionId: string, database: string): Promise<void> {
  owner.assertCurrent(); const window = await owner.desktop.browserWindow(owner.page); owner.assertCurrent();
  let senderId: number; try { senderId = await window.evaluate(value => value.webContents.id); owner.assertCurrent(); } finally { await window.dispose(); }
  await owner.desktop.evaluate(({ ipcMain }, target) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: { command: string; input?: Record<string, unknown> }) => Promise<any>;
    const root = globalThis as CreateRoot, handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers, original = handlers.get('dbark:request');
    if (!original || root.__dbarkDefinitionCreate) throw Error('W03建库ACK旁观器不可交叉覆盖');
    let token: string | undefined;
    const state: CreateReceipt = { phase: 'absent', safe: true, restore() { if (handlers.get('dbark:request') !== wrapped) throw Error('W03建库ACK处理器已变化'); handlers.set('dbark:request', original); delete root.__dbarkDefinitionCreate; } };
    const wrapped: Handler = async (event, payload) => {
      if (event.sender.id !== target.senderId) return original(event, payload);
      const input = payload.input;
      const apply = payload.command === 'schema.databaseCreate.apply';
      const bound = apply && state.safe && state.phase === 'absent' && !!token && input?.previewToken === token && input.confirmation === target.database;
      if (apply) { if (state.phase === 'absent') state.phase = 'unknown'; else state.safe = false; }
      const response = await original(event, payload), result = response?.ok === true ? response.result : undefined;
      if (root.__dbarkDefinitionCreate !== state) return response;
      if (payload.command === 'schema.databaseCreate.preview') token = state.phase === 'absent' && result?.target?.connectionId === target.connectionId && result.name === target.database && typeof result.previewToken === 'string' ? result.previewToken : undefined;
      if (bound && state.safe && result?.name === target.database && result.ddlSubmitted === true && result.ddlCompleted === true && result.definitionVerified === true) state.phase = 'confirmed';
      return response;
    }; root.__dbarkDefinitionCreate = state; handlers.set('dbark:request', wrapped);
  }, { senderId, connectionId, database }); owner.assertCurrent();
}

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
  await watchCreate(owner, connectionId, database);
  let primary: { reason: unknown } | undefined;
  try {
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
  owner.submitting?.();
  await create.getByRole('button', { name: databaseText.apply, exact: true }).click(); owner.assertCurrent();
  await expect(create.getByRole('status')).toHaveText(databaseText.succeeded, { timeout: 20000 }); owner.assertCurrent();
  const acknowledged = await owner.desktop.evaluate(() => { const receipt = (globalThis as CreateRoot).__dbarkDefinitionCreate; return receipt?.phase === 'confirmed' && receipt.safe; }); owner.assertCurrent();
  if (!acknowledged) throw Error('W03未收到本例准确CREATE成功回包，保留未知'); owner.created?.();
  await create.getByRole('button', { name: '关闭', exact: true }).click(); owner.assertCurrent();
  await expect(create).toBeHidden(); owner.assertCurrent();
  await connectionRow.getByRole('button', { name: connectionName, exact: true }).click(); owner.assertCurrent();
  await expect(page.locator('.database-row').getByRole('button', { name: database, exact: true })).toBeVisible(); owner.assertCurrent();
  return { database, connectionName, connectionId, ...owner };
  } catch (reason) { primary = { reason }; throw reason; }
  finally {
    try { owner.assertCurrent(); await owner.desktop.evaluate(() => (globalThis as CreateRoot).__dbarkDefinitionCreate?.restore()); owner.assertCurrent(); }
    catch (reason) { owner.retain?.(); if (primary) throw new AggregateError([primary.reason, reason], 'W03建库失败且ACK旁观器未确认恢复', { cause: primary.reason }); throw reason; }
  }
}

/** Promise end不能代替原生QUIT及同一流close证明；关闭等待不得越过原期限。 */
async function closeDefinitionObserver(raw: Connection, native: any, stream: any, owner: LiveOwner, deadline: number): Promise<void> {
  owner.assertCurrent();
  if (!native || (raw as Connection & { connection?: unknown }).connection !== native || !stream || native.stream !== stream || typeof native.end !== 'function' || typeof native.destroy !== 'function' || [stream.once, stream.removeListener, stream.end, stream.destroy].some(method => typeof method !== 'function')) throw Error('W03观察连接原生流未知，保留现场');
  await closeMysqlConnection(native, true, false, Math.min(1000, Math.max(1, deadline - Date.now()))); owner.assertCurrent();
  if ((raw as Connection & { connection?: unknown }).connection !== native || native.stream !== stream || stream.closed !== true) throw Error('W03同一观察连接原生流close未确认，保留现场');
}

/** 观察及清理始终绑定本例原始页面、应用和连接；未知结果保留现场。 */
export async function isolatedDatabase(body: (context: LiveContext) => Promise<void>, testInfo: TestInfo) {
  if (!enabled) throw Error('W03定义导航核心/UI双开关未显式开启');
  const activity = beginDefinitionNavigationCase(testInfo); activity.check();
  const captured = ownedDesktopResources(testInfo);
  let create: 'absent' | 'unknown' | 'confirmed' = 'absent', absenceVerified = false, allowClosed = false;
  const owner: LiveOwner = { page: captured.page, desktop: captured.application, retain: () => activity.retain(),
    submitting() { owner.assertCurrent(); if (!absenceVerified || create !== 'absent') { activity.retain(); throw Error('W03建库来源不明或重复提交'); } create = 'unknown'; },
    created() { owner.assertCurrent(); if (create !== 'unknown') { activity.retain(); throw Error('W03建库ACK状态不符'); } create = 'confirmed'; },
    assertCurrent() {
      activity.check();
      try { const current = ownedDesktopResources(testInfo); if (current.page !== captured.page || current.application !== captured.application || !allowClosed && current.closed) throw Error('W03定义导航本例归属或关闭状态失效'); }
      catch (reason) { activity.retain(); throw reason; }
    },
  };
  let raw: Connection | undefined, native: any, stream: any, primary: { reason: unknown } | undefined;
  const database = `dbark_e2e_defnav_${Date.now().toString(36)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
  try {
    assertDefaultEncodingLiveTarget({ host: environment.DBARK_TEST_HOST, port: environment.DBARK_TEST_PORT, tlsFlag: environment.DBARK_TEST_TLS, caPath: environment.DBARK_TEST_CA });
    if (!environment.DBARK_TEST_USER) throw Error('W03定义导航必须显式提供已核对的账号');
    const certificate = tlsCertificate(); owner.assertCurrent();
    try { raw = await mysql.createConnection({ host: environment.DBARK_TEST_HOST, port: Number(environment.DBARK_TEST_PORT), user: environment.DBARK_TEST_USER, password: environment.DBARK_TEST_PASSWORD, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, connectTimeout: 15000, ...(certificate ? { ssl: { ca: readFileSync(certificate), rejectUnauthorized: true, verifyIdentity: true } } : {}) }); owner.assertCurrent(); }
    catch (reason) { activity.retain(); throw reason; }
    native = (raw as Connection & { connection?: any }).connection; stream = native?.stream;
    // 观察未知先落本地锁，通知throw/noop及后续身份恢复均不能继续退出或删除。
    const observer = new Proxy(raw, { get(target, key) {
      if (key !== 'query') { const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; }
      return async (...args: unknown[]) => { owner.assertCurrent(); try { const value = await (target.query as Function).apply(target, args); owner.assertCurrent(); return value; } catch (reason) { activity.retain(); throw reason; } };
    } });
    const [existing] = await observer.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
    expect(existing).toHaveLength(0); absenceVerified = true;
    const context = await connectAndCreate(database, owner); owner.assertCurrent();
    await body({ observer, ...context }); owner.assertCurrent(); expect(pageErrors).toEqual([]);
  } catch (reason) { primary = { reason }; if ((create as string) === 'unknown') activity.retain(); throw reason; }
  finally {
    try {
      owner.assertCurrent(); const current = ownedDesktopResources(testInfo);
      if (!current.closed) {
        const tasks = await captured.page.evaluate(() => window.dbark.invoke('tasks.list', {})); owner.assertCurrent();
        if (!Array.isArray(tasks) || tasks.some(task => task.kind.startsWith('schema.databaseCreate.') && (task.kind.endsWith('.apply') ? task.status !== 'completed' : !['completed', 'failed', 'cancelled'].includes(task.status)))) throw Error('W03建库任务未确认终态，保留现场');
      }
      if ((create as string) === 'unknown') throw Error('W03本例CREATE未知，不退出或删除');
      await confirmOwnedDesktopExit(testInfo); allowClosed = true; owner.assertCurrent();
      if ((create as string) === 'confirmed') {
        if (!absenceVerified || !raw || !/^dbark_e2e_defnav_[a-z0-9_]+$/.test(database)) throw Error('拒绝清理非本例已确认创建的数据库');
        owner.assertCurrent(); await raw.query({ sql: `DROP DATABASE IF EXISTS \`${database}\``, timeout: Math.min(15000, Math.max(1, activity.deadline - Date.now())) }); owner.assertCurrent();
        const [remaining] = await raw.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]); owner.assertCurrent(); expect(remaining).toHaveLength(0);
      }
      if (raw) await closeDefinitionObserver(raw, native, stream, owner, activity.deadline);
    } catch (reason) {
      activity.retain();
      if (primary) throw new AggregateError([primary.reason, reason], 'W03原失败及收尾未确认，保留所属资源：' + (primary.reason instanceof Error ? primary.reason.message : String(primary.reason)), { cause: primary.reason });
      throw reason;
    } finally { activity.active = false; }
  }
}
