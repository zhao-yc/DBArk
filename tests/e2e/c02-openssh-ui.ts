import { expect, type Locator } from '@playwright/test';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import type { C02OpenSshLease, C02OpenSshMode } from '../integration/helpers/c02-openssh-fixture';
import { c02Failure } from '../integration/helpers/c02-mtls-policy';
import { c02OpenSshCheck as check } from '../integration/helpers/c02-openssh-policy';
import { c02WrongSshFingerprint } from '../integration/helpers/c02-ssh-policy';
import { C02Desktop } from './c02-mtls-desktop';
import { editConnection, testConnection } from './c02-mtls-ui';

const requireC02 = createRequire(join(process.cwd(), 'package.json'));
const label = (mode: C02OpenSshMode) => mode === 'password' ? 'SSH 密码' : '私钥口令';
const slotName = (mode: C02OpenSshMode) => mode === 'password' ? 'sshPassword' : 'sshPassphrase';

/** 秘密只进入正式password控件，不出现在fill步骤标题、Monaco或expect原值中。 */
async function secret(form: Locator, name: string, value: string) {
  const accepted = await form.getByLabel(name, { exact: true }).evaluate((element, input) => {
    if (!(element instanceof HTMLInputElement) || element.type !== 'password' || element.disabled) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, input); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return element.value === input;
  }, value);
  check(accepted, 'C02正式秘密控件未接收输入');
}

/** 只回答本例文件选择，路径授权和驱动读本轮材料仍走真实实现。 */
async function choose(scope: C02Desktop, form: Locator, button: string, input: string, path: string) {
  await scope.app!.evaluate(({ dialog }, value) => {
    const root = globalThis as typeof globalThis & { __c02OwnOpen?: typeof dialog.showOpenDialog }; if (root.__c02OwnOpen) throw Error('C02本例选择器已占用');
    root.__c02OwnOpen = dialog.showOpenDialog; dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [value] })) as typeof dialog.showOpenDialog;
  }, path);
  try { await form.getByRole('button', { name: button, exact: true }).click(); await expect.poll(async () => (await form.getByRole('textbox', { name: input, exact: true }).inputValue()) === path).toBe(true); }
  finally { await scope.app!.evaluate(({ dialog }) => { const root = globalThis as typeof globalThis & { __c02OwnOpen?: typeof dialog.showOpenDialog }; if (root.__c02OwnOpen) dialog.showOpenDialog = root.__c02OwnOpen; delete root.__c02OwnOpen; }); }
}

/** 只返回公开标记；不把连接秘密或密文带出当前比较函数。 */
export async function c02OpenSshOverview(scope: C02Desktop, name: string) {
  return scope.page.evaluate(async value => {
    const rows = (await window.dbark.invoke('connections.list', {})).filter(row => row.name === value), row = rows[0];
    return { id: rows.length === 1 ? row.id : '', publicOnly: !!row && !Object.hasOwn(row, 'password') && !!row.ssh && !Object.hasOwn(row.ssh, 'password') && !Object.hasOwn(row.ssh, 'passphrase'), database: row?.hasPassword === true, password: row?.ssh?.hasPassword === true, passphrase: row?.ssh?.hasPassphrase === true };
  }, name);
}

/** 系统安全后端只实读，basic_text不可冒充持久恢复成功，也不改写safeStorage能力。 */
export async function c02OpenSshNativeStorage(scope: C02Desktop) {
  const info = await scope.page.evaluate(() => window.dbark.invoke('app.info', {}));
  const native = await scope.app!.evaluate(({ safeStorage }) => {
    const available = safeStorage.isEncryptionAvailable(), backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined;
    return { available, secure: available && (process.platform !== 'linux' || ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(backend ?? '')) };
  });
  check(info.dataPath === scope.directory && info.encryptionAvailable === native.available, 'C02原生存储或本例目录不匹配'); return native.secure;
}

