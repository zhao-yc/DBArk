import { test as baseTest, expect } from '@playwright/test';
import { isDeepStrictEqual } from 'node:util';

// 列表阶段先短路，不加载桌面夹具、认证、系统剪贴板或私网帮助器。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_E2E === '1' && process.env.DBARK_Q01_FORMAT_UI === '1';
const test: typeof baseTest = active ? (require('./desktop-fixture') as typeof import('./desktop-fixture')).test : baseTest;
test.skip(!active, '默认关闭：须Root另行授权正式Monaco格式化界面验收');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 60000, retries: 0 });
type Desktop = typeof import('./desktop-fixture');
type MonacoWindow = Window & { monaco?: typeof import('monaco-editor') };
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/** 只通过官方只读API观察可见模型；不调用setValue、setSelection或executeEdits伪造真实编辑。 */
async function observe(desktop: Desktop) {
  return desktop.page.evaluate(() => {
    const editors = (window as MonacoWindow).monaco?.editor.getEditors().filter(editor => {
      const node = editor.getContainerDomNode(); return node.isConnected && node.closest('.query-tab') && node.getClientRects().length > 0;
    });
    if (editors?.length !== 1) throw Error('无法唯一观察当前查询编辑器');
    const model = editors[0].getModel(); if (!model || model.isDisposed()) throw Error('当前模型不可观察');
    return { value: model.getValue(), version: model.getVersionId(), eol: model.getEOL(), focused: editors[0].hasTextFocus(), selections: editors[0].getSelections()?.map(range => ({ start: model.getOffsetAt(range.getStartPosition()), end: model.getOffsetAt(range.getEndPosition()) })) };
  });
}
/** 只建本例离线连接和保存查询；正文由正式打开入口进入编辑器，不建立数据库会话。 */
async function openSource(sql: string) {
  // Playwright转译为CJS后，动态import命名空间可能固化上一例的page；读取同一夹具当前导出。
  const desktop = require('./desktop-fixture') as Desktop, { page } = desktop;
  await page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; });
  await page.evaluate(async source => {
    const connection = await window.dbark.invoke('connections.save', { id: '', name: '格式化离线连接', group: '', color: '#51bda5', dialect: 'mysql', host: '127.0.0.1', port: 1, user: 'offline' });
    await window.dbark.invoke('queries.create', { name: '格式化来源', connectionId: connection.id, context: { state: 'known', database: null }, sql: source });
  }, sql);
  await page.reload(); await expect(page.locator('.app-statusbar')).toBeVisible();
  await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: '历史与查询', exact: true })).click();
  const dialog = page.getByRole('dialog', { name: '历史与保存的查询', exact: true }); await (await navigationMenuItem(dialog, { name: '保存的查询', exact: true })).click();
  await (await navigationMenuItem(dialog.locator('.history-card').filter({ has: page.getByText('格式化来源', { exact: true }) }), { name: '在新标签打开', exact: true })).click();
  await expect(page.locator('.query-tab:visible .monaco-editor')).toBeVisible();
  expect((await observe(desktop)).value.replaceAll('\r\n', '\n') === sql, '初始正文必须来自保存查询原文').toBe(true); return desktop;
}
/** 快照只留RAM，断言只接收布尔，避免意外任务SQL或来源正文出现在失败附件中。 */
async function sideEffects(desktop: Desktop) {
  return desktop.page.evaluate(async () => {
    const settings = await window.dbark.invoke('settings.get', {}), current = settings.tabs.find(tab => tab.id === settings.activeTabId);
    const { sql: _sql, ...tab } = current!;
    return { tab, tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}), sources: await window.dbark.invoke('queries.list', {}), sessionCaption: document.querySelector('.query-tab .context-bar .muted')?.textContent };
  });
}
/** 同时核对真实模型和落盘草稿；不把store替换当作Monaco撤销栈证据。 */
async function exactSql(desktop: Desktop, expected: string) {
  await expect.poll(async () => (await observe(desktop)).value === expected, { message: '真实Monaco全文须与独立期望逐字一致' }).toBe(true);
  await expect.poll(() => desktop.page.evaluate(async expected => {
    const settings = await window.dbark.invoke('settings.get', {}); return settings.tabs.find(tab => tab.id === settings.activeTabId)?.sql === expected;
  }, expected), { message: '格式化及撤销后的草稿应沿原保存路径落盘' }).toBe(true);
}

