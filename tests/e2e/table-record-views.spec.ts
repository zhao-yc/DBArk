import { clickSidebarAction } from './sidebar-menu';
import type { Locator, TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import type { RowChange } from '../../src/shared/contracts';
import { recordViewZh as text } from '../../src/renderer/locales/recordViews.zh-CN';
import { test, expect, page, desktop, closed, answerDialogs, requestQuit } from './desktop-fixture';
import { enabled, environment, isolatedDatabase, modifier, type LiveContext } from './live-helpers';

// 真实凭据仅进入既有连接表单；关闭追踪，普通 CI 不访问私网。
test.use({ trace: 'off' });
const table = () => page.locator('.table-tab:visible');
const form = () => table().getByRole('complementary', { name: text.title, exact: true });
const leave = () => page.getByRole('dialog', { name: text.leaveTitle, exact: true });
const preview = () => page.getByRole('dialog', { name: '确认数据修改', exact: true });
const qualified = (database: string, name: string) => `\`${database}\`.\`${name}\``;
type Observation = { command: string; changes?: RowChange[]; dirty?: boolean; returned: boolean };
type Probe = { calls: Observation[]; held: boolean; release(): void; restore(): void };
type ProbeGlobal = typeof globalThis & { __recordViewProbe?: Probe };

/** 只观察生产 handler 的真实调用，最多门控一次 apply 已完成响应，不构造数据库结果。 */
async function observeRequests(holdApply = false) {
  await desktop.evaluate(({ ipcMain }, hold) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: { command: string; input?: { changes?: RowChange[]; dirty?: boolean } }) => Promise<unknown>;
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers.get('dbark:request'); if (!original) throw new Error('真实 IPC handler 不存在');
    let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
    const state: Probe = { calls: [], held: false, release, restore: () => { release(); handlers.set('dbark:request', original); } };
    (globalThis as ProbeGlobal).__recordViewProbe = state;
    handlers.set('dbark:request', async (event, payload) => {
      // 仅记录本例表编辑与读取命令；连接认证、任意 SQL、服务器错误原文均不采集。
      const selected = ['table.preview', 'table.apply', 'table.page', 'metadata.table', 'app.setDirty'].includes(payload.command);
      const call: Observation | undefined = selected ? { command: payload.command, changes: payload.input?.changes ? structuredClone(payload.input.changes) : undefined, dirty: payload.input?.dirty, returned: false } : undefined;
      if (call) state.calls.push(call);
      const response = await original(event, payload); if (call) call.returned = true;
      if (hold && payload.command === 'table.apply' && !state.held) { state.held = true; await waiting; }
      return response;
    });
  }, holdApply);
}
/** 清理先释放真实响应，避免测试失败时阻塞应用正常退出。 */
async function restoreRequests() {
  if (!closed) await desktop.evaluate(() => { const root = globalThis as ProbeGlobal; root.__recordViewProbe?.restore(); delete root.__recordViewProbe; });
}
/** Playwright 对象反序列化使用普通赋值，会丢自有 __proto__；先在主进程编码字符串再由 Node 解码证据。 */
async function calls(command: string): Promise<Observation[]> {
  const json = await desktop.evaluate((_, name) => JSON.stringify((globalThis as ProbeGlobal).__recordViewProbe?.calls.filter(call => call.command === name) ?? []), command);
  return JSON.parse(json) as Observation[];
}
async function applyTasks() { return page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'table.apply')); }
/** 隔离库及精确 DROP 沿用已验 helper；失败只附本例无凭据的调用摘要和界面。 */
async function recordDatabase(body: (context: LiveContext) => Promise<void>, info: TestInfo) {
  await isolatedDatabase(async context => {
    try { await body(context); }
    catch (error) {
      if (!closed) await info.attach('记录表单调用证据', { body: await desktop.evaluate((_, database) => JSON.stringify({ database, calls: (globalThis as ProbeGlobal).__recordViewProbe?.calls ?? [] }, null, 2), context.database), contentType: 'application/json' }).catch(() => undefined);
      throw error;
    } finally { await restoreRequests(); }
  }, info);
}
/** 从真实对象树打开表或视图，不以 API 注入页数据。 */
async function openTable(context: LiveContext, name: string) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) });
  await connection.locator('.connection-row').hover(); await clickSidebarAction(connection, { name: '刷新连接', exact: true });
  await connection.locator('.database-row').getByRole('button', { name: context.database, exact: true }).click();
  await connection.locator('.object-row').getByText(name, { exact: true }).click();
  await expect(table().locator('.context-bar')).toContainText(name); await expect(table().locator('.loading-overlay')).toHaveCount(0);
  await expect(table().locator(':scope > .error-box')).toHaveCount(0); await expect(table().locator('.results-grid')).toBeVisible();
}
/** 从实际列头解析虚拟网格坐标，支持原型名而不把列名拼入 CSS。 */
async function cell(name: string, row = 2) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const header = table().getByRole('columnheader', { name: new RegExp(`^${escaped}`) });
  await expect(header).toHaveCount(1); const index = await header.getAttribute('aria-colindex'); if (!index) throw new Error('列头缺少实际坐标');
  const result = table().locator(`[role="row"][aria-rowindex="${row}"] [role="gridcell"][aria-colindex="${index}"]`);
  await result.scrollIntoViewIfNeeded(); return result;
}
async function openForm(name = 'note', row = 2) {
  await (await cell(name, row)).click(); if (!(await form().isVisible())) await table().getByRole('button', { name: text.title, exact: true }).click(); await expect(form()).toBeVisible();
}
/** 字段按精确 accessible name 定位；展开与修改均来自真实控件。 */
async function field(name: string): Promise<Locator> {
  const section = form().getByRole('region', { name, exact: true });
  if (!(await section.getByRole('textbox', { name: `${name} · ${text.value}`, exact: true }).count())) await section.getByRole('button', { name: /^(编辑字段|查看字段)$/ }).click();
  return section;
}
async function input(name: string, value: string, mode = 'text') {
  const section = await field(name); await section.getByRole('combobox', { name: text.mode, exact: true }).selectOption(mode);
  if (mode !== 'null' && mode !== 'default') await section.getByRole('textbox', { name: `${name} · ${text.value}`, exact: true }).fill(value);
}
async function stage() { await form().getByRole('button', { name: text.stage, exact: true }).click(); await expect(form().locator('.error-box')).toHaveCount(0); await expect(form().getByRole('status')).toHaveText(text.stagedNotice); }
async function showPreview() { await table().getByRole('button', { name: '预览并提交', exact: true }).click(); await expect(preview()).toBeVisible(); await expect(preview().locator('.monaco-editor .view-lines')).toContainText(/UPDATE|INSERT/); }
async function submit() { await preview().getByRole('button', { name: '确认提交', exact: true }).click(); await expect(preview()).toBeHidden({ timeout: 20000 }); await expect(table().locator('.loading-overlay')).toHaveCount(0); await expect(table().locator(':scope > .error-box')).toHaveCount(0); }
/** 两行夹具区分本地行 UUID、完整旧值和服务器并发更新。 */
async function simple(context: LiveContext) {
  await context.observer.query(`CREATE TABLE ${qualified(context.database, 'records')}(id INT PRIMARY KEY,note VARCHAR(100),\`__proto__\` VARCHAR(100),payload BLOB) ENGINE=InnoDB`);
  await context.observer.query(`INSERT INTO ${qualified(context.database, 'records')} VALUES(1,'原第一','原型一',X'00FF'),(2,'原第二','原型二',NULL)`);
  await openTable(context, 'records');
}

