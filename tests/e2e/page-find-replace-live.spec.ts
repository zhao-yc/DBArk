import { clickSidebarAction } from './sidebar-menu';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, page, pageErrors } from './desktop-fixture';
import { enabled, environment, isolatedDatabase } from './live-helpers';
import { tableGridZh as text } from '../../src/renderer/locales/tableGrid.zh-CN';

test.use({ trace: 'off' });
const table = () => page.locator('.table-tab:visible');
const panel = () => table().getByRole('region', { name: text.find, exact: true });
/** 使用真实对象树打开新表，保持生产连接、元数据和分页 IPC。 */
async function openTable(connectionName: string, database: string, name: string) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(connectionName, { exact: true }) });
  await connection.locator('.connection-row').hover(); await clickSidebarAction(connection, { name: '刷新连接', exact: true });
  const databaseRow = connection.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
  await databaseRow.getByRole('button', { name: database, exact: true }).click(); await connection.locator('.object-row').getByText(name, { exact: true }).click();
  await expect(table().locator('.loading-overlay')).toHaveCount(0); await expect(table().getByRole('button', { name: text.find, exact: true })).toBeEnabled();
}

test.describe('200隔离实库页内单处与正则替换', () => {
  test.skip(!enabled, '由主对话统一启用200隔离实库验收');
  test.beforeEach(() => { if (environment.DBARK_TEST_HOST !== '192.168.31.200') throw new Error('仅允许主对话核对后的200隔离测试服务器'); });
  test('同格第二处替换和正则零宽预览零写库，明确集中提交后才更新精确原值', async ({}, result) => {
    test.setTimeout(120000);
    await isolatedDatabase(async ({ observer, database, connectionName }) => {
      const qualified = '`' + database + '`.`find_single_regex`';
      await observer.query(`CREATE TABLE ${qualified} (id BIGINT UNSIGNED PRIMARY KEY,note TEXT,amount DECIMAL(30,6),payload BLOB) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${qualified} VALUES (18446744073709551615,'😀old前old后old',12345678901234567890.123456,UNHEX('00ff'))`);
      await openTable(connectionName, database, 'find_single_regex'); await table().getByRole('button', { name: text.find, exact: true }).click();
      await panel().getByRole('combobox', { name: text.column, exact: true }).selectOption('note'); await panel().getByRole('textbox', { name: text.query, exact: true }).fill('old');
      await expect(panel().getByRole('status')).toContainText('0 / 3 处'); await panel().getByRole('button', { name: text.next, exact: true }).click(); await panel().getByRole('button', { name: text.next, exact: true }).click();
      await expect(panel().locator('.page-find-current')).toContainText('格内第 2 处'); await panel().getByRole('textbox', { name: text.replacement, exact: true }).fill('新'); await panel().getByRole('button', { name: text.replaceOne, exact: true }).click();
      await expect(table().locator('.row-modified')).toContainText('😀old前新后old');
      const read = async () => (await observer.query<RowDataPacket[]>(`SELECT CAST(id AS CHAR) AS id,note,amount,HEX(payload) AS payload FROM ${qualified}`))[0][0];
      expect(await read()).toMatchObject({ id: '18446744073709551615', note: '😀old前old后old', amount: '12345678901234567890.123456', payload: '00FF' });
      await panel().getByRole('checkbox', { name: text.regex, exact: true }).check(); await panel().getByRole('textbox', { name: text.query, exact: true }).fill('(?=old)'); await panel().getByRole('button', { name: text.search, exact: true }).click();
      await expect(panel().getByRole('status')).toContainText('0 / 2 处'); await panel().getByRole('textbox', { name: text.replacement, exact: true }).fill('$1'); await panel().getByRole('button', { name: text.preview, exact: true }).click();
      const preview = page.getByRole('dialog', { name: text.replaceTitle, exact: true }); await expect(preview).toContainText('😀$1old前新后$1old'); expect((await read()).note).toBe('😀old前old后old');
      await preview.getByRole('button', { name: text.apply, exact: true }).click(); await expect(table().locator('.row-modified')).toContainText('😀$1old前新后$1old'); expect((await read()).note).toBe('😀old前old后old');
      await table().getByRole('button', { name: '预览并提交', exact: true }).click(); const submit = page.getByRole('dialog', { name: '确认数据修改', exact: true }); await expect(submit.locator('.monaco-editor .view-lines')).toContainText('UPDATE'); await submit.getByRole('button', { name: '确认提交', exact: true }).click();
      await expect(submit).toHaveCount(0); expect(await read()).toMatchObject({ id: '18446744073709551615', note: '😀$1old前新后$1old', amount: '12345678901234567890.123456', payload: '00FF' }); expect(pageErrors).toEqual([]);
    }, result);
  });
});

