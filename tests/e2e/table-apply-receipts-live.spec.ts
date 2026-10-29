import { clickSidebarAction } from './sidebar-menu';
import { test as baseTest, expect, type Locator, type TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import type { TableApplyReceipt } from '../../src/shared/tableApplyReceipt';
import { zh } from '../../src/renderer/locales/zh-CN';
import { recordViewZh } from '../../src/renderer/locales/recordViews.zh-CN';

type Desktop = typeof import('./desktop-fixture');
type Live = typeof import('./live-helpers');
type Context = import('./live-helpers').LiveContext;
// 收集先短路，连实跑门和env文件都不读取；类型导入不会加载实库模块。
const listing = process.argv.includes('--list');
const armed = !listing && process.env.DBARK_D08_RECEIPT_LIVE_UI === '1' && process.env.DBARK_INTEGRATION_ENABLED === '1';
if (armed && (process.env.DBARK_TEST_HOST !== '192.168.31.200' || process.env.DBARK_TEST_PORT !== '13384' || process.env.DBARK_TEST_TLS === '1' || !/^run\d+-d08-receipts-[a-z0-9-]+$/.test(process.env.DBARK_D08_RECEIPT_ROOT_RUN ?? '') || !/^[a-f0-9-]{36}$/i.test(process.env.DBARK_D08_EXPECTED_SERVER_UUID ?? ''))) throw Error('实跑必须由ROOT核对200/13384明文目标，提供独占窗口编号和新鲜server UUID');
// 只在真正获准执行时复用原自动桌面夹具；列表及默认关闭时不加载它或live-helpers。
const desktop: Desktop | undefined = armed ? require('./desktop-fixture') : undefined;
const test = (desktop?.test ?? baseTest) as typeof baseTest;
let live: Live;
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(!armed, '默认关闭：ROOT明确分配GUI及200/13384独占窗口后才可执行；准备和list均为0实际');
test.setTimeout(180000);
test.describe.configure({ retries: 0 });
const page = () => { if (!desktop) throw Error('缺少ROOT实跑授权'); return desktop.page; };
const target = (c: Context) => '`' + c.database.replaceAll('`', '``') + '`.`receipt_subject`';
const table = () => page().locator('.table-tab:visible');
const undo = () => table().getByRole('button', { name: '撤销上一步', exact: true });
const redo = () => table().getByRole('button', { name: '重做下一步', exact: true });

/** 在任何随机库创建前只读核身份；不授予权限、不改变服务器设置。 */
test.beforeEach(async () => {
  live = await import('./live-helpers');
  if (live.environment.DBARK_TEST_HOST !== '192.168.31.200' || live.environment.DBARK_TEST_PORT !== '13384' || live.environment.DBARK_TEST_TLS === '1') throw Error('实际配置与ROOT批准的13384明文目标不符');
  const mysql = await import('mysql2/promise');
  const observer = await mysql.createConnection({ host: '192.168.31.200', port: 13384, user: live.environment.DBARK_TEST_USER, password: live.environment.DBARK_TEST_PASSWORD, connectTimeout: 10000 });
  try { const [rows] = await observer.query<RowDataPacket[]>('SELECT @@server_uuid AS identity_value, VERSION() AS version_value'); expect(String(rows[0].identity_value)).toBe(process.env.DBARK_D08_EXPECTED_SERVER_UUID); expect(String(rows[0].version_value)).toMatch(/^8\.4\./); }
  finally { await observer.end(); }
});

/** 从真实对象树打开表；不调用table.page或内部React状态伪造界面。 */
async function open(c: Context) {
  const connection = page().locator('.connection-node').filter({ has: page().locator('.connection-row').getByText(c.connectionName, { exact: true }) });
  await connection.locator('.connection-row').hover(); await clickSidebarAction(connection, { name: '刷新连接', exact: true });
  await connection.locator('.database-row').getByRole('button', { name: c.database, exact: true }).click();
  await connection.locator('.object-row').getByText('receipt_subject', { exact: true }).click();
  await expect(table().locator('.context-bar')).toContainText('receipt_subject'); await expect(table().locator('.loading-overlay')).toHaveCount(0);
}
/** 由实际列头坐标定位，不能用固定列序掩盖布局或隐藏列错误。 */
async function index(name: string) { const value = await table().getByRole('columnheader').filter({ hasText: new RegExp('^' + name) }).getAttribute('aria-colindex'); if (!value || !/^\d+$/.test(value)) throw Error('列头缺少有效aria坐标'); return value; }
async function row(id: string) { const column = await index('id'); return table().getByRole('row').filter({ has: page().locator(`[role="gridcell"][aria-colindex="${column}"]`).filter({ hasText: new RegExp('^' + id + '$') }) }); }
async function cell(r: Locator, name: string) { return r.locator(`[role="gridcell"][aria-colindex="${await index(name)}"]`); }
/** 普通值通过网格输入；只形成草稿，不能走IPC直接写数据库。 */
async function edit(r: Locator, key: string, value: string) { await (await cell(r, key)).dblclick(); const input = table().locator('.grid-input'); await expect(input).toBeVisible(); await input.fill(value); await input.press('Enter'); await expect(input).toHaveCount(0); }
/** NULL与BLOB使用原单元格编辑器和暂存按钮，不混淆空串、DEFAULT或字节。 */
async function typed(r: Locator, key: string, mode: 'null' | 'binary', value = '') {
  await (await cell(r, key)).click(); await table().getByRole('button', { name: zh.table.text005, exact: true }).click();
  const dialog = page().getByRole('dialog', { name: '编辑单元格：' + key, exact: true });
  await dialog.getByRole('combobox', { name: recordViewZh.mode, exact: true }).selectOption(mode);
  if (mode === 'binary') await dialog.getByRole('textbox', { name: key + ' · ' + recordViewZh.value, exact: true }).fill(value);
  await dialog.getByRole('button', { name: recordViewZh.stageCell, exact: true }).click(); await expect(dialog).toBeHidden();
}
/** 固定自有夹具；独立旁观连接只用于种子、并发修改、断言和原helper清理。 */
async function seed(c: Context, cud: boolean) {
  const [identity] = await c.observer.query<RowDataPacket[]>('SELECT @@server_uuid AS identity_value'); expect(String(identity[0].identity_value)).toBe(process.env.DBARK_D08_EXPECTED_SERVER_UUID);
  await c.observer.query(`CREATE TABLE ${target(c)}(id BIGINT UNSIGNED PRIMARY KEY,note VARCHAR(40),big_value BIGINT UNSIGNED,amount DECIMAL(30,6),nullable_value TEXT,payload BLOB) ENGINE=InnoDB`);
  await c.observer.query(`INSERT INTO ${target(c)} VALUES(1,'更新记录',9007199254740993,12345678901234567890.120000,'将清空',X'0102'),(2,'匹配不变',2,2,NULL,NULL)`);
  if (cud) await c.observer.query(`INSERT INTO ${target(c)} VALUES(3,'删除记录',3,3,'删除值',X'03')`);
  await open(c);
}
/** 只读实际服务端规范值，保留BIGINT/DECIMAL字符串，字节另取HEX。 */
async function read(c: Context) { return (await c.observer.query<RowDataPacket[]>(`SELECT CAST(id AS CHAR) AS id,note,CAST(big_value AS CHAR) AS big_value,CAST(amount AS CHAR) AS amount,nullable_value,HEX(payload) AS payload_hex FROM ${target(c)} ORDER BY id`))[0].map(r => ({ ...r })); }

type Call = { command: string; taskId?: string; previewId?: string };
/** 只旁观正式IPC请求和真实返回的随机ID，不改变响应、不伪造ACK、不采集SQL/变化。 */
async function observe(connectionId: string) {
  await desktop!.desktop.evaluate(({ ipcMain }, id) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, request: { command: string; input: Record<string, unknown> }) => Promise<any>;
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers, original = handlers.get('dbark:request'); if (!original) throw Error('缺少正式IPC处理器');
    const root = globalThis as typeof globalThis & { __d08ReceiptCalls?: Call[]; __d08ReceiptRestore?: () => void }; root.__d08ReceiptCalls = [];
    root.__d08ReceiptRestore = () => { handlers.set('dbark:request', original); };
    handlers.set('dbark:request', async (event, request) => {
      if (request.input?.connectionId !== id || !['table.preview', 'table.apply'].includes(request.command)) return original(event, request);
      if (root.__d08ReceiptCalls!.length >= 8) throw Error('本例IPC摘要超出预算');
      const item: Call = { command: request.command, ...(typeof request.input.taskId === 'string' ? { taskId: request.input.taskId } : {}), ...(typeof request.input.previewId === 'string' ? { previewId: request.input.previewId } : {}) }; root.__d08ReceiptCalls!.push(item);
      const response = await original(event, request); if (request.command === 'table.preview' && response.ok) item.previewId = response.result.previewId; return response;
    });
  }, connectionId);
}
async function calls(): Promise<Call[]> { return desktop!.desktop.evaluate(() => (globalThis as typeof globalThis & { __d08ReceiptCalls?: Call[] }).__d08ReceiptCalls ?? []); }
/** 只读回执辅助核确切字段；所有写入动作已经由真实UI入口完成。 */
async function receipts(c: Context) { return page().evaluate(id => window.dbark.invoke('table.applyReceipt.list', { connectionId: id }), c.connectionId); }
async function preview() { await table().getByRole('button', { name: zh.table.text019, exact: true }).click(); const d = page().getByRole('dialog', { name: zh.table.text031, exact: true }); await expect(d).toBeVisible(); await expect(d.locator('.monaco-editor')).toBeVisible(); return d; }
/** 详情必须真实打开并显示事实和范围，不能仅靠接口对象冒称UI已经验收。 */
async function detail(r: TableApplyReceipt) {
  await table().getByRole('button', { name: '查看本次提交记录', exact: true }).click();
  const d = page().getByRole('dialog', { name: '数据提交记录', exact: true }), section = d.getByRole('region', { name: '提交记录详情' });
  await expect(section).toContainText(r.operationId); await expect(section).toContainText(r.previewId); await expect(section).toContainText(r.target.database); await expect(section).toContainText(r.target.table); await expect(section).toContainText('不包含触发器'); await expect(section).toContainText('不保存SQL');
  await expect(section).toContainText(r.target.connectionId); await expect(section).toContainText(r.startedAt); await expect(section).toContainText(r.finishedAt!);
  await expect(section).toContainText(`新增 ${r.intent.insert}，修改 ${r.intent.update}，删除 ${r.intent.delete}；执行计划 ${r.intent.statementCount} 条`);
  await expect(section.locator('dt').filter({ hasText: /^服务器报告的目标行数/ }).locator('xpath=following-sibling::dd[1]')).toHaveText(String(r.committedReportedRows));
  await expect(section).toContainText('不是服务器提交时间');
  await expect(section).toContainText(r.outcome === 'committed' ? '服务器已确认提交' : '已确认目标事务回滚');
  await expect(section.getByRole('button')).toHaveCount(0); return d;
}
/** 比较真实预览关联和单次投递，证明不是从草稿数量或旧历史补造确认。 */
async function proof(c: Context, expectedPreviews: number): Promise<TableApplyReceipt> {
  const rows = await receipts(c); expect(rows.total).toBe(1); const r = rows.items[0], observed = await calls();
  const previews = observed.filter(x => x.command === 'table.preview'), applies = observed.filter(x => x.command === 'table.apply');
  expect(previews).toHaveLength(expectedPreviews); expect(applies).toHaveLength(1); expect(r.taskId).toBe(applies[0].taskId); expect(r.previewId).toBe(previews.at(-1)!.previewId); expect(r.previewId).toBe(applies[0].previewId);
  expect(r.target).toMatchObject({ connectionId: c.connectionId, database: c.database, table: 'receipt_subject' }); expect(r.target.connectionRevision).toBeGreaterThanOrEqual(0); expect(r.scope).toBe('target-transaction-only'); expect(r.phase).toBe('terminal'); expect(r.startedAt).toBeTruthy(); expect(r.finishedAt).toBeTruthy(); return r;
}

