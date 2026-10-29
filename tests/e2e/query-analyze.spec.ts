import type { TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, desktop, page } from './desktop-fixture';
import { queryAnalyzeZh as t } from '../../src/renderer/locales/queryAnalyze.zh-CN';

// 双门默认关闭，列表路径不加载会读取本地私网配置的帮助器。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_QUERY_ANALYZE_UI === '1';
test.skip(!enabled, '实际执行分析须统筹核对200隔离实例并显式开启实库和GUI双门');
test.use({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true });
test.setTimeout(180000);

type Live = typeof import('./live-helpers');
type Context = Parameters<Parameters<Live['isolatedDatabase']>[0]>[0];
type AnalyzeRequest = { taskId: string; sessionId: string; sql: string; acknowledged: unknown; expectedDatabase: unknown };
type AnalyzeReply = { taskId: string; ok: boolean; error?: string; dialect?: string; format?: string; nodeCount?: number; actualMetrics?: number; truncated?: boolean; transactionOpen?: boolean };
interface AuditSnapshot { requests: AnalyzeRequest[]; replies: AnalyzeReply[]; cancellations: string[]; cancelReplies: Array<{ taskId: string; ok: boolean }>; pending: number; cancelPending: number; execute: number; connectionsOpened: number; sessionsOpened: number; completions: Array<{ command: 'query.completionState' | 'query.analyzeContext'; sessionId: string; dialect?: string; serverVersion?: string; database?: string | null; databaseKnown: boolean; broken: boolean; busy: boolean }> }
const query = () => page.locator('.query-tab:visible');
const confirm = () => page.getByRole('dialog', { name: t.title, exact: true });
const analysis = () => query().getByRole('region', { name: t.view, exact: true });
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/** 配置只在明确运行的用例体中加载；只操作用户已经批准的200隔离实例。 */
async function isolated(body: (context: Context, live: Live) => Promise<void>, info: TestInfo) {
  if (!enabled) throw Error('实际执行分析专项未获得双门授权');
  const live = await import('./live-helpers');
  if (!['192.168.31.200', 'deve-server.yinzon.com'].includes(live.environment.DBARK_TEST_HOST ?? '') || !['13357', '13380', '13384', '13310', '13311', '13484'].includes(live.environment.DBARK_TEST_PORT ?? '')) throw Error('实际执行分析只允许已批准的200隔离端口');
  if (live.environment.DBARK_TEST_PORT === '13484' && live.environment.DBARK_TEST_TLS !== '1') throw Error('13484必须明确使用严格TLS配置');
  await live.isolatedDatabase(context => body(context, live), info);
}

