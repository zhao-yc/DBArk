import { mkdir, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import iconv from 'iconv-lite';
import type { FileChoice, TaskRecord } from '../../src/shared/contracts';
import { queryFileSourceRefSchema } from '../../src/shared/queryFileSources';
import { test, expect, desktop, page, dataDir, pageErrors, launchDesktop, quitDesktop } from './desktop-fixture';
import { beginQueryFileSaveObservation } from '../helpers/queryFileSaveObservation';

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
  // 只观察本次测试的原Page和应用；不在其它测试或迟到页面上补读诊断。
  const owner = { page, desktop, dataDir, info: test.info() };
  await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: '新建连接', exact: true })).click();
  const connection = page.getByRole('dialog', { name: '新建连接', exact: true });
  await connection.getByLabel('连接名称', { exact: true }).fill('SQL 文件离线验收');
  await connection.getByLabel('主机地址', { exact: true }).fill('127.0.0.1');
  await connection.getByLabel('端口', { exact: true }).fill('1');
  await connection.getByLabel('用户名', { exact: true }).fill('offline');
  const observation = await beginQueryFileSaveObservation(owner.page, connection, () => {
    if (page !== owner.page || desktop !== owner.desktop || dataDir !== owner.dataDir || test.info() !== owner.info || owner.page.isClosed()) throw Error('离线保存观察所属测试已失效');
  });
  try {
    await (await navigationMenuItem(connection, { name: '保存连接', exact: true })).click();
    await expect(connection).toBeHidden();
  } catch (original) {
    await observation.failure(original, (name, attachment) => owner.info.attach(name, attachment));
  } finally {
    await observation.detach();
  }
  await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: '新建查询', exact: true })).click();
  await (await navigationMenuItem(page.getByRole('dialog', { name: '新建查询', exact: true }), { name: '打开查询', exact: true })).click();
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
  await (await navigationMenuItem(page.locator('.query-tab:visible'), { name: title, exact: true })).click();
  const modal = page.getByRole('dialog', { name: title, exact: true });
  await modal.getByRole('combobox', { name: /^文件编码/ }).selectOption(encoding);
  return modal;
}

/** 等待真实配置保存再核对全部标签，避免把 400ms 防抖写入误认为内容丢失。 */
async function storedTabs(count: number) {
  await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('settings.get', {}))).tabs.length).toBe(count);
  return (await page.evaluate(() => window.dbark.invoke('settings.get', {}))).tabs;
}

