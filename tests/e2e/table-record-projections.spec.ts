import type { Locator, TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { recordViewZh as formText } from '../../src/renderer/locales/recordViews.zh-CN';
import { recordProjectionZh as text } from '../../src/renderer/locales/recordProjections.zh-CN';
import { tableGridZh } from '../../src/renderer/locales/tableGrid.zh-CN';
import { test, expect, page, desktop, closed } from './desktop-fixture';
import { enabled, environment, isolatedDatabase, modifier, type LiveContext } from './live-helpers';

// 凭据只进真实连接表单；本套只使用200已有隔离端口，不创建权限账号。
test.use({ trace: 'off' });
const activeTable = () => page.locator('.table-tab:visible');
const panel = () => activeTable().getByRole('complementary', { name: formText.title, exact: true });
const tree = () => panel().getByRole('list', { name: text.lexicalTree, exact: true });
const leave = () => page.getByRole('dialog', { name: formText.leaveTitle, exact: true });
const qualified = (context: LiveContext, name = 'projections') => `\`${context.database}\`.\`${name}\``;
type Probe = { calls: string[]; restore(): void };
type ProbeGlobal = typeof globalThis & { __recordProjectionProbe?: Probe };

/** 只旁观真实IPC命令名，不记录认证、SQL、行值，不替换原结果或改变完成时机。 */
async function observe() {
  await desktop.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: { command: string }) => Promise<unknown>;
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers.get('dbark:request'); if (!original) throw new Error('缺少真实IPC');
    const state: Probe = { calls: [], restore: () => handlers.set('dbark:request', original) };
    (globalThis as ProbeGlobal).__recordProjectionProbe = state;
    handlers.set('dbark:request', (event, payload) => { if (/^(?:table\.|metadata\.|query\.)/.test(payload.command)) state.calls.push(payload.command); return original(event, payload); });
  });
}
/** 数据不写入测试日志；只核对新增展示操作没有读取、预览、查询或写任务。 */
async function calls() { return desktop.evaluate(() => (globalThis as ProbeGlobal).__recordProjectionProbe?.calls ?? []); }
async function restore() { if (!closed) await desktop.evaluate(() => { const root = globalThis as ProbeGlobal; root.__recordProjectionProbe?.restore(); delete root.__recordProjectionProbe; }); }
/** 退出与DROP沿用精确隔离库清理，失败只附命令名和无认证表页。 */
async function projectionDatabase(body: (context: LiveContext) => Promise<void>, info: TestInfo) {
  await isolatedDatabase(async context => {
    try { await body(context); }
    catch (error) { if (!closed) await info.attach('只读投影命令名', { body: JSON.stringify(await calls()), contentType: 'application/json' }).catch(() => undefined); throw error; }
    finally { await restore(); }
  }, info);
}
/** 按名称聚焦既有树操作区；实际打开表后等待原有读取结束，不注入页数据。 */
async function openTable(context: LiveContext, name = 'projections') {
  const connection = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: context.connectionName, exact: true }) });
  await connection.getByRole('button', { name: context.connectionName, exact: true }).focus();
  await connection.getByRole('button', { name: '刷新连接', exact: true }).click();
  await connection.locator('.database-row').getByRole('button', { name: context.database, exact: true }).click();
  await connection.locator('.object-row').getByText(name, { exact: true }).click();
  await expect(activeTable().locator('.context-bar')).toContainText(name); await expect(activeTable().locator('.loading-overlay')).toHaveCount(0);
  await expect(activeTable().locator(':scope > .error-box')).toHaveCount(0);
}
/** 可见列头提供真实虚拟网格坐标，特殊列名只进入正则转义。 */
async function cell(name: string, row = 2): Promise<Locator> {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const header = activeTable().getByRole('columnheader', { name: new RegExp(`^${escaped}`) });
  await expect(header).toHaveCount(1); const index = await header.getAttribute('aria-colindex'); if (!index) throw new Error('缺少真实列坐标');
  const result = activeTable().locator(`[role="row"][aria-rowindex="${row}"] [role="gridcell"][aria-colindex="${index}"]`); await result.scrollIntoViewIfNeeded(); return result;
}
async function openPanel(name = 'payload') { await (await cell(name)).click(); if (!(await panel().isVisible())) await activeTable().getByRole('button', { name: formText.title, exact: true }).click(); await expect(panel()).toBeVisible(); }
async function mode(value: 'form' | 'tree' | 'json') { await panel().getByRole('button', { name: text[value], exact: true }).click(); }
/** 未暂存输入来自真实字段控件；不用内部状态或IPC造草稿。 */
async function editField(name: string, value: string, valueMode = 'text') {
  const section = panel().getByRole('region', { name, exact: true });
  if (!(await section.getByRole('textbox').count())) await section.getByRole('button', { name: /^(编辑字段|查看字段)$/ }).click();
  await section.getByRole('combobox').selectOption(valueMode); await section.getByRole('textbox').fill(value);
}
/** 读取原生只读文本控件的完整字符串，类型化格式不是导入/恢复协议。 */
async function document() { return JSON.parse(await panel().getByRole('textbox', { name: text.jsonText, exact: true }).inputValue()) as { format: string; version: number; fields: { name: string; hidden: boolean; value: { kind: string; text?: string; bytes?: number; encoding?: string } }[] }; }
async function parseField(name: string) { const item = panel().getByRole('list', { name: text.fields, exact: true }).locator(':scope > li').filter({ has: page.getByRole('heading', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }) }); await item.getByRole('button', { name: /^(展开 JSON 结构|按 JSON 查看此字符串)$/ }).click(); }
/** 单个成员按原文序号检查，重复名称不能合并成字典键。 */
async function inspectMember(index: number, name: string) {
  const label = `成员 #${index + 1} · ${JSON.stringify(name)}`;
  await tree().locator(':scope > li').filter({ has: page.getByText(label, { exact: true }) }).getByRole('button', { name: text.inspect, exact: true }).click();
  return { token: await panel().getByRole('textbox', { name: text.token, exact: true }).inputValue(), path: JSON.parse(await panel().getByRole('textbox', { name: text.path, exact: true }).inputValue()) };
}

