import { test, expect, type TestInfo } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { createEditorIndentNativeRun, readIndentNativeSettings } from './editor-indentation-native-runtime';
import type { EditorIndentNativeRun, IndentNativeOwner } from './editor-indentation-native-owner';
import { type bindShortcutNativeEnvironment, shortcutNativeCase } from '../helpers/queryFileShortcutGate';
import { installShortcutObservation, detachShortcutObservation, ShortcutEventLog } from '../helpers/queryFileShortcutObservation';
import { installMainProbe, detachMainProbe, MainProbeLog } from '../helpers/queryFileMainProbe';
import { QueryFilesNativeFiles } from '../helpers/queryFilesNativeFiles';
import { sourceSql, savedSql, utf16NativeBytes, installSqlFilesOpenAnswer, finishSqlFilesOpenAnswer } from '../helpers/queryFilesNative';
import { zh } from '../../src/renderer/locales/zh-CN';
import { queryFilesZh as text } from '../../src/renderer/locales/queryFiles.zh-CN';
import type { SystemShortcutDriver, SystemShortcutReceipt } from '../helpers/queryFileSystemShortcutHandshake';

/** Main读取每次只发一个真实RPC，各自经过原parent/run.step。 */
async function settings(run: EditorIndentNativeRun, owner: IndentNativeOwner) { return run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('settings.get', {}))); }
/** 只读唯一可见模型及官方焦点getter，不设值、EOL、模型或撤销栈。 */
async function model(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  return run.step(owner, () => owner.page.evaluate(() => {
    const root = window as Window & { monaco?: typeof import('monaco-editor') };
    const editors = root.monaco?.editor.getEditors().filter(editor => editor.getContainerDomNode().isConnected && editor.getContainerDomNode().closest('.query-tab') && editor.getContainerDomNode().getClientRects().length > 0);
    if (editors?.length !== 1) throw Error('快捷键原可见编辑器不唯一'); const current = editors[0].getModel(); if (!current || current.isDisposed()) throw Error('快捷键原模型未知');
    const eol = current.getEOL(); if (eol !== '\n' && eol !== '\r\n') throw Error('快捷键原模型EOL未知');
    return { sql: current.getValue(), eol, focused: editors[0].hasTextFocus() };
  }));
}
/** 只允许文件任务且全部终态，无查询库写入和SQL历史。 */
async function noSql(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  expect(await run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]);
  expect(await run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('queries.list', {})))).toEqual([]);
  const tasks = await run.step(owner, () => owner.page.evaluate(() => window.dbark.invoke('tasks.list', {})));
  expect(tasks.map(({ kind, status }) => ({ kind, status })).sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([{ kind: 'queryFileSources.open', status: 'completed' }, { kind: 'queryFileSources.save', status: 'completed' }]);
  expect(new Set(tasks.map(task => task.id)).size).toBe(2); expect(owner.errors).toEqual([]);
}
/** 本例正式表单与回环拒连前提沿原入口；每次await单独由原父门结算。 */
async function offlineQuery(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  const page = owner.page; await run.step(owner, async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, () => run.assert(owner))).click());
  const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
  for (const [label, value] of [[zh.connections.text006, '单次文件快捷键离线'], [zh.connections.text009, '127.0.0.1'], [zh.connections.text010, '1'], [zh.common.user, 'offline'], [zh.connections.text011, ''], [zh.connections.text012, '']]) await run.step(owner, () => form.getByLabel(label, { exact: true }).fill(value));
  await run.step(owner, () => form.getByRole('checkbox', { name: zh.connections.text016, exact: true }).uncheck()); await run.step(owner, async () => (await navigationMenuItem(form, { name: zh.connections.text036, exact: true }, () => run.assert(owner))).click()); await run.step(owner, () => expect(form).toBeHidden());
  const profiles = await run.step(owner, () => page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; })))); expect(profiles).toHaveLength(1); expect(profiles[0]).toMatchObject({ host: '127.0.0.1', port: 1, user: 'offline', rememberPassword: false }); expect(Boolean(profiles[0].hasPassword || profiles[0].ssh?.enabled || profiles[0].tls?.enabled)).toBe(false);
  await run.step(owner, async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newQuery, exact: true }, () => run.assert(owner))).click()); const query = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
  await run.step(owner, () => expect(query.locator('.error-box')).toContainText(/ECONNREFUSED|连接被拒绝|拒绝连接/i, { timeout: 20000 })); await run.step(owner, async () => (await navigationMenuItem(query, { name: zh.app.text053, exact: true }, () => run.assert(owner))).click()); await run.step(owner, () => expect(query).toBeHidden());
}
/** 严格Main来源核验仍在原launch中；reload仅开放官方只读getter。 */
async function observe(run: EditorIndentNativeRun, owner: IndentNativeOwner) {
  expect(await run.step(owner, () => owner.application.evaluate(({ app }) => app.getVersion()))).toBe('0.28.0');
  await run.step(owner, () => owner.page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; }));
  await run.step(owner, () => owner.page.reload()); await run.step(owner, () => expect(owner.page.locator('.app-statusbar')).toBeVisible());
}
/** 只回答原生文件选择一次，仍由正式UI和Main建立来源。 */
async function openSource(run: EditorIndentNativeRun, owner: IndentNativeOwner, path: string) {
  const nonce = randomUUID(); await run.step(owner, () => installSqlFilesOpenAnswer(owner.application, { nonce, path }));
  await run.step(owner, async () => (await navigationMenuItem(owner.page.locator('.query-tab:visible'), { name: text.open, exact: true }, () => run.assert(owner))).click()); const dialog = owner.page.getByRole('dialog', { name: text.open, exact: true });
  await run.step(owner, () => dialog.getByRole('combobox', { name: text.encoding, exact: true }).selectOption('utf8')); await run.step(owner, async () => (await navigationMenuItem(dialog, { name: text.openAction, exact: true }, () => run.assert(owner))).click());
  expect(await run.step(owner, () => finishSqlFilesOpenAnswer(owner.application, nonce))).toEqual({ calls: 1, restored: true }); await run.step(owner, () => expect(dialog).toBeHidden());
}
/** 单一用例只发一次保存按键；事件只是诊断，文件字节/来源/重启/正常退出仍决定成败。 */
export function registerShortcutNative(binding: ReturnType<typeof bindShortcutNativeEnvironment>, system?: SystemShortcutDriver) {
  test.use({ trace: 'off', screenshot: 'off', video: 'off' }); test.describe.configure({ mode: 'serial', timeout: 120000, retries: 0 });
  const scopes = new WeakMap<TestInfo, ReturnType<typeof bindEditorIndentNativeCase>>(); test.afterEach(({}, info) => scopes.get(info)?.retain());
  test(system?.caseTitle ?? shortcutNativeCase, async ({ trace, screenshot, video }, info) => {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); const scope = bindEditorIndentNativeCase(info, binding, () => test.info()); scopes.set(info, scope);
    const run = createEditorIndentNativeRun(scope, binding.approval); let files: QueryFilesNativeFiles | undefined, failure: unknown, log: ShortcutEventLog | undefined, removeConsole: (() => void) | undefined;
    let mainWindow: { window: number; contents: number; windowFocused: boolean; contentsFocused: boolean; destroyed: boolean } | undefined, observationFailure: unknown, presses = 0;
    let mainLog: MainProbeLog | undefined, removeMain: (() => void) | undefined;
    let systemReceipt: SystemShortcutReceipt | undefined;
    try {
      const first = await run.launch(); await observe(run, first); await offlineQuery(run, first);
      files = new QueryFilesNativeFiles(run.path!, () => run.assert()); await run.step(first, () => files!.start()); const path = files.paths.source, original = await run.step(first, () => files!.create(path, utf16NativeBytes(sourceSql)));
      await openSource(run, first, path); const opened = await settings(run, first); expect(opened.tabs).toHaveLength(2); const tab = opened.tabs[1]; expect(opened.activeTabId).toBe(tab.id); expect(tab.sql).toBe(sourceSql); expect(tab.sourceBinding).toBeUndefined(); expect(tab.fileSourceBinding).toBeDefined();
      expect((await run.step(first, () => files!.read(path, original))).bytes).toEqual(utf16NativeBytes(sourceSql));
      const baseline = await run.step(first, () => first.page.evaluate(tabId => window.dbark.invoke('queryFileSources.status', { tabId }), tab.id)); expect(baseline.state).toBe('bound'); if (baseline.state !== 'bound') throw Error('原快捷键来源未绑定'); expect(baseline.binding.ref).toEqual(tab.fileSourceBinding); expect(baseline.binding).toMatchObject({ encoding: 'utf16le', bom: 'utf16le', eol: 'crlf' });
      expect(baseline.binding.displayPath).toBe(path);
      const initial = await model(run, first), expectedSql = savedSql.replaceAll('\r\n', initial.eol); // 只映射手写预期，不拿实际结果生成golden。
      const input = first.page.locator('.query-tab:visible .monaco-editor').getByRole('textbox'); await run.step(first, () => input.focus()); await run.step(first, () => first.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')); await run.step(first, () => first.page.keyboard.insertText(expectedSql));
      await expect.poll(() => settings(run, first).then(value => value.tabs[1]?.sql)).toBe(expectedSql); expect((await model(run, first)).sql).toBe(expectedSql);
      await run.step(first, () => expect(first.page.locator('.query-tab:visible').getByRole('status', { name: text.fileSource, exact: true })).toContainText(text.dirty));
      const before = await settings(run, first); expect(before.activeTabId).toBe(tab.id); expect(before.tabs[1].fileSourceBinding).toEqual(tab.fileSourceBinding); expect(before.tabs[0]).toEqual(opened.tabs[0]);
      const start = Object.hasOwn(info, '_startWallTime') ? (info as unknown as { _startWallTime: number })._startWallTime : Number((info as unknown as { startTime: Date }).startTime), choice = { nonce: randomUUID(), tabId: tab.id, deadline: start + 120000 };
      log = new ShortcutEventLog(choice.nonce, () => { scope.assertCurrent(); run.assert(first); });
      const listener = (message: { text(): string }) => { try { log!.ingest(message.text()); } catch (reason) { observationFailure ??= reason; run.retained = true; log!.stop(); } };
      first.page.on('console', listener); removeConsole = () => first.page.removeListener('console', listener);
      // 原窗口来源与前台焦点分别记录；此处只读，不补focus或调用菜单。
      const handle = await run.step(first, () => first.application.browserWindow(first.page)); mainWindow = await run.step(first, () => handle.evaluate(window => ({ window: window.id, contents: window.webContents.id, windowFocused: window.isFocused(), contentsFocused: window.webContents.isFocused(), destroyed: window.isDestroyed() }))); await run.step(first, () => handle.dispose());
      // 与原runtime已完成来源证明逐项相等；不能把另一个窗口的Main输入混入本例。
      const proven = first.sourceDiagnostics?.filter(value => value.complete && value.observed.window).at(-1)?.observed.window;
      expect(proven).toMatchObject({ id: mainWindow.window, contents: mainWindow.contents, destroyed: false }); expect(mainWindow.destroyed).toBe(false);
      const mainChoice = { nonce: randomUUID(), deadline: choice.deadline, window: mainWindow.window, contents: mainWindow.contents };
      mainLog = new MainProbeLog(mainChoice, () => { scope.assertCurrent(); run.assert(first); });
      run.assert(first); const stdout = first.application.process().stdout; run.assert(first); if (!stdout) throw Error('Main原stdout未知');
      const mainListener = (chunk: Buffer) => { try { mainLog!.ingest(chunk); } catch { observationFailure ??= Error('Main被动观察失效'); run.retained = true; mainLog!.stop(); } };
      stdout.on('data', mainListener); removeMain = () => stdout.removeListener('data', mainListener);
      expect(await run.step(first, () => installMainProbe(first.application, mainChoice))).toEqual({ nonce: mainChoice.nonce, installed: true, window: mainChoice.window, contents: mainChoice.contents });
      await expect.poll(() => { scope.assertCurrent(); run.assert(first); return mainLog!.frames.filter(frame => frame.stage === 0).length; }).toBe(1);
      expect(await run.step(first, () => installShortcutObservation(first.page, choice))).toEqual({ nonce: choice.nonce, installed: true });
      await expect.poll(() => { scope.assertCurrent(); run.assert(first); return log!.events.filter(event => event.stage === 'before').length; }).toBe(1);
      if (system) {
        // 仅指定操作者系统输入入口等待一次握手；原Main来源、文件身份及120秒deadline全部沿用。
        const diagnostic = first.sourceDiagnostics?.filter(value => value.complete && value.observed.window).at(-1);
        expect(diagnostic?.observed.window).toMatchObject({ id: mainWindow.window, contents: mainWindow.contents, destroyed: false });
        expect(mainWindow.windowFocused && mainWindow.contentsFocused).toBe(true);
        systemReceipt = await run.step(first, () => system.waitForInput({ deadline: choice.deadline, window: mainWindow!.window, contents: mainWindow!.contents, mainPid: diagnostic!.observed.mainPid, rendererPid: diagnostic!.observed.window!.renderer, launcherPid: diagnostic!.expected.launcherPid, manifestSha256: binding.approval.approvedHash, source: { tabId: tab.id, ref: baseline.binding.ref, path, identity: original } }, () => { scope.assertCurrent(); run.assert(first); }, info));
      } else {
        presses++; await run.step(first, () => first.page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s'));
      }
      // 即使观察到keydown/menu，未保存仍在原5000ms断言失败；不补按、不fallback、不放宽期限。
      await run.step(first, () => expect(first.page.locator('.query-tab:visible').getByRole('status', { name: text.fileSource, exact: true })).toContainText(text.clean));
      expect(await run.step(first, () => detachShortcutObservation(first.page, choice))).toEqual({ nonce: choice.nonce, detached: true });
      await expect.poll(() => { scope.assertCurrent(); run.assert(first); return log!.events.filter(event => event.stage === 'detached').length; }).toBe(1);
      expect(await run.step(first, () => detachMainProbe(first.application, mainChoice))).toEqual({ nonce: mainChoice.nonce, detached: true });
      await expect.poll(() => { scope.assertCurrent(); run.assert(first); return mainLog!.frames.filter(frame => frame.stage === 4).length; }).toBe(1);
      if (observationFailure !== undefined) throw observationFailure; mainLog.stop(); removeMain(); removeMain = undefined; log.stop(); removeConsole(); removeConsole = undefined;
      if (system) {
        // ack仅是Root的一次外部请求声明；Main/DOM各自的被动事件数独立核验。
        expect(presses).toBe(0); expect(systemReceipt?.externalInputRequests).toBe(1);
        const mainKeys = mainLog.frames.filter(frame => frame.stage === 3 && frame.type === 1), domKeys = log.events.filter(event => event.stage === 'keydown');
        expect(mainKeys).toHaveLength(1); expect(mainKeys[0]).toMatchObject({ control: true, meta: false, shift: false, alt: false, repeat: false, composing: false });
        expect(domKeys).toHaveLength(1); expect(domKeys[0]).toMatchObject({ ctrl: true, meta: false, shift: false, alt: false, repeat: false, composing: false });
        expect(log.events.filter(event => event.stage === 'task' && event.task?.status === 'completed' && event.task.phase === 'terminal' && event.task.wrote === 'yes')).toHaveLength(1);
      } else expect(presses).toBe(1);
      expect(log.events.filter(event => event.stage === 'menu' && event.command === 'save-query')).toHaveLength(1);
      const saved = await run.step(first, () => files!.read(path)); expect(saved.bytes).toEqual(utf16NativeBytes(savedSql));
      const after = await settings(run, first); expect(after.tabs[0]).toEqual(before.tabs[0]); expect(after.activeTabId).toBe(tab.id); expect(after.tabs[1]).toEqual({ ...before.tabs[1], fileSourceBinding: { id: baseline.binding.ref.id, revision: baseline.binding.ref.revision + 1 } });
      const status = await run.step(first, () => first.page.evaluate(tabId => window.dbark.invoke('queryFileSources.status', { tabId }), tab.id)); expect(status.state).toBe('bound'); if (status.state !== 'bound') throw Error('保存后来源未知');
      expect(status.binding.ref).toEqual(after.tabs[1].fileSourceBinding); expect(status.binding).toMatchObject({ encoding: 'utf16le', bom: 'utf16le', eol: 'crlf', savedSqlDigest: createHash('sha256').update(expectedSql).digest('hex') });
      expect(status.binding.displayPath).toBe(baseline.binding.displayPath);
      await noSql(run, first); await run.close(first);
      const disk = await run.stopped(async value => { await files!.assertDirectory(); return readIndentNativeSettings(value, () => run.assert()); }); expect(disk.schema).toBe(9); expect(disk.settings.tabs).toEqual(after.tabs); expect(disk.settings.activeTabId).toBe(after.activeTabId);
      const second = await run.launch(); expect(second.application).not.toBe(first.application); await run.step(second, () => files!.assertDirectory()); await observe(run, second); await expect.poll(() => settings(run, second).then(value => ({ tabs: value.tabs, activeTabId: value.activeTabId }))).toEqual({ tabs: after.tabs, activeTabId: after.activeTabId });
      const restarted = await model(run, second); expect(restarted.sql).toBe(expectedSql.replace(/\r\n|\r|\n/g, restarted.eol)); expect((await run.step(second, () => files!.read(path, saved.identity))).bytes).toEqual(utf16NativeBytes(savedSql));
      await run.step(second, () => expect(second.page.locator('.query-tab:visible').getByRole('status', { name: text.fileSource, exact: true })).toContainText(text.clean)); await noSql(run, second); await run.close(second);
      await run.stopped(() => files!.closeHandles()); await run.stopped(() => files!.assertDirectory()); await run.finish();
      if (system) await info.attach('单次系统文件保存快捷键终态', { body: Buffer.from(JSON.stringify({ inputChannel: '@oai/sky.press_key', designatedInputOperator: system.operator, reviewer: 'Root', ...systemReceipt, pageKeyboardSaveRequests: presses, observedMainSaveKeydowns: mainLog.frames.filter(frame => frame.stage === 3 && frame.type === 1).length, observedDomSaveKeydowns: log.events.filter(event => event.stage === 'keydown').length, physicalKeyCountMeasured: false, sqliteSchema: disk.schema, normalOwners: run.owners.map(owner => ({ confirmed: owner.confirmed, closed: owner.closed, willQuit: owner.ready, pids: owner.ids.size })), directoryRemoved: run.removed })), contentType: 'application/json' });
      await info.attach('单次文件保存快捷键终态', { body: Buffer.from(JSON.stringify({ presses, mainWindow, mainFrames: mainLog.frames, events: log.events, sourceRef: status.binding.ref, fileIdentity: saved.identity, sqliteSchema: disk.schema, normalOwners: run.owners.map(owner => ({ confirmed: owner.confirmed, closed: owner.closed, willQuit: owner.ready, pids: owner.ids.size })), directoryRemoved: run.removed, nativeMenuClickObserved: false, menuWrapper: false, sqlExecution: 0, systemClipboard: 0 })), contentType: 'application/json' });
    } catch (reason) {
      failure = reason; run.retained = true; mainLog?.stop(); removeMain?.(); removeMain = undefined; log?.stop(); removeConsole?.(); removeConsole = undefined;
      // 原失败优先：只附加父进程已收到的内存记录，不在失败后evaluate/截图/读SQLite补证。
      try { await info.attach('单次文件保存快捷键保留现场', { body: Buffer.from(JSON.stringify({ presses, mainWindow, mainFrames: mainLog?.frames ?? [], events: log?.events ?? [], observationFailed: observationFailure !== undefined, directory: run.path, files: files?.records, owners: run.owners.map(owner => ({ confirmed: owner.confirmed, closed: owner.closed, willQuit: owner.ready, ids: [...owner.ids] })), automaticRetry: false, fallback: false, nativeMenuClickObserved: false })), contentType: 'application/json' }); }
      // finally仍可能关闭失败；同步保留附录错误，不能被后一层聚合覆盖。
      catch (attachment) { failure = new AggregateError([reason, attachment], '原快捷键失败与内存附录失败', { cause: reason }); throw failure; } throw reason;
    } finally { mainLog?.stop(); removeMain?.(); log?.stop(); removeConsole?.(); try { await files?.closeHandles(); } catch (closing) { run.retained = true; throw new AggregateError(failure === undefined ? [closing] : [failure, closing], '快捷键原文件句柄关闭失败', { cause: failure }); } }
  });
}

/** 原门进入具体动作后才加载真实菜单导航，不改变默认/列表阶段的资源边界。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args); }
