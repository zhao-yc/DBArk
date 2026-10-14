import { mkdir, open, readFile, readdir, rmdir, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { ConnectionProfile, FileChoice } from '../../src/shared/contracts';
import type { ConnectionImportApply, ConnectionTransferDocument, ExportedConnectionProfile } from '../../src/shared/connectionTransfer';
import { test as desktopTest, expect, desktop, page, dataDir, pageErrors, closed, launchDesktop, quitDesktop } from './desktop-fixture';
import { enabled as liveEnabled, environment } from './live-helpers';

interface Traffic { port: number; connections: number; }
interface NativeChoiceCall { mode: 'open' | 'save'; filters?: { name: string; extensions: string[] }[]; }
declare global { var __dbarkConnectionChoices: NativeChoiceCall[]; }
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const stagedLabel = '我确认仅暂存概要，稍后补充密码并重新选择本机私钥/证书文件';
const dummySecrets = ['仅验收数据库密码-C03', '仅验收SSH密码-C03', '仅验收私钥口令-C03'];

/** 真实端口只统计进入的连接并立即关闭，不模拟 MySQL、worker 或 IPC。 */
const test = desktopTest.extend<{ traffic: Traffic }>({
  traffic: async ({}, use) => {
    const traffic: Traffic = { port: 0, connections: 0 };
    const server = createServer(socket => { traffic.connections++; socket.destroy(); });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    traffic.port = (server.address() as AddressInfo).port;
    try { await use(traffic); }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  },
});
// 同文件含显式启用的实库凭据输入；Playwright 要求 trace 在文件级配置，禁止记录秘密参数。
test.use({ trace: 'off' });
/** 失败时在夹具关闭窗口前保存实际画面，凭据字段仍为密码框且测试轨迹关闭。 */
test.afterEach(async ({}, testInfo) => { if (!closed && testInfo.status !== testInfo.expectedStatus) await page.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => undefined); });

