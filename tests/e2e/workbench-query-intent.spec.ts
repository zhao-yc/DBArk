import { test, expect, desktop, page, pageErrors, closed } from './desktop-fixture';
import { objectUri, type WorkbenchTarget } from '../../src/shared/workbench';

// 当前GUI和剪贴板由统筹独占；默认在自动桌面夹具前跳过，只为后续真实App入口验收准备。
test.skip(process.env.DBARK_QUERY_INTENT_UI !== '1', '需统筹取得GUI时段后显式启用正式App查询意图验收');
test.use({ trace: 'off' });
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
type Entry = '工具栏' | '标签加号' | '欢迎页' | '快捷键' | '原生菜单';
type Pending = { target: WorkbenchTarget; finish(error?: string): void };
type Probe = { pending: Map<number, Pending>; next: number; restore(): void };
type ProbeRoot = typeof globalThis & { __queryIntentUiProbe?: Probe };
const form = () => page.getByRole('dialog', { name: '新建查询', exact: true });
const shelf = () => page.getByRole('region', { name: '对象收藏', exact: true });

/** 真实本地配置只写入本例临时数据目录；没有凭据，也不导入任何私网帮助器。 */
async function seed() {
  const profiles = await page.evaluate(async () => {
    const profiles = [];
    for (const name of ['当前连接', '旧目标连接']) profiles.push(await window.dbark.invoke('connections.save', { id: '', name, group: '导航意图离线验收', color: '#4984cf', dialect: 'mysql', host: '127.0.0.1', port: 1, user: 'offline' }));
    const snapshot = await window.dbark.invoke('workbench.get', {});
    await window.dbark.invoke('workbench.save', { revision: snapshot.revision, document: { version: 1, focusMode: false, groups: [], favorites: [
      { id: 'old-table', label: '迟到表页', groupId: null, target: { connectionId: profiles[1].id, database: 'old_db', kind: 'table', name: 'old_table' } },
      { id: 'old-definition', label: '迟到定义', groupId: null, target: { connectionId: profiles[1].id, database: 'old_db', kind: 'procedure', name: 'old_proc' } },
      { id: 'latest-database', label: '最新有效导航', groupId: null, target: { connectionId: profiles[0].id, database: 'latest_db', kind: 'database' } }
    ] } });
    return profiles;
  });
  await page.reload(); await expect(page.locator('.app-statusbar')).toBeVisible(); await expect(shelf()).toBeVisible();
  return profiles;
}

/** 只控制resolve回包顺序及离线建连/列库结果；正式App、组件、协调器、工作区和本地存储均未替换。 */
async function controlledResolutions() {
  await desktop.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: { command: string; input: WorkbenchTarget }) => Promise<unknown>;
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers.get('dbark:request'); if (!original) throw Error('没有正式IPC处理器');
    const probe: Probe = { pending: new Map(), next: 0, restore() { for (const item of probe.pending.values()) item.finish('测试收尾'); probe.pending.clear(); handlers.set('dbark:request', original); } };
    (globalThis as ProbeRoot).__queryIntentUiProbe = probe;
    handlers.set('dbark:request', async (event, payload) => {
      if (payload.command === 'workbench.resolve') return new Promise(resolve => {
        const id = ++probe.next;
        probe.pending.set(id, { target: payload.input, finish: error => { probe.pending.delete(id); resolve(error ? { ok: false, error } : { ok: true, result: payload.input }); } });
      });
      if (payload.command === 'connections.open') return { ok: true, result: { dialect: 'mysql', version: '8.4.0' } };
      if (payload.command === 'metadata.databases') return { ok: true, result: ['latest_db'] };
      return original(event, payload);
    });
  });
}

/** 完成的是本例受控对象核验，不声称已核验真实服务器对象。 */
async function finish(id: number, error?: string) {
  await desktop.evaluate((_, value) => {
    const item = (globalThis as ProbeRoot).__queryIntentUiProbe?.pending.get(value.id); if (!item) throw Error('没有待完成的导航'); item.finish(value.error);
  }, { id, error });
}
/** 观察正式入口发起的resolve编号，不能靠固定延时猜测请求已发送。 */
async function waiting(id: number) {
  await expect.poll(() => desktop.evaluate(() => [...((globalThis as ProbeRoot).__queryIntentUiProbe?.pending.keys() ?? [])])).toContain(id);
}
/** 五条路径均经正式入口；原生菜单调用实际MenuItem处理器，不人工发渲染事件或改React状态。 */
async function open(entry: Entry) {
  if (entry === '工具栏') await page.locator('.app-commandbar').getByRole('button', { name: '新建查询', exact: true }).click();
  else if (entry === '标签加号') await page.locator('.tab-strip .add-tab').click();
  else if (entry === '欢迎页') await page.locator('.welcome-actions > button').nth(1).click();
  else if (entry === '快捷键') await page.keyboard.press(`${modifier}+T`);
  else await desktop.evaluate(({ Menu, BrowserWindow }) => {
    const menu = Menu.getApplicationMenu()?.items.find(item => item.label === '文件')?.submenu;
    const item = menu?.items.find(item => item.label === '新建查询'); if (!item) throw Error('没有正式新建查询菜单');
    item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent);
  });
  await expect(form()).toBeVisible();
}
/** 恢复原IPC后再由桌面夹具退出；测试从未触碰系统剪贴板。 */
async function restore() {
  if (!closed) await desktop.evaluate(() => { const root = globalThis as ProbeRoot; root.__queryIntentUiProbe?.restore(); delete root.__queryIntentUiProbe; });
}

