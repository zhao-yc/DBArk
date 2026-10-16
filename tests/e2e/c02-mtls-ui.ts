import { discardTestTab } from './query-close-ui';
import { expect, type Locator } from '@playwright/test';
import type { C02MtlSLease } from '../integration/helpers/c02-mtls-fixture';
import { C02FixtureError, c02Failure } from '../integration/helpers/c02-mtls-policy';
import type { C02Desktop } from './c02-mtls-desktop';

const passphraseLabel = 'TLS 客户端私钥口令';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/** 所有关键失败均为受控说明，不能让秘密控件或原始错误值进入 expect 报告。 */
export function c02Assert(value: unknown, message: string): asserts value { if (!value) throw new C02FixtureError(message); }

/** 只对真实密码输入控件触发原生输入事件；避免 fill(口令) 的步骤标题或失败调用日志保存口令。 */
async function secretInput(form: Locator, label: string, value: string): Promise<void> {
  try {
    const accepted = await form.getByLabel(label, { exact: true }).evaluate((element, secret) => {
      if (!(element instanceof HTMLInputElement) || element.type !== 'password' || element.disabled) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) return false;
      setter.call(element, secret);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return element.value === secret;
    }, value);
    c02Assert(accepted, 'C02 真实密码控件未接收输入');
  } catch (error) { throw c02Failure('C02 真实密码控件输入失败', error); }
}

/** 仅替换一次原生文件选择回答；路径授权、files.choose/path 与 ConnectionDialog 保存仍为产品实现。 */
async function chooseFile(scope: C02Desktop, form: Locator, label: string, path: string): Promise<void> {
  await scope.app!.evaluate(({ dialog }, file) => {
    type Root = typeof globalThis & { __c02OpenDialog?: typeof dialog.showOpenDialog };
    const root = globalThis as Root;
    if (root.__c02OpenDialog) throw new Error('C02 原生文件选择回答已占用');
    root.__c02OpenDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
  }, path);
  const failures: unknown[] = [];
  try {
    await form.getByRole('button', { name: `选择${label}`, exact: true }).click();
    await expect.poll(async () => (await form.getByRole('textbox', { name: `${label} 选择${label}`, exact: true }).inputValue()) === path, { message: '真实文件选择结果应进入本例连接表单' }).toBe(true);
  } catch (error) { failures.push(c02Failure('C02 真实文件选择失败', error)); }
  try {
    await scope.app!.evaluate(({ dialog }) => {
      const root = globalThis as typeof globalThis & { __c02OpenDialog?: typeof dialog.showOpenDialog };
      if (root.__c02OpenDialog) dialog.showOpenDialog = root.__c02OpenDialog;
      delete root.__c02OpenDialog;
    });
  } catch (error) { failures.push(c02Failure('C02 原生文件选择回答恢复失败', error)); }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'C02 文件选择及恢复均失败', { cause: failures[0] });
}

/** 负例只判断真实 UI 终态，不读取或输出原错误文本，也不替换认证回包。 */
export async function testConnection(form: Locator, success: boolean): Promise<void> {
  await form.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect.poll(async () => {
    const button = form.getByRole('button', { name: '测试连接', exact: true });
    const done = await button.count() === 1 && await button.isEnabled();
    const ok = await form.locator('.success-box').count() > 0, failed = await form.locator('.error-box').count() > 0;
    return done && (success ? ok && !failed : failed && !ok);
  }, { timeout: 20000, message: success ? 'C02 正确口令必须真实连接成功' : 'C02 错/缺口令必须真实拒绝连接' }).toBe(true);
}

