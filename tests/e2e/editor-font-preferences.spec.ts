import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import initSqlJs from 'sql.js';

test.skip(process.env.DBARK_EDITOR_FONT_NATIVE_TEST !== '1', '默认关闭：Root明确开启真实字号与重启专项');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.setTimeout(90000);
interface Owner { app: ElectronApplication; page: Page; ids: Set<number>; closed: boolean; confirmed: boolean; errors: string[]; ready: Promise<void>; }
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
// Monaco的macOS文末动作使用Command+下方向键；End只用于其它平台。
const cursorBottom = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';

/** 每次启动独立登记原应用、窗口与退出事实，不复用上次启动的授权或全局夹具。 */
async function launch(directory: string, owners: Owner[]): Promise<Owner> {
  const env = Object.fromEntries(Object.entries({ ...process.env, DBARK_USER_DATA: directory }).filter((item): item is [string, string] => item[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.DBARK_EXECUTABLE_PATH;
  const app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env, chromiumSandbox: true });
  let ready!: () => void;
  const owner: Owner = { app, page: undefined!, ids: new Set(), closed: false, confirmed: false, errors: [], ready: new Promise(resolve => { ready = resolve; }) };
  owners.push(owner);
  app.on('close', () => { owner.closed = true; });
  const marker = 'DBARK_FONT_QUIT:' + randomUUID();
  app.on('console', message => { if (message.text() === marker) ready(); });
  await app.evaluate(({ app }, marker) => { app.once('will-quit', () => console.log(marker)); }, marker);
  await processes(owner);
  owner.page = await app.firstWindow();
  owner.page.on('pageerror', error => owner.errors.push(error.name));
  await expect(owner.page.locator('.app-statusbar')).toBeVisible({ timeout: 15000 });
  return owner;
}

/** 原应用的PID记录只增加；探测权限错误不解释为进程不存在。 */
async function processes(owner: Owner): Promise<void> {
  if (owner.closed) throw Error('本次应用已关闭，进程归属未知');
  const ids = await owner.app.evaluate(({ app }) => app.getAppMetrics().map(item => item.pid));
  const main = owner.app.process().pid;
  if (!main || !ids.length || [...ids, main].some(id => !Number.isSafeInteger(id) || id <= 0)) throw Error('本次应用进程记录无效');
  for (const id of [...ids, main]) owner.ids.add(id);
}

/** 只走产品退出握手；不覆盖原生回答，不强制结束进程，未知时保留原应用及目录。 */
async function close(owner: Owner): Promise<void> {
  if (owner.closed || owner.confirmed) throw Error('缺少本次完整退出证明');
  await processes(owner);
  const exited = owner.app.waitForEvent('close', { timeout: 15000 });
  void exited.catch(() => undefined);
  await owner.app.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); });
  await Promise.race([owner.ready, exited]);
  if (!owner.closed) await owner.app.close();
  await exited;
  await expect.poll(() => [...owner.ids].filter(id => {
    try { process.kill(id, 0); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
  }), { timeout: 5000, message: '本次字号应用的全部已记录进程应已退出' }).toEqual([]);
  expect(owner.closed).toBe(true); expect(owner.errors).toEqual([]); owner.confirmed = true;
}

/** 只读取真实主进程工作区；正文不通过测试脚本注入React或Monaco模型。 */
async function settings(owner: Owner) { return owner.page.evaluate(() => window.dbark.invoke('settings.get', {})); }
async function activeSql(owner: Owner) { const state = await settings(owner); return state.tabs.find(tab => tab.id === state.activeTabId)?.sql; }
/** 沿实际命令栏打开设置，存储、preload、IPC和所有编辑器仍使用产品实现。 */
async function dialog(owner: Owner) {
  await owner.page.locator('.app-commandbar').getByRole('button', { name: '编辑器字号', exact: true }).click();
  return owner.page.getByRole('dialog', { name: 'SQL 编辑器字号', exact: true });
}
/** 仅观察真实Monaco绘制层；不替换updateOptions、模型或撤销操作。 */
async function style(owner: Owner) {
  return owner.page.locator('.query-tab:visible .monaco-editor .view-lines').evaluate(element => {
    const value = getComputedStyle(element); return { fontSize: value.fontSize, lineHeight: value.lineHeight, fontFamily: value.fontFamily };
  });
}

