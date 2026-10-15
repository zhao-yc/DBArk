import type { Locator, TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import type { FilterRule, SortRule } from '../../src/shared/contracts';
import { recordViewZh as text } from '../../src/renderer/locales/recordViews.zh-CN';
import { tableGridZh as gridText } from '../../src/renderer/locales/tableGrid.zh-CN';
import { referenceZh } from '../../src/renderer/locales/references.zh-CN';
import { binaryCellZh as binaryText } from '../../src/renderer/locales/binaryCell.zh-CN';
import { binaryCellLimits } from '../../src/renderer/binaryCell';
import { formatText } from '../../src/renderer/locales/zh-CN';
import { test, expect, page, desktop, closed, answerDialogs } from './desktop-fixture';
import { enabled, environment, isolatedDatabase, type LiveContext } from './live-helpers';

// 仅新增真实界面验收定义；默认跳过，不创建权限账号，也不访问本机 Docker。
// trace 关闭，避免把真实连接表单中的临时凭据记录进测试轨迹。
test.use({ trace: 'off' });
const activeTable = () => page.locator('.table-tab:visible');
const form = () => activeTable().getByRole('complementary', { name: text.title, exact: true });
const tableName = 'guard_records';
const qualified = (database: string, name: string) => `\`${database}\`.\`${name}\``;
type ReadArguments = { table?: string; page?: number; pageSize?: number; sort?: SortRule[]; filters?: FilterRule[]; filterMode?: 'all' | 'any' };
type Observation = { command: string; input: ReadArguments; settled: boolean };
type Probe = { calls: Observation[]; restore(): void };
type ProbeGlobal = typeof globalThis & { __recordGuardProbe?: Probe };

/** 仅旁观真实 handler，不拦截响应或伪造数据库结果；不记录密码、任意 SQL 或行内容。 */
async function observeRequests() {
  await desktop.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: { command: string; input?: ReadArguments }) => Promise<unknown>;
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers.get('dbark:request'); if (!original) throw new Error('未找到真实请求处理器');
    const state: Probe = { calls: [], restore: () => handlers.set('dbark:request', original) };
    (globalThis as ProbeGlobal).__recordGuardProbe = state;
    handlers.set('dbark:request', async (event, payload) => {
      const selected = ['table.page', 'metadata.table', 'table.preview', 'table.apply', 'table.referencePage', 'table.preferences.save'].includes(payload.command);
      const input = payload.input ?? {};
      const call: Observation | undefined = selected ? { command: payload.command, input: { table: input.table, page: input.page, pageSize: input.pageSize, sort: input.sort ? structuredClone(input.sort) : undefined, filters: input.filters ? structuredClone(input.filters) : undefined, filterMode: input.filterMode }, settled: false } : undefined;
      if (call) state.calls.push(call);
      try { return await original(event, payload); } finally { if (call) call.settled = true; }
    });
  });
}

/** 每例结束先撤掉旁观包装，再由既有 helper 退出应用并精确删除唯一隔离库。 */
async function restoreRequests() {
  if (!closed) await desktop.evaluate(() => { const root = globalThis as ProbeGlobal; root.__recordGuardProbe?.restore(); delete root.__recordGuardProbe; });
}

/** 读取只包含本例分页参数与命令名的观察记录，断言不借助伪造页面状态。 */
async function calls(command: string): Promise<Observation[]> {
  return desktop.evaluate((_, selected) => (globalThis as ProbeGlobal).__recordGuardProbe?.calls.filter(call => call.command === selected) ?? [], command);
}

/** 失败附件只含脱敏调用摘要；清理仍执行原 helper 的退出、DROP 和库不存在验证。 */
async function guardDatabase(body: (context: LiveContext) => Promise<void>, info: TestInfo) {
  await isolatedDatabase(async context => {
    try { await body(context); }
    catch (error) {
      if (!closed) await info.attach('记录表单守卫调用证据', { body: JSON.stringify(await desktop.evaluate(() => (globalThis as ProbeGlobal).__recordGuardProbe?.calls ?? []), null, 2), contentType: 'application/json' }).catch(() => undefined);
      throw error;
    } finally { await restoreRequests(); }
  }, info);
}

