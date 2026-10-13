import { mkdir, readFile, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { version as sourceVersion } from '../../package.json';
import { test, expect, desktop, page, dataDir, closed, pageErrors, dialogCalls, launchDesktop, answerDialogs, requestQuit, quitDesktop } from './desktop-fixture';

test('桌面启动、存储、进程隔离与输入校验', async ({}, testInfo) => {
  await expect(page).toHaveTitle('DBArk');
  await page.screenshot({ path: testInfo.outputPath('desktop-welcome.png') });
  const status = await page.evaluate(async () => ({ info: await window.dbark.invoke('app.info', {}), hasNode: 'require' in window, settings: await window.dbark.invoke('settings.get', {}) }));
  expect(status.info.version).toBe(sourceVersion); expect(status.hasNode).toBe(false); expect(status.settings.theme).toBe('dark');
  const connection = await page.evaluate(() => window.dbark.invoke('connections.save', { id: '', name: '自动化测试连接', group: '测试', color: '#40bb99', dialect: 'mysql', host: '127.0.0.1', port: 1, user: 'nobody', password: 'temporary-test-password', rememberPassword: false }));
  expect(connection.hasPassword).toBe(true); expect(connection.password).toBeUndefined();
  const error = await page.evaluate(async () => { try { await window.dbark.invoke('query.execute', { sessionId: 'missing', taskId: 'test', sql: 'SELECT 1', maxRows: -1 }); } catch (e) { return (e as Error).message; } });
  expect(error).toContain('参数无效');
  // 此请求实际跨越 utility process；不存在的会话应得到清楚错误而非进程崩溃。
  const workerError = await page.evaluate(async () => { try { await window.dbark.invoke('query.execute', { sessionId: 'missing', taskId: 'worker-test', sql: 'SELECT 1', maxRows: 10 }); } catch (e) { return (e as Error).message; } });
  expect(workerError).toBeTruthy(); expect(workerError).not.toContain('进程已退出');
  const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); expect(tasks[0].status).toBe('failed');
  await page.reload(); await expect(page.locator('.app-statusbar')).toBeVisible();
  const restored = await page.evaluate(() => window.dbark.invoke('connections.list', {})); expect(restored[0].name).toBe('自动化测试连接');
  await page.screenshot({ path: testInfo.outputPath('desktop-workbench.png') });
  expect(pageErrors).toEqual([]);
});

test('渲染页面只能访问固定的隔离接口', async () => {
  const boundary = await page.evaluate(() => ({ keys: Object.keys(window.dbark).sort(), node: 'process' in window || 'require' in window, exposedIpc: 'ipcRenderer' in window }));
  expect(boundary.keys).toEqual(['invoke', 'onMenu', 'onTask']); expect(boundary.node).toBe(false); expect(boundary.exposedIpc).toBe(false);
  const renderers = await desktop.evaluate(({ app }) => app.getAppMetrics().filter(metric => metric.type === 'Tab'));
  expect(renderers.length).toBeGreaterThan(0);
  if (process.platform === 'win32' || process.platform === 'darwin') expect(renderers.every(metric => metric.sandboxed)).toBe(true);
});

test('待提交修改退出可取消，随后确认退出并释放进程', async () => {
  // 无真实数据库时通过同一受校验 IPC 设置标记，不伪造表格或事务已执行成功。
  await page.evaluate(() => window.dbark.invoke('app.setDirty', { dirty: true }));
  await answerDialogs([0, 1]);
  await requestQuit('window');
  await expect.poll(() => desktop.evaluate(() => globalThis.__dbarkE2EDialogs.calls.length)).toBe(1);
  expect(closed).toBe(false);
  await expect(page.locator('.app-statusbar')).toBeVisible();
  const first = await desktop.evaluate(() => globalThis.__dbarkE2EDialogs.calls[0]);
  expect(first.title).toBe('仍有待完成的工作'); expect(first.response).toBe(0);
  expect(first.message).toContain('回滚未提交事务');
  // 取消后仍可操作，第二次退出可再次进入状态机而非永久卡在 shuttingDown。
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await quitDesktop('window');
  expect(dialogCalls.map(call => call.response)).toEqual([0, 1]);
});

