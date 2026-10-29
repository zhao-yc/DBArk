import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SqlSnippet } from '../../src/shared/contracts';
import { test, expect, desktop, page, dataDir, pageErrors } from './desktop-fixture';

interface FileChoiceCall { mode: 'import' | 'export'; title?: string; extensions: string[]; parented: boolean; }
declare global { var __dbarkSnippetTransferChoices: FileChoiceCall[]; }

// 不修改共享夹具：退出或所属进程未确认时保留本例窗口和临时目录，禁止强制清理。
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', video: 'off', screenshot: 'off' });
const library = () => page.getByRole('dialog', { name: 'SQL 片段库', exact: true });
const preview = () => library().getByRole('region', { name: '片段导入差异预览', exact: true });
const source = "-- 美元符号保持原文 $1 ${name}\nSELECT JSON_OBJECT('a', '$&'), '${1:值}', '🚢';\n";
const importedSql = "-- 文件中的 CRLF 与 LF\r\nSELECT '9223372036854775807', '12.00000000000000000001', '🚢';\n";

/** 只替换操作系统文件选择的回答，Main 文档能力、预览、确认、SQLite 和文件写入均走实际代码。 */
async function chooseFile(mode: FileChoiceCall['mode'], file?: string) {
  await desktop.evaluate(({ dialog }, choice) => {
    globalThis.__dbarkSnippetTransferChoices ??= [];
    if (choice.mode === 'import') dialog.showOpenDialog = (async (...args: unknown[]) => {
      const options = args.at(-1) as Electron.OpenDialogOptions;
      globalThis.__dbarkSnippetTransferChoices.push({ mode: 'import', title: options.title, extensions: options.filters?.flatMap(filter => filter.extensions) ?? [], parented: args.length === 2 });
      return { canceled: choice.file === undefined, filePaths: choice.file === undefined ? [] : [choice.file] };
    }) as typeof dialog.showOpenDialog;
    else dialog.showSaveDialog = (async (...args: unknown[]) => {
      const options = args.at(-1) as Electron.SaveDialogOptions;
      globalThis.__dbarkSnippetTransferChoices.push({ mode: 'export', title: options.title, extensions: options.filters?.flatMap(filter => filter.extensions) ?? [], parented: args.length === 2 });
      return { canceled: choice.file === undefined, filePath: choice.file };
    }) as typeof dialog.showSaveDialog;
  }, { mode, file });
}

/** 通过实际连接和查询表单打开片段库；目标故意不可连接，测试不需要数据库凭据。 */
async function openLibrary() {
  await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.navigation-toolbar'), { name: '新建连接', exact: true })).click();
  const connection = page.getByRole('dialog', { name: '新建连接', exact: true });
  await connection.getByLabel('连接名称', { exact: true }).fill('片段文件离线验收');
  await connection.getByLabel('主机地址', { exact: true }).fill('127.0.0.1');
  await connection.getByLabel('端口', { exact: true }).fill('1');
  await connection.getByLabel('用户名', { exact: true }).fill('offline');
  await (await (await import('./navigation-menu')).navigationMenuItem(connection, { name: '保存连接', exact: true })).click();
  await expect(connection).toBeHidden();
  await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.navigation-toolbar'), { name: '新建查询', exact: true })).click();
  await (await (await import('./navigation-menu')).navigationMenuItem(page.getByRole('dialog', { name: '新建查询', exact: true }), { name: '打开查询', exact: true })).click();
  await expect(page.locator('.query-tab:visible .monaco-editor')).toBeVisible();
  await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.query-tab:visible'), { name: 'SQL 片段库', exact: true })).click();
  await expect(library()).toBeVisible();
}