/** 表的打开始终来自真实对象树，记录与元数据都由实际数据库读取。 */
async function openTable(context: LiveContext, name = tableName) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) });
  await connection.locator('.connection-row').hover(); await connection.getByRole('button', { name: '刷新连接', exact: true }).click();
  await connection.locator('.database-row').getByRole('button', { name: context.database, exact: true }).click();
  await connection.locator('.object-row').getByText(name, { exact: true }).click();
  await expect(activeTable().locator('.context-bar')).toContainText(name);
  await expect(activeTable().locator('.loading-overlay')).toHaveCount(0); await expect(activeTable().locator(':scope > .error-box')).toHaveCount(0);
  await expect(activeTable().getByRole('columnheader', { name: /^id/ })).toBeVisible();
}

/** 从实际可见列头定位单元格，不固定隐藏或重排之后的列索引。 */
async function cell(name: string, row = 2): Promise<Locator> {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const header = activeTable().getByRole('columnheader', { name: new RegExp(`^${escaped}`) });
  await expect(header).toHaveCount(1); const index = await header.getAttribute('aria-colindex'); if (!index) throw new Error('缺少当前列的实际坐标');
  const target = activeTable().locator(`[role="row"][aria-rowindex="${row}"] [role="gridcell"][aria-colindex="${index}"]`);
  await target.scrollIntoViewIfNeeded(); return target;
}

/** 选择活动记录与复选集合无关，表单只从当前已加载行打开。 */
async function openForm(name = 'note') {
  await (await cell(name)).click();
  if (!(await form().isVisible())) await activeTable().getByRole('button', { name: text.title, exact: true }).click();
  await expect(form()).toBeVisible();
}

/** 显式展开真实字段控件；不调用内部模型构造缓冲。 */
async function field(name: string): Promise<Locator> {
  const section = form().getByRole('region', { name, exact: true });
  if (!(await section.getByRole('textbox', { name: `${name} · ${text.value}`, exact: true }).count())) await section.getByRole('button', { name: /^(编辑字段|查看字段)$/ }).click();
  return section;
}

/** 输入只留在表单层，用 grid 与观察连接的旧值分别证明尚未暂存或写库。 */
async function dirtyInput(value: string, name = 'note') {
  const section = await field(name); await section.getByRole('textbox', { name: `${name} · ${text.value}`, exact: true }).fill(value);
  await expect(activeTable().locator('.table-action-bar')).toContainText(text.inputDirty);
}

/** Electron 的确认框同时覆盖同步和异步回答路径，记录真实请求的文案和按钮。 */
async function answerDiscard(response: 0 | 1) {
  await answerDialogs([response]);
  await desktop.evaluate(({ dialog }, fallback) => {
    dialog.showMessageBoxSync = ((...args: unknown[]) => {
      const options = args.at(-1) as Electron.MessageBoxSyncOptions;
      const response = globalThis.__dbarkE2EDialogs.answers.shift() ?? fallback;
      globalThis.__dbarkE2EDialogs.calls.push({ title: options.title, message: options.message, buttons: options.buttons, response }); return response;
    }) as typeof dialog.showMessageBoxSync;
  }, response);
}

/** 每个清页动作只能询问一次，不用固定延时掩盖重复确认或迟到读取。 */
async function expectDiscard(response: 0 | 1) {
  await expect.poll(() => desktop.evaluate(() => globalThis.__dbarkE2EDialogs.calls.length)).toBe(1);
  const [call] = await desktop.evaluate(() => globalThis.__dbarkE2EDialogs.calls);
  expect(call.message).toContain(text.discardPage); expect(call.response).toBe(response);
}