/** 只旁观真实 Main 处理器的请求与响应，不改变结果、时序、权限或数据库命令。 */
async function installAudit() {
  await desktop.evaluate(({ ipcMain, BrowserWindow }) => {
    const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers;
    const original = handlers?.get('dbark:request'), windows = BrowserWindow.getAllWindows(), window = windows[0];
    if (typeof original !== 'function' || windows.length !== 1 || root.__queryAnalyzeUiAudit) throw Error('实际执行分析Main旁观归属不明');
    const contents = window.webContents, frame = contents.mainFrame, processId = frame.processId, frameToken = frame.frameToken;
    const state: AuditSnapshot & { restore(): void } = { requests: [], replies: [], cancellations: [], cancelReplies: [], pending: 0, cancelPending: 0, execute: 0, connectionsOpened: 0, sessionsOpened: 0, completions: [], restore() { if (handlers.get('dbark:request') !== wrapped) throw Error('实际执行分析旁观器已被替换'); handlers.set('dbark:request', original); delete root.__queryAnalyzeUiAudit; } };
    const wrapped = async (event: any, payload: any) => {
      if (event.sender !== contents || event.senderFrame !== frame || frame.processId !== processId || frame.frameToken !== frameToken) return original(event, payload);
      const command = payload?.command, input = payload?.input;
      if (command === 'query.execute' || command === 'query.executeParameterized') state.execute++;
      if (command === 'connections.open') state.connectionsOpened++;
      if (command === 'sessions.open') state.sessionsOpened++;
      const cancellation = command === 'query.cancel' && state.requests.some(request => request.taskId === input?.taskId);
      if (cancellation) { state.cancellations.push(input.taskId); state.cancelPending++; }
      const request = command === 'query.analyze' ? { taskId: input?.taskId, sessionId: input?.sessionId, sql: input?.sql, acknowledged: input?.acknowledged, expectedDatabase: input?.expectedDatabase } : undefined;
      if (request) { state.requests.push(request); state.pending++; }
      try {
        const response = await original(event, payload);
        if ((command === 'query.completionState' || command === 'query.analyzeContext') && response?.ok === true) {
          const value = response.result; state.completions.push({ command, sessionId: input?.sessionId, dialect: value?.dialect, serverVersion: value?.serverVersion, database: value?.database, databaseKnown: value?.databaseKnown, broken: value?.broken, busy: value?.busy });
        }
        if (request) {
          const value = response?.result, plan = value?.analysis;
          state.replies.push({ taskId: request.taskId, ok: response?.ok === true, ...(typeof response?.error === 'string' ? { error: response.error } : {}), ...(plan ? { dialect: plan.dialect, format: plan.format, nodeCount: plan.nodes?.length, actualMetrics: plan.nodes?.reduce((total: number, node: any) => total + node.metrics.filter((metric: any) => metric.kind === 'actual').length, 0), truncated: plan.rawTruncated } : {}), ...(typeof value?.transactionOpen === 'boolean' ? { transactionOpen: value.transactionOpen } : {}) });
        }
        if (cancellation) state.cancelReplies.push({ taskId: input.taskId, ok: response?.ok === true });
        return response;
      } finally { if (request) state.pending--; if (cancellation) state.cancelPending--; }
    };
    root.__queryAnalyzeUiAudit = state; handlers.set('dbark:request', wrapped);
  });
}
/** 不读凭据，只读本例合成SQL的实际执行次数及准入事实。 */
async function audit(): Promise<AuditSnapshot> {
  return desktop.evaluate(() => {
    const state = (globalThis as any).__queryAnalyzeUiAudit; if (!state) throw Error('实际执行分析旁观器不存在');
    const { requests, replies, cancellations, cancelReplies, pending, cancelPending, execute, connectionsOpened, sessionsOpened, completions } = state; return { requests, replies, cancellations, cancelReplies, pending, cancelPending, execute, connectionsOpened, sessionsOpened, completions };
  });
}
/** 旁观器恢复前须等原实际分析响应落定；观察超时不被当作进程或数据库已停止。 */
async function restoreAudit(info: TestInfo) {
  const result = await audit();
  await info.attach('实际分析Main旁观事实', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.pending).toBe(0); expect(result.cancelPending).toBe(0);
  await desktop.evaluate(() => { const state = (globalThis as any).__queryAnalyzeUiAudit; if (!state) throw Error('缺少原旁观器'); state.restore(); });
}
/** 原失败和旁观收尾失败同时保留，不能让后一个异常覆盖原断言。 */
async function observed(body: () => Promise<void>, info: TestInfo) {
  await installAudit(); let failed = false, original: unknown;
  try { await body(); } catch (error) { failed = true; original = error; throw error; }
  finally { try { await restoreAudit(info); } catch (cleanup) { if (failed) throw new AggregateError([original, cleanup], '原实际分析验收失败且旁观器收尾未确认', { cause: original }); throw cleanup; } }
}

