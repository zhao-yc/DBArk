import { clickSidebarAction } from './sidebar-menu';
import type { Locator } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, page, pageErrors } from './desktop-fixture';
import { enabled, environment, isolatedDatabase } from './live-helpers';
import { tableGridZh as text } from '../../src/renderer/locales/tableGrid.zh-CN';
import { completeCaptureSql, type CaptureSqlChange } from '../helpers/pageCaptureSql';

test.use({ trace: 'off' });
const table = () => page.locator('.table-tab:visible');
const panel = () => table().getByRole('region', { name: text.find, exact: true });
const replacementPreview = () => page.getByRole('dialog', { name: text.replaceTitle, exact: true });

/** 通过对象树及真实网格打开本例表，不调用打开表IPC或修改React/Monaco模型。 */
async function openCaptureTable(connectionName: string, database: string, name: string) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(connectionName, { exact: true }) });
  await connection.locator('.connection-row').getByRole('button', { name: connectionName, exact: true }).focus();
  await clickSidebarAction(connection, { name: '刷新连接', exact: true });
  const databaseRow = connection.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
  await databaseRow.getByRole('button', { name: database, exact: true }).click();
  await connection.locator('.object-row').getByText(name, { exact: true }).click();
  await expect(table().locator('.loading-overlay')).toHaveCount(0);
  await expect(table().getByRole('button', { name: text.find, exact: true })).toBeEnabled();
}

/** 按实际可见列坐标读取虚拟网格；只滚动网格，不伪造模型、结果或选择令牌。 */
async function cell(key: string, row = 2): Promise<Locator> {
  const grid = table().getByRole('grid', { name: text.grid, exact: true }), header = table().getByRole('columnheader', { name: new RegExp('^' + key, 'u') });
  await grid.evaluate(node => { node.scrollLeft = 0; });
  await expect.poll(async () => { if (await header.count()) return true; await grid.evaluate(node => { node.scrollLeft += node.clientWidth; }); return false; }, { message: `等待实际可见列${key}挂载` }).toBe(true);
  const index = await header.getAttribute('aria-colindex'); if (!index) throw Error('缺少实际网格列坐标');
  return table().locator(`[role=row][aria-rowindex="${row}"] [role=gridcell][aria-colindex="${index}"]`);
}

/** 正则选项不会自动执行；每次更改后明确点击真实查找入口。 */
async function find(query: string, column: string, occurrences: number) {
  await panel().getByRole('combobox', { name: text.column, exact: true }).selectOption(column);
  await panel().getByRole('textbox', { name: text.query, exact: true }).fill(query);
  await panel().getByRole('button', { name: text.search, exact: true }).click();
  await expect(panel().getByRole('status')).toContainText(`0 / ${occurrences} 处`);
  await expect(panel().getByRole('button', { name: text.search, exact: true })).toBeEnabled();
}

/** 完整逐格比对预览，不以片段或预览标题代替真实原值和完整after。 */
async function preview(changes: readonly Pick<CaptureSqlChange, 'before' | 'after'>[]) {
  await panel().getByRole('button', { name: text.preview, exact: true }).click();
  const dialog = replacementPreview(); await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.locator('tbody tr td:nth-child(3) pre').allTextContents()).toEqual(changes.map(change => change.before));
  await expect.poll(() => dialog.locator('tbody tr td:nth-child(4) pre').allTextContents()).toEqual(changes.map(change => change.after));
}