for (const entry of ['工具栏', '标签加号', '欢迎页', '快捷键', '原生菜单'] as Entry[]) {
  test(`正式App ${entry}接管后迟到表页、定义及错误不能覆盖查询表单`, async ({}, info) => {
    const [current] = await seed(); await controlledResolutions();
    try {
      // 默认上下文由真实侧栏选择建立，不依赖本地连接列表的排序规则。
      const connection = page.locator('.connection-row').filter({ has: page.getByRole('button', { name: current.name, exact: true }) });
      await connection.getByRole('button', { name: current.name, exact: true }).click(); await expect(connection).toHaveClass(/active/);
      for (const [index, kind] of ['表页', '定义', '错误'].entries()) {
        const button = shelf().getByRole('button', { name: kind === '定义' ? /^打开对象：迟到定义 ·/ : /^打开对象：迟到表页 ·/ });
        await button.click(); await waiting(index + 1); await open(entry);
        await form().getByLabel('数据库连接', { exact: true }).selectOption(current.id);
        await form().getByLabel('默认数据库（可选）', { exact: true }).fill('用户新草稿库');
        await finish(index + 1, kind === '错误' ? '旧导航专属错误不得出现' : undefined);
        // 收藏按钮恢复可用意味着正式入口finally已处理完回包，而非只等主进程Promise完成。
        await expect(button).toBeEnabled(); await expect(form()).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(1);
        await expect(form().getByLabel('数据库连接', { exact: true })).toHaveValue(current.id);
        await expect(form().getByLabel('默认数据库（可选）', { exact: true })).toHaveValue('用户新草稿库');
        await expect(page.locator('.tab-strip .workspace-tab-button')).toHaveCount(0);
        await expect(page.locator('.toast')).not.toContainText('旧导航专属错误不得出现');
        await form().getByRole('button', { name: '取消', exact: true }).click(); await expect(form()).toBeHidden();
        // 重开读取正式工作区默认上下文，能发现旧响应只偷偷改变selection的情况。
        await open(entry); await expect(form().getByLabel('数据库连接', { exact: true })).toHaveValue(current.id);
        await expect(form().getByLabel('默认数据库（可选）', { exact: true })).toHaveValue('');
        await form().getByRole('button', { name: '取消', exact: true }).click(); await expect(form()).toBeHidden();
      }
      const latest = shelf().getByRole('button', { name: /^打开对象：最新有效导航 ·/ });
      await latest.click(); await waiting(4); await finish(4); await expect(latest).toBeEnabled();
      await expect(page.locator('.query-tab:visible').getByLabel('当前查询默认库', { exact: true })).toHaveText('latest_db');
      await expect(page.locator('.tab-strip .workspace-tab-button')).toHaveCount(1);
      await page.screenshot({ path: info.outputPath('query-intent-latest.png') }); expect(pageErrors).toEqual([]);
    } finally { await restore(); }
  });
}

test('正式对象链接关闭后迟到响应不影响查询表单，最新链接错误仍在本入口显示', async () => {
  const profiles = await seed(); await controlledResolutions();
  try {
    await page.locator('.app-commandbar').getByRole('button', { name: '粘贴对象链接', exact: true }).click();
    const link = page.getByRole('dialog', { name: '粘贴对象链接', exact: true });
    await link.getByLabel('DBArk 对象链接', { exact: true }).fill(objectUri({ connectionId: profiles[1].id, database: 'old_db', kind: 'procedure', name: 'old_proc' }));
    await link.getByRole('button', { name: '打开链接', exact: true }).click(); await waiting(1);
    await link.getByRole('button', { name: '取消', exact: true }).click(); await expect(link).toBeHidden();
    await open('工具栏'); await finish(1); await expect(form()).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(1);
    await form().getByRole('button', { name: '取消', exact: true }).click();
    await page.locator('.app-commandbar').getByRole('button', { name: '粘贴对象链接', exact: true }).click();
    await link.getByLabel('DBArk 对象链接', { exact: true }).fill(objectUri({ connectionId: profiles[1].id, database: 'old_db', kind: 'table', name: 'old_table' }));
    await link.getByRole('button', { name: '打开链接', exact: true }).click(); await waiting(2); await finish(2, '最新对象连接修订错误');
    await expect(link.getByRole('alert')).toContainText('最新对象连接修订错误'); expect(pageErrors).toEqual([]);
  } finally { await restore(); }
});