/** 显式固定服务器页大小与排序，分页断言不依赖偶然的默认返回顺序。 */
async function createPaged(context: LiveContext) {
  await context.observer.query(`CREATE TABLE ${qualified(context.database, tableName)}(id INT PRIMARY KEY,note VARCHAR(100)) ENGINE=InnoDB`);
  await context.observer.query(`INSERT INTO ${qualified(context.database, tableName)} VALUES ?`, [Array.from({ length: 120 }, (_, index) => [index + 1, `原始-${index + 1}`])]);
  await openTable(context); await expect(await cell('id')).toHaveText('1'); await observeRequests();
  try {
    const size = activeTable().getByRole('combobox', { name: '每页行数', exact: true }); const previousSize = await size.inputValue(); await size.selectOption('50');
    if (previousSize !== '50') await expect.poll(async () => (await calls('table.page')).some(call => call.input.pageSize === 50 && call.settled)).toBe(true);
    await expect(activeTable().locator('.results-grid')).toHaveAttribute('aria-rowcount', '51');
    await activeTable().getByRole('columnheader', { name: /^id/ }).click();
    // 排序前后首行可能相同，不能仅见旧单元格就误认为新读取已完成。
    await expect.poll(async () => (await calls('table.page')).some(call => call.input.sort?.[0]?.column === 'id' && call.input.sort[0].direction === 'ASC' && call.settled)).toBe(true);
    await expect(activeTable().getByRole('columnheader', { name: /^id/ })).toHaveAttribute('aria-sort', 'ascending');
    await expect(activeTable().locator('.loading-overlay')).toHaveCount(0); await expect(await cell('id')).toHaveText('1');
  } finally { await restoreRequests(); }
}

/** 等到真实分页调用完成且新页内容出现，再断言参数与本地输入清除。 */
async function expectPageReads(count: number, id: string) {
  await expect.poll(async () => (await calls('table.page')).filter(call => call.settled).length).toBe(count);
  await expect(activeTable().locator('.loading-overlay')).toHaveCount(0); await expect(await cell('id')).toHaveText(id);
  await expect(activeTable().locator(':scope > .error-box')).toHaveCount(0);
}

/** 无写入同时核对应用 IPC 和真实任务记录，不把 UI 按钮状态当作数据库事实。 */
async function expectNoApply() {
  expect(await calls('table.apply')).toHaveLength(0);
  expect(await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'table.apply'))).toEqual([]);
}