test('网格CUD精确值与匹配行单次提交，关闭表及真实重启后任务中心保留同一回执', async ({}, info: TestInfo) => {
  await live.isolatedDatabase(async c => {
    await seed(c, true); await observe(c.connectionId); const original = await read(c);
    await edit(await row('1'), 'note', '更新后记录'); await edit(await row('1'), 'big_value', '18446744073709551614'); await edit(await row('1'), 'amount', '12345678901234567890.100001'); await typed(await row('1'), 'nullable_value', 'null'); await typed(await row('1'), 'payload', 'binary', '0x00FF8000');
    // 改为不同词法的同一BIGINT值，真实服务端内容不变，但FOUND_ROWS仍须报告匹配行。
    await edit(await row('2'), 'id', '02');
    await table().getByRole('button', { name: zh.common.add, exact: true }).click(); const added = table().locator('.row-inserted');
    for (const [key, value] of [['id', '4'], ['note', '新增记录'], ['big_value', '18446744073709551615'], ['amount', '-12345678901234567890.120000']]) await edit(added, key, value);
    await typed(added, 'nullable_value', 'null'); await typed(added, 'payload', 'binary', '0x0000FF');
    await (await cell(await row('3'), 'note')).click(); await table().getByRole('button', { name: zh.common.delete, exact: true }).click();
    expect(await read(c)).toEqual(original); expect((await receipts(c)).total).toBe(0); await expect(undo()).toBeEnabled();
    const first = await preview(); expect(await read(c)).toEqual(original); await first.getByRole('button', { name: zh.common.backToEdit, exact: true }).click(); await expect(undo()).toBeEnabled();
    await undo().click(); await expect(redo()).toBeEnabled(); await redo().click();
    const final = await preview(); expect(await read(c)).toEqual(original); await final.getByRole('button', { name: zh.common.confirmApply, exact: true }).click(); await expect(final).toBeHidden(); await expect(table().locator('.loading-overlay')).toHaveCount(0);
    const actual = await read(c); expect(actual).toEqual([
      { id: '1', note: '更新后记录', big_value: '18446744073709551614', amount: '12345678901234567890.100001', nullable_value: null, payload_hex: '00FF8000' },
      original[1],
      { id: '4', note: '新增记录', big_value: '18446744073709551615', amount: '-12345678901234567890.120000', nullable_value: null, payload_hex: '0000FF' }
    ]);
    const r = await proof(c, 2); expect(r.intent).toEqual({ insert: 1, update: 2, delete: 1, statementCount: 4 }); expect(r.outcome).toBe('committed'); expect(r.committedReportedRows).toBe(4); expect(r.evidence).toMatchObject({ dmlAcknowledged: 4, serverReportedRows: 4, commitAcknowledged: true, rollbackAcknowledged: false, transactionProtected: true, transactionKnown: true, transactionOpen: false });
    await expect(undo()).toBeDisabled(); await expect(redo()).toBeDisabled(); const d = await detail(r); await expect(d).toContainText('FOUND_ROWS'); await page().keyboard.press('Escape');
    await page().locator('.workspace-tab-button.active .tab-close').click(); await expect(page().locator('.table-tab')).toHaveCount(0);
    const oldPid = desktop!.desktop.process().pid; await desktop!.quitDesktop(); expect(desktop!.closed).toBe(true); await desktop!.launchDesktop(); expect(desktop!.desktop.process().pid).not.toBe(oldPid);
    const restored = await page().evaluate(id => window.dbark.invoke('table.applyReceipt.detail', { operationId: id }), r.operationId); expect(restored).toEqual(r);
    await page().locator('.app-statusbar').getByRole('button').click(); await page().getByRole('button', { name: '数据提交记录', exact: true }).click(); const history = page().getByRole('dialog', { name: '数据提交记录', exact: true }); await history.getByRole('textbox', { name: '提交连接筛选', exact: true }).fill(c.connectionId); await expect(history.getByRole('button', { name: '查看提交详情', exact: true })).toHaveCount(1); await history.getByRole('button', { name: '查看提交详情', exact: true }).click(); await expect(history.getByRole('region', { name: '提交记录详情' })).toContainText(r.operationId);
    expect(await read(c)).toEqual(actual); await info.attach('实际提交回执', { body: Buffer.from(JSON.stringify(r)), contentType: 'application/json' });
  }, info);
});