test('字号及换行热更新保留正文与撤销，SQLite落盘并在独立重启恢复', async ({}, info) => {
  const directory = await mkdtemp(join(tmpdir(), 'dbark-font-')), owners: Owner[] = [];
  // 新建Monaco模型使用宿主默认EOL；测试输入及断言同源，不将CRLF差异误判为正文丢失。
  const sql = "SELECT '" + '合成换行探针'.repeat(90) + "' AS precision_probe;", appended = (process.platform === 'win32' ? '\r\n' : '\n') + '-- 字号撤销探针';
  try {
    const first = await launch(directory, owners);
    // 仅准备不会连接的离线概要和旧版缺字号设置；实际字号更改全部由界面完成。
    await first.page.evaluate(async sql => {
      const connection = await window.dbark.invoke('connections.save', { id: '', name: '字号离线来源', group: '', color: '#123456', dialect: 'mysql', host: '127.0.0.1', port: 1, user: 'offline' });
      const old = await window.dbark.invoke('settings.get', {}); delete old.editorFontSize; delete old.editorWordWrap;
      const tab = { id: 'font-query', kind: 'query' as const, title: '字号与撤销', connectionId: connection.id, sql, databaseContext: { state: 'known' as const, database: null } };
      await window.dbark.invoke('settings.save', { ...old, tabs: [tab], activeTabId: tab.id });
    }, sql);
    await first.page.reload();
    const editor = first.page.locator('.query-tab:visible .monaco-editor');
    await expect(editor.getByRole('textbox')).toBeEditable();
    await expect.poll(() => style(first).then(value => value.fontSize)).toBe('13px');
    const initial = await style(first), originalNode = await editor.elementHandle();
    expect(initial.lineHeight).toBe('23px');
    await editor.getByRole('textbox').focus(); await first.page.keyboard.press(cursorBottom); await first.page.keyboard.insertText(appended);
    await expect.poll(() => activeSql(first)).toBe(sql + appended);
    // 真实输入可能产生多个撤销分组；先记录本机同一撤销动作的实际基线，不假设整段只有一个undo项。
    await first.page.keyboard.press(`${modifier}+z`); await expect.poll(() => activeSql(first)).not.toBe(sql + appended);
    const undoBaseline = await activeSql(first);
    await first.page.keyboard.press(`${modifier}+${process.platform === 'darwin' ? 'Shift+z' : 'y'}`); await expect.poll(() => activeSql(first)).toBe(sql + appended);
    let modal = await dialog(first); await modal.getByLabel('字号（px）', { exact: true }).fill('28'); await modal.getByRole('button', { name: '取消', exact: true }).click();
    await expect(modal).toBeHidden(); expect((await style(first)).fontSize).toBe('13px');
    modal = await dialog(first); await modal.getByLabel('字号（px）', { exact: true }).fill('18'); await modal.getByRole('button', { name: '保存字号', exact: true }).click();
    await expect(modal).toBeHidden(); await expect.poll(() => style(first).then(value => value.fontSize)).toBe('18px');
    expect(await editor.evaluate((element, original) => element === original, originalNode)).toBe(true);
    expect(await style(first)).toEqual({ ...initial, fontSize: '18px', lineHeight: '32px' });
    expect(await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBe(1);
    await editor.getByRole('textbox').focus(); await first.page.keyboard.press(`${modifier}+z`); await expect.poll(() => activeSql(first)).toBe(undoBaseline);
    await first.page.keyboard.press(`${modifier}+${process.platform === 'darwin' ? 'Shift+z' : 'y'}`); await expect.poll(() => activeSql(first)).toBe(sql + appended);
    modal = await dialog(first); await expect(modal.getByLabel('字号（px）', { exact: true })).toHaveValue('18');
    await modal.getByRole('button', { name: '恢复默认 13', exact: true }).click(); await expect(modal.getByLabel('字号（px）', { exact: true })).toHaveValue('13');
    await first.page.keyboard.press('Escape'); await expect(modal).toBeHidden(); expect((await style(first)).fontSize).toBe('18px');
    modal = await dialog(first); await modal.getByLabel('字号（px）', { exact: true }).fill('20'); await modal.getByRole('button', { name: '保存字号', exact: true }).click();
    await expect(modal).toBeHidden(); await expect.poll(() => settings(first).then(value => value.editorFontSize)).toBe(20);
    // 用实际长行绘制证明换行开关，而不是只读aria属性或模拟Monaco回包。
    const wrap = first.page.locator('.app-commandbar').getByRole('button', { name: '自动换行', exact: true });
    await expect(wrap).toHaveAttribute('aria-pressed', 'true'); await expect.poll(() => editor.locator('.view-line').count()).toBeGreaterThan(2);
    await wrap.click(); await expect(wrap).toHaveAttribute('aria-pressed', 'false'); await expect(editor.locator('.view-line')).toHaveCount(2);
    await wrap.click(); await expect(wrap).toHaveAttribute('aria-pressed', 'true'); await expect.poll(() => editor.locator('.view-line').count()).toBeGreaterThan(2);
    await wrap.click(); await expect(wrap).toHaveAttribute('aria-pressed', 'false'); await expect(editor.locator('.view-line')).toHaveCount(2);
    expect(await editor.evaluate((element, original) => element === original, originalNode)).toBe(true);
    expect((await style(first)).fontSize).toBe('20px');
    await editor.getByRole('textbox').focus(); await first.page.keyboard.press(`${modifier}+z`); await expect.poll(() => activeSql(first)).toBe(undoBaseline);
    await first.page.keyboard.press(`${modifier}+${process.platform === 'darwin' ? 'Shift+z' : 'y'}`); await expect.poll(() => activeSql(first)).toBe(sql + appended);
    await expect.poll(() => settings(first).then(value => value.editorWordWrap)).toBe(false);
    const before = await settings(first); await close(first);
    // 仅在原应用全部退出后读取真实SQLite文件；此处不是IPC回包或内存保存替身。
    const SQL = await initSqlJs({ locateFile: name => resolve('node_modules/sql.js/dist', name) });
    const db = new SQL.Database(await readFile(join(directory, 'dbark.sqlite')));
    try { const stored = JSON.parse(String(db.exec('SELECT data FROM settings WHERE id=1')[0].values[0][0])); expect(stored.editorFontSize).toBe(20); expect(stored.editorWordWrap).toBe(false); expect(stored.tabs).toEqual(before.tabs); }
    finally { db.close(); }
    const second = await launch(directory, owners);
    await expect(second.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox')).toBeEditable();
    await expect.poll(() => style(second).then(value => value.fontSize)).toBe('20px');
    await expect(second.page.locator('.app-commandbar').getByRole('button', { name: '自动换行', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(second.page.locator('.query-tab:visible .monaco-editor .view-line')).toHaveCount(2);
    expect(await activeSql(second)).toBe(sql + appended); expect((await settings(second)).tabs).toEqual(before.tabs);
    expect(await second.page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(await second.page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual([]);
    await close(second); expect(owners.every(owner => owner.confirmed)).toBe(true);
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('dbark-font-')) throw Error('拒绝清理非本例目录');
    await rm(directory, { recursive: true, force: false });
    await info.attach('字号原生终态', { body: Buffer.from(JSON.stringify({ accepted: true, launches: 2, owners: owners.map(owner => ({ confirmed: owner.confirmed, closed: owner.closed, recordedProcesses: owner.ids.size })), wordWrapChecked: true, systemClipboard: 0, databaseExecution: 0, sqliteChecked: true, directoryRemoved: true })), contentType: 'application/json' });
  } catch (error) {
    // 不在未知退出时强退、删除配置或复用旧owner；保留原始失败供Root处理。
    await info.attach('字号原生保留现场', { body: Buffer.from(JSON.stringify({ directory, owners: owners.map(owner => ({ closed: owner.closed, confirmed: owner.confirmed, ids: [...owner.ids] })), automaticRetry: false })), contentType: 'application/json' });
    throw error;
  }
});