/** 生成本地虚构目标；端口由当前用例独占监听，不访问用户已有数据库。 */
function profile(port: number, name = '概要源连接'): ConnectionProfile {
  return { id: '', name, group: '概要验收', color: '#52c5a2', dialect: 'mysql', host: '127.0.0.1', port, user: 'overview_user', database: 'overview_database', rememberPassword: false };
}
/** 独立构造交换白名单期望，避免调用生产导出 helper 掩盖同源缺陷。 */
function exported(port: number, id = 'source-1', name = '来源连接'): ExportedConnectionProfile {
  return { id, name, group: '导入验收', color: '#52c5a2', dialect: 'mysql', host: '127.0.0.1', port, user: 'import_user', database: 'target_db' };
}
/** 文件都是本用例 userData 内虚构数据，由共享夹具核对目录边界并精确清理。 */
async function writeDocument(name: string, connections: ExportedConnectionProfile[]) {
  const file = join(dataDir, name);
  const document: ConnectionTransferDocument = { format: 'DBArk-connections', version: 1, connections };
  await writeFile(file, JSON.stringify(document), 'utf8'); return file;
}
/** 只有操作系统文件选择回答被替换；真实主进程仍创建授权令牌并读写文件。 */
async function chooseNative(mode: 'open' | 'save', file?: string) {
  await desktop.evaluate(({ dialog }, choice) => {
    globalThis.__dbarkConnectionChoices ??= [];
    if (choice.mode === 'open') dialog.showOpenDialog = (async (...args: unknown[]) => {
      const options = args.at(-1) as Electron.OpenDialogOptions;
      globalThis.__dbarkConnectionChoices.push({ mode: 'open', filters: options.filters });
      return { canceled: choice.file === undefined, filePaths: choice.file === undefined ? [] : [choice.file] };
    }) as typeof dialog.showOpenDialog;
    else dialog.showSaveDialog = (async (...args: unknown[]) => {
      const options = args.at(-1) as Electron.SaveDialogOptions;
      globalThis.__dbarkConnectionChoices.push({ mode: 'save', filters: options.filters });
      return { canceled: choice.file === undefined, filePath: choice.file };
    }) as typeof dialog.showSaveDialog;
  }, { mode, file });
}
/** 种子经真实存储 IPC 建立；刷新页面只让侧栏读取种子，不展开或连接目标。 */
async function seed(input: ConnectionProfile) { return page.evaluate(value => window.dbark.invoke('connections.save', value), input); }
async function list() { return page.evaluate(() => window.dbark.invoke('connections.list', {})); }
async function reloadWorkspace() { await page.reload(); await expect(page.locator('.app-statusbar')).toBeVisible(); }
/** UI 模式和文件选择保持用户实际顺序；不绕过预览直接发路径给业务接口。 */
async function transfer(mode: 'export' | 'import') {
  await page.getByRole('button', { name: '连接导入导出', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '连接概要导入导出', exact: true });
  await modal.getByRole('button', { name: mode === 'export' ? '导出连接概要' : '导入连接概要', exact: true }).click();
  return modal;
}
async function previewUi(file: string) {
  await chooseNative('open', file); const modal = await transfer('import');
  await modal.getByRole('button', { name: /^选择概要导入文件/ }).click(); return modal;
}
/** 负例也通过真实原生选择获取令牌；不同用途令牌不能直接互换。 */
async function authorize(file: string, purpose: 'connection-import' | 'connection-export' | 'query'): Promise<FileChoice> {
  await chooseNative(purpose === 'connection-export' ? 'save' : 'open', file);
  const choice = await page.evaluate(input => window.dbark.invoke('files.choose', input), { purpose, format: purpose === 'query' ? 'sql' : 'json' });
  expect(choice).not.toBeNull(); return choice!;
}
async function previewIpc(file: string) { const choice = await authorize(file, 'connection-import'); return page.evaluate(fileToken => window.dbark.invoke('connections.importPreview', { fileToken }), choice.token); }
async function apply(input: ConnectionImportApply) { return page.evaluate(value => window.dbark.invoke('connections.importApply', value), input); }
/** 无网络证据与真实任务、历史一起核对；只对本例已配置的监听目标作零连接结论。 */
async function expectOffline(traffic: Traffic) {
  expect(await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual([]);
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(traffic.connections).toBe(0); expect(pageErrors).toEqual([]);
}
/** 秘密存在标记即使为 false 也不能被导出；副本公开概要允许明确的 false。 */
function expectNoInheritedSecrets(value: ConnectionProfile) {
  expect(value.rememberPassword).toBe(false); expect(value.password).toBeUndefined(); expect(value.hasPassword).not.toBe(true);
  expect(value.ssh?.password).toBeUndefined(); expect(value.ssh?.passphrase).toBeUndefined();
  expect(value.ssh?.hasPassword).not.toBe(true); expect(value.ssh?.hasPassphrase).not.toBe(true);
  expect(value.ssh?.privateKeyPath).toBeUndefined(); expect(value.tls?.caPath).toBeUndefined(); expect(value.tls?.certPath).toBeUndefined(); expect(value.tls?.keyPath).toBeUndefined();
}

test.describe('离线连接概要复制与迁移', () => {
  test('UI 复制产生新 ID，不复制秘密、认证文件或表偏好且重启保持源连接', async ({ traffic }, testInfo) => {
    const platform = await page.evaluate(() => window.dbark.invoke('app.info', {}));
    await writeFile(testInfo.outputPath('credential-storage-branch.json'), JSON.stringify({ version: platform.version, platform: platform.platform, encryptionAvailable: platform.encryptionAvailable }, null, 2));
    const original = await seed({ ...profile(traffic.port), password: dummySecrets[0], rememberPassword: true,
      ssh: { enabled: false, host: '127.0.0.1', port: traffic.port, user: 'ssh_user', password: dummySecrets[1], passphrase: dummySecrets[2], privateKeyPath: join(dataDir, '源私钥.key'), hostFingerprint: 'SHA256:dummy-c03' },
      tls: { enabled: false, rejectUnauthorized: true, caPath: join(dataDir, '源CA.pem'), certPath: join(dataDir, '源证书.pem'), keyPath: join(dataDir, '源证书.key') } });
    expect(original.hasPassword).toBe(true); expect(original.ssh?.hasPassword).toBe(true); expect(original.ssh?.hasPassphrase).toBe(true);
    const target = { connectionId: original.id, database: 'overview_database', table: '同名表' };
    const preferences = { version: 1 as const, columns: [{ name: '__proto__', hidden: true, width: 222 }] };
    await page.evaluate(input => window.dbark.invoke('table.preferences.save', input), { ...target, preferences });
    await reloadWorkspace();
    const row = page.locator('.connection-row').filter({ hasText: original.name }); await row.hover();
    await row.getByRole('button', { name: `复制连接概要 ${original.name}`, exact: true }).click();
    const modal = page.getByRole('dialog', { name: '新建连接', exact: true });
    await expect(modal.getByLabel('连接名称', { exact: true })).toHaveValue(`${original.name} 副本`);
    await expect(modal.getByLabel('数据库密码', { exact: true })).toHaveValue('');
    await expect(modal).toContainText('未复制密码');
    await modal.getByRole('checkbox', { name: stagedLabel, exact: true }).check();
    await modal.getByRole('button', { name: '保存连接', exact: true }).click(); await expect(modal).toBeHidden();
    const all = await list(); expect(all).toHaveLength(2);
    const copy = all.find(item => item.id !== original.id)!; expect(copy.name).toBe(`${original.name} 副本`); expectNoInheritedSecrets(copy);
    expect(copy.pendingFiles?.slice().sort()).toEqual(['sshPrivateKey', 'tlsCa', 'tlsCert', 'tlsKey'].sort());
    expect(all.find(item => item.id === original.id)).toEqual(original);
    expect(await page.evaluate(input => window.dbark.invoke('table.preferences.get', input), { ...target, connectionId: copy.id })).toBeNull();
    expect(await page.evaluate(input => window.dbark.invoke('table.preferences.get', input), target)).toEqual(preferences);
    await page.screenshot({ path: testInfo.outputPath('connection-copy-distinct.png') });
    await quitDesktop(); await launchDesktop();
    const restarted = await list(); expectNoInheritedSecrets(restarted.find(item => item.id === copy.id)!);
    expect(restarted.find(item => item.id === original.id)).toMatchObject({ id: original.id, name: original.name, host: original.host, port: original.port });
    const restartedSource = restarted.find(item => item.id === original.id)!;
    expect(restartedSource.hasPassword).toBe(platform.encryptionAvailable); expect(restartedSource.ssh?.hasPassword).toBe(platform.encryptionAvailable); expect(restartedSource.ssh?.hasPassphrase).toBe(platform.encryptionAvailable);
    await expectOffline(traffic);
  });

  test('UI 导出实际 JSON 白名单且取消保留文件，错用途令牌不能绕过授权', async ({ traffic }, testInfo) => {
    const privateKeyPath = join(dataDir, '绝不导出目录', 'client.key');
    const original = await seed({ ...profile(traffic.port), rememberPassword: true, password: dummySecrets[0],
      ssh: { enabled: false, host: '127.0.0.1', port: traffic.port, user: 'ssh_user', password: dummySecrets[1], passphrase: dummySecrets[2], privateKeyPath, hostFingerprint: 'SHA256:dummy-c03' },
      tls: { enabled: false, rejectUnauthorized: true, caPath: join(dataDir, '绝不导出目录', 'ca.pem') } });
    await reloadWorkspace(); const file = join(dataDir, '概要.json'); await writeFile(file, '旧文件必须完整保留');
    await chooseNative('save'); let modal = await transfer('export');
    await modal.getByRole('button', { name: /^选择概要导出文件/ }).click();
    await expect(modal.getByRole('button', { name: '确认导出连接概要', exact: true })).toBeDisabled();
    expect(await readFile(file, 'utf8')).toBe('旧文件必须完整保留');
    await chooseNative('save', file); await modal.getByRole('button', { name: /^选择概要导出文件/ }).click();
    await modal.getByRole('button', { name: '确认导出连接概要', exact: true }).dblclick();
    await expect(modal.locator('.success-box')).toHaveText('连接概要已导出');
    const bytes = await readFile(file, 'utf8');
    expect(JSON.parse(bytes)).toEqual({ format: 'DBArk-connections', version: 1, connections: [{ id: original.id, name: original.name, group: original.group, color: original.color, dialect: original.dialect,
      host: original.host, port: original.port, user: original.user, database: original.database,
      ssh: { enabled: false, host: '127.0.0.1', port: traffic.port, user: 'ssh_user', hostFingerprint: 'SHA256:dummy-c03', privateKeyFileName: 'client.key' },
      tls: { enabled: false, rejectUnauthorized: true, caFileName: 'ca.pem' } }] });
    for (const forbidden of [...dummySecrets, dataDir, 'hasPassword', 'hasPassphrase', 'rememberPassword', 'privateKeyPath', 'caPath']) expect(bytes).not.toContain(forbidden);
    await page.screenshot({ path: testInfo.outputPath('connection-export-whitelist.png') });
    await modal.getByRole('button', { name: '关闭', exact: true }).click();
    const wrong = await authorize(file, 'query');
    await expect(page.evaluate(fileToken => window.dbark.invoke('connections.importPreview', { fileToken }), wrong.token)).rejects.toThrow(/未授权|用途/);
    await expect(page.evaluate(input => window.dbark.invoke('connections.export', input), { connectionIds: [original.id], fileToken: wrong.token })).rejects.toThrow(/未授权|用途/);
    expect(await readFile(file, 'utf8')).toBe(bytes);
    expect((await readdir(dataDir)).filter(name => name.includes('.partial'))).toEqual([]);
    const calls = await desktop.evaluate(() => globalThis.__dbarkConnectionChoices.filter(call => call.mode === 'save'));
    expect(calls).toHaveLength(2); expect(calls.every(call => call.filters?.some(filter => filter.extensions.includes('json')))).toBe(true);
    await expectOffline(traffic);
  });

  test('重复候选明确新增或跳过，原文件改动不替换预览快照且双击仅新增一批', async ({ traffic }, testInfo) => {
    const existing = await seed({ ...profile(traffic.port, '已存在连接'), user: 'import_user', database: 'target_db' }); await reloadWorkspace();
    const originalPreferenceTarget = { connectionId: existing.id, database: 'target_db', table: '同名表' };
    const preferences = { version: 1 as const, columns: [{ name: '__proto__', hidden: true, width: 123 }] };
    await page.evaluate(input => window.dbark.invoke('table.preferences.save', input), { ...originalPreferenceTarget, preferences });
    const first = exported(traffic.port, existing.id, existing.name), second = exported(traffic.port, 'source-2', '同目标另一来源');
    const file = await writeDocument('重复来源.json', [first, second]);
    const modal = await previewUi(file);
    await expect(modal.getByRole('region', { name: '来源连接概要 1', exact: true })).toContainText('来源 ID 相同');
    await expect(modal.getByRole('combobox', { name: '导入处理 1', exact: true })).toHaveValue('skip');
    await expect(modal.getByRole('combobox', { name: '导入处理 2', exact: true })).toHaveValue('skip');
    await modal.getByRole('combobox', { name: '导入处理 1', exact: true }).selectOption('add');
    await modal.getByRole('checkbox', { name: stagedLabel, exact: true }).check();
    // 预览就是已核对的不可变快照；确认时不得偷偷重新读取被替换的源文件。
    await writeFile(file, JSON.stringify({ format: 'DBArk-connections', version: 1, connections: [exported(traffic.port, 'changed-after-preview', '不应被导入的迟到文件')] }));
    await page.keyboard.press(`${modifier}+Enter`); expect(await list()).toEqual([existing]); await expectOffline(traffic);
    await page.screenshot({ path: testInfo.outputPath('connection-import-duplicate-preview.png') });
    await modal.getByRole('button', { name: '确认批次新增连接', exact: true }).dblclick();
    await expect(modal.locator('.success-box')).toContainText('新增 1，跳过 1');
    const all = await list(); expect(all).toHaveLength(2); expect(all.find(item => item.id === existing.id)).toEqual(existing);
    await expect(page.locator('.connection-row')).toHaveCount(2);
    const added = all.find(item => item.id !== existing.id)!; expect(added).toMatchObject({ name: first.name, host: first.host, port: first.port }); expectNoInheritedSecrets(added);
    expect(added.id).not.toBe(second.id); expect(all.some(item => item.name.includes('迟到文件'))).toBe(false);
    expect(await page.evaluate(input => window.dbark.invoke('table.preferences.get', input), { ...originalPreferenceTarget, connectionId: added.id })).toBeNull();
    expect(await page.evaluate(input => window.dbark.invoke('table.preferences.get', input), originalPreferenceTarget)).toEqual(preferences);
    await modal.getByRole('button', { name: '关闭', exact: true }).click();
    await quitDesktop(); await launchDesktop(); expect(await list()).toEqual(all);
    // 全跳过也必须回传完整公开列表，不能让前端用空新增列表清空原侧栏。
    const skipFile = await writeDocument('全部跳过.json', [first, second]), skipModal = await previewUi(skipFile);
    for (const index of [1, 2]) await expect(skipModal.getByRole('combobox', { name: `导入处理 ${index}`, exact: true })).toHaveValue('skip');
    await skipModal.getByRole('checkbox', { name: stagedLabel, exact: true }).check();
    await skipModal.getByRole('button', { name: '确认批次新增连接', exact: true }).click();
    await expect(skipModal.locator('.success-box')).toContainText('新增 0，跳过 2'); await expect(page.locator('.connection-row')).toHaveCount(2);
    expect(await list()).toEqual(all); await skipModal.getByRole('button', { name: '关闭', exact: true }).click(); await expectOffline(traffic);
  });

  test('非法版本、秘密字段、绝对路径、重复 ID 和数量体积超限在预览拒绝且不落配置', async ({ traffic }) => {
    const existing = await seed(profile(traffic.port)); await reloadWorkspace();
    const valid = { format: 'DBArk-connections', version: 1, connections: [exported(traffic.port)] };
    const invalid: unknown[] = [
      { ...valid, version: 99 }, { ...valid, extra: true },
      { ...valid, connections: [{ ...valid.connections[0], password: '禁止导入的秘密字段' }] },
      { ...valid, connections: [{ ...valid.connections[0], hasPassword: true }] },
      { ...valid, connections: [{ ...valid.connections[0], ssh: { enabled: true, host: '127.0.0.1', port: traffic.port, user: 'ssh_user', privateKeyFileName: join(dataDir, '禁止绝对路径.key') } }] },
      { ...valid, connections: [valid.connections[0], valid.connections[0]] },
      { ...valid, connections: Array.from({ length: 501 }, (_, index) => exported(traffic.port, `too-many-${index}`)) },
    ];
    for (const [index, document] of invalid.entries()) {
      const file = join(dataDir, `非法-${index}.json`); await writeFile(file, JSON.stringify(document)); const modal = await previewUi(file);
      await expect(modal.locator('.error-box')).toBeVisible(); await expect(modal.getByRole('button', { name: '确认批次新增连接', exact: true })).toBeDisabled();
      expect(await list()).toEqual([existing]); await modal.getByRole('button', { name: '关闭', exact: true }).click();
    }
    const huge = join(dataDir, '超限.json'), handle = await open(huge, 'w'); try { await handle.truncate(2 * 1024 * 1024 + 1); } finally { await handle.close(); }
    const modal = await previewUi(huge); await expect(modal.locator('.error-box')).toContainText(/2 MiB|2MiB|2 MB/);
    expect(await list()).toEqual([existing]); await modal.getByRole('button', { name: '关闭', exact: true }).click();
    const bytes = await readFile(join(dataDir, 'dbark.sqlite')); expect(bytes.includes(Buffer.from('禁止导入的秘密字段'))).toBe(false);
    await expectOffline(traffic);
  });

  test('连接修订使旧预览失效，实际写盘失败整批回滚且消费令牌不能在重启后偷偷提交', async ({ traffic }, testInfo) => {
    const original = await seed(profile(traffic.port)); await reloadWorkspace();
    const file = await writeDocument('原子批次.json', [exported(traffic.port, 'atomic-one', '整批第一条'), exported(traffic.port, 'atomic-two', '整批第二条')]);
    const modal = await previewUi(file);
    await expect(modal.getByRole('region', { name: '来源连接概要 2', exact: true })).toBeVisible();
    await modal.getByRole('checkbox', { name: stagedLabel, exact: true }).check();
    // 使用真实公开保存入口模拟预览期间另一操作修改配置，不能 mock 修订号或取消后台旧会话。
    const renamed = await seed({ ...original, name: '预览后真实修改的名称' });
    await modal.getByRole('button', { name: '确认批次新增连接', exact: true }).click();
    await expect(modal.locator('.error-box')).toContainText(/变更|变化|过期|失效/);
    expect(await list()).toEqual([renamed]);
    await page.screenshot({ path: testInfo.outputPath('connection-import-stale-preview.png') });
    await modal.getByRole('button', { name: '关闭', exact: true }).click();

    const preview = await previewIpc(file);
    const input: ConnectionImportApply = { previewToken: preview.previewToken, decisions: preview.entries.map(entry => ({ sourceId: entry.sourceId, action: 'add' })), allowIncomplete: true };
    // 在真实 SQLite 临时文件位置创建目录，触发真实文件系统失败；不拦截 writeFile/rename 或存储方法。
    const blocker = join(dataDir, 'dbark.sqlite.tmp'); await mkdir(blocker);
    try {
      await expect(apply(input)).rejects.toThrow(/修改未保存/);
      expect(await list()).toEqual([renamed]);
    } finally { await rmdir(blocker); }
    // 这是明确的已消费 token 负例，不是对失败写入的自动重试。
    await expect(apply(input)).rejects.toThrow(/预览|令牌|失效|过期/);
    expect(await list()).toEqual([renamed]);
    await page.getByRole('button', { name: '切换主题', exact: true }).click();
    await quitDesktop(); await launchDesktop(); expect(await list()).toEqual([renamed]);
    const bytes = await readFile(join(dataDir, 'dbark.sqlite'));
    expect(bytes.includes(Buffer.from('整批第一条'))).toBe(false); expect(bytes.includes(Buffer.from('整批第二条'))).toBe(false);
    await expectOffline(traffic);
  });

  test('SSH 和 TLS 文件提示仅暂存，模式切换清预览且未重选文件不能降级连接', async ({ traffic }, testInfo) => {
    const protectedProfile: ExportedConnectionProfile = { ...exported(traffic.port, 'with-auth-files', '需要本机认证'),
      ssh: { enabled: true, host: '127.0.0.1', port: traffic.port, user: 'ssh_user', hostFingerprint: 'SHA256:dummy-c03', privateKeyFileName: '提示私钥.key' },
      tls: { enabled: true, rejectUnauthorized: true, caFileName: '提示CA.pem', certFileName: '提示证书.pem', keyFileName: '提示证书.key' } };
    const file = await writeDocument('需补文件.json', [protectedProfile]);
    const modal = await previewUi(file); await expect(modal.getByRole('region', { name: '来源连接概要 1', exact: true })).toContainText('提示CA.pem');
    await modal.getByRole('checkbox', { name: stagedLabel, exact: true }).check();
    await modal.getByRole('button', { name: '导出连接概要', exact: true }).click();
    await expect(modal.getByRole('region', { name: '来源连接概要 1', exact: true })).toHaveCount(0);
    await expect(modal.getByRole('button', { name: '确认导出连接概要', exact: true })).toBeDisabled();
    await modal.getByRole('button', { name: '导入连接概要', exact: true }).click();
    await expect(modal.getByRole('button', { name: '确认批次新增连接', exact: true })).toBeDisabled();
    await chooseNative('open'); await modal.getByRole('button', { name: '选择概要导入文件', exact: true }).click();
    expect(await list()).toEqual([]);
    await chooseNative('open', file); await modal.getByRole('button', { name: '选择概要导入文件', exact: true }).click();
    await modal.getByRole('checkbox', { name: stagedLabel, exact: true }).check();
    await modal.getByRole('button', { name: '确认批次新增连接', exact: true }).click();
    await expect(modal.locator('.success-box')).toContainText('新增 1，跳过 0'); await modal.getByRole('button', { name: '关闭', exact: true }).click();
    const [imported] = await list(); expectNoInheritedSecrets(imported);
    expect(imported.ssh).toMatchObject({ enabled: true, hostFingerprint: protectedProfile.ssh!.hostFingerprint });
    expect(imported.tls).toEqual({ enabled: true, rejectUnauthorized: true });
    expect(imported.pendingFiles?.slice().sort()).toEqual(['sshPrivateKey', 'tlsCa', 'tlsCert', 'tlsKey'].sort());
    await expect(page.evaluate(input => window.dbark.invoke('connections.test', input), imported)).rejects.toThrow(/重新选择本机/);
    await expect(page.evaluate(id => window.dbark.invoke('connections.open', { id }), imported.id)).rejects.toThrow(/重新选择本机/);
    await quitDesktop(); await launchDesktop();
    expect((await list())[0].pendingFiles).toEqual(imported.pendingFiles);
    const row = page.locator('.connection-row').filter({ has: page.getByRole('button', { name: imported.name, exact: true }) });
    /** 重启或关闭弹窗后通过实际 focus-within 入口显示操作区，不依赖前一窗口的鼠标悬停，也不点击主按钮发起连接。 */
    async function openImportedEditor() {
      await row.getByRole('button', { name: imported.name, exact: true }).focus();
      const edit = row.getByRole('button', { name: `编辑连接 ${imported.name}`, exact: true });
      await expect(edit).toBeVisible(); await edit.click();
      const dialog = page.getByRole('dialog', { name: '编辑连接', exact: true }); await expect(dialog).toBeVisible(); return dialog;
    }
    const editor = await openImportedEditor();
    await editor.getByRole('button', { name: 'SSH 隧道', exact: true }).click();
    await expect(editor.getByRole('checkbox', { name: '通过 SSH 隧道连接', exact: true })).toBeChecked();
    // 实际 Field 可访问名称含同一 label 内选择按钮的 aria-label，使用完整名称而非不存在的短标签。
    await expect(editor.getByRole('textbox', { name: '私钥文件 选择 SSH 私钥', exact: true })).toHaveValue('');
    // 手输路径不是新的本机选择授权，不能清除待补标记；只测试拒绝，不读取或生成真实私钥。
    await editor.getByRole('textbox', { name: '私钥文件 选择 SSH 私钥', exact: true }).fill(join(dataDir, '未经选择的私钥.key'));
    await editor.getByRole('button', { name: 'TLS / SSL', exact: true }).click();
    await expect(editor.getByRole('checkbox', { name: '启用加密连接', exact: true })).toBeChecked();
    await expect(editor.getByRole('checkbox', { name: '验证服务器证书', exact: true })).toBeChecked();
    await expect(editor.getByRole('textbox', { name: 'CA 证书 选择CA 证书', exact: true })).toHaveValue('');
    await editor.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect(editor.locator('.error-box')).toContainText(/重新选择本机/);
    await page.screenshot({ path: testInfo.outputPath('connection-import-auth-pending.png') });
    await editor.getByRole('button', { name: '取消', exact: true }).click(); expect(await list()).toEqual([imported]);

    // 文件只含虚构文本，用来核验选择授权和保存门槛，不冒充真实私钥或成功 TLS/SSH 认证。
    const selections = { ssh: join(dataDir, '本机选中.key'), ca: join(dataDir, '本机选中CA.pem'), cert: join(dataDir, '本机选中证书.pem'), key: join(dataDir, '本机选中TLS.key') };
    for (const file of Object.values(selections)) await writeFile(file, 'C03 虚构文件：只核验路径授权，不用于真实认证。');
    const reselected = await openImportedEditor();
    await reselected.getByRole('button', { name: 'SSH 隧道', exact: true }).click();
    await chooseNative('open', selections.ssh); await reselected.getByRole('button', { name: '选择 SSH 私钥', exact: true }).click();
    await expect(reselected.getByRole('textbox', { name: '私钥文件 选择 SSH 私钥', exact: true })).toHaveValue(selections.ssh);
    await reselected.getByRole('button', { name: 'TLS / SSL', exact: true }).click();
    for (const [label, file] of [['CA 证书', selections.ca], ['客户端证书', selections.cert], ['客户端私钥', selections.key]]) {
      await chooseNative('open', file); await reselected.getByRole('button', { name: `选择${label}`, exact: true }).click();
      await expect(reselected.getByRole('textbox', { name: `${label} 选择${label}`, exact: true })).toHaveValue(file);
    }
    // UI 已有真实本机授权，但持久化的旧标记尚未解除；先测试必须仍拒绝且没有任何网络连接。
    await reselected.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect(reselected.locator('.error-box')).toContainText(/重新选择本机|先保存/);
    expect(await list()).toEqual([imported]); expect(traffic.connections).toBe(0);
    await reselected.getByRole('button', { name: '保存连接', exact: true }).click(); await expect(reselected).toBeHidden();
    const [saved] = await list(); expect(saved.pendingFiles ?? []).toEqual([]);
    expect(saved.ssh).toMatchObject({ enabled: true, privateKeyPath: selections.ssh, hostFingerprint: protectedProfile.ssh!.hostFingerprint });
    expect(saved.tls).toEqual({ enabled: true, rejectUnauthorized: true, caPath: selections.ca, certPath: selections.cert, keyPath: selections.key });
    await quitDesktop(); await launchDesktop(); expect(await list()).toEqual([saved]);
    await expectOffline(traffic);
  });
});

/** 只读取系统库；真实会话和事务由 Electron 建立，验收期间不创建或修改任何服务器对象。 */
test.describe('连接迁移保持真实只读工作区', () => {
  test.skip(!liveEnabled, '需要显式启用已核对的 200 专用 MySQL 8.4；默认 CI 不访问私网');
  test('两个系统库标签保持目标、会话编号和打开的事务，复制及文件迁移不执行后台 SQL', async ({}, testInfo) => {
    if (environment.DBARK_TEST_HOST !== '192.168.31.200' || Number(environment.DBARK_TEST_PORT) !== 13384 || !environment.DBARK_TEST_USER) throw new Error('只允许已核对的 200 专用 MySQL 8.4:13384');
    const first = await seed({ ...profile(13384, '只读信息库'), host: environment.DBARK_TEST_HOST, user: environment.DBARK_TEST_USER, password: environment.DBARK_TEST_PASSWORD, database: 'information_schema' });
    const second = await seed({ ...profile(13384, '只读性能库'), host: environment.DBARK_TEST_HOST, user: environment.DBARK_TEST_USER, password: environment.DBARK_TEST_PASSWORD, database: 'performance_schema' });
    await reloadWorkspace();
    let probeSequence = 0;
    /** 输入经 Monaco 真实键盘且先核对已保存正文，结果必须等真实数字单元格绘制。 */
    async function executeProbe(database: string) {
      const sequence = ++probeSequence, probe = `SELECT CONNECTION_ID() AS session_id, DATABASE() AS target_database, ${sequence} AS probe_sequence;`;
      const query = page.locator('.query-tab:visible'); const input = query.locator('.monaco-editor').getByRole('textbox');
      await input.focus(); await page.keyboard.press(`${modifier}+A`); await page.keyboard.insertText(probe);
      await expect.poll(async () => { const settings = await page.evaluate(() => window.dbark.invoke('settings.get', {})); return settings.tabs.find(tab => tab.id === settings.activeTabId)?.sql; }).toBe(probe);
      const previousTasks = await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).map(task => task.id));
      await query.getByRole('button', { name: '执行全部', exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).filter(task => !previousTasks.includes(task.id)).map(task => task.status)).toEqual(['completed']);
      await expect(query.getByRole('button', { name: '停止', exact: true })).toBeDisabled({ timeout: 20000 }); await expect(query.locator('.error-box')).toHaveCount(0);
      // 单调探针值证明是这次 SELECT 的新行，不能把旧结果或重绘中的空节点当作会话证据。
      await expect(query.locator('.result-body [role="gridcell"][aria-colindex="4"]')).toHaveText(String(sequence));
      const session = query.locator('.result-body [role="gridcell"][aria-colindex="2"]'); await expect(session).toHaveText(/^\d+$/);
      await expect(query.locator('.result-body [role="gridcell"][aria-colindex="3"]')).toHaveText(database);
      await expect(query.getByRole('button', { name: '回滚', exact: true })).toBeEnabled(); return session.innerText();
    }
    const sessions: string[] = [];
    for (const connection of [first, second]) {
      await page.locator('.app-commandbar').getByRole('button', { name: '新建查询', exact: true }).click();
      const modal = page.getByRole('dialog', { name: '新建查询', exact: true });
      await modal.getByRole('combobox', { name: '数据库连接', exact: true }).selectOption(connection.id);
      // 带 datalist 的真实输入框具有 combobox 角色，仍可直接输入明确系统库名。
      await modal.getByRole('combobox', { name: '默认数据库（可选）', exact: true }).fill(connection.database!);
      await modal.getByRole('button', { name: '打开查询', exact: true }).click();
      const query = page.locator('.query-tab:visible'); await expect(query.locator('.monaco-editor')).toBeVisible();
      await query.getByRole('button', { name: '开始事务', exact: true }).click();
      await expect(query.getByRole('button', { name: '回滚', exact: true })).toBeEnabled({ timeout: 20000 });
      sessions.push(await executeProbe(connection.database!));
    }
    expect(sessions[0]).not.toBe(sessions[1]);
    await writeFile(testInfo.outputPath('connection-transfer-live-sessions.json'), JSON.stringify({ port: 13384, sessionIds: sessions.map(Number) }, null, 2));
    // 明确等待两个标签及其活动身份持久化，不能把上一标签的防抖快照当作本次基线。
    await expect.poll(async () => {
      const settings = await page.evaluate(() => window.dbark.invoke('settings.get', {}));
      return { connections: settings.tabs.map(tab => tab.connectionId), activeConnection: settings.tabs.find(tab => tab.id === settings.activeTabId)?.connectionId };
    }).toEqual({ connections: [first.id, second.id], activeConnection: second.id });
    const before = await page.evaluate(async () => ({ settings: await window.dbark.invoke('settings.get', {}), tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}) }));
    const row = page.locator('.connection-row').filter({ hasText: first.name }); await row.hover();
    await row.getByRole('button', { name: `复制连接概要 ${first.name}`, exact: true }).click();
    const copyDialog = page.getByRole('dialog', { name: '新建连接', exact: true });
    await copyDialog.getByRole('button', { name: '保存连接', exact: true }).click(); await expect(copyDialog).toBeHidden();
    const file = join(dataDir, '实际只读连接概要.json'); await chooseNative('save', file); const exporter = await transfer('export');
    await exporter.getByRole('button', { name: '选择概要导出文件', exact: true }).click();
    await page.keyboard.press(`${modifier}+Enter`); await page.keyboard.press(`${modifier}+S`);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await exporter.getByRole('button', { name: '确认导出连接概要', exact: true }).click();
    await expect(exporter.locator('.success-box')).toBeVisible(); await exporter.getByRole('button', { name: '关闭', exact: true }).click();
    const importer = await previewUi(file);
    await importer.getByRole('combobox', { name: '导入处理 1', exact: true }).selectOption('add');
    await importer.getByRole('checkbox', { name: stagedLabel, exact: true }).check();
    await importer.getByRole('button', { name: '确认批次新增连接', exact: true }).click();
    await expect(importer.locator('.success-box')).toContainText('新增 1，跳过 2'); await importer.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.locator('.connection-row')).toHaveCount(4);
    const after = await page.evaluate(async () => ({ settings: await window.dbark.invoke('settings.get', {}), tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}) }));
    expect(after.settings.tabs).toEqual(before.settings.tabs); expect(after.settings.activeTabId).toBe(before.settings.activeTabId);
    expect(after.tasks).toEqual(before.tasks); expect(after.history).toEqual(before.history);
    for (const [index, connection] of [first, second].entries()) {
      await page.locator('.workspace-tab-button').nth(index).getByRole('button').first().click();
      expect(await executeProbe(connection.database!)).toBe(sessions[index]);
      await page.locator('.query-tab:visible').getByRole('button', { name: '回滚', exact: true }).click();
      await expect(page.locator('.query-tab:visible').getByRole('button', { name: '回滚', exact: true })).toBeDisabled();
    }
    expect((await list()).filter(item => item.id === first.id || item.id === second.id)).toEqual([first, second]);
    expect(pageErrors).toEqual([]); await page.screenshot({ path: testInfo.outputPath('connection-transfer-live-sessions-retained.png') });
  });
});