/** 等完整SQL、完整参数和只读性，再用独立连接确认提交前零写库，最后点击原集中提交。 */
async function commitDraft(database: string, name: string, changes: readonly CaptureSqlChange[], assertUnchanged: () => Promise<void>) {
  await table().getByRole('button', { name: '预览并提交', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '确认数据修改', exact: true }), editor = dialog.locator('.monaco-editor'), lines = editor.locator('.view-lines');
  let complete: string | undefined;
  await expect.poll(async () => { const rendered = await lines.innerText(); if (completeCaptureSql(rendered, database, name, changes)) complete = rendered; return complete; }, { message: '等待所有UPDATE、完整参数及JSON尾部实际渲染' }).toBeDefined();
  const before = complete!; await editor.click(); await page.keyboard.type('不能改写SQL');
  await expect.poll(() => lines.innerText()).toBe(before);
  await assertUnchanged(); await expect(dialog.getByRole('button', { name: '确认提交', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '确认提交', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(table().locator('.error-box')).toHaveCount(0);
}

test.describe('D06显式捕获替换正式产品UI', () => {
  // 双门控制测试体和自动GUI；模块导入的本地env读取仅受既有全局integration门控制。
  test.skip(!enabled || process.env.DBARK_D06_CAPTURE_UI !== '1', '由ROOT单独安排捕获模式正式UI，默认关闭');
  test.beforeAll(() => {
    if (environment.DBARK_TEST_HOST !== '192.168.31.200' || !['13357', '13380', '13384', '13310', '13311', '13484'].includes(environment.DBARK_TEST_PORT ?? '')) throw Error('捕获UI仅允许已核对的200六个专用隔离端口');
    if (environment.DBARK_TEST_PORT === '13484' && environment.DBARK_TEST_TLS !== '1') throw Error('13484必须显式启用原严格TLS连接');
  });

  test('D06-CAPTURE-BATCH-UI：默认美元字面及显式数字命名未参与组批量草稿，集中提交才写库', async ({}, result) => {
    await isolatedDatabase(async ({ observer, database, connectionName }) => {
      const name = 'capture_batch', qualified = '`' + database + '`.`' + name + '`', ids = ['18446744073709551614', '18446744073709551615'], sources = ['old-x/old', '前old后'];
      const query = '(?<word>old)(?:-(?<optional>x))?', replacement = '[$1|$<word>|$2|$<optional>|$$|$&]';
      await observer.query(`CREATE TABLE ${qualified}(id BIGINT UNSIGNED PRIMARY KEY,note TEXT) ENGINE=InnoDB`);
      for (let index = 0; index < ids.length; index++) await observer.query(`INSERT INTO ${qualified}(id,note) VALUES(?,?)`, [ids[index], sources[index]]);
      const read = async () => (await observer.query<RowDataPacket[]>(`SELECT CAST(id AS CHAR) AS id,note FROM ${qualified} ORDER BY id`))[0], before = await read();
      expect(before).toEqual(ids.map((id, index) => ({ id, note: sources[index] })));
      const unchanged = async () => { expect(await read()).toEqual(before); };
      await openCaptureTable(connectionName, database, name); await table().getByRole('button', { name: text.find, exact: true }).click();
      const capture = panel().getByRole('checkbox', { name: text.captureReplacement, exact: true }); await expect(capture).not.toBeChecked(); await expect(capture).toBeDisabled();
      await panel().getByRole('checkbox', { name: text.regex, exact: true }).check(); await expect(capture).not.toBeChecked();
      await panel().getByRole('textbox', { name: text.replacement, exact: true }).fill(replacement); await find(query, 'note', 3);
      const literal = sources.map(source => source.replace(new RegExp(query, 'gu'), () => replacement));
      await preview(sources.map((source, index) => ({ before: source, after: literal[index] }))); await unchanged();
      await replacementPreview().getByRole('button', { name: '取消', exact: true }).click(); await expect(table().locator('.row-modified')).toHaveCount(0);
      await capture.check(); await find(query, 'note', 3);
      const changes = sources.map((source, index) => ({ id: ids[index], before: source, after: source.replace(new RegExp(query, 'gu'), replacement) }));
      await preview(changes); await unchanged(); await replacementPreview().getByRole('button', { name: text.apply, exact: true }).click();
      await expect(replacementPreview()).toHaveCount(0);
      for (let index = 0; index < changes.length; index++) await expect(await cell('note', index + 2)).toHaveText(changes[index].after);
      await unchanged(); await page.screenshot({ path: result.outputPath('capture-batch-drafts.png') });
      await commitDraft(database, name, changes, unchanged);
      await expect.poll(read).toEqual(changes.map(change => ({ id: change.id, note: change.after }))); expect(pageErrors).toEqual([]);
    }, result);
  });

  test('D06-CAPTURE-CURRENT-UI：按实际展开长度跳过新插入匹配并定位下一原匹配，服务器保持原文', async ({}, result) => {
    await isolatedDatabase(async ({ observer, database, connectionName }) => {
      const name = 'capture_current', qualified = '`' + database + '`.`' + name + '`', id = '18446744073709551615', source = '😀old|old|old', replacement = '$1-$1-$1';
      await observer.query(`CREATE TABLE ${qualified}(id BIGINT UNSIGNED PRIMARY KEY,note TEXT) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${qualified}(id,note) VALUES(?,?)`, [id, source]);
      const read = async () => (await observer.query<RowDataPacket[]>(`SELECT CAST(id AS CHAR) AS id,note FROM ${qualified}`))[0]; expect(await read()).toEqual([{ id, note: source }]);
      await openCaptureTable(connectionName, database, name); await table().getByRole('button', { name: text.find, exact: true }).click();
      await panel().getByRole('checkbox', { name: text.regex, exact: true }).check(); await panel().getByRole('checkbox', { name: text.captureReplacement, exact: true }).check();
      const replace = panel().getByRole('textbox', { name: text.replacement, exact: true }); await replace.fill(replacement); await find('(old)', 'note', 3);
      await panel().getByRole('button', { name: text.next, exact: true }).click(); await expect(panel().getByRole('status')).toContainText('1 / 3 处');
      const first = source.replace(/(old)/u, replacement); expect('old-old-old'.length).not.toBe(replacement.length);
      await replace.press('Enter'); await expect(await cell('note')).toHaveText(first); await expect(panel().getByRole('status')).toContainText('4 / 5 处');
      await expect(panel().locator('.page-find-current')).toContainText('格内第 4 处 · UTF-16 位置 15'); await expect(replace).toBeFocused(); expect(await read()).toEqual([{ id, note: source }]);
      const secondPattern = /(old)/uy; secondPattern.lastIndex = first.indexOf('|') + 1; const second = first.replace(secondPattern, replacement);
      await replace.press('Enter'); await expect(await cell('note')).toHaveText(second); await expect(panel().getByRole('status')).toContainText('7 / 7 处');
      expect(await read()).toEqual([{ id, note: source }]); await expect(replacementPreview()).toHaveCount(0); expect(pageErrors).toEqual([]);
      await page.screenshot({ path: result.outputPath('capture-current-next-original.png') });
    }, result);
  });

  test('D06-CAPTURE-UNICODE-UI：Unicode零宽前后缀及非文字生成列保护，完整预览集中提交', async ({}, result) => {
    await isolatedDatabase(async ({ observer, database, connectionName }) => {
      const name = 'capture_unicode', qualified = '`' + database + '`.`' + name + '`', id = '18446744073709551615', source = '😀a😀', query = '(?=😀)|$', replacement = "<$`|$'>";
      await observer.query(`CREATE TABLE ${qualified}(id BIGINT UNSIGNED PRIMARY KEY,note TEXT,amount DECIMAL(30,6),payload BLOB,nil TEXT,\`generated\` TEXT GENERATED ALWAYS AS (note) VIRTUAL) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${qualified}(id,note,amount,payload,nil) VALUES(?,?,12345678901234567890.123456,UNHEX('0001ff'),NULL)`, [id, source]);
      const read = async () => (await observer.query<RowDataPacket[]>(`SELECT CAST(id AS CHAR) AS id,note,amount,HEX(payload) AS bytes_value,nil,\`generated\` AS generated_value FROM ${qualified}`))[0], before = await read();
      expect(before).toEqual([{ id, note: source, amount: '12345678901234567890.123456', bytes_value: '0001FF', nil: null, generated_value: source }]);
      const unchanged = async () => { expect(await read()).toEqual(before); };
      await openCaptureTable(connectionName, database, name); await table().getByRole('button', { name: text.find, exact: true }).click();
      await panel().getByRole('checkbox', { name: text.regex, exact: true }).check(); await panel().getByRole('checkbox', { name: text.captureReplacement, exact: true }).check();
      await panel().getByRole('textbox', { name: text.replacement, exact: true }).fill(replacement); await find(query, '', 8);
      const change = { id, before: source, after: source.replace(new RegExp(query, 'gu'), replacement) };
      await preview([change]); await unchanged(); await replacementPreview().getByRole('button', { name: text.apply, exact: true }).click();
      await expect(replacementPreview()).toHaveCount(0); await expect(await cell('note')).toHaveText(change.after); await unchanged();
      for (const [key, pattern, count, value] of [['amount', '12345678901234567890\\.123456', 1, '12345678901234567890.123456'], ['generated', query, 3, source], ['payload', '00', 0, '0x0001ff']] as const) {
        await find(pattern, key, count); if (count) await panel().getByRole('button', { name: text.next, exact: true }).click();
        await expect(panel().getByRole('button', { name: text.replaceOne, exact: true })).toBeDisabled(); await expect(panel().getByRole('button', { name: text.preview, exact: true })).toBeDisabled();
        await expect(await cell(key)).toHaveText(value); await unchanged();
      }
      await panel().getByRole('combobox', { name: text.column, exact: true }).selectOption('nil'); await panel().getByRole('combobox', { name: text.kind, exact: true }).selectOption('null');
      await panel().getByRole('button', { name: text.search, exact: true }).click(); await expect(panel().getByRole('status')).toContainText('0 / 1 处');
      await expect(panel().getByRole('checkbox', { name: text.captureReplacement, exact: true })).not.toBeChecked(); await expect(panel().getByRole('button', { name: text.preview, exact: true })).toBeDisabled(); await expect(await cell('nil')).toHaveText('NULL');
      await expect(await cell('note')).toHaveText(change.after); await unchanged(); await page.screenshot({ path: result.outputPath('capture-unicode-readonly-drafts.png') });
      await commitDraft(database, name, [change], unchanged);
      await expect.poll(read).toEqual([{ ...before[0], note: change.after, generated_value: change.after }]); expect(pageErrors).toEqual([]);
    }, result);
  });
});