/** 版本由独立观察连接真实读取，不依据被测组件是否显示按钮决定期望。 */
async function server(context: Context) {
  const [rows] = await context.observer.query<RowDataPacket[]>('SELECT VERSION() AS version');
  const version = String(rows[0].version), dialect = /mariadb/i.test(version) ? 'mariadb' : 'mysql';
  const normalized = version.replace(/^5\.5\.5-/, ''), match = /^(\d+)\.(\d+)\.(\d+)/.exec(normalized);
  if (!match) throw Error('实际服务器版本不能确认');
  const [major, minor, patch] = match.slice(1).map(Number);
  const supported = dialect === 'mariadb' ? major > 10 || major === 10 && minor >= 1 : major > 8 || major === 8 && (minor > 0 || patch >= 18);
  return { version, normalized, dialect, supported, prefix: dialect === 'mariadb' ? 'ANALYZE FORMAT=JSON ' : major > 8 || minor > 0 || patch >= 21 ? 'EXPLAIN ANALYZE FORMAT=TREE ' : 'EXPLAIN ANALYZE ' };
}
/** 实际不支持版本走正式入口的明确拒绝，不将该场景记为支持能力跳过。 */
async function unsupported(source: string, live: Live, info: TestInfo) {
  await live.writeSql(source); const before = await query().locator('.result-body').innerText();
  await (await navigationMenuItem(query(), { name: t.open, exact: true })).click();
  await expect((await navigationMenuItem(query(), { name: t.open, exact: true }))).toBeEnabled();
  await expect(query().locator('.error-box')).toContainText('不支持实际执行分析'); await expect(confirm()).toHaveCount(0);
  expect((await audit()).requests).toEqual([]); expect((await audit()).execute).toBe(0); expect(await query().locator('.result-body').innerText()).toBe(before);
  info.annotations.push({ type: '实测能力拒绝', description: '当前真实服务器不支持实际执行分析，已验证正式入口零ANALYZE，未作为支持场景跳过' });
}
/** 确认发送后等待原Main响应和正式任务按钮，不用显示轮询代替真实执行次数。 */
async function analyze(source: string, database: string, live: Live, expected: number) {
  await live.writeSql(source); await (await navigationMenuItem(query(), { name: t.open, exact: true })).click();
  await expect(confirm()).toBeVisible(); await expect(confirm()).toContainText(database);
  expect((await audit()).requests).toHaveLength(expected - 1); await confirm().getByRole('checkbox', { name: t.acknowledge, exact: true }).check();
  await (await navigationMenuItem(confirm(), { name: t.confirm, exact: true })).click(); await expect(confirm()).toHaveCount(0);
  await expect.poll(async () => (await audit()).requests.length).toBe(expected);
  await expect.poll(async () => (await audit()).pending, { timeout: 20000 }).toBe(0);
  await expect((await navigationMenuItem(query(), { name: '停止', exact: true }))).toBeDisabled(); await expect(query().locator('.error-box')).toHaveCount(0);
  await expect(analysis()).toBeVisible(); await expect(analysis().getByRole('treeitem').first()).toBeVisible();
  const result = await audit(), request = result.requests[expected - 1], reply = result.replies.find(item => item.taskId === request.taskId)!;
  expect(request).toMatchObject({ sql: source, expectedDatabase: database, acknowledged: true }); expect(reply).toMatchObject({ ok: true, truncated: false });
  expect(reply.nodeCount).toBeGreaterThan(0); expect(reply.actualMetrics).toBeGreaterThan(0);
  return { request, reply };
}
/** 确认框内有第二个只读编辑器；只给原主编辑器真实键盘输入，不改模型或产品状态。 */
async function writeBehindConfirmation(source: string) {
  const input = query().locator('.sql-editor-wrap .monaco-editor').getByRole('textbox');
  await input.focus(); await page.keyboard.press(`${modifier}+A`); await page.keyboard.insertText(source);
}

