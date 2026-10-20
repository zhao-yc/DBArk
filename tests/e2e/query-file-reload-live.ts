import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { test, expect, dataDir, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, pageErrors } from './desktop-fixture';
import { QueryFilesNativeFiles } from '../helpers/queryFilesNativeFiles';
import { installSqlFilesOpenAnswer, finishSqlFilesOpenAnswer } from '../helpers/queryFilesNative';
import { queryFilesZh as text } from '../../src/renderer/locales/queryFiles.zh-CN';
import { queryFileReloadZh as reloadText } from '../../src/shared/queryFileReload.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

interface Binding { owner: string; source: string; title: string; assertCurrent(): void; }
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const redo = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';
const digest = (sql: string) => createHash('sha256').update(Buffer.from(sql, 'utf8')).digest('hex');

/** 真实文件/IPC/SQLite/Monaco工作流；只替代本owner的一次原生选择回答，不运行SQL。 */
export function registerQueryFileReloadUi(binding: Binding) {
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off', ownedDesktopLaunchGuard: { assertCurrent: binding.assertCurrent } });
  test.setTimeout(120000); test.describe.configure({ retries: 0 });
  test(binding.title, async ({ trace, screenshot, video }, info) => {
    const owner = ownedDesktopResources(info), page = owner.page, application = owner.application, deadline = Date.now() + 120000;
    let exited = false;
    /** 同一原Page/App/期限贯穿每个await；失败只保留原owner，不借其它窗口补收尾。 */
    function check() { binding.assertCurrent(); const now = ownedDesktopResources(info); if (Date.now() >= deadline || now.page !== page || now.application !== application || now.closed !== exited || !exited && page.isClosed()) throw Error('文件重载原owner或期限已失效'); }
    async function step<T>(action: () => Promise<T>): Promise<T> { check(); const value = await action(); check(); return value; }
    const settings = () => step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})));
    /** 官方getter及弱编号只观察真实存活模型，不设置正文、选区或撤销栈。 */
    const model = () => step(() => page.evaluate(() => {
      type Api = typeof import('monaco-editor');
      const root = window as Window & { monaco?: Api; __dbarkReloadIds?: { ids: WeakMap<object, number>; next: number } };
      const editors = root.monaco?.editor.getEditors().filter(editor => editor.getContainerDomNode().isConnected && editor.getContainerDomNode().closest('.query-tab') && editor.getContainerDomNode().getClientRects().length > 0);
      if (editors?.length !== 1) throw Error('文件重载可见编辑器不唯一');
      const editor = editors[0], value = editor.getModel(); if (!value || value.isDisposed()) throw Error('文件重载模型未知');
      const ids = root.__dbarkReloadIds ??= { ids: new WeakMap(), next: 0 };
      const id = (object: object) => { if (!ids.ids.has(object)) ids.ids.set(object, ++ids.next); return ids.ids.get(object)!; };
      return { editor: id(editor), model: id(value), sql: value.getValue(), eol: value.getEOL(), readOnly: editor.getRawOptions().readOnly };
    }));
    try {
      check(); expect({ trace, screenshot, video }).toEqual({ trace: 'off', screenshot: 'off', video: 'off' });
      const directory = await step(() => realpath(dataDir)), files = new QueryFilesNativeFiles(directory, check); await step(() => files.start());
      const initial = "SELECT 'base';\r\n", external = "SELECT 'external';\n", draft = 'x' + initial;
      let identity = await step(() => files.create(files.paths.source, Buffer.from(initial)));
      await step(() => page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; }));
      await step(() => page.reload()); await step(() => expect(page.locator('.app-statusbar')).toBeVisible());
      await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click());
      const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      for (const [label, value] of [[zh.connections.text006, '文件重载离线验收'], [zh.connections.text009, '127.0.0.1'], [zh.connections.text010, '1'], [zh.common.user, 'offline'], [zh.connections.text011, ''], [zh.connections.text012, '']]) await step(() => connection.getByLabel(label, { exact: true }).fill(value));
      await step(() => connection.getByRole('checkbox', { name: zh.connections.text016, exact: true }).uncheck());
      await step(() => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(connection).toBeHidden());
      await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newQuery, exact: true }).click());
      const query = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
      await step(() => expect(query.locator('.error-box')).toContainText(/ECONNREFUSED|连接被拒绝|拒绝连接/i, { timeout: 15000 }));
      await step(() => query.getByRole('button', { name: zh.app.text053, exact: true }).click()); await step(() => expect(query).toBeHidden());
      const nonce = randomUUID(); await step(() => installSqlFilesOpenAnswer(application, { nonce, path: files.paths.source }));
      const tab = page.locator('.query-tab:visible'); await step(() => tab.getByRole('button', { name: text.open, exact: true }).click());
      const opening = page.getByRole('dialog', { name: text.open, exact: true });
      await step(() => opening.getByRole('combobox', { name: text.encoding, exact: true }).selectOption('utf8'));
      await step(() => opening.getByRole('button', { name: text.openAction, exact: true }).click());
      await step(() => expect(opening).toBeHidden()); expect(await step(() => finishSqlFilesOpenAnswer(application, nonce))).toEqual({ calls: 1, restored: true });
      await expect.poll(() => model().then(value => value.sql)).toBe(initial);
      const original = await model(), state = await settings(); expect(state.tabs).toHaveLength(2); const fileTab = state.tabs[1]; expect(fileTab.fileSourceBinding).toBeDefined();
      /** 每个检查点同时核真实模型和Main持久草稿；不调用settings.save补造结果。 */
      async function exact(sql: string, eol: string, revision: number, clean: boolean) {
        await expect.poll(() => model().then(value => value.sql)).toBe(sql);
        await expect.poll(() => settings().then(value => value.tabs.find(item => item.id === fileTab.id)?.sql)).toBe(sql);
        expect(await model()).toMatchObject({ editor: original.editor, model: original.model, eol, readOnly: false });
        const stored = (await settings()).tabs.find(item => item.id === fileTab.id)!; expect(stored.fileSourceBinding?.revision).toBe(revision);
        await step(() => expect(tab.getByRole('status', { name: text.fileSource, exact: true, includeHidden: true })).toContainText(clean ? text.clean : text.dirty));
      }
      await exact(initial, '\r\n', 1, true);
      const input = tab.locator('.monaco-editor').getByRole('textbox'); await step(() => input.focus());
      await step(() => page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')); await step(() => page.keyboard.type('x'));
      await exact(draft, '\r\n', 1, false);
      const replacement = await step(() => files.create(files.paths.replacement, Buffer.from(external)));
      identity = (await step(() => files.move(files.paths.replacement, files.paths.source, replacement, identity))).identity;
      const preview = page.getByRole('dialog', { name: reloadText.title, exact: true });
      await step(() => tab.getByRole('button', { name: reloadText.check, exact: true }).click());
      await step(() => expect(preview).toContainText(reloadText.replaced)); await step(() => expect(preview).toContainText(reloadText.dirty));
      await step(() => expect(preview.getByRole('button', { name: reloadText.confirm, exact: true })).toBeDisabled());
      await step(() => preview.getByRole('button', { name: reloadText.cancel, exact: true }).click()); await step(() => expect(preview).toBeHidden()); await exact(draft, '\r\n', 1, false);
      await step(() => tab.getByRole('button', { name: reloadText.check, exact: true }).click());
      await step(() => preview.getByRole('checkbox', { name: reloadText.acknowledge, exact: true }).check());
      await step(() => preview.getByRole('button', { name: reloadText.confirm, exact: true }).click()); await step(() => expect(preview).toBeHidden()); await exact(external, '\n', 2, true);
      for (const [sql, eol] of [[draft.replaceAll('\r\n', '\n'), '\n'], [draft, '\r\n'], [initial, '\r\n']]) { await step(() => input.focus()); await step(() => page.keyboard.press(modifier + '+z')); await exact(sql, eol, 2, false); }
      for (const [sql, eol, clean] of [[draft, '\r\n', false], [draft.replaceAll('\r\n', '\n'), '\n', false], [external, '\n', true]] as const) { await step(() => input.focus()); await step(() => page.keyboard.press(redo)); await exact(sql, eol, 2, clean); }
      // 新预览建立后再次原子外改；确认必须拒绝，不能自动拿后一个版本替换草稿。
      const third = await step(() => files.create(files.paths.replacement, Buffer.from("SELECT 'third';\n")));
      identity = (await step(() => files.move(files.paths.replacement, files.paths.source, third, identity))).identity;
      await step(() => tab.getByRole('button', { name: reloadText.check, exact: true }).click()); await step(() => expect(preview).toContainText(reloadText.replaced));
      const fourthBytes = Buffer.from("SELECT 'fourth';\n"), fourth = await step(() => files.create(files.paths.replacement, fourthBytes));
      identity = (await step(() => files.move(files.paths.replacement, files.paths.source, fourth, identity))).identity;
      await step(() => preview.getByRole('checkbox', { name: reloadText.acknowledge, exact: true }).check()); await step(() => preview.getByRole('button', { name: reloadText.confirm, exact: true }).click());
      const recovery = page.getByRole('dialog', { name: text.recovery, exact: true }); await step(() => expect(recovery).toContainText(reloadText.expired));
      await step(() => recovery.getByRole('button', { name: zh.common.cancel, exact: true }).click()); await exact(external, '\n', 2, true);
      const status = await step(() => page.evaluate(id => window.dbark.invoke('queryFileSources.status', { tabId: id }), fileTab.id));
      expect(status.state).toBe('bound'); if (status.state !== 'bound') throw Error('最终来源不明'); expect(status.binding.savedSqlDigest).toBe(digest(external));
      const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})));
      const actual = tasks.map(value => [value.kind, value.status]).sort();
      expect(actual).toEqual([['queryFileSources.open', 'completed'], ['queryFileSources.checkExternal', 'completed'], ['queryFileSources.checkExternal', 'completed'], ['queryFileSources.checkExternal', 'completed'], ['queryFileSources.reload', 'completed'], ['queryFileSources.reload', 'failed']].sort());
      expect(tasks.every(value => value.finishedAt && value.status !== 'running')).toBe(true);
      expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]);
      expect(await step(() => page.evaluate(() => window.dbark.invoke('queries.list', {})))).toEqual([]); expect(pageErrors).toEqual([]);
      expect((await step(() => files.read(files.paths.source, identity))).bytes).toEqual(fourthBytes);
      await step(() => expect(page.locator('.tab-strip .dirty-dot')).toHaveCount(0)); await step(() => files.closeHandles());
      check(); await confirmOwnedDesktopExit(info); exited = true; check(); await files.assertDirectory();
      await info.attach('SQL文件重载真实入口及严格收尾', { body: Buffer.from(JSON.stringify({ source: binding.source, owner: binding.owner, model: original.model, finalRevision: 2, tasks: actual, sourceUnmodifiedAfterRejection: true, normalOwnerExit: true, fileRecords: files.records })), contentType: 'application/json' });
    } catch (reason) { retainOwnedDesktopResources(info); throw reason; }
  });
}
