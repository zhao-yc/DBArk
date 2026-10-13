import { mkdir, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import iconv from 'iconv-lite';
import type { FileChoice } from '../../src/shared/contracts';
import { test, expect, desktop, page, dataDir, pageErrors, launchDesktop, quitDesktop } from './desktop-fixture';

type Encoding = 'utf8' | 'utf16le' | 'gb18030';
interface NativeFileCall { mode: 'open' | 'save'; title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[]; }
declare global { var __dbarkQueryFileCalls: NativeFileCall[]; }
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const source = "-- 中文文件往返\nSELECT '9223372036854775807', '12.00000000000000000001', '🚢';\n";

/** 只替换原生选择的返回值并记录选项；令牌授权、编解码和磁盘读写仍走真实主进程。 */
async function chooseNativeFile(mode: 'open' | 'save', path?: string) {
  await desktop.evaluate(({ dialog }, choice) => {
    globalThis.__dbarkQueryFileCalls ??= [];
    if (choice.mode === 'open') {
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.OpenDialogOptions;
        globalThis.__dbarkQueryFileCalls.push({ mode: 'open', title: options.title, filters: options.filters });
        return { canceled: choice.path === undefined, filePaths: choice.path === undefined ? [] : [choice.path] };
      }) as typeof dialog.showOpenDialog;
    } else {
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.SaveDialogOptions;
        globalThis.__dbarkQueryFileCalls.push({ mode: 'save', title: options.title, defaultPath: options.defaultPath, filters: options.filters });
        return { canceled: choice.path === undefined, filePath: choice.path };
      }) as typeof dialog.showSaveDialog;
    }
  }, { mode, path });
}

/** 原生选择也用于 IPC 负例，不能绕过真实令牌生成直接传绝对路径。 */
async function authorizeFile(path: string, purpose: 'query' | 'import' | 'export', format = 'sql'): Promise<FileChoice> {
  await chooseNativeFile(purpose === 'export' ? 'save' : 'open', path);
  const selected = await page.evaluate(input => window.dbark.invoke('files.choose', input), { purpose, format });
  expect(selected).not.toBeNull();
  return selected!;
}

/** 通过界面创建故意不可连接的离线配置，文件操作不得偷偷执行 SQL 或创建数据库任务。 */
async function openOfflineQuery() {
  await page.locator('.app-commandbar').getByRole('button', { name: '新建连接', exact: true }).click();
  const connection = page.getByRole('dialog', { name: '新建连接', exact: true });
  await connection.getByLabel('连接名称', { exact: true }).fill('SQL 文件离线验收');
  await connection.getByLabel('主机地址', { exact: true }).fill('127.0.0.1');
  await connection.getByLabel('端口', { exact: true }).fill('1');
  await connection.getByLabel('用户名', { exact: true }).fill('offline');
  await connection.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(connection).toBeHidden();
  await page.locator('.app-commandbar').getByRole('button', { name: '新建查询', exact: true }).click();
  await page.getByRole('dialog', { name: '新建查询', exact: true }).getByRole('button', { name: '打开查询', exact: true }).click();
  await expect(page.locator('.query-tab:visible .monaco-editor')).toBeVisible();
}

/** 使用 Monaco 的真实输入区写入正文，不直接修改 React 状态或模拟 IPC 返回值。 */
async function writeEditor(sql: string) {
  const input = page.locator('.query-tab:visible .monaco-editor').getByRole('textbox');
  await input.focus(); await page.keyboard.press(`${modifier}+A`); await page.keyboard.insertText(sql);
  await expect.poll(async () => {
    const settings = await page.evaluate(() => window.dbark.invoke('settings.get', {}));
    return settings.tabs.find(tab => tab.id === settings.activeTabId)?.sql;
  }).toBe(sql);
}

/** 只有用户点击主按钮才触发文件选择；每次调用只点击一次，不重放写入操作。 */
async function fileDialog(mode: 'open' | 'save', encoding: Encoding) {
  const title = mode === 'open' ? '打开 SQL 文件' : '另存 SQL 文件';
  await page.locator('.query-tab:visible').getByRole('button', { name: title, exact: true }).click();
  const modal = page.getByRole('dialog', { name: title, exact: true });
  await modal.getByRole('combobox', { name: /^文件编码/ }).selectOption(encoding);
  return modal;
}

/** 等待真实配置保存再核对全部标签，避免把 400ms 防抖写入误认为内容丢失。 */
async function storedTabs(count: number) {
  await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('settings.get', {}))).tabs.length).toBe(count);
  return (await page.evaluate(() => window.dbark.invoke('settings.get', {}))).tabs;
}

/** 离线文件操作不得生成查询历史或数据库任务；不以伪造事务状态冒充实库事务验收。 */
async function expectNoSqlExecution() {
  const state = await page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}) }));
  expect(state.tasks).toEqual([]); expect(state.history).toEqual([]); expect(pageErrors).toEqual([]);
}