// 新产品语义的独立补充，双门在自动桌面夹具前关闭；旧用例ID和期限保持原样。
test.describe('D06替换当前与键盘导航补充', () => {
  test.skip(!enabled || process.env.DBARK_D06_REPLACE_CURRENT_UI !== '1', '由ROOT单独安排D06真实UI窗口，默认不启动应用或访问200');
  test.beforeAll(() => { if (environment.DBARK_TEST_HOST !== '192.168.31.200' || !['13357', '13380', '13384', '13310', '13311', '13484'].includes(environment.DBARK_TEST_PORT ?? '')) throw Error('D06补充只允许已核对的200六个专用隔离端口'); });
  test('D06-REPLACE-CURRENT-UI：文字单处前进、IME零命令及空串只形成本地草稿', async ({}, result) => {
    test.setTimeout(120000);
    const fixture = await import('./desktop-fixture');
    await isolatedDatabase(async ({ observer, database, connectionName }) => {
      const qualified = '`' + database + '`.`d06_current_ui`', original = '😀old前old后old';
      // generated是MySQL保留字；夹具与产品一致显式引用字段，不能让建表语法失败冒充界面结果。
      await observer.query(`CREATE TABLE ${qualified}(id BIGINT UNSIGNED PRIMARY KEY,note TEXT,other TEXT,nil TEXT,amount DECIMAL(30,6),payload BLOB,\`generated\` TEXT GENERATED ALWAYS AS (note) VIRTUAL) ENGINE=InnoDB`);
      for (const [id, note, other] of [['18446744073709551614', original, '原旁列'], ['18446744073709551615', 'old', '原旁列2']]) await observer.query(`INSERT INTO ${qualified}(id,note,other,nil,amount,payload) VALUES(?,?,?,NULL,12345678901234567890.123456,UNHEX('0001ff'))`, [id, note, other]);
      const read = async () => (await observer.query<RowDataPacket[]>(`SELECT CAST(id AS CHAR) AS id,note,other,nil,amount,HEX(payload) AS bytes_value,\`generated\` FROM ${qualified} ORDER BY id`))[0], before = await read();
      await fixture.desktop.evaluate(({ ipcMain }) => {
        type Handler = (event: Electron.IpcMainInvokeEvent, payload: { command: string }) => Promise<unknown>;
        const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers, original = handlers.get('dbark:request'); if (!original) throw Error('没有真实IPC处理器');
        const state = { preview: 0, apply: 0, restore: () => handlers.set('dbark:request', original) }; (globalThis as typeof globalThis & { __d06Current?: typeof state }).__d06Current = state;
        handlers.set('dbark:request', async (event, payload) => { if (payload.command === 'table.preview') state.preview++; if (payload.command === 'table.apply') state.apply++; return original(event, payload); });
      });
      try {
        await openTable(connectionName, database, 'd06_current_ui');
        /** 只通过实际可见列及aria坐标定位，横向虚拟列也须先挂载。 */
        async function cell(key: string, row = 2) { const grid = table().getByRole('grid', { name: text.grid, exact: true }), header = table().getByRole('columnheader', { name: new RegExp('^' + key) }); await grid.evaluate(node => { node.scrollLeft = 0; }); for (let attempt = 0; attempt < 10; attempt++) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); if (await header.count()) break; await grid.evaluate(node => { node.scrollLeft += node.clientWidth; }); } await expect(header).toHaveCount(1); const index = await header.getAttribute('aria-colindex'); if (!index) throw Error('缺少实际列坐标'); return table().locator(`[role=row][aria-rowindex="${row}"] [role=gridcell][aria-colindex="${index}"]`); }
        await expect(await cell('id')).toHaveText('18446744073709551614');
        await (await cell('other')).dblclick(); const edit = table().getByRole('textbox', { name: '编辑 other', exact: true }); await edit.fill('已有草稿'); await edit.press('Enter'); await expect(edit).toHaveCount(0);
        await table().getByRole('button', { name: text.find, exact: true }).click(); await panel().getByRole('combobox', { name: text.column, exact: true }).selectOption('note'); const find = panel().getByRole('textbox', { name: text.query, exact: true }), replace = panel().getByRole('textbox', { name: text.replacement, exact: true }); await find.fill('old'); await expect(panel().getByRole('status')).toContainText('0 / 4 处'); await find.press('Enter'); await find.press('Enter'); await expect(panel().locator('.page-find-current')).toContainText('格内第 2 处'); await replace.fill('新old');
        // DOM报告标志只证明守卫，不声称自动化了实体输入法；正常按键另验。
        for (const state of [{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }]) await replace.evaluate((input, state) => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...state })); }, state);
        await expect(await cell('note')).toHaveText(original); expect(await read()).toEqual(before);
        await replace.press('Enter'); await expect(await cell('note')).toHaveText('😀old前新old后old'); await expect(panel().getByRole('status')).toContainText('3 / 4 处'); await expect(replace).toBeFocused();
        await replace.press('Enter'); await expect(await cell('note')).toHaveText('😀old前新old后新old'); await expect(panel().locator('.page-find-current')).toContainText('第 2 行');
        await replace.fill(''); await replace.press('Enter'); await expect(await cell('note', 3)).toHaveText(''); await expect(panel().getByRole('status')).toContainText('1 / 3 处');
        await expect(await cell('other')).toHaveText('已有草稿'); await expect(await cell('nil')).toHaveText('NULL'); await expect(await cell('amount')).toHaveText('12345678901234567890.123456'); await expect(await cell('payload')).toHaveText('0x0001ff'); expect(await read()).toEqual(before);
        await panel().getByRole('combobox', { name: text.column, exact: true }).selectOption('generated'); await expect(panel().getByRole('status')).toContainText('0 / 4 处'); await find.press('Enter'); await expect(panel().getByRole('button', { name: text.replaceOne, exact: true })).toBeDisabled(); await replace.press('Enter'); expect(await read()).toEqual(before);
        expect(await fixture.desktop.evaluate(() => { const state = (globalThis as typeof globalThis & { __d06Current?: { preview: number; apply: number } }).__d06Current!; return { preview: state.preview, apply: state.apply }; })).toEqual({ preview: 0, apply: 0 }); expect(pageErrors).toEqual([]); await page.screenshot({ path: result.outputPath('d06-replace-current-drafts-only.png') });
      } finally { if (!fixture.closed) await fixture.desktop.evaluate(() => { const root = globalThis as typeof globalThis & { __d06Current?: { restore(): void } }; root.__d06Current?.restore(); delete root.__d06Current; }); }
    }, result);
  });
});