/** 种子也经父弹窗保存；列表 IPC 只独立观察 Main 真实结果，不伪造业务响应。 */
async function createSnippet() {
  await (await (await import('./navigation-menu')).navigationMenuItem(library(), { name: '新建片段', exact: true })).click();
  await library().getByLabel('片段名称', { exact: true }).fill('文件原文片段');
  await library().getByLabel('片段分组', { exact: true }).fill('文件验收');
  await library().getByRole('textbox', { name: '片段说明', exact: true }).fill('只保留用户片段字段');
  await library().getByRole('textbox', { name: '片段 SQL 正文', exact: true }).fill(source);
  await (await (await import('./navigation-menu')).navigationMenuItem(library(), { name: '保存', exact: true })).click();
  await expect(library().getByRole('button', { name: '编辑片段', exact: true })).toBeEnabled();
  const saved = await snippets(); expect(saved).toHaveLength(1); expect(saved[0].sql).toBe(source); return saved[0];
}

/** 文件仅写本例 userData；清理由既有夹具在真实退出和所属进程核对后负责。 */
async function documentFile(name: string, items: SqlSnippet[]) {
  const file = join(dataDir, name);
  // 独立构造版本合同，不复用生产编码器或解码器作为期望。
  await writeFile(file, '\uFEFF' + JSON.stringify({ format: 'DBArk-snippets', version: 1, snippets: items }), 'utf8');
  return file;
}

/** 只读取实际 IPC 状态，不触发任何查询、连接或任务。 */
async function snippets() { return page.evaluate(() => window.dbark.invoke('snippets.list', {})); }

/** 片段操作不得偷偷执行 SQL、保存查询或制造数据库任务。 */
async function noExecution() {
  expect(await page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}), queries: await window.dbark.invoke('queries.list', {}) }))).toEqual({ tasks: [], history: [], queries: [] });
  expect(pageErrors).toEqual([]);
  await expect(page.locator('.query-tab:visible .context-bar')).toContainText('执行时连接');
}

/** 等待整次操作解锁父弹窗，而不是仅看按钮点击已经返回。 */
async function expectIdle() {
  await expect(library().getByRole('button', { name: '导入片段 JSON', exact: true })).toBeEnabled();
  await expect(library().getByRole('button', { name: '导出片段 JSON', exact: true })).toBeEnabled();
  await expect(library().getByRole('button', { name: '关闭', exact: true })).toBeEnabled();
}

test('片段导出经过父弹窗未保存确认，取消保留旧文件，真实 JSON 仅含用户字段', async () => {
  await openLibrary(); const original = await createSnippet();
  const directory = join(dataDir, '片段导出'); await mkdir(directory);
  const file = join(directory, '用户片段.json'); await writeFile(file, '旧文件必须完整保留', 'utf8');
  await (await (await import('./navigation-menu')).navigationMenuItem(library(), { name: '编辑片段', exact: true })).click();
  await library().getByRole('textbox', { name: '片段 SQL 正文', exact: true }).fill('不应导出的草稿');
  await chooseFile('export', file);
  await (await (await import('./navigation-menu')).navigationMenuItem(library(), { name: '导出片段 JSON', exact: true })).click();
  const unsaved = library().getByRole('alertdialog', { name: '放弃片段修改', exact: true });
  await expect(unsaved).toBeVisible();
  expect(await desktop.evaluate(() => globalThis.__dbarkSnippetTransferChoices)).toEqual([]);
  await (await (await import('./navigation-menu')).navigationMenuItem(unsaved, { name: '取消', exact: true })).click();
  await expect(library().getByRole('textbox', { name: '片段 SQL 正文', exact: true })).toHaveValue('不应导出的草稿');
  expect(await readFile(file, 'utf8')).toBe('旧文件必须完整保留');

  await chooseFile('export');
  await (await (await import('./navigation-menu')).navigationMenuItem(library(), { name: '导出片段 JSON', exact: true })).click();
  await (await (await import('./navigation-menu')).navigationMenuItem(unsaved, { name: '放弃修改', exact: true })).click();
  await expectIdle(); expect(await readFile(file, 'utf8')).toBe('旧文件必须完整保留');
  expect(await snippets()).toEqual([original]);

  await chooseFile('export', file);
  await (await (await import('./navigation-menu')).navigationMenuItem(library(), { name: '导出片段 JSON', exact: true })).click();
  await expect(library().getByRole('status')).toHaveText('已导出 1 条用户片段。');
  await expectIdle();
  const bytes = await readFile(file, 'utf8');
  expect(JSON.parse(bytes)).toEqual({ format: 'DBArk-snippets', version: 1, snippets: [original] });
  expect(bytes.endsWith('\n')).toBe(true);
  expect(bytes).not.toContain('不应导出的草稿'); expect(bytes).not.toContain('片段文件离线验收');
  expect(await readdir(directory)).toEqual(['用户片段.json']);
  expect(await desktop.evaluate(() => globalThis.__dbarkSnippetTransferChoices)).toEqual([
    { mode: 'export', title: '导出片段 JSON', extensions: ['json'], parented: true },
    { mode: 'export', title: '导出片段 JSON', extensions: ['json'], parented: true }
  ]);
  await noExecution();
});