/** 实际SQLite与系统解密只输出布尔/计数，任何秘密均不得成为断言的实际值。 */
export async function c02OpenSshStorage(scope: C02Desktop, lease: C02OpenSshLease, mode: C02OpenSshMode, id: string, remembered: boolean, cleared = false) {
  const profile = lease.profile(mode), bytes = await readFile(join(scope.directory, 'dbark.sqlite')), SQL = await initSqlJs({ locateFile: () => requireC02.resolve('sql.js/dist/sql-wasm.wasm') }), db = new SQL.Database(bytes);
  const slots: { name: string; value: string }[] = []; let publicOnly = false;
  try {
    const entry = db.prepare('SELECT data FROM connections WHERE id=?');
    try { entry.bind([id]); if (entry.step()) { const raw = JSON.parse(String(entry.get()[0])); publicOnly = !Object.hasOwn(raw, 'password') && !Object.hasOwn(raw, 'hasPassword') && !!raw.ssh && !['password', 'passphrase', 'hasPassword', 'hasPassphrase'].some(key => Object.hasOwn(raw.ssh, key)); } } finally { entry.free(); }
    const values = db.prepare('SELECT name,value FROM secrets WHERE connection_id=?'); try { values.bind([id]); while (values.step()) { const row = values.get(); slots.push({ name: String(row[0]), value: String(row[1]) }); } } finally { values.free(); }
  } finally { db.close(); }
  const sshSecret = mode === 'password' ? profile.ssh!.password! : profile.ssh!.passphrase!;
  check(publicOnly && [profile.password!, sshSecret].every(value => !bytes.includes(Buffer.from(value, 'utf8')) && !bytes.includes(Buffer.from(value, 'utf16le'))), 'C02SQLite包含秘密原文或概要字段');
  check(slots.length === (remembered ? cleared ? 1 : 2 : 0) && slots.filter(row => row.name === 'password').length === Number(remembered) && slots.filter(row => row.name === slotName(mode)).length === Number(remembered && !cleared), 'C02实际独立秘密槽数量不匹配');
  if (remembered) {
    const matches = await scope.app!.evaluate(({ safeStorage }, input) => {
      const same = (name: string, expected: string) => { const value = input.slots.filter(row => row.name === name); try { return value.length === 1 && safeStorage.decryptString(Buffer.from(value[0].value, 'base64')) === expected; } catch { return false; } };
      return { database: same('password', input.database), ssh: same(input.name, input.secret) };
    }, { slots, database: profile.password!, name: slotName(mode), secret: sshSecret });
    check(matches.database && matches.ssh === !cleared, 'C02真实safeStorage解密未保留所需秘密或仅清除SSH槽');
  }
}

/** 新建正式表单逐一验证真实负例；未知网络错误不能充当密码或指纹拒绝。 */
export async function createC02OpenSshConnection(scope: C02Desktop, lease: C02OpenSshLease, mode: C02OpenSshMode, remember: boolean) {
  const page = scope.page, profile = lease.profile(mode), ssh = profile.ssh!;
  await page.locator('.app-commandbar').getByRole('button', { name: '新建连接', exact: true }).click(); const form = page.getByRole('dialog', { name: '新建连接', exact: true });
  for (const [name, value] of [['连接名称', profile.name], ['主机地址', profile.host], ['端口', String(profile.port)], ['用户名', profile.user], ['默认数据库（可选）', lease.database]]) await form.getByLabel(name, { exact: true }).fill(value);
  await form.getByRole('checkbox', { name: '安全保存密码', exact: true }).setChecked(remember); await secret(form, '数据库密码', profile.password!);
  if (profile.tls?.enabled) {
    await form.getByRole('button', { name: 'TLS / SSL', exact: true }).click(); await form.getByRole('checkbox', { name: '启用加密连接', exact: true }).check(); await form.getByRole('checkbox', { name: '验证服务器证书', exact: true }).check(); await choose(scope, form, '选择CA 证书', 'CA 证书 选择CA 证书', profile.tls.caPath!);
  }
  await form.getByRole('button', { name: 'SSH 隧道', exact: true }).click(); await form.getByRole('checkbox', { name: '通过 SSH 隧道连接', exact: true }).check();
  for (const [name, value] of [['SSH 主机', ssh.host], ['SSH 端口', String(ssh.port)], ['SSH 用户名', ssh.user], ['主机指纹', ssh.hostFingerprint!]]) await form.getByLabel(name, { exact: true }).fill(value);
  if (mode === 'encrypted-key') await choose(scope, form, '选择 SSH 私钥', '私钥文件 选择 SSH 私钥', ssh.privateKeyPath!);
  const password = mode === 'password' ? ssh.password! : ssh.passphrase!;
  await secret(form, label(mode), password + '-wrong'); await testConnection(form, false);
  check(mode === 'password' ? (await form.locator('.error-box').textContent())?.includes('All configured authentication methods failed') : /privateKey|passphrase|encrypted|decrypt/i.test(await form.locator('.error-box').textContent() ?? ''), 'C02错误秘密未命中真实SSH认证阶段');
  await secret(form, label(mode), password); await form.getByLabel('主机指纹', { exact: true }).fill(c02WrongSshFingerprint(ssh.hostFingerprint!)); await testConnection(form, false);
  check((await form.locator('.error-box').textContent())?.includes('Host denied (verification failed)'), 'C02错指纹未收到真实主机身份拒绝');
  await form.getByLabel('主机指纹', { exact: true }).fill(ssh.hostFingerprint!); await testConnection(form, true); await form.getByRole('button', { name: '保存连接', exact: true }).click(); await expect(form).toBeHidden();
  const facts = await c02OpenSshOverview(scope, profile.name); check(facts.id && facts.publicOnly && facts.database && facts.password === (mode === 'password') && facts.passphrase === (mode === 'encrypted-key'), 'C02正式表单公开标记或独立SSH秘密未保存'); return facts.id;
}

