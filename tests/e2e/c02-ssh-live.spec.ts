import { discardTestTab } from './query-close-ui';
import { test, expect, type Locator } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { c02Failure, withC02UiLifetime } from '../integration/helpers/c02-mtls-policy';
import { c02SshEnabled, c02WrongSshFingerprint } from '../integration/helpers/c02-ssh-policy';
import type { C02SshLease } from '../integration/helpers/c02-ssh-fixture';
import { C02Desktop } from './c02-mtls-desktop';
import { c02Assert, editConnection, testConnection } from './c02-mtls-ui';

test.skip(!c02SshEnabled(process.env), '默认关闭：须 ROOT 显式注入 server-200 身份并取得独占 GUI 时段');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.setTimeout(300000);
const c02Require = createRequire(join(process.cwd(), 'package.json'));

/** 只给真实密码控件输入，不让 fill(口令) 的步骤标题或失败调用日志保留临时数据库密码。 */
async function databasePassword(form: Locator, password: string): Promise<void> {
  const accepted = await form.getByLabel('数据库密码', { exact: true }).evaluate((element, value) => {
    if (!(element instanceof HTMLInputElement) || element.type !== 'password' || element.disabled) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return element.value === value;
  }, password);
  c02Assert(accepted, 'C02 SSH 真实数据库密码控件未接收输入');
}

/** 仅回答本次文件选择，不读取身份内容；真实文件授权、路径解析和正式驱动保持原样。 */
async function choose(scope: C02Desktop, form: Locator, button: string, inputName: string, path: string): Promise<void> {
  await scope.app!.evaluate(({ dialog }, file) => {
    const root = globalThis as typeof globalThis & { __c02SshOpen?: typeof dialog.showOpenDialog };
    if (root.__c02SshOpen) throw new Error('C02 SSH 文件选择回答已占用'); root.__c02SshOpen = dialog.showOpenDialog;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
  }, path);
  const errors: unknown[] = [];
  try { await form.getByRole('button', { name: button, exact: true }).click(); await expect.poll(async () => (await form.getByRole('textbox', { name: inputName, exact: true }).inputValue()) === path).toBe(true); }
  catch (error) { errors.push(c02Failure('C02 SSH 正式文件选择失败', error)); }
  try { await scope.app!.evaluate(({ dialog }) => { const root = globalThis as typeof globalThis & { __c02SshOpen?: typeof dialog.showOpenDialog }; if (root.__c02SshOpen) dialog.showOpenDialog = root.__c02SshOpen; delete root.__c02SshOpen; }); }
  catch (error) { errors.push(c02Failure('C02 SSH 文件选择回答恢复失败', error)); }
  if (errors.length === 1) throw errors[0]; if (errors.length > 1) throw new AggregateError(errors, 'C02 SSH 文件选择及恢复均失败', { cause: errors[0] });
}

/** 只返回概要存在性/身份匹配布尔值及公开ID，不返回秘密或完整连接对象。 */
async function overview(scope: C02Desktop, lease: C02SshLease) {
  return scope.page.evaluate(async input => {
    const rows = (await window.dbark.invoke('connections.list', {})).filter(profile => profile.name === input.name), profile = rows[0], ssh = profile?.ssh;
    return { id: rows.length === 1 ? profile.id : '', publicOnly: rows.length === 1 && !Object.hasOwn(profile, 'password') && !!ssh && !Object.hasOwn(ssh, 'password') && !Object.hasOwn(ssh, 'passphrase'),
      hasPassword: profile?.hasPassword === true, noSshSecrets: ssh?.hasPassword !== true && ssh?.hasPassphrase !== true,
      correctSsh: ssh?.enabled === true && ssh.host === input.ssh.host && ssh.port === input.ssh.port && ssh.user === input.ssh.user && ssh.privateKeyPath === input.ssh.privateKeyPath && ssh.hostFingerprint === input.ssh.hostFingerprint };
  }, { name: `C02 SSH ${lease.database}`, ssh: lease.profile.ssh! });
}

/** 系统加密仅实读，不把 basic_text 或未知 Linux 后端当作可安全重启恢复。 */
async function secureStorage(scope: C02Desktop): Promise<boolean> {
  const info = await scope.page.evaluate(() => window.dbark.invoke('app.info', {}));
  const native = await scope.app!.evaluate(({ safeStorage }) => {
    const available = safeStorage.isEncryptionAvailable(), backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined;
    return { available, secure: available && (process.platform !== 'linux' || ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(backend ?? '')) };
  });
  c02Assert(info.dataPath === scope.directory && info.encryptionAvailable === native.available, 'C02 SSH 数据目录或原生加密能力不匹配'); return native.secure;
}