for (const selected of [true, false]) test(selected ? '真实选区格式化保持外部原文、Unicode注释字符串，单次撤销重做且零执行' : '无选区格式化全文，单次撤销重做且来源会话任务历史不变', async () => {
  const prefix = "select '🚢外面' as 前; -- 头部保持\n", body = "select 名称,'🚢  ; -- 字符串' as 标记 from 表 where 编号=1; -- 注释保持", suffix = "\nselect '尾部' as 后;";
  const source = selected ? prefix + body + suffix : 'select 1,2 from 表 where 编号=1;';
  const formatted = selected ? prefix + "select\n  名称,\n  '🚢  ; -- 字符串' as 标记\nfrom\n  表\nwhere\n  编号 = 1;\n\n-- 注释保持" + suffix : 'select\n  1,\n  2\nfrom\n  表\nwhere\n  编号 = 1;';
  const desktop = await openSource(source), { page } = desktop, initial = await observe(desktop);
  const expected = (formatted + ' ').replaceAll('\n', initial.eol), original = (source + ' ').replaceAll('\n', initial.eol), box = page.locator('.query-tab:visible .monaco-editor').getByRole('textbox');
  // 先用真实按键追加普通空格，格式化的一次撤销必须保留这次独立用户输入。
  await box.focus(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'); await page.keyboard.press('Space'); await exactSql(desktop, original);
  const before = await sideEffects(desktop), start = prefix.replaceAll('\n', initial.eol).length;
  for (const entry of ['快捷键', '按钮']) {
    await box.focus(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
    if (selected) {
      await page.keyboard.press('ArrowDown');
      // 按Unicode码点逐键选择，避开换行/软折行的End键差异，不通过模型设置选区。
      for (const _point of body) await page.keyboard.press('Shift+ArrowRight');
    }
    const chosen = await observe(desktop);
    expect(chosen.focused && chosen.selections?.length === 1 && (selected ? chosen.selections[0].start === start && chosen.selections[0].end === start + body.length : chosen.selections[0].start === chosen.selections[0].end), '真实按键必须得到唯一准确选区或空选区').toBe(true);
    if (entry === '快捷键') await page.keyboard.press('Alt+Shift+f');
    else await (await navigationMenuItem(page, { name: '格式化 SQL', exact: true })).click();
    await exactSql(desktop, expected);
    const after = await observe(desktop); expect(after.focused, '格式化两入口完成后均须将焦点保留或返回真实编辑器').toBe(true);
    if (selected) expect(after.selections?.length === 1 && after.selections[0].start === start && after.selections[0].end === expected.length - (suffix.replaceAll('\n', initial.eol).length + 1), '选区跟随格式化范围且不纳入外部原文').toBe(true);
    // 每次只按一次撤销便恢复含用户空格的原文；不补设焦点掩盖格式化的焦点错误。
    await page.keyboard.press(`${modifier}+z`); await exactSql(desktop, original);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y'); await exactSql(desktop, expected);
    await page.keyboard.press(`${modifier}+z`); await exactSql(desktop, original);
  }
  expect(isDeepStrictEqual(await sideEffects(desktop), before), '格式化及撤销重做不得改变来源绑定、会话、任务、历史或已保存查询').toBe(true);
  expect(desktop.pageErrors.length, '正式界面不应产生页面错误').toBe(0);
});

for (const [label, source, message] of [
  ['分隔符脚本', 'DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; END$$', '无法确认此 SQL 的引号、分隔符或语法可安全排版，请手动调整；原文未改动。'],
  ['格式器不支持语法', 'select [合成字段] from 表;', 'SQL 格式化失败，原文未改动。'],
]) test(`${label}格式化失败保持原文，不创建编辑或执行SQL`, async () => {
  const desktop = await openSource(source), initial = await observe(desktop), before = await sideEffects(desktop);
  for (const entry of ['快捷键', '按钮']) {
    if (entry === '快捷键') { await desktop.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox').focus(); await desktop.page.keyboard.press('Alt+Shift+f'); }
    else await (await navigationMenuItem(desktop.page, { name: '格式化 SQL', exact: true })).click();
    await expect(desktop.page.getByText(message, { exact: true })).toBeVisible();
    const after = await observe(desktop); expect(after.value === initial.value && after.version === initial.version, '拒绝排版不得改模型或编辑版本').toBe(true);
  }
  expect(isDeepStrictEqual(await sideEffects(desktop), before), '拒绝路径不得执行或保存查询').toBe(true);
});

/** 原门进入具体动作后才加载真实菜单导航，不改变默认/列表阶段的资源边界。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args); }
