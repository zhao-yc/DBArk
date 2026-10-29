import { test } from '@playwright/test';

// 默认和列表只登记未执行定义，不加载Electron、SQLite、资料或认证。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_QUERY_ORGANIZATION_NATIVE_TEST === '1') register();
else test.skip('保存查询层级分组原生专项默认关闭（未执行）', () => {});

/** 原120秒内完成两次正常启动；失败保留原窗口与profile，不重试或强停。 */
function register() {
  const { expect } = require('@playwright/test') as typeof import('@playwright/test');
  const { bindSavedQueryOrganizationNative, savedQueryOrganizationFixture, installSavedQueryOrganizationAudit, readSavedQueryOrganizationAudit, quitSavedQueryOrganizationAudit } = require('../helpers/savedQueryOrganizationNative') as typeof import('../helpers/savedQueryOrganizationNative');
  const { createEditorIndentNativeRun } = require('./editor-indentation-native-runtime') as typeof import('./editor-indentation-native-runtime');
  const { bindEditorIndentNativeCase } = require('./editor-indentation-native-gate') as typeof import('./editor-indentation-native-gate');
  const { savedQueryOrganizationZh: text } = require('../../src/renderer/locales/savedQueryOrganization.zh-CN') as typeof import('../../src/renderer/locales/savedQueryOrganization.zh-CN');
  const { savedQueryPagesZh: pages } = require('../../src/renderer/locales/savedQueryPages.zh-CN') as typeof import('../../src/renderer/locales/savedQueryPages.zh-CN');
  const { queryBindingZh } = require('../../src/renderer/locales/queryBinding.zh-CN') as typeof import('../../src/renderer/locales/queryBinding.zh-CN');
  const { zh } = require('../../src/renderer/locales/zh-CN') as typeof import('../../src/renderer/locales/zh-CN');
  const fs = require('node:fs/promises') as typeof import('node:fs/promises'), sync = require('node:fs') as typeof import('node:fs'), { resolve, join } = require('node:path') as typeof import('node:path'), { createHash } = require('node:crypto') as typeof import('node:crypto');
  const binding = bindSavedQueryOrganizationNative(() => ({ env: process.env, args: process.argv, platform: process.platform })), config = resolve('playwright.config.ts'), hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex'), configHash = hash(sync.readFileSync(config));
  test.use({ trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(120000); test.describe.configure({ retries: 0 });
  test('真实分组树、跨页批量归类、原来源保存及两次正常启动', async ({ trace, screenshot, video }, info) => {
    const clock = bindEditorIndentNativeCase(info, { assertCurrent() { binding.assertCurrent(); if (info.retry || info.repeatEachIndex || info.config.workers !== 1 || info.project.retries || info.project.repeatEach !== 1 || info.config.configFile !== config || hash(sync.readFileSync(config)) !== configHash || [trace, screenshot, video].some(value => value !== 'off')) throw Error('分组原例运行配置变化'); } }, () => test.info());
    const run = createEditorIndentNativeRun(clock, { manifestPath: binding.target.manifest, approvedHash: binding.target.sha });
    let owner: Awaited<ReturnType<typeof run.launch>>, armed = false;
    const audits: ReturnType<typeof readSavedQueryOrganizationAudit>[] = [], exits: { code: number | null; pids: number[] }[] = [];
    const checked = async <T,>(action: () => Promise<T>): Promise<T> => { run.assert(owner); const value = await action(); run.assert(owner); return value; };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { const value = await run.step(owner, action); if (armed) await run.step(owner, () => owner.application.evaluate(readSavedQueryOrganizationAudit)); return value; };
    try {
      clock.assertCurrent(); await fs.mkdir(binding.target.output, { recursive: false }); clock.assertCurrent(); owner = await run.launch();
      const page = () => owner.page, dialog = () => page().getByRole('dialog', { name: zh.activity.text003, exact: true }), ready = () => step(() => expect(dialog().getByRole('button', { name: pages.refresh, exact: true })).toBeEnabled());
      const profile = await step(() => page().evaluate(() => window.dbark.invoke('connections.save', { id: '', name: '分组离线来源', group: '', color: '#123456', dialect: 'mysql', host: '127.0.0.1', port: 1, user: 'offline' })));
      for (let index = 0; index < 58; index++) { const fixture = savedQueryOrganizationFixture(index); await step(() => page().evaluate(value => window.dbark.invoke('queries.save', { ...value.query, connectionId: value.profile, databaseContext: { state: 'known', database: null }, updatedAt: '' }), { query: fixture, profile: profile.id })); }
      const baseline = await step(() => page().evaluate(() => window.dbark.invoke('queries.list', {}))); expect(baseline).toHaveLength(58);
      await step(() => page().reload()); await step(() => expect(page().locator('.app-statusbar')).toBeVisible());
      /** 每次App分别绑定原frame；只认正式IPC，不能测试侧替换分组或SQL实现。 */
      const audit = async () => { const window = await step(() => owner.application.browserWindow(page())), senderId = await step(() => window.evaluate(value => value.webContents.id)); await step(() => window.dispose()); await step(() => owner.application.evaluate(installSavedQueryOrganizationAudit, { senderId, profileId: profile.id })); armed = true; };
      const open = async () => { await step(() => page().locator('.navigation-toolbar').getByRole('button', { name: zh.common.historyQueries, exact: true }).click()); await step(() => dialog().getByRole('button', { name: zh.activity.text005, exact: true }).click()); await ready(); };
      const snapshot = () => step(() => page().evaluate(() => window.dbark.invoke('queries.organizationGet', {})));
      const scope = async (name: string) => { await step(() => dialog().getByRole('button', { name, exact: true }).click()); await ready(); };
      const confirm = async () => { await step(() => dialog().getByRole('button', { name: text.preview, exact: true }).click()); await step(() => expect(dialog().getByRole('region', { name: text.previewTitle, exact: true })).toBeVisible()); await step(() => dialog().getByRole('button', { name: text.confirm, exact: true }).click()); await ready(); };
      const create = async (name: string, parent: string) => { await step(() => dialog().getByRole('button', { name: text.create, exact: true }).click()); await step(() => dialog().getByLabel(text.groupName, { exact: true }).fill(name)); await step(() => dialog().getByLabel(text.parent, { exact: true }).selectOption(parent)); await confirm(); return (await snapshot()).groups.find(item => item.name === name)!.id; };
      await audit(); await open(); await step(() => expect(dialog().locator('.history-card')).toHaveCount(25));
      const first = await step(() => dialog().locator('.history-card strong').allTextContents()); expect(first).toEqual(Array.from({ length: 25 }, (_, index) => '资料' + String(57 - index).padStart(2, '0')));
      const root = await create('开发资料', ''), child = await create('常用', root), other = await create('复用资料', '');
      await step(() => dialog().getByLabel(text.selectPage, { exact: true }).check()); await step(() => dialog().getByRole('button', { name: pages.next, exact: true }).click()); await ready();
      for (const index of [32, 31]) await step(() => dialog().getByLabel(text.select('资料' + index), { exact: true }).check());
      await step(() => expect(dialog()).toContainText(text.selected(27, 25))); await step(() => dialog().getByRole('button', { name: text.moveQueries, exact: true }).click()); await step(() => dialog().getByLabel(text.destination, { exact: true }).selectOption(child)); await confirm();
      const moved = await snapshot(); expect(moved.groups.find(item => item.id === child)).toMatchObject({ count: 27, totalCount: 27 }); expect(moved.groups.find(item => item.id === root)).toMatchObject({ count: 0, totalCount: 27 }); expect(moved.unfiledCount).toBe(31); expect(await step(() => page().evaluate(() => window.dbark.invoke('queries.list', {})))).toEqual(baseline);
      await scope(text.selectGroup('开发资料')); await step(() => dialog().getByLabel(text.includeDescendants, { exact: true }).uncheck()); await ready(); await step(() => expect(dialog().locator('.history-card')).toHaveCount(0));
      await step(() => dialog().getByLabel(text.includeDescendants, { exact: true }).check()); await ready(); await step(() => expect(dialog().locator('.history-card')).toHaveCount(25));
      await step(() => dialog().getByLabel(pages.search, { exact: true }).fill('全文尾部组织标记')); await step(() => dialog().getByRole('button', { name: pages.searchButton, exact: true }).click()); await ready(); await step(() => expect(dialog().locator('.history-card strong')).toHaveText('资料33')); await step(() => expect(dialog().locator('.history-card pre')).not.toContainText('全文尾部组织标记'));
      await step(() => dialog().getByLabel(pages.search, { exact: true }).fill('')); await step(() => dialog().getByRole('button', { name: pages.searchButton, exact: true }).click()); await ready(); await scope(text.selectGroup('开发资料 / 常用'));
      await step(() => dialog().getByRole('button', { name: text.rename, exact: true }).click()); await step(() => dialog().getByLabel(text.groupName, { exact: true }).fill('共享查询')); await confirm();
      await step(() => dialog().getByRole('button', { name: text.moveGroup, exact: true }).click()); await step(() => dialog().getByLabel(text.parent, { exact: true }).selectOption(other)); await confirm();
      await step(() => expect(dialog().getByRole('button', { name: text.selectGroup('复用资料 / 共享查询'), exact: true })).toHaveAttribute('aria-current', 'true'));
      await step(() => dialog().getByRole('navigation', { name: text.tree, exact: true }).scrollIntoViewIfNeeded());
      await step(() => dialog().screenshot({ path: join(binding.target.output, 'group-tree.png') }));
      const card = () => dialog().locator('.history-card').filter({ has: page().getByText('资料33', { exact: true }) });
      await step(() => card().getByRole('button', { name: zh.activity.text010, exact: true }).click()); await step(() => expect(dialog()).toBeHidden());
      await step(() => expect(page().locator('.query-tab:visible .monaco-editor')).toBeVisible());
      await open(); await scope(text.selectGroup('复用资料 / 共享查询')); await step(() => card().getByLabel(text.select('资料33'), { exact: true }).check()); await step(() => dialog().getByRole('button', { name: text.moveQueries, exact: true }).click()); await step(() => dialog().getByLabel(text.destination, { exact: true }).selectOption('')); await confirm(); await step(() => dialog().getByRole('button', { name: zh.common.close, exact: true }).click());
      const originalSql = savedQueryOrganizationFixture(33).sql, updatedSql = originalSql + '\r\n-- 整理后仍保存原查询';
      // 原编辑器已就绪不能代替模态收尾；等隐藏并核持焦后才投递真实按键。
      await step(() => expect(dialog()).toBeHidden());
      const editor = page().locator('.query-tab:visible .monaco-editor').getByRole('textbox'); await step(() => expect(page().locator('.query-tab:visible .sql-editor-wrap > [aria-busy]')).toHaveAttribute('aria-busy', 'false')); await step(() => expect(editor).toBeVisible()); await step(() => expect(editor).toBeEditable()); await step(() => editor.focus()); await step(() => expect(editor).toBeFocused()); await step(() => page().keyboard.press('Control+End')); await step(() => expect(editor).toBeFocused()); await step(() => page().keyboard.insertText('\r\n-- 整理后仍保存原查询'));
      await step(() => page().locator('.query-tab:visible .toolbar').getByRole('button', { name: zh.query.text015, exact: true }).click()); const save = page().getByRole('dialog', { name: queryBindingZh.title, exact: true }); await step(() => save.getByRole('button', { name: queryBindingZh.update, exact: true }).click()); await step(() => expect(save).toBeHidden());
      const saved = await step(() => page().evaluate(() => window.dbark.invoke('queries.list', {}))); expect(saved.find(item => item.id === 'organization-33')?.sql).toBe(updatedSql); expect(saved.filter(item => item.id !== 'organization-33')).toEqual(baseline.filter(item => item.id !== 'organization-33'));
      await open(); await scope(text.selectGroup('复用资料')); await step(() => dialog().getByRole('button', { name: text.dissolve, exact: true }).click()); await step(() => expect(dialog().getByRole('group', { name: text.dissolve, exact: true })).toContainText(text.dissolveWarning)); await confirm();
      const final = await snapshot(); expect(final.groups.map(item => ({ id: item.id, name: item.name, parentId: item.parentId, count: item.count, totalCount: item.totalCount }))).toEqual([{ id: root, name: '开发资料', parentId: null, count: 0, totalCount: 0 }]); expect([final.unfiledCount, final.totalCount]).toEqual([58, 58]);
      await step(() => dialog().getByRole('button', { name: zh.common.close, exact: true }).click());
      const quit = async () => { await step(() => expect.poll(() => checked(() => owner.application.evaluate(readSavedQueryOrganizationAudit))).toMatchObject({ pending: 0 })); audits.push(await step(() => owner.application.evaluate(readSavedQueryOrganizationAudit))); await step(() => owner.application.evaluate(quitSavedQueryOrganizationAudit)); armed = false; const child = owner.application.process(); await run.close(owner); expect(child.exitCode).toBe(0); exits.push({ code: child.exitCode, pids: [...owner.ids] }); };
      await quit(); owner = await run.launch(); await audit(); const restored = await snapshot(); expect({ ...restored, revision: final.revision }).toEqual(final); expect(restored.revision).not.toBe(final.revision);
      await open(); await scope(text.unfiled); const names: string[] = []; for (const count of [25, 25, 8]) { await step(() => expect(dialog().locator('.history-card')).toHaveCount(count)); names.push(...await step(() => dialog().locator('.history-card strong').allTextContents())); if (names.length < 58) { await step(() => dialog().getByRole('button', { name: pages.next, exact: true }).click()); await ready(); } } expect(new Set(names).size).toBe(58);
      await step(() => dialog().screenshot({ path: join(binding.target.output, 'group-restored.png') })); expect(await step(() => page().evaluate(() => window.dbark.invoke('queries.list', {})))).toEqual(saved);
      expect(await step(() => page().evaluate(() => window.dbark.invoke('tasks.list', {})))).toEqual([]); expect(await step(() => page().evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]); await step(() => dialog().getByRole('button', { name: zh.common.close, exact: true }).click()); await quit();
      let sqliteSha256 = ''; await run.stopped(async path => { clock.assertCurrent(); const file = join(path, 'dbark.sqlite'), before = await fs.lstat(file); clock.assertCurrent(); if (!before.isFile() || before.isSymbolicLink()) throw Error('原SQLite身份无效'); const bytes = await fs.readFile(file); clock.assertCurrent(); sqliteSha256 = hash(bytes); await fs.writeFile(join(binding.target.output, 'original-sqlite-copy.sqlite'), bytes, { flag: 'wx', mode: 0o600 }); clock.assertCurrent(); const after = await fs.lstat(file); clock.assertCurrent(); expect([after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs]).toEqual([before.dev, before.ino, before.size, before.mtimeMs, before.ctimeMs]); expect(hash(await fs.readFile(file))).toBe(sqliteSha256); clock.assertCurrent(); });
      const evidence = { kind: 'dbark.saved-query-organization-ui', version: 1, platform: process.platform, manifestSha256: binding.target.sha, fixtureCount: 58, movedAcrossPages: 27, hiddenSelected: 25, originalSourcesUnchangedByMove: true, originalSourceUpdatedAfterMove: true, fullSourceTailSearch: true, groupDissolveRetainedAllQueries: true, groups: final.groups, unfiledCount: final.unfiledCount, audits, exits, sqliteSha256, normalExits: 2, clipboard: false, databaseExecution: false };
      clock.assertCurrent(); await fs.writeFile(join(binding.target.output, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); clock.assertCurrent(); await run.finish(); expect(run.removed).toBe(true);
    } catch (error) { run.retained = true; clock.retain(); throw error; }
  });
}
