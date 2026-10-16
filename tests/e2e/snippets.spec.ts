import { test, expect, page, pageErrors, quitDesktop, launchDesktop, startSnippetsNativeDiagnostics, snippetsDiagnostics } from './desktop-fixture';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const source = "-- 原样保留 $1 ${name} 和注释\nSELECT JSON_OBJECT('a', '$&'), '${1:值}', '🚢';\n";
const editorSource = process.platform === 'win32' ? source.replaceAll('\n', '\r\n') : source;
const query = () => page.locator('.query-tab:visible');
const dialog = () => page.getByRole('dialog', { name: 'SQL 片段库', exact: true });

/** 创建不可连接的离线查询，任何意外 SQL 执行都会留下任务或历史。 */
async function offlineQuery() {
  await page.locator('.app-commandbar').getByRole('button', { name: '新建连接', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '新建连接', exact: true });
  await modal.getByLabel('连接名称', { exact: true }).fill('片段离线验收');
  await modal.getByLabel('主机地址', { exact: true }).fill('127.0.0.1');
  await modal.getByLabel('端口', { exact: true }).fill('1');
  await modal.getByLabel('用户名', { exact: true }).fill('offline');
  await modal.getByRole('button', { name: '保存连接', exact: true }).click();
  await page.locator('.app-commandbar').getByRole('button', { name: '新建查询', exact: true }).click();
  await page.getByRole('dialog', { name: '新建查询', exact: true }).getByRole('button', { name: '打开查询', exact: true }).click();
  await expect(query().locator('.monaco-editor')).toBeVisible();
}

/** 验收通过真实 Monaco 键盘输入，不替换编辑器或执行 IPC 返回值。 */
async function writeSql(sql: string) {
  const input = query().locator('.monaco-editor').getByRole('textbox'); await input.focus();
  await page.keyboard.press(`${modifier}+A`); await page.keyboard.insertText(sql); await expectSql(sql);
}
/** 等待真实工作台防抖保存，避免以视觉相似误判原文一致。 */
async function expectSql(sql: string) {
  await expect.poll(async () => {
    const settings = await page.evaluate(() => window.dbark.invoke('settings.get', {}));
    return settings.tabs.find(tab => tab.id === settings.activeTabId)?.sql;
  }).toBe(sql);
}
/** 仅操作本地片段，任务、历史及保存查询始终为空。 */
async function noExecution() {
  const state = await page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}), queries: await window.dbark.invoke('queries.list', {}) }));
  expect(state).toEqual({ tasks: [], history: [], queries: [] }); expect(pageErrors).toEqual([]);
  await expect(query().locator('.error-box')).toHaveCount(0);
  await expect(query().locator('.context-bar')).toContainText('执行时连接');
}
async function openLibrary() { await query().getByRole('button', { name: 'SQL 片段库', exact: true }).click(); await expect(dialog()).toBeVisible(); }
async function selectSnippet(name: string) { await dialog().getByRole('button', { name: `选择片段：${name}`, exact: true }).click(); }