test('退出保存失败可返回工作台，修复磁盘后再次退出并恢复最新状态', async () => {
  const blockedFile = join(dataDir, 'dbark.sqlite.tmp');
  // 用同名目录制造真实文件写入失败，验证存储回滚和退出回退的完整路径。
  await mkdir(blockedFile);
  await answerDialogs([0]);
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await requestQuit();
  await expect.poll(() => desktop.evaluate(() => globalThis.__dbarkE2EDialogs.calls.length)).toBe(1);
  const failure = await desktop.evaluate(() => globalThis.__dbarkE2EDialogs.calls[0]);
  expect(failure.title).toBe('退出前保存失败'); expect(failure.message).toContain('本地数据保存失败');
  expect(closed).toBe(false); await expect(page.locator('.app-statusbar')).toBeVisible();
  expect(await page.evaluate(async () => (await window.dbark.invoke('settings.get', {})).theme)).toBe('dark');
  await rmdir(blockedFile);
  await answerDialogs([]);
  await quitDesktop();
  await launchDesktop();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('通过界面保存连接和查询，Monaco 可编辑，主题与最后输入重启恢复', async ({}, testInfo) => {
  await page.locator('.app-commandbar').getByRole('button', { name: '新建连接', exact: true }).click();
  const connectionDialog = page.getByRole('dialog', { name: '新建连接', exact: true });
  await connectionDialog.getByLabel('连接名称', { exact: true }).fill('离线工作区测试');
  await connectionDialog.getByLabel('端口', { exact: true }).fill('1');
  await connectionDialog.getByLabel('用户名', { exact: true }).fill('e2e');
  await connectionDialog.getByLabel('数据库密码', { exact: true }).fill('仅用于本例的临时密码');
  await connectionDialog.getByLabel('连接分组', { exact: true }).fill('自动化测试');
  await connectionDialog.getByLabel('安全保存密码').uncheck();
  await connectionDialog.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(connectionDialog).toBeHidden();
  await expect(page.locator('.sidebar')).toContainText('离线工作区测试');
  await page.locator('.app-commandbar').getByRole('button', { name: '新建查询', exact: true }).click();
  await page.getByRole('dialog', { name: '新建查询', exact: true }).getByRole('button', { name: '打开查询', exact: true }).click();
  const editor = page.locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  // Monaco 新版使用原生 EditContext；通过无障碍角色定位，兼容 textarea 与原生输入区。
  const input = editor.getByRole('textbox');
  await input.focus(); await page.keyboard.insertText('select 1 as e2e_value;');
  await page.getByTitle('格式化 SQL', { exact: true }).click();
  await expect(editor.locator('.view-lines')).toContainText('SELECT');
  await page.getByTitle('保存查询', { exact: true }).click();
  const queryDialog = page.getByRole('dialog', { name: '保存查询', exact: true });
  await queryDialog.getByLabel('查询名称', { exact: true }).fill('离线保存的 SQL');
  await queryDialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(queryDialog).toBeHidden();
  const saved = await page.evaluate(() => window.dbark.invoke('queries.list', {}));
  expect(saved[0].name).toBe('离线保存的 SQL'); expect(saved[0].sql).toContain('SELECT');
  // 不等待 400 ms 防抖保存，退出握手必须保存最后输入的 SQL 和主题。
  await input.focus(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText('SELECT 2 AS last_edit_before_quit;');
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await quitDesktop();
  await launchDesktop();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.sidebar')).toContainText('离线工作区测试');
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('last_edit_before_quit');
  const restored = await page.evaluate(async () => ({ settings: await window.dbark.invoke('settings.get', {}), connections: await window.dbark.invoke('connections.list', {}) }));
  expect(restored.settings.tabs[0].sql).toBe('SELECT 2 AS last_edit_before_quit;');
  expect(restored.connections[0].hasPassword).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('desktop-sql.png') });
  expect(pageErrors).toEqual([]);
});

test('保存失败时明确放弃配置可退出，重启仍保留上次成功保存的状态', async () => {
  const blockedFile = join(dataDir, 'dbark.sqlite.tmp');
  await mkdir(blockedFile);
  await answerDialogs([1]);
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await quitDesktop();
  expect(dialogCalls).toHaveLength(1);
  expect(dialogCalls[0].title).toBe('退出前保存失败');
  expect(dialogCalls[0].response).toBe(1);
  await rmdir(blockedFile);
  await launchDesktop();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('系统加密可用时密码密文落盘并可重启解密，否则只保留会话', async ({}, testInfo) => {
  const secret = 'DBArk-E2E-仅用于验证的凭据-43cf';
  const available = await page.evaluate(async () => (await window.dbark.invoke('app.info', {})).encryptionAvailable);
  testInfo.annotations.push({ type: '凭据保护', description: available ? '系统加密可用，验证真实密文及重启解密' : '系统加密不可用，只验证会话保存降级' });
  console.log(available ? '凭据保护：已进入真实系统加密验证分支' : '凭据保护：系统加密不可用，验证仅会话保存');
  const connection = await page.evaluate(password => window.dbark.invoke('connections.save', { id: '', name: '凭据重启验证', group: '测试', color: '#40bb99', dialect: 'mysql', host: '127.0.0.1', port: 1, user: 'nobody', password, rememberPassword: true }), secret);
  expect(connection.hasPassword).toBe(true); expect(connection.password).toBeUndefined();
  const bytes = await readFile(join(dataDir, 'dbark.sqlite'));
  expect(bytes.includes(Buffer.from(secret, 'utf8'))).toBe(false);
  expect(bytes.includes(Buffer.from(secret, 'utf16le'))).toBe(false);
  // 独立读取真实 SQLite 文件；不依靠渲染层 hasPassword 标志猜测已发生加密。
  const SQL = await initSqlJs({ locateFile: () => join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm') });
  const database = new SQL.Database(bytes);
  const stored = database.exec('SELECT value FROM secrets');
  const encrypted = stored[0]?.values.map(row => String(row[0])) ?? [];
  database.close();
  expect(encrypted).toHaveLength(available ? 1 : 0);
  await quitDesktop();
  await launchDesktop();
  const profiles = await page.evaluate(() => window.dbark.invoke('connections.list', {}));
  expect(profiles[0].hasPassword).toBe(available);
  if (available) {
    const decrypted = await desktop.evaluate(({ safeStorage }, ciphertext) => safeStorage.decryptString(Buffer.from(ciphertext, 'base64')), encrypted[0]);
    expect(decrypted).toBe(secret);
    // 请求经过主进程 resolveConnection、真实驱动和 utility process；本例不要求数据库服务。
    const connectionError = await page.evaluate(async profile => { try { await window.dbark.invoke('connections.test', profile); return ''; } catch (error) { return (error as Error).message; } }, profiles[0]);
    expect(connectionError).toMatch(/ECONNREFUSED|连接被拒绝/);
    expect(connectionError).not.toMatch(/无法解密|加密不可用/);
  }
});