/** 文件任务的类别、数量及终态必须准确匹配；其他任务和任何查询历史均不允许出现。 */
async function expectNoSqlExecution(expected: { kind: 'queryFileSources.open' | 'queryFileSources.saveAs'; status: TaskRecord['status'] }[] = []) {
  const state = await page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}) }));
  expect(state.tasks.map(({ kind, status }) => ({ kind, status })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual([...expected].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  expect(new Set(state.tasks.map(task => task.id)).size).toBe(expected.length);
  expect(state.tasks.every(task => task.finishedAt && task.status !== 'running')).toBe(true);
  expect(state.history).toEqual([]); expect(pageErrors).toEqual([]);
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
      await (await navigationMenuItem(modal, { name: '选择并打开 SQL 文件', exact: true })).click();
      await expect(modal).toBeHidden();
      await expect(page.locator('.workspace-tab-button')).toHaveCount(index + 2);
      const tabs = await storedTabs(index + 2);
      expect(tabs[0]).toEqual(original);
      expect(tabs.at(-1)).toMatchObject({ kind: 'query', connectionId: original.connectionId, sql: source });
      expect(tabs.at(-1)!.id).not.toBe(original.id);
      expect(tabs.at(-1)!.title).toBe(example.name);
      expect(queryFileSourceRefSchema.parse(tabs.at(-1)!.fileSourceBinding)).toEqual({ id: expect.any(String), revision: 1 });
      expect(tabs.at(-1)!.sourceBinding).toBeUndefined();
      expect(new Set(tabs.slice(1).map(tab => tab.fileSourceBinding!.id)).size).toBe(index + 1);
      await expect(page.locator('.query-tab:visible .monaco-editor .view-lines')).toContainText('中文文件往返');
      const token = await authorizeFile(file, 'query');
      expect(await page.evaluate(input => window.dbark.invoke('files.readQuery', input), { fileToken: token.token, encoding: example.requested })).toEqual({ sql: source, encoding: example.actual });
    }
    const beforeCancel = await storedTabs(4);
    await chooseNativeFile('open');
    const cancelled = await fileDialog('open', 'utf8');
    await (await navigationMenuItem(cancelled, { name: '选择并打开 SQL 文件', exact: true })).click();
    await expect(cancelled).toBeVisible();
    await expect(page.locator('.workspace-tab-button')).toHaveCount(4);
    expect(await storedTabs(4)).toEqual(beforeCancel);
    await (await navigationMenuItem(cancelled, { name: '取消', exact: true })).click();
    const calls = await desktop.evaluate(() => globalThis.__dbarkQueryFileCalls);
    expect(calls.every(call => call.mode === 'open' && call.filters?.[0]?.extensions.includes('sql'))).toBe(true);
    await expectNoSqlExecution([...Array.from({ length: 3 }, () => ({ kind: 'queryFileSources.open' as const, status: 'completed' as const })), { kind: 'queryFileSources.open', status: 'cancelled' }]);
    await page.screenshot({ path: testInfo.outputPath('query-file-independent-tabs.png') });
  });

  test('另存三种编码实际替换目标，原生选择取消保留已有文件和编辑标签', async ({}, testInfo) => {
    // 新建 Monaco 模型采用平台默认换行；另存必须保留编辑器正文，文件读取用例另行精确验证 LF。
    const editorSource = process.platform === 'win32' ? source.replaceAll('\n', '\r\n') : source;
    await openOfflineQuery(); await writeEditor(editorSource);
    const [original] = await storedTabs(1);
    const directory = join(dataDir, 'saved-query-files'); await mkdir(directory);
    let previousBinding = original.fileSourceBinding;
    for (const encoding of ['utf8', 'utf16le', 'gb18030'] as const) {
      const target = join(directory, `${encoding}.sql`); await writeFile(target, '旧文件内容不得追加');
      await chooseNativeFile('save', target);
      const modal = await fileDialog('save', encoding);
      // 正式另存支持独立选择BOM；明确保留原用例的UTF16LE带BOM字节要求。
      await modal.getByRole('combobox', { name: '字节顺序标记（BOM）', exact: true }).selectOption(encoding === 'utf16le' ? 'utf16le' : 'none');
      await (await navigationMenuItem(modal, { name: '选择并保存 SQL 文件', exact: true })).click();
      await expect(modal).toBeHidden();
      const expected = encoding === 'utf16le' ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(editorSource, 'utf16le')]) : iconv.encode(editorSource, encoding);
      expect(await readFile(target)).toEqual(expected);
      const [saved] = await storedTabs(1), binding = queryFileSourceRefSchema.parse(saved.fileSourceBinding);
      expect(saved).toEqual({ ...original, title: `${encoding}.sql`, fileSourceBinding: binding });
      expect(binding).toEqual({ id: previousBinding?.id ?? expect.any(String), revision: (previousBinding?.revision ?? 0) + 1 });
      previousBinding = binding;
      const status = await page.evaluate(input => window.dbark.invoke('queryFileSources.status', input), { tabId: saved.id, source: binding });
      expect(status).toMatchObject({ state: 'bound', binding: { ref: binding, name: `${encoding}.sql`, encoding, bom: encoding === 'utf16le' ? 'utf16le' : 'none' } });
      const selected = await authorizeFile(target, 'query');
      expect(await page.evaluate(input => window.dbark.invoke('files.readQuery', input), { fileToken: selected.token, encoding })).toEqual({ sql: editorSource, encoding });
    }
    const callsBeforeCancel = await desktop.evaluate(() => globalThis.__dbarkQueryFileCalls.length);
    const beforeCancel = await storedTabs(1);
    await chooseNativeFile('save');
    const cancelled = await fileDialog('save', 'utf8');
    await (await navigationMenuItem(cancelled, { name: '选择并保存 SQL 文件', exact: true })).click();
    await expect(cancelled).toBeVisible();
    await expect.poll(() => desktop.evaluate(() => globalThis.__dbarkQueryFileCalls.length)).toBe(callsBeforeCancel + 1);
    expect(await readFile(join(directory, 'utf8.sql'), 'utf8')).toBe(editorSource);
    await (await navigationMenuItem(cancelled, { name: '取消', exact: true })).click();
    expect(await storedTabs(1)).toEqual(beforeCancel);
    expect((await readdir(directory)).sort()).toEqual(['gb18030.sql', 'utf16le.sql', 'utf8.sql']);
    const calls = await desktop.evaluate(() => globalThis.__dbarkQueryFileCalls.filter(call => call.mode === 'save'));
    // 覆盖提示由操作系统的原生 SaveDialog 负责；路径 stub 只能证明选项和实际替换，不声称验证系统提示交互。
    expect(calls).toHaveLength(4);
    expect(calls.every(call => call.filters?.[0]?.extensions.includes('sql'))).toBe(true);
    await expectNoSqlExecution([...Array.from({ length: 3 }, () => ({ kind: 'queryFileSources.saveAs' as const, status: 'completed' as const })), { kind: 'queryFileSources.saveAs', status: 'cancelled' }]);
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
    // 来源读取器固定编码失败消息，超限在读取正文前单独拒绝；不接受任意错误或旧窗口。
    const encodingError = '文件编码无法无损读取或内容不适合SQL编辑';
    for (const example of [{ file: encoded, error: encodingError }, { file: be, error: encodingError }, { file: nul, error: encodingError }, { file: big, error: 'SQL文件超过20MiB，未读写文件正文' }]) {
      await chooseNativeFile('open', example.file);
      const modal = await fileDialog('open', 'utf8');
      await (await navigationMenuItem(modal, { name: '选择并打开 SQL 文件', exact: true })).click();
      const recovery = page.getByRole('dialog', { name: '文件保存需要处理', exact: true });
      await expect(modal).toBeHidden();
      await expect(recovery.locator('.error-box')).toHaveText(example.error);
      await expect(recovery.getByText('本次未写入文件。', { exact: true })).toBeVisible();
      await expect((await navigationMenuItem(recovery, { name: '重新选择 SQL 文件', exact: true }))).toBeEnabled();
      await expect(page.locator('.workspace-tab-button')).toHaveCount(1);
      expect((await storedTabs(1))[0]).toEqual(original);
      await (await navigationMenuItem(recovery, { name: '取消', exact: true })).click();
      await expect(recovery).toBeHidden();
    }
    await chooseNativeFile('open', encoded);
    const recovered = await fileDialog('open', 'gb18030');
    await (await navigationMenuItem(recovered, { name: '选择并打开 SQL 文件', exact: true })).click();
    await expect(recovered).toBeHidden();
    const tabs = await storedTabs(2); expect(tabs[0]).toEqual(original); expect(tabs[1].sql).toBe(source);
    expect(tabs[1].id).not.toBe(original.id); expect(tabs[1].title).toBe('国标.sql');
    expect(queryFileSourceRefSchema.parse(tabs[1].fileSourceBinding)).toEqual({ id: expect.any(String), revision: 1 });
    expect(tabs[1].sourceBinding).toBeUndefined();
    await expectNoSqlExecution([...Array.from({ length: 4 }, () => ({ kind: 'queryFileSources.open' as const, status: 'failed' as const })), { kind: 'queryFileSources.open', status: 'completed' }]);
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

/** 原门进入具体动作后才加载真实菜单导航，不改变默认/列表阶段的资源边界。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args); }