/** 请求经过真实 preload/参数校验/授权处理，返回错误文字供各负例断言。 */
async function fileError(operation: 'read' | 'write', fileToken: string, sql = source, encoding: Encoding = 'utf8') {
  return page.evaluate(async input => {
    try {
      if (input.operation === 'read') await window.dbark.invoke('files.readQuery', { fileToken: input.fileToken, encoding: input.encoding });
      else await window.dbark.invoke('files.writeQuery', { fileToken: input.fileToken, encoding: input.encoding, sql: input.sql });
      return '';
    } catch (error) { return error instanceof Error ? error.message : String(error); }
  }, { operation, fileToken, sql, encoding });
}

test.describe('离线 SQL 文件打开与另存', () => {
  test('UTF BOM 和 GB18030 文件打开为独立标签，取消不覆盖原查询且不执行 SQL', async ({}, testInfo) => {
    await openOfflineQuery();
    const originalSql = "SELECT '原查询不能被文件覆盖' AS original_query;";
    await writeEditor(originalSql);
    const [original] = await storedTabs(1);
    const directory = join(dataDir, 'query-files'); await mkdir(directory);
    const examples: { name: string; bytes: Buffer; requested: Encoding; actual: Encoding }[] = [
      { name: 'UTF8带BOM.sql', bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(source)]), requested: 'gb18030', actual: 'utf8' },
      { name: 'UTF16带BOM.sql', bytes: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(source, 'utf16le')]), requested: 'utf8', actual: 'utf16le' },
      { name: '国标中文.sql', bytes: iconv.encode(source, 'gb18030'), requested: 'gb18030', actual: 'gb18030' }
    ];
    for (const [index, example] of examples.entries()) {
      const file = join(directory, example.name); await writeFile(file, example.bytes);
      await chooseNativeFile('open', file);
      const modal = await fileDialog('open', example.requested);
      await modal.getByRole('button', { name: '选择并打开 SQL 文件', exact: true }).click();
      await expect(modal).toBeHidden();
      await expect(page.locator('.workspace-tab-button')).toHaveCount(index + 2);
      const tabs = await storedTabs(index + 2);
      expect(tabs[0]).toEqual(original);
      expect(tabs.at(-1)).toMatchObject({ kind: 'query', connectionId: original.connectionId, sql: source });
      expect(tabs.at(-1)!.id).not.toBe(original.id);
      await expect(page.locator('.query-tab:visible .monaco-editor .view-lines')).toContainText('中文文件往返');
      const token = await authorizeFile(file, 'query');
      expect(await page.evaluate(input => window.dbark.invoke('files.readQuery', input), { fileToken: token.token, encoding: example.requested })).toEqual({ sql: source, encoding: example.actual });
    }
    await chooseNativeFile('open');
    const cancelled = await fileDialog('open', 'utf8');
    await cancelled.getByRole('button', { name: '选择并打开 SQL 文件', exact: true }).click();
    await expect(cancelled).toBeVisible();
    await expect(page.locator('.workspace-tab-button')).toHaveCount(4);
    expect((await storedTabs(4))[0]).toEqual(original);
    await cancelled.getByRole('button', { name: '取消', exact: true }).click();
    const calls = await desktop.evaluate(() => globalThis.__dbarkQueryFileCalls);
    expect(calls.every(call => call.mode === 'open' && call.filters?.[0]?.extensions.includes('sql'))).toBe(true);
    await expectNoSqlExecution();
    await page.screenshot({ path: testInfo.outputPath('query-file-independent-tabs.png') });
  });

  test('另存三种编码实际替换目标，原生选择取消保留已有文件和编辑标签', async ({}, testInfo) => {
    // 新建 Monaco 模型采用平台默认换行；另存必须保留编辑器正文，文件读取用例另行精确验证 LF。
    const editorSource = process.platform === 'win32' ? source.replaceAll('\n', '\r\n') : source;
    await openOfflineQuery(); await writeEditor(editorSource);
    const [original] = await storedTabs(1);
    const directory = join(dataDir, 'saved-query-files'); await mkdir(directory);
    for (const encoding of ['utf8', 'utf16le', 'gb18030'] as const) {
      const target = join(directory, `${encoding}.sql`); await writeFile(target, '旧文件内容不得追加');
      await chooseNativeFile('save', target);
      const modal = await fileDialog('save', encoding);
      await modal.getByRole('button', { name: '选择并保存 SQL 文件', exact: true }).click();
      await expect(modal).toBeHidden();
      const expected = encoding === 'utf16le' ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(editorSource, 'utf16le')]) : iconv.encode(editorSource, encoding);
      expect(await readFile(target)).toEqual(expected);
      expect((await storedTabs(1))[0]).toEqual(original);
      const selected = await authorizeFile(target, 'query');
      expect(await page.evaluate(input => window.dbark.invoke('files.readQuery', input), { fileToken: selected.token, encoding })).toEqual({ sql: editorSource, encoding });
    }
    const callsBeforeCancel = await desktop.evaluate(() => globalThis.__dbarkQueryFileCalls.length);
    await chooseNativeFile('save');
    const cancelled = await fileDialog('save', 'utf8');
    await cancelled.getByRole('button', { name: '选择并保存 SQL 文件', exact: true }).click();
    await expect(cancelled).toBeVisible();
    await expect.poll(() => desktop.evaluate(() => globalThis.__dbarkQueryFileCalls.length)).toBe(callsBeforeCancel + 1);
    expect(await readFile(join(directory, 'utf8.sql'), 'utf8')).toBe(editorSource);
    await cancelled.getByRole('button', { name: '取消', exact: true }).click();
    expect((await readdir(directory)).sort()).toEqual(['gb18030.sql', 'utf16le.sql', 'utf8.sql']);
    const calls = await desktop.evaluate(() => globalThis.__dbarkQueryFileCalls.filter(call => call.mode === 'save'));
    // 覆盖提示由操作系统的原生 SaveDialog 负责；路径 stub 只能证明选项和实际替换，不声称验证系统提示交互。
    expect(calls).toHaveLength(4);
    expect(calls.every(call => call.filters?.[0]?.extensions.includes('sql'))).toBe(true);
    await expectNoSqlExecution();
    await page.screenshot({ path: testInfo.outputPath('query-file-saved.png') });
  });

  test('错误编码、UTF16BE、NUL 和超限文件被拒绝，修正编码后只新开一个查询', async () => {
    await openOfflineQuery(); await writeEditor("SELECT '保持原文' AS original_query;");
    const [original] = await storedTabs(1);
    const directory = join(dataDir, 'invalid-query-files'); await mkdir(directory);
    const encoded = join(directory, '国标.sql'); await writeFile(encoded, iconv.encode(source, 'gb18030'));
    const big = join(directory, '超限.sql'); const handle = await open(big, 'w');
    try { await handle.truncate(20 * 1024 * 1024 + 1); } finally { await handle.close(); }
    const be = join(directory, '大端.sql'); await writeFile(be, Buffer.from([0xfe, 0xff, 0, 0x53]));
    const nul = join(directory, '非文本.sql'); await writeFile(nul, Buffer.from('SELECT\0 1;'));
    for (const example of [{ file: encoded, error: /无效编码/ }, { file: be, error: /UTF-16BE/ }, { file: nul, error: /NUL/ }, { file: big, error: /20 MiB/ }]) {
      await chooseNativeFile('open', example.file);
      const modal = await fileDialog('open', 'utf8');
      await modal.getByRole('button', { name: '选择并打开 SQL 文件', exact: true }).click();
      await expect(modal.locator('.error-box')).toContainText(example.error);
      await expect(page.locator('.workspace-tab-button')).toHaveCount(1);
      expect((await storedTabs(1))[0]).toEqual(original);
      await modal.getByRole('button', { name: '取消', exact: true }).click();
    }
    await chooseNativeFile('open', encoded);
    const recovered = await fileDialog('open', 'gb18030');
    await recovered.getByRole('button', { name: '选择并打开 SQL 文件', exact: true }).click();
    await expect(recovered).toBeHidden();
    const tabs = await storedTabs(2); expect(tabs[0]).toEqual(original); expect(tabs[1].sql).toBe(source);
    await expectNoSqlExecution();
  });

  test('IPC 拒绝失效与错用途令牌，保存失败保留原目标并清理临时文件', async () => {
    const directory = join(dataDir, 'query-file-token-checks'); await mkdir(directory);
    const target = join(directory, '保留原文件.sql'); await writeFile(target, '必须保留的原内容');
    expect(await fileError('read', 'unknown-token')).toContain('未授权');
    expect(await fileError('write', 'unknown-token')).toContain('未授权');
    const query = await authorizeFile(target, 'query');
    expect(await fileError('write', query.token)).toContain('未授权');
    const imported = await authorizeFile(target, 'import');
    expect(await fileError('read', imported.token)).toContain('未授权');
    const exported = await authorizeFile(target, 'export');
    expect(await fileError('read', exported.token)).toContain('未授权');
    const csv = await authorizeFile(target, 'export', 'csv');
    expect(await fileError('write', csv.token)).toContain('未授权');
    // 非法 Unicode 在写文件前拒绝，已有普通文件的每个字节都须保持原样。
    expect(await fileError('write', exported.token, "SELECT '\ud800';")).toMatch(/无法无损/);
    expect(await readFile(target, 'utf8')).toBe('必须保留的原内容');
    const blocked = join(directory, '不能替换的目录.sql'); await mkdir(blocked);
    const sentinel = join(blocked, '保留.txt'); await writeFile(sentinel, '保留目录内原内容');
    const invalidDestination = await authorizeFile(blocked, 'export');
    expect(await fileError('write', invalidDestination.token)).toMatch(/EISDIR|EPERM|EACCES|ENOTEMPTY/);
    expect(await readFile(sentinel, 'utf8')).toBe('保留目录内原内容');
    expect((await readdir(directory)).sort()).toEqual([basename(target), basename(blocked)].sort());
    const beforeRestart = query.token;
    await quitDesktop(); await launchDesktop();
    expect(await fileError('read', beforeRestart)).toContain('未授权');
    expect(await readFile(target, 'utf8')).toBe('必须保留的原内容');
    await expectNoSqlExecution();
  });
});