test.describe('只读记录树及类型化整行JSON：真实数据与共享草稿', () => {
  test.skip(!enabled, '需要明确启用200隔离实库'); test.setTimeout(120000);
  test.beforeEach(() => { if (environment.DBARK_TEST_HOST !== '192.168.31.200') throw new Error('只能使用已核对200服务器'); const port = process.env.DBARK_RECORD_VIEWS_TEST_PORT ?? process.env.DBARK_TEST_PORT ?? '13384'; if (!['13357', '13380', '13384', '13310', '13311'].includes(port)) throw new Error('拒绝未授权端口'); environment.DBARK_TEST_PORT = port; });

  test('模式切换复用三选守卫，非法输入不丢失，暂存后只读投影同步且零读写', async ({}, info) => {
    await projectionDatabase(async context => {
      await context.observer.query(`CREATE TABLE ${qualified(context)}(id INT PRIMARY KEY,payload LONGTEXT,note VARCHAR(80)) ENGINE=InnoDB`);
      await context.observer.query(`INSERT INTO ${qualified(context)} VALUES(1,'{"a":1}','原备注')`); await openTable(context); await openPanel(); await observe();
      await editField('payload', '{', 'json'); await mode('tree'); await expect(leave()).toBeVisible(); await leave().getByRole('button', { name: formText.stageContinue, exact: true }).click(); await expect(leave().locator('.error-box')).toContainText('payload');
      await leave().getByRole('button', { name: formText.stay, exact: true }).click(); await expect(panel().getByRole('region', { name: 'payload', exact: true }).getByRole('textbox')).toHaveValue('{'); await expect(panel().getByRole('button', { name: text.form, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await mode('json'); await leave().getByRole('button', { name: formText.discardContinue, exact: true }).click(); expect((await document()).fields.find(field => field.name === 'payload')!.value.text).toBe('{"a":1}');
      await mode('form'); await editField('payload', ' {"n":9007199254740993,"n":-0} ', 'json'); await mode('tree'); await leave().getByRole('button', { name: formText.stageContinue, exact: true }).click(); await parseField('payload'); expect((await inspectMember(0, 'n')).token).toBe('9007199254740993');
      await mode('json'); expect((await document()).fields.find(field => field.name === 'payload')!.value.text).toBe(' {"n":9007199254740993,"n":-0} ');
      expect(await calls()).toEqual([]); expect((await context.observer.query<RowDataPacket[]>(`SELECT payload,note FROM ${qualified(context)}`))[0].map(row => [row.payload, row.note])).toEqual([['{"a":1}', '原备注']]);
    }, info);
  });

  test('原文有序树保留重复成员、大数字负零及原型路径，原生复制不改值', async ({}, info) => {
    await projectionDatabase(async context => {
      const source = '{"20":[],"2":{},"n":9007199254740993,"n":1e999,"__proto__":{"x":1},"a.b/[]":true,"\\u006e":-0}';
      await context.observer.query(`CREATE TABLE ${qualified(context)}(id INT PRIMARY KEY,\`a.b/[]\` LONGTEXT) ENGINE=InnoDB`); await context.observer.query(`INSERT INTO ${qualified(context)} VALUES(1,?)`, [source]); await openTable(context); await openPanel('a.b/[]'); await observe(); await mode('tree'); await parseField('a.b/[]');
      await expect(tree().locator(':scope > li')).toHaveCount(8); const labels = await tree().locator(':scope > li > strong').allTextContents(); expect(labels.slice(1)).toEqual(['成员 #1 · "20"', '成员 #2 · "2"', '成员 #3 · "n"', '成员 #4 · "n"', '成员 #5 · "__proto__"', '成员 #6 · "a.b/[]"', '成员 #7 · "n"']);
      for (const [index, name, token] of [[2, 'n', '9007199254740993'], [3, 'n', '1e999'], [6, 'n', '-0']] as const) { const value = await inspectMember(index, name); expect(value.token).toBe(token); expect(value.path).toEqual({ columnName: 'a.b/[]', segments: [{ kind: 'member', memberIndex: index, key: name }] }); }
      expect((await inspectMember(4, '__proto__')).token).toBe('{"x":1}'); const input = panel().getByRole('textbox', { name: text.token, exact: true }); await input.focus(); await input.press(`${modifier}+A`); await input.press(`${modifier}+C`); expect(await desktop.evaluate(({ clipboard }) => clipboard.readText())).toBe('{"x":1}');
      expect(await calls()).toEqual([]); expect((await context.observer.query<RowDataPacket[]>(`SELECT \`a.b/[]\` AS raw FROM ${qualified(context)}`))[0][0].raw).toBe(source); await info.attach('只读词法树及结构路径', { body: await panel().screenshot(), contentType: 'image/png' });
    }, info);
  });

  test('整行JSON按元数据顺序包含隐藏字段，精确字符串二进制NULL各自带类型', async ({}, info) => {
    await projectionDatabase(async context => {
      await context.observer.query(`CREATE TABLE ${qualified(context)}(id INT PRIMARY KEY,big_value BIGINT UNSIGNED,amount DECIMAL(30,6),stamp DATETIME(6),payload BLOB,nil TEXT,empty_text TEXT,literal_null TEXT,\`__proto__\` TEXT,hidden TEXT) ENGINE=InnoDB`);
      await context.observer.query(`INSERT INTO ${qualified(context)} VALUES(1,18446744073709551615,12345678901234567890.123456,'2026-10-14 01:02:03.123456',X'00FF8000',NULL,'','NULL','原型','完整隐藏')`); await openTable(context);
      await activeTable().getByRole('button', { name: tableGridZh.preferences, exact: true }).click(); const layout = page.getByRole('dialog', { name: tableGridZh.preferences, exact: true }); await layout.getByRole('checkbox', { name: '显示列 hidden', exact: true }).uncheck(); await layout.getByRole('button', { name: tableGridZh.save, exact: true }).click(); await expect(layout).toContainText(tableGridZh.saved); await layout.getByRole('button', { name: '关闭', exact: true }).click();
      await openPanel('big_value'); await observe(); await mode('json'); const json = await document(); expect(json.format).toBe('DBArk-record-view'); expect(json.version).toBe(1); expect(json.fields.map(field => field.name)).toEqual(['id', 'big_value', 'amount', 'stamp', 'payload', 'nil', 'empty_text', 'literal_null', '__proto__', 'hidden']); const values = new Map(json.fields.map(field => [field.name, field.value]));
      expect(values.get('big_value')).toMatchObject({ kind: 'string', text: '18446744073709551615' }); expect(values.get('amount')).toMatchObject({ kind: 'string', text: '12345678901234567890.123456' }); expect(values.get('stamp')).toMatchObject({ kind: 'string', text: '2026-10-14 01:02:03.123456' }); expect(values.get('payload')).toEqual({ kind: 'binary', encoding: 'base64', bytes: 4, text: 'AP+AAA==' }); expect(values.get('nil')).toEqual({ kind: 'null' }); expect(values.get('empty_text')).toEqual({ kind: 'string', text: '' }); expect(values.get('literal_null')).toEqual({ kind: 'string', text: 'NULL' }); expect(values.get('__proto__')).toEqual({ kind: 'string', text: '原型' }); expect(json.fields.find(field => field.name === 'hidden')).toMatchObject({ hidden: true, value: { text: '完整隐藏' } });
      await expect(panel().getByRole('textbox', { name: text.jsonText, exact: true })).toHaveJSProperty('readOnly', true); await expect(activeTable().getByRole('columnheader', { name: /^hidden/ })).toHaveCount(0); expect(await calls()).toEqual([]);
    }, info);
  });

  test('真实大结构分页只建512个条目，有序节点窗口无重复遗漏且字段换组撤下结构', async ({}, info) => {
    await projectionDatabase(async context => {
      const extra = Array.from({ length: 38 }, (_, index) => `c${index} TEXT`); await context.observer.query(`CREATE TABLE ${qualified(context)}(id INT PRIMARY KEY,payload LONGTEXT,${extra.join(',')}) ENGINE=InnoDB`); await context.observer.query(`INSERT INTO ${qualified(context)}(id,payload) VALUES(1,?)`, [JSON.stringify(Array.from({ length: 2048 }, (_, index) => index))]); await openTable(context); await openPanel(); await observe(); await mode('tree'); await parseField('payload');
      const all: string[] = []; for (let part = 0; part < 5; part++) { const labels = await tree().locator(':scope > li > strong').allTextContents(); expect(labels).toHaveLength(part < 4 ? 480 : 129); expect(await panel().locator('.record-projection-entry').count()).toBeLessThanOrEqual(512); all.push(...labels); if (part < 4) await panel().getByRole('button', { name: text.nodeNext, exact: true }).click(); }
      expect(all).toEqual([text.root, ...Array.from({ length: 2048 }, (_, index) => `元素 [${index}]`)]); await expect(panel().getByRole('button', { name: text.nodeNext, exact: true })).toBeDisabled(); await panel().getByRole('button', { name: text.fieldNext, exact: true }).click(); await expect(tree()).toHaveCount(0); await expect(panel().getByRole('list', { name: text.fields, exact: true }).locator(':scope > li')).toHaveCount(8); await panel().getByRole('button', { name: text.fieldPrevious, exact: true }).click(); await expect(tree()).toHaveCount(0); expect(await calls()).toEqual([]);
    }, info);
  });

  test('换行与本地网格草稿使旧节点立即失效，整行全文同步最新本页值', async ({}, info) => {
    await projectionDatabase(async context => {
      await context.observer.query(`CREATE TABLE ${qualified(context)}(id INT PRIMARY KEY,payload LONGTEXT) ENGINE=InnoDB`); await context.observer.query(`INSERT INTO ${qualified(context)} VALUES(1,'{"n":1}'),(2,'{"n":2}')`); await openTable(context); await openPanel(); await observe(); await mode('tree'); await parseField('payload'); expect((await inspectMember(0, 'n')).token).toBe('1');
      await panel().getByRole('button', { name: formText.next, exact: true }).click(); await expect(tree()).toHaveCount(0); await expect(panel().getByRole('textbox', { name: text.token, exact: true })).toHaveCount(0); await parseField('payload'); expect((await inspectMember(0, 'n')).token).toBe('2');
      await (await cell('payload', 3)).dblclick(); const input = activeTable().getByRole('textbox', { name: '编辑 payload', exact: true }); await input.fill('{"n":9007199254740993}'); await input.press('Enter'); await expect(tree()).toHaveCount(0); await parseField('payload'); expect((await inspectMember(0, 'n')).token).toBe('9007199254740993'); await mode('json'); expect((await document()).fields.find(field => field.name === 'payload')!.value.text).toBe('{"n":9007199254740993}');
      expect(await calls()).toEqual([]); expect((await context.observer.query<RowDataPacket[]>(`SELECT payload FROM ${qualified(context)} ORDER BY id`))[0].map(row => row.payload)).toEqual(['{"n":1}', '{"n":2}']);
    }, info);
  });

  test('非法或超限原文不建部分树，转义后超2MiB不提供全文且完整草稿保留', async ({}, info) => {
    await projectionDatabase(async context => {
      await context.observer.query(`CREATE TABLE ${qualified(context)}(id INT PRIMARY KEY,payload LONGTEXT) ENGINE=InnoDB`); await context.observer.query(`INSERT INTO ${qualified(context)} VALUES(1,'{"a":')`); await openTable(context); await openPanel(); await observe(); await mode('tree'); await parseField('payload'); await expect(panel()).toContainText(text.invalid); await expect(tree()).toHaveCount(0);
      const huge = '\\'.repeat(1_048_576); await (await cell('payload')).dblclick(); const input = activeTable().getByRole('textbox', { name: '编辑 payload', exact: true }); await input.fill(huge); await input.press('Enter'); await parseField('payload'); await expect(panel()).toContainText(text.lexicalLimited); await expect(tree()).toHaveCount(0); await mode('json'); await expect(panel()).toContainText(text.limited); await expect(panel().getByRole('textbox', { name: text.jsonText, exact: true })).toHaveCount(0);
      await panel().getByRole('heading', { name: formText.title, exact: true }).focus(); await page.keyboard.press(`${modifier}+Enter`); await page.keyboard.press('Delete'); await expect(page.getByRole('dialog', { name: '确认数据修改', exact: true })).toHaveCount(0); await (await cell('payload')).dblclick(); expect(await input.inputValue()).toBe(huge); await input.press('Escape'); expect(await calls()).toEqual([]); expect((await context.observer.query<RowDataPacket[]>(`SELECT payload FROM ${qualified(context)}`))[0][0].payload).toBe('{"a":');
    }, info);
  });

  test('新增缺值与生成列分别展示DEFAULT及待计算，查看不会代填服务器默认', async ({}, info) => {
    await projectionDatabase(async context => {
      await context.observer.query(`CREATE TABLE ${qualified(context)}(id INT PRIMARY KEY AUTO_INCREMENT,payload TEXT,note VARCHAR(40) DEFAULT '服务器默认',generated_value INT GENERATED ALWAYS AS (CHAR_LENGTH(note)) VIRTUAL) ENGINE=InnoDB`); await context.observer.query(`INSERT INTO ${qualified(context)}(id) VALUES(1)`); await openTable(context); await openPanel(); await observe(); await activeTable().getByRole('button', { name: '新增', exact: true }).click(); await mode('json'); const json = await document();
      expect(json.fields.find(field => field.name === 'note')!.value).toEqual({ kind: 'default' }); expect(json.fields.find(field => field.name === 'generated_value')!.value).toEqual({ kind: 'generated-pending' }); expect(json.fields.find(field => field.name === 'id')!.value).toEqual({ kind: 'default' }); await mode('tree'); await expect(panel()).toContainText(text.kinds.default); await expect(panel()).toContainText(text.kinds['generated-pending']); expect(await calls()).toEqual([]); expect((await context.observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${qualified(context)}`))[0][0].n).toBe('1');
    }, info);
  });
});
