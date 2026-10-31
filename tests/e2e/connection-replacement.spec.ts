import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, desktop, page, dataDir, pageErrors } from './desktop-fixture';
import { connectionReplacementText as risk } from '../../src/shared/connectionTransferMessages';
import { connectionsTransferZh as text } from '../../src/renderer/locales/connectionsTransfer.zh-CN';
import type { NetworkConnectionProfile as ConnectionProfile } from '../../src/shared/contracts';

// 双门默认关闭；本切片只采集定义，不启动Electron，不读取实际数据库环境或认证文件。
test.skip(process.env.DBARK_E2E !== '1' || process.env.DBARK_C03_REPLACE_UI !== '1', 'C03受控替换正式UI需另行显式授权，默认关闭');
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
test.setTimeout(120000);

/** 合成目标只用于概要，不测试或连接；没有生成、读取真实私钥/证书。 */
async function seed(name: string, id = '') {
  const profile: ConnectionProfile = { id, name, group: 'C03受控替换验收', color: '#123456', dialect: 'mysql', host: 'old.invalid', port: 3306, user: 'old', rememberPassword: false, password: '仅用于C03验收的合成字符串' };
  return page.evaluate(value => window.dbark.invoke('connections.save', value).then(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; }), profile);
}
async function sourceFile() {
  const path = join(dataDir, 'c03-replacement.json');
  await writeFile(path, JSON.stringify({ format: 'DBArk-connections', version: 1, connections: [{ id: 'c03-source', name: 'C03新概要', group: '验收', color: '#abcdef', dialect: 'mariadb', host: 'new.invalid', port: 3307, user: 'fresh', tls: { enabled: true, rejectUnauthorized: true, caFileName: '需重新选择CA.pem' } }] }));
  return path;
}
/** 只替换原生打开对话框回答，读取、文件授权、预览及提交仍走真实处理器。 */
async function openImport() {
  const path = await sourceFile();
  await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, path);
  await (await (await import('./navigation-menu')).navigationMenuItem(page, { name: text.open, exact: true })).click();
  const modal = page.getByRole('dialog', { name: text.title, exact: true });
  await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: text.import, exact: true })).click();
  await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: text.chooseImport, exact: true })).click();
  await expect(modal.getByRole('combobox', { name: `${text.action} 1`, exact: true })).toHaveValue('add');
  return modal;
}
/** 用户必须选择目标再审阅，并逐项核对与主进程相同的中文风险。 */
async function review(modal: Awaited<ReturnType<typeof openImport>>, id: string) {
  await modal.getByRole('combobox', { name: `${text.action} 1`, exact: true }).selectOption('replace');
  await expect(modal.getByRole('combobox', { name: `${text.replaceTarget} 1`, exact: true })).toHaveValue('');
  await modal.getByRole('combobox', { name: `${text.replaceTarget} 1`, exact: true }).selectOption(id);
  await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: text.reviewReplace, exact: true })).click();
  await expect(modal.getByLabel(text.reviewTitle, { exact: true })).toBeVisible();
}
async function acknowledge(modal: Awaited<ReturnType<typeof openImport>>) { for (const label of [risk.target, risk.secrets, risk.files, risk.linked]) await modal.getByRole('checkbox', { name: label, exact: true }).check(); await modal.getByRole('checkbox', { name: text.staged, exact: true }).check(); }

test('C03明确选择旧→新目标、风险未齐不可提交，替换后保留ID而清凭据且不连接', async () => {
  const target = await seed('C03原目标'); await page.reload(); const modal = await openImport(); await review(modal, target.id);
  await expect(modal.getByLabel(text.oldTarget, { exact: true })).toContainText('old.invalid:3306'); await expect(modal.getByLabel(text.newTarget, { exact: true })).toContainText('new.invalid:3307');
  await expect(modal.getByRole('button', { name: text.replaceConfirm, exact: true })).toBeDisabled(); await acknowledge(modal);
  await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: text.replaceConfirm, exact: true })).click(); await expect(modal.locator('.success-box')).toContainText('替换 1');
  const connections = await page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; }))); expect(connections).toHaveLength(1);
  expect(connections[0]).toMatchObject({ id: target.id, host: 'new.invalid', hasPassword: false, rememberPassword: false, pendingFiles: ['tlsCa'] });
  expect(await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual([]); expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]); expect(pageErrors).toEqual([]);
});

test('C03目标A→B→A重新选择清除全部确认，不复活旧审阅', async () => {
  const a = await seed('C03目标A'), b = await seed('C03目标B'); await page.reload(); const modal = await openImport(); await review(modal, a.id); await acknowledge(modal);
  await modal.getByRole('combobox', { name: `${text.replaceTarget} 1`, exact: true }).selectOption(b.id); await modal.getByRole('combobox', { name: `${text.replaceTarget} 1`, exact: true }).selectOption(a.id);
  await expect(modal.getByLabel(text.reviewTitle, { exact: true })).toHaveCount(0); await expect(modal.getByRole('checkbox', { name: text.staged, exact: true })).not.toBeChecked();
  await expect(modal.getByRole('button', { name: text.replaceConfirm, exact: true })).toBeDisabled();
  const connections = await page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; }))); expect(connections.every(profile => profile.host === 'old.invalid' && profile.hasPassword)).toBe(true); expect(pageErrors).toEqual([]);
});

test('C03确认后主进程配置修订变化令CAS失败，旧目标和合成凭据保持且不重试', async () => {
  const target = await seed('C03原目标'); await page.reload(); const modal = await openImport(); await review(modal, target.id); await acknowledge(modal);
  // 通过真实主进程保存另一个配置，只制造并发修订，不篡改业务处理器或渲染结果。
  await seed('C03并发新增'); await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: text.replaceConfirm, exact: true })).click();
  await expect(modal.locator('.warning-text')).toContainText([text.fail]); await expect(modal.getByLabel(text.reviewTitle, { exact: true })).toHaveCount(0);
  const connections = await page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; }))); expect(connections.find(profile => profile.id === target.id)).toMatchObject({ host: 'old.invalid', hasPassword: true });
  expect(await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual([]); expect(pageErrors).toEqual([]);
});