/** 实读本例SQLite，仅数据库密码允许密文槽；SSH密码/口令从未提供，也不读取原key作内容对照。 */
async function assertStorage(scope: C02Desktop, lease: C02SshLease, id: string): Promise<void> {
  const bytes = await readFile(join(scope.directory, 'dbark.sqlite')), SQL = await initSqlJs({ locateFile: () => c02Require.resolve('sql.js/dist/sql-wasm.wasm') }), db = new SQL.Database(bytes);
  let publicOnly = false; const slots: { name: string; value: string }[] = [];
  try {
    const profile = db.prepare('SELECT data FROM connections WHERE id=?');
    try { profile.bind([id]); if (profile.step()) { const raw = JSON.parse(String(profile.get()[0])); publicOnly = !Object.hasOwn(raw, 'password') && !Object.hasOwn(raw, 'hasPassword') && !!raw.ssh && !['password', 'passphrase', 'hasPassword', 'hasPassphrase'].some(key => Object.hasOwn(raw.ssh, key)); } } finally { profile.free(); }
    const secrets = db.prepare('SELECT name,value FROM secrets WHERE connection_id=?');
    try { secrets.bind([id]); while (secrets.step()) { const row = secrets.get(); slots.push({ name: String(row[0]), value: String(row[1]) }); } } finally { secrets.free(); }
  } finally { db.close(); }
  const password = lease.profile.password!;
  c02Assert(publicOnly && slots.length === 1 && slots[0].name === 'password' && !bytes.includes(Buffer.from(password, 'utf8')) && !bytes.includes(Buffer.from(password, 'utf16le')), 'C02 SSH 磁盘概要或秘密槽不正确');
  const matches = await scope.app!.evaluate(({ safeStorage }, input) => { if (!safeStorage.isEncryptionAvailable()) return false; try { return safeStorage.decryptString(Buffer.from(input.cipher, 'base64')) === input.password; } catch { return false; } }, { cipher: slots[0].value, password });
  c02Assert(matches, 'C02 SSH 数据库密码没有通过真实系统解密；未重新输入来掩盖丢失');
}

/** 正式表单只填既有未加密key，SSH密码及私钥口令保持空；错误指纹必须明确命中身份拒绝。 */
async function createConnection(scope: C02Desktop, lease: C02SshLease): Promise<string> {
  const page = scope.page, profile = lease.profile, ssh = profile.ssh!;
  await page.locator('.app-commandbar').getByRole('button', { name: '新建连接', exact: true }).click();
  const form = page.getByRole('dialog', { name: '新建连接', exact: true });
  for (const [label, value] of [['连接名称', `C02 SSH ${lease.database}`], ['主机地址', profile.host], ['端口', String(profile.port)], ['用户名', lease.user], ['默认数据库（可选）', lease.database], ['连接分组', 'C02 SSH 隔离验收']]) await form.getByLabel(label, { exact: true }).fill(value);
  await form.getByRole('checkbox', { name: '安全保存密码', exact: true }).check(); await databasePassword(form, profile.password!);
  if (profile.tls?.enabled) {
    await form.getByRole('button', { name: 'TLS / SSL', exact: true }).click(); await form.getByRole('checkbox', { name: '启用加密连接', exact: true }).check(); await form.getByRole('checkbox', { name: '验证服务器证书', exact: true }).check();
    await choose(scope, form, '选择CA 证书', 'CA 证书 选择CA 证书', profile.tls.caPath!);
  }
  await form.getByRole('button', { name: 'SSH 隧道', exact: true }).click(); await form.getByRole('checkbox', { name: '通过 SSH 隧道连接', exact: true }).check();
  await form.getByLabel('SSH 主机', { exact: true }).fill(ssh.host); await form.getByLabel('SSH 端口', { exact: true }).fill(String(ssh.port)); await form.getByLabel('SSH 用户名', { exact: true }).fill(ssh.user);
  await choose(scope, form, '选择 SSH 私钥', '私钥文件 选择 SSH 私钥', ssh.privateKeyPath!);
  c02Assert((await form.getByLabel('SSH 密码', { exact: true }).inputValue()) === '' && (await form.getByLabel('私钥口令', { exact: true }).inputValue()) === '', 'C02 SSH 本片不能带入密码或私钥口令');
  await form.getByLabel('主机指纹', { exact: true }).fill(c02WrongSshFingerprint(ssh.hostFingerprint!)); await testConnection(form, false);
  c02Assert((await form.locator('.error-box').textContent())?.includes('Host denied (verification failed)'), 'C02 SSH 错指纹没有收到真实主机身份拒绝，不能用普通网络错误代替');
  await form.getByLabel('主机指纹', { exact: true }).fill(ssh.hostFingerprint!); await testConnection(form, true);
  await form.getByRole('button', { name: '保存连接', exact: true }).click(); await expect.poll(async () => !(await form.isVisible())).toBe(true);
  const facts = await overview(scope, lease); c02Assert(facts.id && facts.publicOnly && facts.correctSsh && facts.noSshSecrets && facts.hasPassword, 'C02 SSH 保存的公开身份或存在标记不正确'); return facts.id;
}