test('真实分析确认、取消、模型ABA、SELECT/JOIN/CTE和最小窗口阅读保留原结果', async ({}, info) => isolated(async (context, live) => {
  const { database, observer, connectionName } = context, status = await server(context);
  await observer.query(`CREATE TABLE \`${database}\`.analyze_customer(id INT PRIMARY KEY,active INT) ENGINE=InnoDB`);
  await observer.query(`CREATE TABLE \`${database}\`.analyze_orders(id INT PRIMARY KEY,customer_id INT,KEY customer_id(customer_id)) ENGINE=InnoDB`);
  await observer.query(`INSERT INTO \`${database}\`.analyze_customer VALUES(1,1),(2,0)`); await observer.query(`INSERT INTO \`${database}\`.analyze_orders VALUES(1,1),(2,1)`);
  await live.openDatabaseQuery(database); await live.executeSql("SELECT '分析确认前保留的原结果' AS retained_result");
  await observed(async () => {
    const source = 'SELECT * FROM analyze_customer WHERE active=1';
    if (!status.supported) { await unsupported(source, live, info); return; }
    const before = await query().locator('.result-body').innerText(); await live.writeSql(source);
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 680));
    await (await navigationMenuItem(query(), { name: t.open, exact: true })).click(); await expect(confirm()).toBeVisible();
    await expect(confirm()).toContainText(connectionName); await expect(confirm()).toContainText(database); await expect(confirm()).toContainText(t.risk);
    await expect(confirm().locator('.query-analyze-confirm-source .view-lines')).toContainText(source);
    await expect((await navigationMenuItem(confirm(), { name: t.confirm, exact: true }))).toBeDisabled();
    expect(await query().locator('.result-body').innerText()).toBe(before); expect((await audit()).requests).toEqual([]); expect((await audit()).execute).toBe(0);
    const box = await (await navigationMenuItem(confirm(), { name: t.confirm, exact: true })).boundingBox(), bounds = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(bounds.height); expect(box!.x + box!.width).toBeLessThanOrEqual(bounds.width);
    await page.screenshot({ path: info.outputPath('实际分析-最小窗口确认.png') }); await (await navigationMenuItem(confirm(), { name: t.cancel, exact: true })).click();
    await expect(confirm()).toHaveCount(0); expect((await audit()).requests).toEqual([]); expect(await query().locator('.result-body').innerText()).toBe(before);
    await (await navigationMenuItem(query(), { name: t.open, exact: true })).click(); await expect(confirm()).toBeVisible();
    await confirm().getByRole('checkbox', { name: t.acknowledge, exact: true }).check(); await writeBehindConfirmation('SELECT 999 AS changed_draft');
    await expect(confirm().getByRole('alert')).toHaveText(t.changed); await expect((await navigationMenuItem(confirm(), { name: t.confirm, exact: true }))).toBeDisabled();
    await writeBehindConfirmation(source); await expect((await navigationMenuItem(confirm(), { name: t.confirm, exact: true }))).toBeDisabled();
    expect((await audit()).requests).toEqual([]); await (await navigationMenuItem(confirm(), { name: t.cancel, exact: true })).click();
    const sources = [source, 'WITH active_customers AS (SELECT id FROM analyze_customer WHERE active=1) SELECT * FROM active_customers', 'SELECT c.id,o.id FROM analyze_customer c JOIN analyze_orders o ON o.customer_id=c.id WHERE c.active=1'];
    for (const [index, sql] of sources.entries()) {
      const result = await analyze(sql, database, live, index + 1); expect(result.reply.dialect).toBe(status.dialect); expect(result.reply.format).toBe(status.dialect === 'mysql' ? 'tree' : 'json');
    }
    const state = await audit(); expect(state.execute).toBe(0); expect(new Set(state.requests.map(item => item.taskId)).size).toBe(3);
    expect(state.completions.some(item => item.databaseKnown && item.database === database && item.dialect === status.dialect && item.serverVersion?.replace(/^5\.5\.5-/, '') === status.normalized)).toBe(true);
    await analysis().getByRole('treeitem').first().focus(); await page.keyboard.press('End'); await expect(analysis().getByRole('treeitem').last()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home'); await expect(analysis().getByRole('treeitem').first()).toHaveAttribute('aria-selected', 'true');
    await (await navigationMenuItem(analysis(), { name: t.collapse, exact: true })).click(); await expect(analysis().getByRole('treeitem')).toHaveCount(1); await (await navigationMenuItem(analysis(), { name: t.expand, exact: true })).click();
    await (await navigationMenuItem(analysis(), { name: t.raw, exact: true })).click(); await expect(analysis().getByLabel(t.raw, { exact: true })).toContainText(status.dialect === 'mysql' ? 'actual time=' : 'r_total_time_ms');
    expect((await audit()).requests).toHaveLength(3); await page.screenshot({ path: info.outputPath('实际分析-最小窗口原文.png') });
    const history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    for (const sql of sources) expect(history.filter(item => item.sql === status.prefix + sql && item.success)).toHaveLength(1);

    // 普通服务器ERR只令缓存失去可信默认库，修正语句后应在同一会话明确恢复上下文。
    const originalSession = state.requests[2].sessionId, lifecycle = { connectionsOpened: state.connectionsOpened, sessionsOpened: state.sessionsOpened };
    const missing = 'SELECT * FROM query_analyze_missing_after_original_plan';
    await live.writeSql(missing); await (await navigationMenuItem(query(), { name: t.open, exact: true })).click(); await expect(confirm()).toBeVisible();
    await confirm().getByRole('checkbox', { name: t.acknowledge, exact: true }).check(); await (await navigationMenuItem(confirm(), { name: t.confirm, exact: true })).click(); await expect(confirm()).toHaveCount(0);
    await expect.poll(async () => (await audit()).requests.length).toBe(4); await expect.poll(async () => (await audit()).pending, { timeout: 20000 }).toBe(0);
    await expect((await navigationMenuItem(query(), { name: '停止', exact: true }))).toBeDisabled(); await expect(query().locator('.error-box')).toContainText('query_analyze_missing_after_original_plan');
    const failed = await audit(), failedRequest = failed.requests[3], failedReply = failed.replies.find(item => item.taskId === failedRequest.taskId)!;
    expect(failedRequest).toMatchObject({ sql: missing, sessionId: originalSession, expectedDatabase: database, acknowledged: true }); expect(failedReply.ok).toBe(false); expect(failedReply.error).toContain('query_analyze_missing_after_original_plan');
    const cached = await page.evaluate(sessionId => window.dbark.invoke('query.completionState', { sessionId }), originalSession);
    expect(cached).toMatchObject({ databaseKnown: false, broken: false, busy: false });
    const unknown = await audit(), unknownIndex = unknown.completions.map(item => item.command === 'query.completionState' && item.sessionId === originalSession && !item.databaseKnown).lastIndexOf(true);
    expect(unknownIndex).toBeGreaterThanOrEqual(0); expect(unknown.requests).toHaveLength(4); expect(unknown.execute).toBe(0);
    const corrected = 'SELECT id AS query_analyze_recovered_original_session FROM analyze_customer WHERE id=1';
    const recovered = await analyze(corrected, database, live, 5); expect(recovered.request.sessionId).toBe(originalSession); expect(recovered.request.sessionId).toBe(failedRequest.sessionId);
    const repaired = await audit(); expect({ connectionsOpened: repaired.connectionsOpened, sessionsOpened: repaired.sessionsOpened }).toEqual(lifecycle); expect(repaired.execute).toBe(0); expect(repaired.requests).toHaveLength(5);
    expect(repaired.completions.slice(unknownIndex + 1).some(item => item.command === 'query.analyzeContext' && item.sessionId === originalSession && item.databaseKnown && item.database === database && !item.broken && !item.busy)).toBe(true);
    expect((await observer.query<RowDataPacket[]>(`SELECT id,active FROM \`${database}\`.analyze_customer ORDER BY id`))[0].map(item => [item.id, item.active])).toEqual([[1, 1], [2, 0]]);
    expect((await observer.query<RowDataPacket[]>(`SELECT id,customer_id FROM \`${database}\`.analyze_orders ORDER BY id`))[0].map(item => [item.id, item.customer_id])).toEqual([[1, 1], [2, 1]]);
    const repairedHistory = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    expect(repairedHistory.filter(item => item.sql === status.prefix + missing)).toHaveLength(1); expect(repairedHistory.find(item => item.sql === status.prefix + missing)?.success).toBe(false);
    expect(repairedHistory.filter(item => item.sql === status.prefix + corrected && item.success)).toHaveLength(1);
    await page.screenshot({ path: info.outputPath('实际分析-缺表纠正后同会话恢复.png') });
  }, info);
}, info));