test('导入默认跳过冲突，显式批次确认使用已预览快照并在重新打开弹窗后保持原文', async () => {
  await openLibrary(); const original = await createSnippet();
  const replacement = { ...original, description: '显式替换同 ID', sql: importedSql, updatedAt: '' };
  const sameName = { ...original, id: 'json-same-name', sql: 'SELECT 2;\r\n', updatedAt: '' };
  const addition = { ...original, id: 'json-new-name', name: '默认新增片段', sql: 'SELECT 3;\n', updatedAt: '' };
  const builtinCopy = { ...original, id: 'json-builtin-name', name: '按条件读取列', sql: 'SELECT 4;\n', updatedAt: '' };
  const file = await documentFile('导入差异.json', [replacement, sameName, addition, builtinCopy]);
  await chooseFile('import', file); await (await (await import('./navigation-menu')).navigationMenuItem(library(), { name: '导入片段 JSON', exact: true })).click();
  await expect(preview()).toBeVisible(); expect(await snippets()).toEqual([original]);
  const replace = preview().getByRole('combobox', { name: `${original.name}（${original.id}）导入动作`, exact: true });
  const duplicate = preview().getByRole('combobox', { name: `${sameName.name}（${sameName.id}）导入动作`, exact: true });
  await expect(replace).toHaveValue('skip'); await expect(duplicate).toHaveValue('skip');
  await expect(preview().getByRole('combobox', { name: `${addition.name}（${addition.id}）导入动作`, exact: true })).toHaveValue('add');
  await expect(preview().getByRole('combobox', { name: `${builtinCopy.name}（${builtinCopy.id}）导入动作`, exact: true })).toHaveValue('skip');
  await expect(preview()).toContainText('存在同名片段');
  await expect(library().getByRole('button', { name: '关闭', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(library()).toBeVisible(); await expect(preview()).toBeVisible();
  await replace.selectOption('replace'); await duplicate.selectOption('add');
  // 用户确认的是 Main 已保留的快照；此时改源文件不能偷偷换入另一条 SQL。
  await writeFile(file, JSON.stringify({ format: 'DBArk-snippets', version: 1, snippets: [{ ...addition, id: 'late-file', name: '迟到文件' }] }), 'utf8');
  await preview().getByRole('button', { name: '确认导入所选更改', exact: true }).dblclick();
  await expect(library().getByRole('status')).toHaveText('导入完成：新增 2 条、替换 1 条、跳过 1 条。');
  await expect(preview()).toHaveCount(0); await expectIdle();
  const saved = await snippets(); expect(saved).toHaveLength(3);
  for (const incoming of [replacement, sameName, addition]) {
    const persisted = saved.find(item => item.id === incoming.id);
    expect(persisted).toEqual({ ...incoming, updatedAt: expect.any(String) });
    expect(persisted!.updatedAt).not.toBe('');
  }
  await (await (await import('./navigation-menu')).navigationMenuItem(library(), { name: '关闭', exact: true })).click();
  await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.query-tab:visible'), { name: 'SQL 片段库', exact: true })).click();
  expect(await snippets()).toEqual(saved);
  await expect(library().getByRole('button', { name: '选择片段：文件原文片段', exact: true })).toHaveCount(2);
  await expect(library().getByRole('button', { name: '选择片段：默认新增片段', exact: true })).toBeVisible();
  await expect(library().getByRole('button', { name: '选择片段：迟到文件', exact: true })).toHaveCount(0);
  await noExecution();
});

test('空库导出不打开文件框，关闭文件选择、取消差异和未知字段均不写片段库', async () => {
  await openLibrary(); await chooseFile('export');
  await (await (await import('./navigation-menu')).navigationMenuItem(library(), { name: '导出片段 JSON', exact: true })).click();
  await expect(library().locator('.error-box')).toContainText('当前没有可导出的用户片段');
  await expectIdle(); expect(await desktop.evaluate(() => globalThis.__dbarkSnippetTransferChoices)).toEqual([]);
  const original = await createSnippet();
  await chooseFile('import'); await (await (await import('./navigation-menu')).navigationMenuItem(library(), { name: '导入片段 JSON', exact: true })).click();
  await expectIdle(); await expect(preview()).toHaveCount(0); expect(await snippets()).toEqual([original]);
  const file = await documentFile('取消导入.json', [{ ...original, id: 'cancelled-item', name: '不会保存的片段' }]);
  await chooseFile('import', file); await (await (await import('./navigation-menu')).navigationMenuItem(library(), { name: '导入片段 JSON', exact: true })).click();
  await expect(preview()).toBeVisible();
  await (await (await import('./navigation-menu')).navigationMenuItem(library(), { name: '取消本次导入', exact: true })).click();
  await expectIdle(); await expect(preview()).toHaveCount(0); expect(await snippets()).toEqual([original]);
  await writeFile(file, JSON.stringify({ format: 'DBArk-snippets', version: 1, snippets: [{ ...original, password: '仅虚构的非法字段' }] }), 'utf8');
  await (await (await import('./navigation-menu')).navigationMenuItem(library(), { name: '导入片段 JSON', exact: true })).click();
  await expect(library().locator('.error-box')).toContainText('片段文件格式无效');
  await expectIdle(); await expect(preview()).toHaveCount(0); expect(await snippets()).toEqual([original]);
  await noExecution();
});

test('真实 IPC 并发修改使预览失效，失败不覆盖新内容且不能重复确认', async () => {
  await openLibrary(); const original = await createSnippet();
  const file = await documentFile('过期预览.json', [{ ...original, sql: importedSql }]);
  await chooseFile('import', file); await (await (await import('./navigation-menu')).navigationMenuItem(library(), { name: '导入片段 JSON', exact: true })).click();
  await expect(preview()).toBeVisible();
  await preview().getByRole('combobox', { name: `${original.name}（${original.id}）导入动作`, exact: true }).selectOption('replace');
  // 使用真实保存 IPC 模拟另一编辑者的成功修改，不篡改库修订或替换业务响应。
  const concurrent = await page.evaluate(value => window.dbark.invoke('snippets.save', value), { ...original, sql: 'SELECT \'并发新内容\';\n' });
  await (await (await import('./navigation-menu')).navigationMenuItem(preview(), { name: '确认导入所选更改', exact: true })).click();
  await expect(library().locator('.error-box')).toContainText('片段库、窗口或传输已变化');
  await expectIdle(); await expect(preview()).toHaveCount(0);
  await expect(library().getByRole('button', { name: '确认导入所选更改', exact: true })).toHaveCount(0);
  expect(await snippets()).toEqual([concurrent]); await noExecution();
});