/** SQL只读本轮subject，从真实查询表单/Monaco执行，经实际utility与观察者线程对应，不重发。 */
async function utilitySelect(scope: C02Desktop, lease: C02SshLease, id: string): Promise<void> {
  const page = scope.page;
  await page.locator('.app-commandbar').getByRole('button', { name: '新建查询', exact: true }).click(); const form = page.getByRole('dialog', { name: '新建查询', exact: true });
  await form.getByRole('combobox', { name: '数据库连接', exact: true }).selectOption(id); await form.getByRole('combobox', { name: '默认数据库（可选）', exact: true }).fill(lease.database);
  await expect.poll(async () => !(await form.getByRole('combobox', { name: '默认数据库（可选）', exact: true }).getAttribute('placeholder'))?.includes('读取'), { timeout: 20000 }).toBe(true);
  await form.getByRole('button', { name: '打开查询', exact: true }).click(); const query = page.locator('.query-tab:visible'), input = query.locator('.monaco-editor').getByRole('textbox');
  const execute = async (source: string, complete: (value: string) => boolean): Promise<string> => {
    await input.focus(); await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`); await page.keyboard.insertText(source); await query.getByRole('button', { name: '执行全部', exact: true }).click();
    await expect(query.getByRole('button', { name: '停止', exact: true })).toBeDisabled({ timeout: 20000 }); c02Assert(await query.locator('.error-box').count() === 0, 'C02 SSH 真实utility查询失败');
    let result = ''; await expect.poll(async () => { const value = await query.locator('.result-body').innerText(); if (complete(value)) result = value; return !!result; }).toBe(true); return result;
  };
  const value = await execute("SELECT CONCAT(CURRENT_USER(),'|',DATABASE(),'|',CONNECTION_ID()) AS c02_identity,marker FROM subject", text => text.includes(lease.marker) && text.includes(`${lease.user}@%`) && text.includes(lease.database));
  c02Assert((await lease.observeApplicationThreads()).some(id => new RegExp(`\\b${id}\\b`).test(value)), 'C02 SSH 网格实际会话与观察线程不对应');
  if (lease.profile.tls?.enabled) await execute("SHOW SESSION STATUS LIKE 'Ssl_cipher'", text => text.includes('Ssl_cipher') && /TLS_[A-Z0-9_]+|AES[0-9_-]+|CHACHA[A-Z0-9_-]*/.test(text));
  c02Assert(await scope.rememberProcesses(), 'C02 SSH 实际数据库utility未出现'); while (await page.locator('.tab-close').count()) await discardTestTab(page, page.locator('.tab-close').first()); await expect(page.locator('.tab-close')).toHaveCount(0);
}

test('C02 正式SSH表单：错指纹拒绝、既有私钥、utility SELECT与真实退出重启', async ({}, info) => {
  let unverified = '', restarted = false;
  try {
    const { withC02SshLease } = await import('../integration/helpers/c02-ssh-fixture');
    const fixture = await withC02SshLease(process.env, async lease => {
      let scope: C02Desktop | undefined;
      await withC02UiLifetime(async () => {
        scope = await C02Desktop.create(lease.tempParent); await scope.start();
        if (!(await secureStorage(scope))) { unverified = '系统安全加密不可用：本片无补填的重启路径未验'; return; }
        const id = await createConnection(scope, lease); await assertStorage(scope, lease, id); await utilitySelect(scope, lease, id);
        await scope.quit(); await scope.start();
        const facts = await overview(scope, lease); c02Assert(facts.id === id && facts.publicOnly && facts.correctSsh && facts.noSshSecrets && facts.hasPassword, 'C02 SSH 重启后原私钥身份或数据库密码存在标记不正确');
        await assertStorage(scope, lease, id);
        const form = await editConnection(scope, `C02 SSH ${lease.database}`);
        c02Assert((await form.getByLabel('数据库密码', { exact: true }).inputValue()) === '', 'C02 SSH 重启不应回显数据库密码');
        await form.getByRole('button', { name: 'SSH 隧道', exact: true }).click(); await testConnection(form, true); await form.getByRole('button', { name: '取消', exact: true }).click();
        await utilitySelect(scope, lease, id); restarted = true;
      }, async () => { if (scope) await scope.dispose(); });
    });
    if (!fixture.ownerSupported) unverified = '本片MySQL5.7/MariaDB所有权夹具未覆盖；创建前停止，未启动GUI';
    await writeFile(info.outputPath('c02-ssh-facts.json'), JSON.stringify({ fixture, status: unverified || '完成', realUiRestart: restarted, passwordSsh: '未验', privateKeyPassphrase: '未验', sourceKeyCopiedOrGenerated: false, appAndUtilityClosed: true, fixtureCleaned: true }, null, 2));
  } catch (error) { throw c02Failure('C02 既有未加密私钥SSH正式UI验收失败', error); }
  test.skip(!!unverified, unverified);
});