test.describe('普通记录表单：共享草稿与真实提交', () => {
  test.skip(!enabled, '必须明确启用 200 隔离实库验收'); test.setTimeout(120000);
  test.beforeEach(() => {
    if (environment.DBARK_TEST_HOST !== '192.168.31.200') throw new Error('只允许已授权 200 测试服务器');
    const port = process.env.DBARK_RECORD_VIEWS_TEST_PORT ?? process.env.DBARK_TEST_PORT ?? '13384';
    if (!['13357', '13380', '13384', '13310', '13311'].includes(port)) throw new Error('拒绝未授权测试端口'); environment.DBARK_TEST_PORT = port;
  });

  test('网格和表单共享完整旧值，暂存与预览零写且双击只提交同一批一次', async ({}, info) => {
    await recordDatabase(async context => {
      await simple(context); await observeRequests(true);
      await (await cell('note')).dblclick(); const gridInput = table().getByRole('textbox', { name: '编辑 note', exact: true }); await gridInput.fill('网格草稿'); await gridInput.press('Enter');
      await openForm(); await input('__proto__', '表单原型'); await stage(); await expect(await cell('__proto__')).toHaveText('表单原型');
      const read = async () => (await context.observer.query<RowDataPacket[]>(`SELECT note,\`__proto__\` AS p,HEX(payload) AS b FROM ${qualified(context.database, 'records')} WHERE id=1`))[0];
      expect((await read()).map(row => [row.note, row.p, row.b])).toEqual([['原第一', '原型一', '00FF']]); expect(await applyTasks()).toHaveLength(0);
      await showPreview(); expect((await read())[0].note).toBe('原第一');
      const changes = (await calls('table.preview'))[0].changes!; expect(changes).toHaveLength(1); expect(changes[0].kind).toBe('update');
      if (changes[0].kind !== 'update') throw new Error('实际预览不是更新');
      expect(Object.keys(changes[0].before).sort()).toEqual(['__proto__', 'id', 'note', 'payload']); expect(changes[0].before.payload).toEqual({ type: 'binary', base64: 'AP8=' }); expect(Object.hasOwn(changes[0].values, '__proto__')).toBe(true);
      // 连续真实 DOM click 在同轮触发，固定快照与同步门必须抵抗 React 尚未重绘的重复点击。
      await preview().getByRole('button', { name: '确认提交', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
      await expect.poll(() => desktop.evaluate(() => (globalThis as ProbeGlobal).__recordViewProbe?.held)).toBe(true);
      expect(await calls('table.apply')).toHaveLength(1); expect((await calls('table.apply'))[0].changes).toEqual(changes);
      await desktop.evaluate(() => (globalThis as ProbeGlobal).__recordViewProbe?.release()); await expect(preview()).toBeHidden();
      expect((await read()).map(row => [row.note, row.p, row.b])).toEqual([['网格草稿', '表单原型', '00FF']]); expect(await applyTasks()).toHaveLength(1); expect((await applyTasks())[0].status).toBe('completed');
    }, info);
  });

  test('新增精确数值与时间、NULL/空串/文字NULL/DEFAULT、BLOB及JSON原文分别保真', async ({}, info) => {
    await recordDatabase(async context => {
      await context.observer.query(`CREATE TABLE ${qualified(context.database, 'types')}(id INT PRIMARY KEY AUTO_INCREMENT,default_text VARCHAR(40) DEFAULT '服务器默认',nullable_text VARCHAR(40),empty_text VARCHAR(40),literal_null VARCHAR(40),big_value BIGINT UNSIGNED,decimal_value DECIMAL(30,6),time_value DATETIME(6),payload BLOB,json_value JSON,\`__proto__\` VARCHAR(40)) ENGINE=InnoDB`);
      await context.observer.query(`INSERT INTO ${qualified(context.database, 'types')}(id) VALUES(1)`); await openTable(context, 'types'); await openForm('id'); await observeRequests();
      await table().getByRole('button', { name: '新增', exact: true }).click(); await expect(form()).toContainText(text.inserted);
      await input('nullable_text', '', 'null'); await input('empty_text', ''); await input('literal_null', 'NULL'); await input('big_value', '18446744073709551615'); await input('decimal_value', '12345678901234567890.123456'); await input('time_value', '2026-10-14 01:02:03.123456'); await input('payload', '00 ff 80 00', 'binary'); await input('__proto__', '原型新增');
      const json = ' { "n":9007199254740993, "text":"中文" }\n'; await input('json_value', json, 'json'); await stage();
      expect((await context.observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${qualified(context.database, 'types')}`))[0][0].n).toBe('1');
      await showPreview(); const change = (await calls('table.preview'))[0].changes![0]; expect(change.kind).toBe('insert'); if (change.kind !== 'insert') throw new Error('实际预览不是新增');
      expect(Object.hasOwn(change.values, 'default_text')).toBe(false); expect(change.values.json_value).toBe(json); expect(change.values.nullable_text).toBeNull(); expect(change.values.empty_text).toBe(''); expect(change.values.literal_null).toBe('NULL');
      await submit();
      const [rows] = await context.observer.query<RowDataPacket[]>(`SELECT default_text,nullable_text,empty_text,literal_null,CAST(big_value AS CHAR) AS big_value,decimal_value,DATE_FORMAT(time_value,'%Y-%m-%d %H:%i:%s.%f') AS time_value,HEX(payload) AS payload,JSON_UNQUOTE(JSON_EXTRACT(json_value,'$.n')) AS json_n,JSON_UNQUOTE(JSON_EXTRACT(json_value,'$.text')) AS json_text,\`__proto__\` AS p FROM ${qualified(context.database, 'types')} WHERE id=2`);
      expect(rows.map(row => [row.default_text, row.nullable_text, row.empty_text, row.literal_null, row.big_value, row.decimal_value, row.time_value, row.payload, row.json_n, row.json_text, row.p])).toEqual([['服务器默认', null, '', 'NULL', '18446744073709551615', '12345678901234567890.123456', '2026-10-14 01:02:03.123456', '00FF8000', '9007199254740993', '中文', '原型新增']]);
      // JSON 服务器可能规范化空白；原文证据来自真实预览请求，存值按 JSON 语义独立核对。
      expect(await calls('table.apply')).toHaveLength(1);
    }, info);
  });

  test('非法JSON切行保留输入，留在/放弃/暂存三条离开路径均不写库', async ({}, info) => {
    await recordDatabase(async context => {
      await simple(context); await openForm(); await observeRequests(); await input('note', '{', 'json');
      await form().getByRole('button', { name: text.next, exact: true }).click(); await expect(leave()).toBeVisible(); await leave().getByRole('button', { name: text.stageContinue, exact: true }).click(); await expect(leave().locator('.error-box')).toContainText('note');
      await leave().getByRole('button', { name: text.stay, exact: true }).click(); await expect((await field('note')).getByRole('textbox')).toHaveValue('{'); await expect(form()).toContainText('本页第 1 / 2 条');
      await form().getByRole('button', { name: text.next, exact: true }).click(); await leave().getByRole('button', { name: text.discardContinue, exact: true }).click(); await expect(form()).toContainText('本页第 2 / 2 条');
      await input('note', '第二行待暂存'); await form().getByRole('button', { name: text.previous, exact: true }).click(); await leave().getByRole('button', { name: text.stageContinue, exact: true }).click(); await expect(form()).toContainText('本页第 1 / 2 条'); await expect(await cell('note', 3)).toHaveText('第二行待暂存');
      expect((await context.observer.query<RowDataPacket[]>(`SELECT note FROM ${qualified(context.database, 'records')} ORDER BY id`))[0].map(row => row.note)).toEqual(['原第一', '原第二']); expect(await calls('table.preview')).toHaveLength(0); expect(await calls('table.apply')).toHaveLength(0); expect(await calls('table.page')).toHaveLength(0);
    }, info);
  });

  test('完整旧值冲突后整批回滚，草稿保留且同预览禁止重放', async ({}, info) => {
    await recordDatabase(async context => {
      await simple(context); await openForm(); await observeRequests(); await input('note', '本地第一'); await stage(); await form().getByRole('button', { name: text.next, exact: true }).click(); await input('note', '本地第二'); await stage(); await showPreview();
      await context.observer.query(`UPDATE ${qualified(context.database, 'records')} SET \`__proto__\`='并发原型' WHERE id=2`);
      await preview().getByRole('button', { name: '确认提交', exact: true }).click(); await expect(preview().locator('.error-box')).toContainText(/并发|已被其他/); await expect(preview().getByRole('button', { name: '确认提交', exact: true })).toBeDisabled();
      await preview().getByRole('button', { name: '确认提交', exact: true }).evaluate(button => (button as HTMLButtonElement).click()); expect(await calls('table.apply')).toHaveLength(1);
      expect((await context.observer.query<RowDataPacket[]>(`SELECT note,\`__proto__\` AS p FROM ${qualified(context.database, 'records')} ORDER BY id`))[0].map(row => [row.note, row.p])).toEqual([['原第一', '原型一'], ['原第二', '并发原型']]);
      expect((await applyTasks()).map(task => task.status)).toEqual(['failed']); await preview().getByRole('button', { name: '返回编辑', exact: true }).click(); await expect(await cell('note')).toHaveText('本地第一'); await expect(await cell('note', 3)).toHaveText('本地第二'); await expect(table().locator('.table-action-bar')).toContainText('2 条待提交修改');
    }, info);
  });

  test('仅未暂存输入在隐藏标签和取消原生退出后仍保留且没有页面写入', async ({}, info) => {
    await recordDatabase(async context => {
      await simple(context); await context.observer.query(`CREATE TABLE ${qualified(context.database, 'other')}(id INT PRIMARY KEY) ENGINE=InnoDB`); await openForm(); await observeRequests(); await input('note', '只在输入层');
      await expect.poll(async () => (await calls('app.setDirty')).some(call => call.dirty === true && call.returned)).toBe(true);
      await openTable(context, 'other'); await expect(form()).toHaveCount(0); await page.locator('.tab-select').filter({ hasText: /^records$/ }).click(); await expect((await field('note')).getByRole('textbox')).toHaveValue('只在输入层'); await expect(table().locator('.table-action-bar')).toContainText(text.inputDirty); await expect(await cell('note')).toHaveText('原第一');
      await answerDialogs([0]); await requestQuit('window'); await expect.poll(() => desktop.evaluate(() => globalThis.__dbarkE2EDialogs.calls.length)).toBe(1);
      const dialogs = await desktop.evaluate(() => globalThis.__dbarkE2EDialogs.calls); expect(dialogs[0].message).toContain('尚未提交'); expect(dialogs[0].response).toBe(0); expect(closed).toBe(false); await expect((await field('note')).getByRole('textbox')).toHaveValue('只在输入层');
      expect(await calls('table.apply')).toHaveLength(0); expect((await context.observer.query<RowDataPacket[]>(`SELECT note FROM ${qualified(context.database, 'records')} WHERE id=1`))[0][0].note).toBe('原第一');
    }, info);
  });

  test('单元格CtrlEnter失败留输入成功关闭，reported组合键Escape不关闭弹窗', async ({}, info) => {
    await recordDatabase(async context => {
      await simple(context); await observeRequests(); await (await cell('payload')).click(); await table().getByRole('button', { name: '单元格', exact: true }).click();
      const modal = page.getByRole('dialog', { name: '编辑单元格：payload', exact: true }); const editor = modal.getByRole('textbox', { name: `payload · ${text.value}`, exact: true }); await editor.fill('001'); await editor.press(`${modifier}+Enter`); await expect(modal).toBeVisible(); await expect(modal.getByRole('alert').filter({ hasText: '字段“payload”无法暂存' })).toContainText('payload'); await expect(editor).toHaveValue('001');
      // 浏览器报告的组合状态只是事件边界验收，不代表实体输入法或真实 composition 过程。
      for (const properties of [{ isComposing: true, keyCode: 27 }, { isComposing: false, keyCode: 229 }]) {
        await editor.evaluate((element, state) => { element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...state })); }, properties);
        await expect(modal).toBeVisible(); await expect(leave()).toHaveCount(0); await expect(editor).toHaveValue('001');
      }
      await editor.fill('00ff8000'); await editor.press(`${modifier}+Enter`); await expect(modal).toBeHidden(); await expect(await cell('payload')).toContainText('00ff8000'); expect(await calls('table.apply')).toHaveLength(0);
      expect((await context.observer.query<RowDataPacket[]>(`SELECT HEX(payload) AS b FROM ${qualified(context.database, 'records')} WHERE id=1`))[0][0].b).toBe('00FF');
    }, info);
  });

  test('生成列、无可靠键与视图明确只读，当前页导航不发额外读取', async ({}, info) => {
    await recordDatabase(async context => {
      await context.observer.query(`CREATE TABLE ${qualified(context.database, 'generated_rows')}(id INT PRIMARY KEY,note VARCHAR(40),computed VARCHAR(50) GENERATED ALWAYS AS(CONCAT(note,'生成')) STORED) ENGINE=InnoDB`);
      await context.observer.query(`INSERT INTO ${qualified(context.database, 'generated_rows')}(id,note) VALUES(1,'第一'),(2,'第二')`);
      await context.observer.query(`CREATE TABLE ${qualified(context.database, 'no_key')}(note VARCHAR(40)) ENGINE=InnoDB`); await context.observer.query(`INSERT INTO ${qualified(context.database, 'no_key')} VALUES('无键')`);
      await context.observer.query(`CREATE VIEW ${qualified(context.database, 'readonly_view')} AS SELECT id,note FROM ${qualified(context.database, 'generated_rows')}`);
      await openTable(context, 'generated_rows'); await openForm(); await observeRequests(); const generated = await field('computed'); await expect(generated).toContainText(text.generated); await expect(generated.getByRole('combobox')).toBeDisabled(); await expect(generated.getByRole('textbox')).toHaveAttribute('readonly', '');
      await form().getByRole('button', { name: text.next, exact: true }).click(); await expect(form()).toContainText('本页第 2 / 2 条'); await expect(form().getByRole('button', { name: text.next, exact: true })).toBeDisabled(); await form().getByRole('button', { name: text.previous, exact: true }).click(); await expect(form()).toContainText('本页第 1 / 2 条'); expect(await calls('table.page')).toHaveLength(0); expect(await calls('metadata.table')).toHaveLength(0);
      await openTable(context, 'no_key'); await openForm(); const noKey = await field('note'); await expect(noKey).toContainText(text.noKey); await expect(noKey.getByRole('textbox')).toHaveAttribute('readonly', ''); await expect(table().getByRole('button', { name: '新增', exact: true })).toBeDisabled();
      await openTable(context, 'readonly_view'); await openForm(); const view = await field('note'); await expect(view).toContainText(text.viewReadonly); await expect(view.getByRole('textbox')).toHaveAttribute('readonly', ''); expect(await calls('table.apply')).toHaveLength(0); expect(await applyTasks()).toHaveLength(0);
      expect((await context.observer.query<RowDataPacket[]>(`SELECT note,computed FROM ${qualified(context.database, 'generated_rows')} ORDER BY id`))[0].map(row => [row.note, row.computed])).toEqual([['第一', '第一生成'], ['第二', '第二生成']]);
    }, info);
  });
});