test.describe('记录表单额外守卫：清页、编辑入口与只读边界', () => {
  test.skip(!enabled, '必须明确启用 200 隔离实库验收'); test.setTimeout(120000);
  test.beforeEach(() => {
    if (environment.DBARK_TEST_HOST !== '192.168.31.200') throw new Error('只允许已授权 200 测试服务器');
    const port = process.env.DBARK_RECORD_VIEWS_TEST_PORT ?? process.env.DBARK_TEST_PORT ?? '13384';
    if (!['13357', '13380', '13384', '13310', '13311'].includes(port)) throw new Error('拒绝未授权测试端口');
    environment.DBARK_TEST_PORT = port;
  });

  test('未暂存输入下刷新和排序取消不变，确认后才读取真实新页', async ({}, info) => {
    await guardDatabase(async context => {
      await createPaged(context); await openForm(); await observeRequests(); await dirtyInput('刷新前输入');
      await context.observer.query(`UPDATE ${qualified(context.database, tableName)} SET note='服务器新值' WHERE id=1`);
      await answerDiscard(1); await activeTable().getByRole('button', { name: '刷新', exact: true }).click(); await expectDiscard(1);
      await expect((await field('note')).getByRole('textbox')).toHaveValue('刷新前输入'); await expect(await cell('note')).toHaveText('原始-1'); expect(await calls('table.page')).toHaveLength(0);
      await expect(activeTable().getByRole('textbox', { name: '跳转页码', exact: true })).toHaveValue('1');
      await answerDiscard(0); await activeTable().getByRole('button', { name: '刷新', exact: true }).click(); await expectDiscard(0); await expectPageReads(1, '1');
      await expect(await cell('note')).toHaveText('服务器新值'); await expect(form()).toContainText(text.empty);
      await openForm(); await dirtyInput('排序前输入');
      await answerDiscard(1); await activeTable().getByRole('columnheader', { name: /^id/ }).click(); await expectDiscard(1);
      await expect(activeTable().getByRole('columnheader', { name: /^id/ })).toHaveAttribute('aria-sort', 'ascending');
      await expect((await field('note')).getByRole('textbox')).toHaveValue('排序前输入'); await expect(await cell('id')).toHaveText('1'); expect(await calls('table.page')).toHaveLength(1);
      await answerDiscard(0); await activeTable().getByRole('columnheader', { name: /^id/ }).click(); await expectDiscard(0); await expectPageReads(2, '120');
      await expect(activeTable().getByRole('columnheader', { name: /^id/ })).toHaveAttribute('aria-sort', 'descending');
      expect((await calls('table.page')).map(call => [call.input.page, call.input.pageSize, call.input.sort])).toEqual([[1, 50, [{ column: 'id', direction: 'ASC' }]], [1, 50, [{ column: 'id', direction: 'DESC' }]]]);
      expect((await context.observer.query<RowDataPacket[]>(`SELECT note FROM ${qualified(context.database, tableName)} WHERE id=1`))[0][0].note).toBe('服务器新值'); await expectNoApply();
    }, info);
  });

  test('未暂存输入下翻页和页大小取消保留条件，确认后页号与行范围一致', async ({}, info) => {
    await guardDatabase(async context => {
      await createPaged(context); await openForm(); await observeRequests(); await dirtyInput('翻页前输入');
      await answerDiscard(1); await activeTable().getByRole('button', { name: '下一页', exact: true }).click(); await expectDiscard(1);
      await expect(activeTable().getByRole('textbox', { name: '跳转页码', exact: true })).toHaveValue('1'); await expect((await field('note')).getByRole('textbox')).toHaveValue('翻页前输入'); expect(await calls('table.page')).toHaveLength(0);
      await answerDiscard(0); await activeTable().getByRole('button', { name: '下一页', exact: true }).click(); await expectDiscard(0); await expectPageReads(1, '51');
      await expect(activeTable().getByRole('textbox', { name: '跳转页码', exact: true })).toHaveValue('2'); await openForm(); await dirtyInput('页大小前输入');
      await answerDiscard(1); await activeTable().getByRole('combobox', { name: '每页行数', exact: true }).selectOption('100'); await expectDiscard(1);
      await expect(activeTable().getByRole('combobox', { name: '每页行数', exact: true })).toHaveValue('50'); await expect(activeTable().getByRole('textbox', { name: '跳转页码', exact: true })).toHaveValue('2');
      await expect((await field('note')).getByRole('textbox')).toHaveValue('页大小前输入'); await expect(await cell('id')).toHaveText('51'); expect(await calls('table.page')).toHaveLength(1);
      await answerDiscard(0); await activeTable().getByRole('combobox', { name: '每页行数', exact: true }).selectOption('100'); await expectDiscard(0); await expectPageReads(2, '1');
      await expect(activeTable().getByRole('textbox', { name: '跳转页码', exact: true })).toHaveValue('1'); await expect(activeTable().locator('.results-grid')).toHaveAttribute('aria-rowcount', '101');
      expect((await calls('table.page')).map(call => [call.input.page, call.input.pageSize])).toEqual([[2, 50], [1, 100]]);
      expect((await context.observer.query<RowDataPacket[]>(`SELECT note FROM ${qualified(context.database, tableName)} WHERE id IN(1,51) ORDER BY id`))[0].map(row => row.note)).toEqual(['原始-1', '原始-51']); await expectNoApply();
    }, info);
  });

  test('未暂存输入阻止粘贴、当前页替换和关联值写入口，放弃输入后仍能正常选择关联', async ({}, info) => {
    await guardDatabase(async context => {
      await context.observer.query(`CREATE TABLE ${qualified(context.database, 'parents')}(id INT PRIMARY KEY,label VARCHAR(40)) ENGINE=InnoDB`);
      await context.observer.query(`INSERT INTO ${qualified(context.database, 'parents')} VALUES(10,'父十'),(20,'父二十')`);
      await context.observer.query(`CREATE TABLE ${qualified(context.database, tableName)}(id INT PRIMARY KEY,parent_id INT,note VARCHAR(100),CONSTRAINT guard_parent FOREIGN KEY(parent_id) REFERENCES ${qualified(context.database, 'parents')}(id)) ENGINE=InnoDB`);
      await context.observer.query(`INSERT INTO ${qualified(context.database, tableName)} VALUES(1,10,'原始备注')`); await openTable(context);
      await activeTable().getByRole('button', { name: gridText.find, exact: true }).click();
      const find = activeTable().getByRole('region', { name: gridText.find, exact: true });
      await find.getByRole('textbox', { name: gridText.query, exact: true }).fill('原始'); await find.getByRole('textbox', { name: gridText.replacement, exact: true }).fill('替换');
      await expect(find.getByRole('button', { name: gridText.preview, exact: true })).toBeEnabled();
      await openForm('parent_id'); await observeRequests(); await dirtyInput('表单尚未暂存');
      await expect(find.getByRole('button', { name: gridText.preview, exact: true })).toBeDisabled(); await expect(find.getByRole('textbox', { name: gridText.replacement, exact: true })).toBeDisabled();
      // 派发真实剪贴板事件进入 RDG 的生产处理器，不直接替换行数据或伪造 IPC 返回。
      const target = await cell('parent_id'); await target.click(); await target.evaluate(element => { const data = new DataTransfer(); data.setData('text/plain', '20'); element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); });
      // RDG 可以直接拒绝不可编辑单元格的粘贴；两种合法拒绝方式都必须保留输入和旧草稿。
      await expect(await cell('parent_id')).toHaveText('10'); await expect((await field('note')).getByRole('textbox')).toHaveValue('表单尚未暂存');
      await activeTable().getByRole('button', { name: referenceZh.choose, exact: true }).click();
      await expect(activeTable().locator(':scope > .error-box')).toContainText(text.resolveInput);
      await expect(page.getByRole('dialog', { name: referenceZh.choose, exact: true })).toHaveCount(0); await expect(page.getByRole('dialog', { name: gridText.replaceTitle, exact: true })).toHaveCount(0);
      expect(await calls('table.referencePage')).toHaveLength(0); await expect((await field('note')).getByRole('textbox')).toHaveValue('表单尚未暂存'); await expect(activeTable().locator('.row-modified')).toHaveCount(0);
      await form().getByRole('button', { name: text.discard, exact: true }).click(); await expect(find.getByRole('button', { name: gridText.preview, exact: true })).toBeEnabled();
      await find.getByRole('button', { name: gridText.preview, exact: true }).click(); const replacement = page.getByRole('dialog', { name: gridText.replaceTitle, exact: true }); await expect(replacement).toBeVisible(); await replacement.getByRole('button', { name: '取消', exact: true }).click();
      await activeTable().getByRole('button', { name: referenceZh.choose, exact: true }).click(); const reference = page.getByRole('dialog', { name: referenceZh.choose, exact: true });
      await expect(reference.getByRole('gridcell', { name: '父二十', exact: true })).toBeVisible(); await reference.getByRole('gridcell', { name: '父二十', exact: true }).click(); await reference.getByRole('button', { name: referenceZh.use, exact: true }).click(); await expect(reference).toBeHidden();
      await expect(await cell('parent_id')).toHaveText('20'); await expect(await cell('note')).toHaveText('原始备注');
      expect((await context.observer.query<RowDataPacket[]>(`SELECT parent_id,note FROM ${qualified(context.database, tableName)}`))[0].map(row => [row.parent_id, row.note])).toEqual([[10, '原始备注']]); await expectNoApply();
    }, info);
  });

  test('表单显示隐藏字段沿用可见列顺序，隐藏输入仍能暂存且不改持久列偏好', async ({}, info) => {
    await guardDatabase(async context => {
      await context.observer.query(`CREATE TABLE ${qualified(context.database, tableName)}(id INT PRIMARY KEY,note VARCHAR(100),hidden VARCHAR(100),tail VARCHAR(100)) ENGINE=InnoDB`);
      await context.observer.query(`INSERT INTO ${qualified(context.database, tableName)} VALUES(1,'原备注','原隐藏','原尾列')`); await openTable(context);
      await activeTable().getByRole('button', { name: gridText.preferences, exact: true }).click(); const layout = page.getByRole('dialog', { name: gridText.preferences, exact: true });
      await layout.getByRole('checkbox', { name: '显示列 hidden', exact: true }).uncheck();
      for (let step = 0; step < 2; step++) await layout.getByRole('button', { name: '前移 tail', exact: true }).click();
      await layout.getByRole('button', { name: gridText.save, exact: true }).click(); await expect(layout).toContainText(gridText.saved); await layout.getByRole('button', { name: '关闭', exact: true }).click();
      const target = { connectionId: context.connectionId, database: context.database, table: tableName };
      const saved = await page.evaluate(input => window.dbark.invoke('table.preferences.get', input), target);
      expect(saved?.columns.filter(column => !column.hidden).map(column => column.name)).toEqual(['id', 'tail', 'note']);
      await openForm(); await observeRequests(); await expect.poll(() => form().locator('.record-field').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).toEqual(['id', 'tail', 'note']);
      await form().getByRole('checkbox', { name: text.showHidden, exact: true }).check();
      await expect.poll(() => form().locator('.record-field').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).toEqual(['id', 'tail', 'note', 'hidden']);
      await dirtyInput('隐藏本地草稿', 'hidden'); await form().getByRole('checkbox', { name: text.showHidden, exact: true }).uncheck(); await expect(form().getByRole('region', { name: 'hidden', exact: true })).toHaveCount(0);
      await form().getByRole('button', { name: text.stage, exact: true }).click(); await expect(form().getByRole('status')).toHaveText(text.stagedNotice); await expect(activeTable().locator('.table-action-bar')).toContainText('1 条待提交修改');
      await form().getByRole('checkbox', { name: text.showHidden, exact: true }).check(); await expect(form().getByRole('region', { name: 'hidden', exact: true })).toContainText('隐藏本地草稿');
      await expect(activeTable().getByRole('columnheader', { name: /^hidden/ })).toHaveCount(0); await expect(activeTable().getByRole('columnheader', { name: /^tail/ })).toHaveAttribute('aria-colindex', '3');
      expect(await page.evaluate(input => window.dbark.invoke('table.preferences.get', input), target)).toEqual(saved); expect(await calls('table.preferences.save')).toHaveLength(0); expect(await calls('table.page')).toHaveLength(0);
      expect((await context.observer.query<RowDataPacket[]>(`SELECT note,hidden,tail FROM ${qualified(context.database, tableName)}`))[0].map(row => [row.note, row.hidden, row.tail])).toEqual([['原备注', '原隐藏', '原尾列']]); await expectNoApply();
      // 仅附本例合成记录的实际表页截图供布局观察，不包含连接表单或凭据，也不代替上述断言。
      await info.attach('普通记录表单与隐藏字段草稿', { body: await activeTable().screenshot(), contentType: 'image/png' });
    }, info);
  });

  test('本地草稿验证表单精确编辑边界，服务器超限行仍整页拒绝且不暴露可编辑数据', async ({}, info) => {
    await guardDatabase(async context => {
      await context.observer.query(`CREATE TABLE ${qualified(context.database, tableName)}(id INT PRIMARY KEY,note VARCHAR(40),limit_text LONGTEXT,huge_text LONGTEXT,huge_blob LONGBLOB) ENGINE=InnoDB`);
      // 分页已有整行 256 KiB 预算，先读取服务器小值，再从生产网格入口形成精确边界的本地草稿。
      await context.observer.query(`INSERT INTO ${qualified(context.database, tableName)} VALUES(1,'原备注','边界原值','超限原值',X'00FF')`);
      await openTable(context); await expect(await cell('limit_text')).toHaveText('边界原值'); await observeRequests();
      for (const [name, value] of [['limit_text', '边'.repeat(262144)], ['huge_text', '大'.repeat(262145)]]) {
        await (await cell(name)).dblclick(); const input = activeTable().getByRole('textbox', { name: `编辑 ${name}`, exact: true });
        await input.fill(value); await input.press('Enter'); await expect(activeTable().locator(':scope > .error-box')).toHaveCount(0);
      }
      const binary = await cell('huge_blob'); await binary.click();
      // 类型化 ClipboardEvent 进入实际解码和网格暂存链路，不直接注入 DraftRow 或伪造数据库响应。
      await binary.evaluate((element, base64) => {
        const data = new DataTransfer(); data.setData('application/x-dbark-cells', JSON.stringify({ version: 1, rows: [[{ type: 'binary', base64 }]] }));
        data.setData('text/plain', '0x' + 'ff'.repeat(131072)); element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
      }, Buffer.alloc(131072, 255).toString('base64'));
      await expect(activeTable().locator(':scope > .error-box')).toHaveCount(0); await expect(activeTable().locator('.table-action-bar')).toContainText('1 条待提交修改');
      /** 通过生产复制协议读回实际草稿，仅返回长度和完整内容判定，避免把巨量文本附到失败报告。 */
      async function copiedShape(name: string) {
        const target = await cell(name); await target.click();
        return target.evaluate((element, column) => {
          const data = new DataTransfer(); element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
          const payload = JSON.parse(data.getData('application/x-dbark-cells')) as { rows: unknown[][] }; const value = payload.rows[0][0];
          if (typeof value === 'string') return { kind: 'text', length: value.length, exact: column === 'limit_text' ? /^边+$/.test(value) : /^大+$/.test(value) };
          if (value && typeof value === 'object' && 'type' in value && value.type === 'binary' && 'base64' in value && typeof value.base64 === 'string') {
            const bytes = atob(value.base64); return { kind: 'binary', length: bytes.length, exact: [...bytes].every(byte => byte.charCodeAt(0) === 255) };
          }
          throw new Error('实际剪贴板未返回预期类型');
        }, name);
      }
      expect(await copiedShape('limit_text')).toEqual({ kind: 'text', length: 262144, exact: true });
      expect(await copiedShape('huge_text')).toEqual({ kind: 'text', length: 262145, exact: true });
      expect(await copiedShape('huge_blob')).toEqual({ kind: 'binary', length: 131072, exact: true });
      await openForm();
      for (const name of ['huge_text', 'huge_blob']) {
        const section = form().getByRole('region', { name, exact: true }); await expect(section).toContainText(text.fieldTooLarge);
        await expect(section.getByRole('textbox')).toHaveCount(0); await expect(section.getByRole('button', { name: /^(编辑字段|查看字段)$/ })).toHaveCount(0);
      }
      const boundary = await field('limit_text'); await expect(boundary.getByRole('textbox')).not.toHaveAttribute('readonly', '');
      expect(await boundary.getByRole('textbox').evaluate(element => ({ length: (element as HTMLTextAreaElement).value.length, exact: /^边+$/.test((element as HTMLTextAreaElement).value) }))).toEqual({ length: 262144, exact: true });
      await expect(form().getByRole('button', { name: text.stage, exact: true })).toBeDisabled(); await form().getByRole('button', { name: text.close, exact: true }).click();
      for (const name of ['huge_text', 'huge_blob']) {
        await (await cell(name)).click(); await activeTable().getByRole('button', { name: '单元格', exact: true }).click(); const modal = page.getByRole('dialog', { name: `编辑单元格：${name}`, exact: true });
        await expect(modal).toContainText(text.fieldTooLarge);
        if (name === 'huge_blob') {
          // 大字节值新增只读分页查看；可查看不代表可编辑，更不能把片段当完整草稿暂存。
          const viewer = modal.getByRole('region', { name: binaryText.title, exact: true }), hex = viewer.getByRole('textbox');
          await expect(hex).toHaveCount(1); await expect(hex).toHaveAttribute('readonly', '');
          const first = (await hex.inputValue()).replace(/^0x/i, '').replace(/\s/g, '');
          expect(first).toHaveLength(binaryCellLimits.pageBytes * 2); expect(first).toMatch(/^f+$/i);
          await expect(viewer).toContainText(formatText(binaryText.segment, 1, binaryCellLimits.pageBytes, 131072));
          await viewer.getByRole('button', { name: binaryText.next, exact: true }).click();
          await expect(viewer).toContainText(formatText(binaryText.segment, binaryCellLimits.pageBytes + 1, binaryCellLimits.pageBytes * 2, 131072));
          await expect(hex).toHaveAttribute('readonly', '');
        } else await expect(modal.getByRole('textbox')).toHaveCount(0);
        await expect(modal.getByRole('button', { name: text.stageCell, exact: true })).toBeDisabled(); await modal.getByRole('button', { name: text.closeCell, exact: true }).click();
      }
      // 查看或拒绝展开不能截断已经形成的草稿，数据库上的小值也必须保持原样。
      expect(await copiedShape('limit_text')).toEqual({ kind: 'text', length: 262144, exact: true });
      expect(await copiedShape('huge_text')).toEqual({ kind: 'text', length: 262145, exact: true });
      expect(await copiedShape('huge_blob')).toEqual({ kind: 'binary', length: 131072, exact: true });
      await expect(activeTable().locator('.row-modified')).toHaveCount(1);
      expect((await context.observer.query<RowDataPacket[]>(`SELECT limit_text,huge_text,HEX(huge_blob) AS binary_value FROM ${qualified(context.database, tableName)}`))[0].map(row => [row.limit_text, row.huge_text, row.binary_value])).toEqual([['边界原值', '超限原值', '00FF']]); await expectNoApply();

      // 另一个真实表验证服务器预算：即使前面有可读取的小行，后续超限行也不能留下部分可编辑结果。
      const rejected = 'server_large_rows';
      await context.observer.query(`CREATE TABLE ${qualified(context.database, rejected)}(id INT PRIMARY KEY,note LONGTEXT) ENGINE=InnoDB`);
      await context.observer.query(`INSERT INTO ${qualified(context.database, rejected)} VALUES(1,'小行'),(2,?)`, ['x'.repeat(262145)]);
      expect(Number((await context.observer.query<RowDataPacket[]>(`SELECT OCTET_LENGTH(note) AS bytes FROM ${qualified(context.database, rejected)} WHERE id=2`))[0][0].bytes)).toBe(262145);
      const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) });
      await connection.locator('.connection-row').hover(); await connection.getByRole('button', { name: '刷新连接', exact: true }).click();
      await connection.locator('.database-row').getByRole('button', { name: context.database, exact: true }).click(); await connection.locator('.object-row').getByText(rejected, { exact: true }).click();
      await expect(activeTable().locator('.context-bar')).toContainText(rejected);
      await expect(activeTable().locator(':scope > .error-box')).toContainText('超过 256 KiB'); await expect(activeTable().locator(':scope > .error-box')).toContainText('未返回可编辑数据');
      await expect(activeTable().locator('.loading-overlay')).toHaveCount(0); await expect(activeTable().getByRole('gridcell')).toHaveCount(0);
      await expect(activeTable().getByRole('button', { name: '新增', exact: true })).toBeDisabled(); await expect(activeTable().getByRole('button', { name: text.title, exact: true })).toBeDisabled();
      expect((await calls('table.page')).some(call => call.input.table === rejected && call.settled)).toBe(true); await expectNoApply();
    }, info);
  });

  test('非InnoDB和待删除记录明确只读，撤销删除恢复编辑且始终未写入服务器', async ({}, info) => {
    await guardDatabase(async context => {
      await context.observer.query(`CREATE TABLE ${qualified(context.database, 'myisam_records')}(id INT PRIMARY KEY,note VARCHAR(80)) ENGINE=MyISAM`);
      await context.observer.query(`INSERT INTO ${qualified(context.database, 'myisam_records')} VALUES(1,'非事务原值')`);
      await context.observer.query(`CREATE TABLE ${qualified(context.database, tableName)}(id INT PRIMARY KEY,note VARCHAR(80)) ENGINE=InnoDB`);
      await context.observer.query(`INSERT INTO ${qualified(context.database, tableName)} VALUES(1,'事务原值')`);
      await openTable(context, 'myisam_records'); await openForm(); await observeRequests(); const readonly = await field('note');
      await expect(readonly).toContainText(text.engineReadonly); await expect(readonly.getByRole('textbox')).toHaveAttribute('readonly', ''); await expect(readonly.getByRole('combobox')).toBeDisabled();
      await expect(activeTable().getByRole('button', { name: '新增', exact: true })).toBeDisabled(); await expect(activeTable().getByRole('button', { name: '删除', exact: true })).toBeDisabled();
      await openTable(context); await openForm(); await field('note'); await activeTable().getByRole('button', { name: '删除', exact: true }).click();
      await expect(activeTable().locator('.row-deleted')).toHaveCount(1); const deleted = form().getByRole('region', { name: 'note', exact: true });
      await expect(deleted).toContainText(text.deletedReadonly); await expect(deleted.getByRole('textbox')).toHaveAttribute('readonly', ''); await expect(form().getByRole('button', { name: text.stage, exact: true })).toBeDisabled();
      await activeTable().getByRole('button', { name: '删除', exact: true }).click(); await expect(activeTable().locator('.row-deleted')).toHaveCount(0); await expect(deleted.getByRole('textbox')).not.toHaveAttribute('readonly', '');
      await expect(activeTable().getByRole('button', { name: '预览并提交', exact: true })).toHaveCount(0);
      expect((await context.observer.query<RowDataPacket[]>(`SELECT note FROM ${qualified(context.database, 'myisam_records')}`))[0][0].note).toBe('非事务原值'); expect((await context.observer.query<RowDataPacket[]>(`SELECT note FROM ${qualified(context.database, tableName)}`))[0][0].note).toBe('事务原值'); await expectNoApply();
    }, info);
  });
});