test('第二行原值冲突使第一条修改真实回滚，回执保留确认事实且Undo不能重做重放', async ({}, info: TestInfo) => {
  await live.isolatedDatabase(async c => {
    await seed(c, false); await observe(c.connectionId); const original = await read(c);
    await edit(await row('1'), 'note', '第一行草稿'); await edit(await row('2'), 'note', '第二行草稿'); const d = await preview(); expect(await read(c)).toEqual(original);
    await c.observer.query(`UPDATE ${target(c)} SET note='旁观并发新值' WHERE id=2`); const concurrent = await read(c); expect(concurrent[0]).toEqual(original[0]);
    await d.getByRole('button', { name: zh.common.confirmApply, exact: true }).click(); await expect(d.locator('.error-box')).toContainText('目标表事务'); await expect(d.locator('.error-box')).toContainText('回滚'); await expect(d.getByRole('button', { name: zh.common.confirmApply, exact: true })).toBeDisabled();
    expect(await read(c)).toEqual(concurrent); const r = await proof(c, 1); expect(r.intent).toEqual({ insert: 0, update: 2, delete: 0, statementCount: 2 }); expect(r.outcome).toBe('rolled-back'); expect(r.reason).toBe('conflict'); expect(r.committedReportedRows).toBe(0); expect(r.evidence).toMatchObject({ dmlAcknowledged: 2, serverReportedRows: 1, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: true, transactionProtected: true, transactionKnown: true, transactionOpen: false });
    await d.getByRole('button', { name: zh.common.backToEdit, exact: true }).click(); await expect(undo()).toBeDisabled(); await expect(redo()).toBeDisabled(); await detail(r); expect((await calls()).filter(x => x.command === 'table.apply')).toHaveLength(1); expect(await read(c)).toEqual(concurrent);
    await info.attach('实际回滚回执', { body: Buffer.from(JSON.stringify(r)), contentType: 'application/json' });
  }, info);
});