test('原会话临时表与事务分析保留，显式回滚恢复原数据，真实长分析取消不重发', async ({}, info) => isolated(async (context, live) => {
  const { database, observer } = context, status = await server(context);
  await observer.query(`CREATE TABLE \`${database}\`.analyze_subject(id INT PRIMARY KEY,n INT) ENGINE=InnoDB`); await observer.query(`INSERT INTO \`${database}\`.analyze_subject VALUES(1,10)`);
  await live.openDatabaseQuery(database); await live.executeSql('SELECT 1 AS initial_result');
  await observed(async () => {
    if (!status.supported) { await unsupported('SELECT * FROM analyze_subject', live, info); return; }
    await live.executeSql('CREATE TEMPORARY TABLE analyze_temporary(id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO analyze_temporary VALUES(7); START TRANSACTION; UPDATE analyze_subject SET n=99 WHERE id=1');
    const result = await analyze('SELECT s.n,t.id FROM analyze_subject s JOIN analyze_temporary t ON t.id=7 WHERE s.id=1', database, live, 1);
    expect(result.reply.transactionOpen).toBe(true); await expect((await navigationMenuItem(query(), { name: '提交', exact: true }))).toBeEnabled();
    expect((await observer.query<RowDataPacket[]>(`SELECT n FROM \`${database}\`.analyze_subject WHERE id=1`))[0][0].n).toBe(10);
    await live.executeSql('ROLLBACK'); await live.executeSql('SELECT s.n AS after_rollback,t.id AS temporary_id FROM analyze_subject s JOIN analyze_temporary t ON t.id=7 WHERE s.id=1');
    await expect((await navigationMenuItem(query(), { name: '提交', exact: true }))).toBeDisabled();
    for (const [name, value] of [['after_rollback', '10'], ['temporary_id', '7']]) {
      const index = await query().getByRole('columnheader', { name: new RegExp('^' + name) }).getAttribute('aria-colindex'); expect(index).toMatch(/^[1-9]\d*$/);
      await expect(query().locator(`[role=row][aria-rowindex="2"] [role=gridcell][aria-colindex="${index}"]`)).toHaveText(value);
    }
    const long = 'SELECT id FROM analyze_subject WHERE id=1 AND SLEEP(30)=0', sql = status.prefix + long;
    await live.writeSql(long); await (await navigationMenuItem(query(), { name: t.open, exact: true })).click(); await expect(confirm()).toBeVisible(); await confirm().getByRole('checkbox', { name: t.acknowledge, exact: true }).check();
    await (await navigationMenuItem(confirm(), { name: t.confirm, exact: true })).click(); await expect((await navigationMenuItem(query(), { name: '停止', exact: true }))).toBeEnabled();
    let threadId: number | undefined;
    await expect.poll(async () => {
      const [rows] = await observer.query<RowDataPacket[]>('SELECT ID,INFO FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ? AND INFO=?', [database, sql]);
      if (rows.length === 1) threadId = Number(rows[0].ID); return rows.length;
    }, { timeout: 15000, message: '等待服务器实际执行本次ANALYZE长查询' }).toBe(1);
    expect(Number.isSafeInteger(threadId)).toBe(true); const pending = await audit(); expect(pending.requests).toHaveLength(2); expect(pending.pending).toBe(1); expect(pending.requests[1].sessionId).toBe(result.request.sessionId);
    await (await navigationMenuItem(query(), { name: '停止', exact: true })).click(); await expect((await navigationMenuItem(query(), { name: '停止', exact: true }))).toBeDisabled({ timeout: 20000 });
    await expect.poll(async () => (await audit()).pending, { timeout: 20000 }).toBe(0);
    await expect.poll(async () => (await audit()).cancelPending, { timeout: 20000 }).toBe(0);
    await expect.poll(async () => (await observer.query<RowDataPacket[]>('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=? AND INFO=?', [threadId, sql]))[0].length, { timeout: 15000 }).toBe(0);
    const ended = await audit(); expect(ended.requests).toHaveLength(2); expect(ended.requests[1]).toMatchObject({ sql: long, expectedDatabase: database, acknowledged: true }); expect(ended.cancellations).toEqual([ended.requests[1].taskId]);
    expect(ended.cancelReplies).toEqual([{ taskId: ended.requests[1].taskId, ok: true }]); expect(ended.replies.find(item => item.taskId === ended.requests[1].taskId)).toMatchObject({ ok: false });
    const history = await page.evaluate(() => window.dbark.invoke('history.list', {})); expect(history.filter(item => item.sql === sql)).toHaveLength(1); expect(history.find(item => item.sql === sql)?.success).toBe(false);
    expect((await observer.query<RowDataPacket[]>(`SELECT n FROM \`${database}\`.analyze_subject WHERE id=1`))[0][0].n).toBe(10);
    await page.screenshot({ path: info.outputPath('实际分析-长查询取消.png') });
  }, info);
}, info));

/** 原门进入具体动作后才加载真实菜单导航，不改变默认/列表阶段的资源边界。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args); }