/** 新建、错误/正确测试与保存全部走正式 ConnectionDialog；不经 IPC 直接植入连接配置。 */
export async function createConnection(scope: C02Desktop, lease: C02MtlSLease, remember: boolean): Promise<string> {
  const page = scope.page, profile = lease.profile, name = `C02 UI ${lease.database}`;
  await page.locator('.app-commandbar').getByRole('button', { name: '新建连接', exact: true }).click();
  const form = page.getByRole('dialog', { name: '新建连接', exact: true });
  await form.getByLabel('连接名称', { exact: true }).fill(name);
  await form.getByLabel('主机地址', { exact: true }).fill(profile.host);
  await form.getByLabel('端口', { exact: true }).fill(String(profile.port));
  await form.getByLabel('用户名', { exact: true }).fill(lease.user);
  await form.getByLabel('默认数据库（可选）', { exact: true }).fill(lease.database);
  await form.getByLabel('连接分组', { exact: true }).fill('C02 独立验收');
  await form.getByRole('checkbox', { name: '安全保存密码', exact: true }).setChecked(remember);
  await secretInput(form, '数据库密码', profile.password!);
  await form.getByRole('button', { name: 'TLS / SSL', exact: true }).click();
  await form.getByRole('checkbox', { name: '启用加密连接', exact: true }).check();
  await form.getByRole('checkbox', { name: '验证服务器证书', exact: true }).check();
  await chooseFile(scope, form, 'CA 证书', profile.tls!.caPath!);
  await chooseFile(scope, form, '客户端证书', profile.tls!.certPath!);
  await chooseFile(scope, form, '客户端私钥', profile.tls!.keyPath!);
  await secretInput(form, passphraseLabel, `${profile.tls!.passphrase}-wrong`); await testConnection(form, false);
  await secretInput(form, passphraseLabel, profile.tls!.passphrase!); await testConnection(form, true);
  await form.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect.poll(async () => !(await form.isVisible()), { message: 'C02 正式保存应完成并关闭表单' }).toBe(true);
  const facts = await overview(scope, name);
  c02Assert(facts.id && facts.publicOnly && facts.hasPassword && facts.hasTlsPassphrase, 'C02 保存后的公开概要或秘密存在标记不正确');
  return facts.id;
}

/** 只把公开 ID 和存在性布尔值带出渲染进程，不向渲染进程注入预期口令，也不返回完整概要。 */
export async function overview(scope: C02Desktop, name: string): Promise<{ id: string; publicOnly: boolean; hasPassword: boolean; hasTlsPassphrase: boolean }> {
  return scope.page.evaluate(async connectionName => {
    const matches = (await window.dbark.invoke('connections.list', {})).filter(profile => profile.name === connectionName), profile = matches[0];
    return { id: matches.length === 1 ? profile.id : '', publicOnly: matches.length === 1 && !Object.hasOwn(profile, 'password') && !!profile.tls && !Object.hasOwn(profile.tls, 'passphrase'), hasPassword: profile?.hasPassword === true, hasTlsPassphrase: profile?.tls?.hasPassphrase === true };
  }, name);
}

/** 编辑从连接行正式入口进入；预先确认本例全部标签已关闭，遵守原敏感配置保护。 */
export async function editConnection(scope: C02Desktop, name: string): Promise<Locator> {
  c02Assert(await scope.page.locator('.tab-close').count() === 0, 'C02 修改认证前必须先关闭真实查询标签');
  const row = scope.page.locator('.connection-row').filter({ has: scope.page.getByRole('button', { name, exact: true }) });
  await row.getByRole('button', { name, exact: true }).focus();
  await row.getByRole('button', { name: `编辑连接 ${name}`, exact: true }).click();
  return scope.page.getByRole('dialog', { name: '编辑连接', exact: true });
}