test('离线片段分组搜索编辑复制删除、重启持久化、纯文本插入撤销与模态快捷键', async ({}, testInfo) => {
  await offlineQuery(); if (snippetsDiagnostics) await startSnippetsNativeDiagnostics(); const original = 'SELECT 0;'; await writeSql(original); await openLibrary();
  await selectSnippet('按条件读取列'); await expect(dialog().getByRole('button', { name: '编辑片段', exact: true })).toHaveCount(0);
  await dialog().locator('.monaco-editor').getByRole('textbox').focus();
  await page.keyboard.press(`${modifier}+Enter`); await page.keyboard.press(`${modifier}+S`); await noExecution(); await expectSql(original);
  await dialog().getByRole('button', { name: '新建片段', exact: true }).click();
  await dialog().getByLabel('片段名称', { exact: true }).fill('原文片段');
  await dialog().getByLabel('片段分组', { exact: true }).fill('JSON 诊断');
  // textarea 的包裹标签文字包含初始值，按真实可访问名称精确定位，避免正文被计入标签匹配。
  await dialog().getByRole('textbox', { name: '片段说明', exact: true }).fill('美元符号不是参数或插值');
  await dialog().getByRole('textbox', { name: '片段 SQL 正文', exact: true }).fill(source);
  await dialog().getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog().getByRole('button', { name: '编辑片段', exact: true })).toBeVisible();
  await dialog().getByLabel('筛选片段分组', { exact: true }).selectOption(':JSON 诊断');
  await dialog().getByLabel('搜索片段名称、说明或正文', { exact: true }).fill('不是参数');
  await expect(dialog().getByRole('button', { name: '选择片段：原文片段', exact: true })).toBeVisible();
  await expect(dialog().getByRole('button', { name: '选择片段：按条件读取列', exact: true })).toHaveCount(0);
  snippetsDiagnostics?.mark('before-copy');
  await dialog().getByRole('button', { name: '复制为新片段', exact: true }).click();
  await dialog().getByLabel('片段名称', { exact: true }).fill('原文副本');
  snippetsDiagnostics?.mark('before-copy-save');
  await dialog().getByRole('button', { name: '保存', exact: true }).click();
  snippetsDiagnostics?.mark('before-copy-edit');
  await dialog().getByRole('button', { name: '编辑片段', exact: true }).click();
  snippetsDiagnostics?.mark('after-copy-edit');
  await dialog().getByRole('textbox', { name: '片段说明', exact: true }).fill('只修改副本');
  await dialog().getByRole('button', { name: '保存', exact: true }).click();
  const snippets = await page.evaluate(() => window.dbark.invoke('snippets.list', {}));
  expect(snippets).toHaveLength(2); expect(snippets.find(item => item.name === '原文片段')?.description).toBe('美元符号不是参数或插值'); expect(snippets.every(item => item.sql === source)).toBe(true);
  await dialog().getByRole('button', { name: '删除', exact: true }).click();
  await dialog().getByRole('alertdialog', { name: '删除 SQL 片段', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.evaluate(() => window.dbark.invoke('snippets.list', {}))).toHaveLength(2);
  await dialog().getByRole('button', { name: '删除', exact: true }).click();
  await dialog().getByRole('alertdialog', { name: '删除 SQL 片段', exact: true }).getByRole('button', { name: '删除', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('snippets.list', {}))).length).toBe(1);
  await dialog().getByRole('button', { name: '关闭', exact: true }).click(); await noExecution();
  await page.getByRole('button', { name: '切换主题', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await quitDesktop(); await launchDesktop(); await expectSql(original); await openLibrary(); await selectSnippet('原文片段');
  await expect(dialog().locator('.snippet-description')).toHaveText('美元符号不是参数或插值');
  await expect(dialog().locator('.monaco-editor .view-lines')).toContainText('JSON_OBJECT');
  await page.screenshot({ path: testInfo.outputPath('snippet-library.png') });
  await dialog().getByRole('button', { name: '编辑片段', exact: true }).click();
  await dialog().getByRole('textbox', { name: '片段 SQL 正文', exact: true }).fill('未保存 SQL');
  await dialog().getByRole('button', { name: '关闭', exact: true }).click();
  await dialog().getByRole('alertdialog', { name: '放弃片段修改', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog().getByRole('textbox', { name: '片段 SQL 正文', exact: true })).toHaveValue('未保存 SQL');
  await dialog().getByRole('button', { name: '关闭', exact: true }).click();
  await dialog().getByRole('alertdialog', { name: '放弃片段修改', exact: true }).getByRole('button', { name: '放弃修改', exact: true }).click();
  // 打开模态前捕获全选区，正文按原样替换且单次撤销恢复原查询。
  const input = query().locator('.monaco-editor').getByRole('textbox'); await input.focus(); await page.keyboard.press(`${modifier}+A`);
  await openLibrary(); await selectSnippet('原文片段'); await dialog().getByRole('button', { name: '插入查询', exact: true }).click(); await expectSql(editorSource);
  await page.keyboard.press(`${modifier}+Z`); await expectSql(original);
  // 空选区在末尾插入，不创建新标签、会话或查询结果。
  await input.focus(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'); await openLibrary(); await selectSnippet('原文片段');
  await dialog().getByRole('button', { name: '插入查询', exact: true }).click(); await expectSql(original + editorSource);
  await page.keyboard.press(`${modifier}+Z`); await expectSql(original); await noExecution();
  const settings = await page.evaluate(() => window.dbark.invoke('settings.get', {})); expect(settings.tabs).toHaveLength(1);
  await expect(query().locator('.context-bar')).toContainText('执行时连接');
});