/** 正式Monaco仅输入固定SELECT，实际broker/utility、线程和TLS结果均不替换。 */
export async function c02OpenSshUtilitySelect(scope: C02Desktop, lease: C02OpenSshLease, id: string, mode: C02OpenSshMode) {
  const page = scope.page; await page.locator('.app-commandbar').getByRole('button', { name: '新建查询', exact: true }).click(); const form = page.getByRole('dialog', { name: '新建查询', exact: true });
  await form.getByRole('combobox', { name: '数据库连接', exact: true }).selectOption(id); await form.getByRole('combobox', { name: '默认数据库（可选）', exact: true }).fill(lease.database); await expect.poll(async () => !(await form.getByRole('combobox', { name: '默认数据库（可选）', exact: true }).getAttribute('placeholder'))?.includes('读取')).toBe(true); await form.getByRole('button', { name: '打开查询', exact: true }).click();
  const query = page.locator('.query-tab:visible'), input = query.locator('.monaco-editor').getByRole('textbox');
  // 等到本次结果真正渲染；停止按钮最初就可能禁用，不能用它单独证明查询完成。
  const run = async (source: string, rendered: (value: string) => boolean) => {
    await input.focus(); await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`); await page.keyboard.insertText(source);
    await query.getByRole('button', { name: '执行全部', exact: true }).click();
    await expect.poll(async () => await query.locator('.error-box').count() === 0 && await query.locator('.result-body').count() === 1 && rendered(await query.locator('.result-body').innerText()), { timeout: 20000, message: 'C02本次真实utility结果未就绪' }).toBe(true);
    await expect(query.getByRole('button', { name: '停止', exact: true })).toBeDisabled({ timeout: 20000 });
    return query.locator('.result-body').innerText();
  };
  const value = await run("SELECT CONCAT(CURRENT_USER(),'|',DATABASE(),'|',CONNECTION_ID()) AS c02_identity,marker FROM subject", text => text.includes(lease.marker) && text.includes(`${lease.user}@%`) && text.includes(lease.database));
  check(value.includes(lease.marker) && value.includes(`${lease.user}@%`) && value.includes(lease.database) && (await lease.observeApplicationThreads()).some(id => new RegExp(`\\b${id}\\b`).test(value)), 'C02utility实际账号、库、数据或线程不对应');
  if (lease.profile(mode).tls?.enabled) await run("SHOW SESSION STATUS LIKE 'Ssl_cipher'", text => /TLS_[A-Z0-9_]+|AES[0-9_-]+|CHACHA[A-Z0-9_-]*/.test(text));
  check(await scope.rememberProcesses(), 'C02没有观察到真实数据库utility'); while (await page.locator('.tab-close').count()) await page.locator('.tab-close').first().click();
}

/** 重启不补填任何秘密或身份；只清本模式SSH秘密，数据库密码继续通过真实系统解密。 */
export async function restartAndClearC02OpenSsh(scope: C02Desktop, lease: C02OpenSshLease, mode: C02OpenSshMode, id: string) {
  await scope.quit(); await scope.start(); const name = lease.profile(mode).name, facts = await c02OpenSshOverview(scope, name);
  check(facts.id === id && facts.database && facts.password === (mode === 'password') && facts.passphrase === (mode === 'encrypted-key'), 'C02真实重启后独立秘密丢失，禁止补填掩盖');
  await c02OpenSshStorage(scope, lease, mode, id, true); const form = await editConnection(scope, name); await form.getByRole('button', { name: 'SSH 隧道', exact: true }).click();
  check((await form.getByLabel(label(mode), { exact: true }).inputValue()) === '', 'C02保存的SSH秘密不能回显'); await testConnection(form, true); await form.getByRole('button', { name: '取消', exact: true }).click(); await c02OpenSshUtilitySelect(scope, lease, id, mode);
  const clearing = await editConnection(scope, name); await clearing.getByRole('button', { name: 'SSH 隧道', exact: true }).click(); await clearing.getByRole('button', { name: `清除${label(mode)}`, exact: true }).click(); await clearing.getByRole('button', { name: '保存连接', exact: true }).click(); await expect(clearing).toBeHidden();
  const after = await c02OpenSshOverview(scope, name); check(after.database && !after.password && !after.passphrase, 'C02仅清SSH秘密时误清数据库密码或遗留SSH槽'); await c02OpenSshStorage(scope, lease, mode, id, true, true);
}

export { editConnection, testConnection, c02Failure };