/** 已存口令不回显，清除必须来自真实清除按钮；不会清空数据库密码或重新输入它来掩盖丢失。 */
export async function savedOrCleared(form: Locator, clear: boolean): Promise<void> {
  const password = form.getByLabel('数据库密码', { exact: true });
  await expect.poll(async () => (await password.inputValue()) === '', { message: '数据库密码不应回显' }).toBe(true);
  await expect(password).toHaveAttribute('placeholder', '已保存，未修改时保留');
  await form.getByRole('button', { name: 'TLS / SSL', exact: true }).click();
  const field = form.getByLabel(passphraseLabel, { exact: true });
  await expect.poll(async () => (await field.inputValue()) === '', { message: 'TLS 口令不应回显' }).toBe(true);
  await expect(field).toHaveAttribute('placeholder', '已保存，未修改时保留');
  if (clear) {
    await form.getByRole('button', { name: `清除${passphraseLabel}`, exact: true }).click();
    await expect(field).toHaveAttribute('placeholder', '保存后将清除');
    await form.getByRole('button', { name: '保存连接', exact: true }).click();
    await expect.poll(async () => !(await form.isVisible()), { message: 'C02 明确清除应保存完成并关闭表单' }).toBe(true);
  }
}

/** Monaco 只输入无秘密的 SELECT/SHOW；实际执行按钮、main broker、utility 与结果网格均不替换。 */
export async function utilitySelect(scope: C02Desktop, lease: C02MtlSLease, id: string): Promise<void> {
  const page = scope.page;
  await page.locator('.app-commandbar').getByRole('button', { name: '新建查询', exact: true }).click();
  const form = page.getByRole('dialog', { name: '新建查询', exact: true });
  await form.getByRole('combobox', { name: '数据库连接', exact: true }).selectOption(id);
  await form.getByRole('combobox', { name: '默认数据库（可选）', exact: true }).fill(lease.database);
  await expect.poll(async () => !(await form.getByRole('combobox', { name: '默认数据库（可选）', exact: true }).getAttribute('placeholder'))?.includes('读取'), { timeout: 20000 }).toBe(true);
  await form.getByRole('button', { name: '打开查询', exact: true }).click();
  const query = page.locator('.query-tab:visible'), input = query.locator('.monaco-editor').getByRole('textbox');
  const execute = async (statement: string, complete: (value: string) => boolean): Promise<string> => {
    await input.focus(); await page.keyboard.press(`${modifier}+A`); await page.keyboard.insertText(statement);
    await query.getByRole('button', { name: '执行全部', exact: true }).click();
    await expect(query.getByRole('button', { name: '停止', exact: true })).toBeDisabled({ timeout: 20000 });
    c02Assert(await query.locator('.error-box').count() === 0, 'C02 utility 查询实际失败');
    let rendered = '';
    await expect.poll(async () => { const value = await query.locator('.result-body').innerText(); if (complete(value)) rendered = value; return !!rendered; }, { message: '等待同一次网格读取含本次完整结果，不能重发 SQL' }).toBe(true);
    return rendered;
  };
  const selected = await execute("SELECT CONCAT(CURRENT_USER(),'|',DATABASE(),'|',CONNECTION_ID()) AS c02_identity,marker FROM subject", value => value.includes(lease.marker) && value.includes(`${lease.user}@%`) && value.includes(lease.database));
  const threads = await lease.observeApplicationThreads();
  c02Assert(selected.includes(lease.marker) && selected.includes(`${lease.user}@%`) && selected.includes(lease.database) && threads.some(thread => new RegExp(`\\b${thread}\\b`).test(selected)), 'C02 结果网格未证明真实账号/subject/线程');
  const cipher = await execute("SHOW SESSION STATUS LIKE 'Ssl_cipher'", value => value.includes('Ssl_cipher') && /TLS_[A-Z0-9_]+|AES[0-9_-]+|CHACHA[A-Z0-9_-]*/.test(value));
  c02Assert(cipher.includes('Ssl_cipher') && /TLS_[A-Z0-9_]+|AES[0-9_-]+|CHACHA[A-Z0-9_-]*/.test(cipher), 'C02 utility 会话未显示真实 SSL cipher');
  c02Assert(await scope.rememberProcesses(), 'C02 实际数据库 utility 进程未出现');
  while (await page.locator('.tab-close').count()) await discardTestTab(page, page.locator('.tab-close').first());
  await expect(page.locator('.tab-close')).toHaveCount(0);
}
