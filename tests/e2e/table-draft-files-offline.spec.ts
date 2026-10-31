import { test as baseTest } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import type { NetworkConnectionProfile as ConnectionProfile } from '../../src/shared/contracts';
import type { TableDraftDocument, TableDraftPayload } from '../../src/shared/tableDraft';

const listing = process.argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_TABLE_DRAFT_OFFLINE === '1';
const title = '离线正式Main草稿文件三种变更无损往返及同ID换端点拒绝';
// 默认与列表不加载桌面夹具、文件帮助器或任何实库配置。
if (enabled) register(); else baseTest.skip(title, () => {});

/** 本例只有正式IPC文件整例；不创建数据库连接或替代任何产品回包。 */
function register(): void {
  const runtime = require('./desktop-fixture') as typeof import('./desktop-fixture'), { test, expect } = runtime;
  const { bindEditorIndentNativeCase } = require('./editor-indentation-native-gate') as typeof import('./editor-indentation-native-gate');
  const { installTableDraftFileAnswer, finishTableDraftFileAnswer } = require('../helpers/tableDraftUi') as typeof import('../helpers/tableDraftUi');
  const { decodeTableDraft } = require('../../src/shared/tableDraft') as typeof import('../../src/shared/tableDraft');
  const { mkdtemp, readFile, readdir, lstat, unlink, rmdir } = require('node:fs/promises') as typeof import('node:fs/promises');
  const { basename, dirname, join, resolve } = require('node:path') as typeof import('node:path');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { randomUUID, createHash } = require('node:crypto') as typeof import('node:crypto');
  const assertEnabled = () => { if (!enabled || process.env.DBARK_TABLE_DRAFT_OFFLINE !== '1') throw Error('离线草稿文件原显式门已变化，停止执行'); };
  let complete = false, completionCheck: (() => void) | undefined;
  test.use({ preserveOnUnconfirmedExit: true, ownedDesktopLaunchGuard: { assertCurrent: assertEnabled }, trace: 'off', screenshot: 'off', video: 'off' });
  test.setTimeout(120000); test.describe.configure({ retries: 0, mode: 'serial' });
  test.afterEach(({}, info) => {
    if (!complete || !completionCheck) { runtime.retainOwnedDesktopResources(info); throw Error('离线草稿文件原例未完整退出或清理，保留现场'); }
    try { completionCheck(); } catch (reason) { runtime.retainOwnedDesktopResources(info); throw reason; }
  });

  /** 最小Main旁观：允许请求原样透传，意外数据库请求或引擎启动在外发前立即失败。 */
  async function installAudit(application: ElectronApplication, connectionId: string): Promise<void> {
    await application.evaluate(({ ipcMain, BrowserWindow, utilityProcess }, connectionId) => {
      const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, previous = handlers?.get('dbark:request'), originalFork = utilityProcess.fork;
      const windows = BrowserWindow.getAllWindows(), window = windows[0], contents = window?.webContents, frame = contents?.mainFrame;
      if (root.__dbarkTableDraftOffline || typeof previous !== 'function' || typeof originalFork !== 'function' || windows.length !== 1 || !frame) throw Error('离线草稿Main原归属未知');
      const state = { pending: 0, calls: [] as { command: string; ok: boolean }[], denied: [] as string[], forks: 0, check() {}, restore() {} };
      const check = () => { if (root.__dbarkTableDraftOffline !== state || handlers.get('dbark:request') !== wrapped || utilityProcess.fork !== blockedFork || window.isDestroyed() || contents.isDestroyed() || contents.mainFrame !== frame || BrowserWindow.getAllWindows().length !== 1 || BrowserWindow.getAllWindows()[0] !== window) throw Error('离线草稿原Main旁观所有权已变化'); };
      const blockedFork = ((..._args: unknown[]) => { state.forks++; throw Error('离线草稿文件例禁止启动数据库或其它执行进程'); }) as typeof utilityProcess.fork;
      const allowed = new Set(['connections.save', 'connections.list', 'tableDraftFiles.save', 'tableDraftFiles.open', 'settings.get', 'settings.save', 'tasks.list']);
      const wrapped = async (event: any, payload: any) => {
        check(); if (event.sender !== contents || event.senderFrame !== frame) throw Error('离线草稿IPC来源不属于原窗口');
        const command = payload?.command, input = payload?.input, fact = { command: String(command), ok: false }; state.calls.push(fact); state.pending++;
        try {
          if (!allowed.has(command)) { state.denied.push(String(command)); throw Error('离线草稿文件例禁止数据库或未声明请求'); }
          if (command === 'connections.save' && (input.id !== connectionId || typeof input.host !== 'string' || !input.host.endsWith('.invalid') || input.port !== 1 || input.user !== 'dbark_offline_user' || Object.hasOwn(input, 'password') || input.ssh || input.tls)) throw Error('离线合成配置离开本例无凭据目标');
          if (command === 'tableDraftFiles.save' || command === 'tableDraftFiles.open') {
            const target = command === 'tableDraftFiles.save' ? input.payload.target : input.target;
            if (target.connectionId !== connectionId || target.database !== 'offline_fixture' || target.table !== 'synthetic_subject' || Object.hasOwn(input, 'filePath')) throw Error('离线草稿文件请求离开准确目标');
          }
          const response = await previous(event, payload); check(); fact.ok = response?.ok === true; return response;
        } finally { state.pending--; }
      };
      state.check = check;
      state.restore = () => { check(); if (state.pending) throw Error('离线草稿原Main请求仍未结算'); handlers.set('dbark:request', previous); utilityProcess.fork = originalFork; if (handlers.get('dbark:request') !== previous || utilityProcess.fork !== originalFork) throw Error('离线草稿原Main适配恢复未确认'); delete root.__dbarkTableDraftOffline; };
      root.__dbarkTableDraftOffline = state; utilityProcess.fork = blockedFork; handlers.set('dbark:request', wrapped); check();
    }, connectionId);
  }
  /** 读取有限事实，不读取连接凭据、数据库进程私有状态或替换真实处理结果。 */
  async function audit(application: ElectronApplication) {
    return application.evaluate(() => { const state = (globalThis as any).__dbarkTableDraftOffline; if (!state) throw Error('离线草稿Main旁观缺失'); state.check(); return { pending: state.pending as number, calls: state.calls as { command: string; ok: boolean }[], denied: state.denied as string[], forks: state.forks as number }; });
  }

  test(title, async ({ trace, screenshot, video }, info) => {
    assertEnabled(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    const original = runtime.ownedDesktopResources(info), { page, application } = original, profileDirectory = runtime.dataDir;
    const clock = bindEditorIndentNativeCase(info, { assertCurrent() { assertEnabled(); const current = runtime.ownedDesktopResources(info); if (current.page !== page || current.application !== application || runtime.dataDir !== profileDirectory) throw Error('离线草稿原桌面或用户目录归属变化'); } }, () => test.info());
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { clock.assertCurrent(); const value = await action(); clock.assertCurrent(); return value; };
    const profileId = randomUUID(), nonceHost = randomUUID().replaceAll('-', ''), target = { connectionId: profileId, database: 'offline_fixture', table: 'synthetic_subject' };
    const profile: ConnectionProfile = { id: profileId, name: '本例合成离线连接', group: '离线文件验证', color: '#3478a4', dialect: 'mysql', host: 'dbark-' + nonceHost + '.invalid', port: 1, user: 'dbark_offline_user', rememberPassword: false };
    const source: TableDraftPayload = { target, metadataKey: 'synthetic-offline-definition-v1', changes: [
      { kind: 'insert', values: { id: '18446744073709551615', decimal: '9007199254740993.12345678901234567890', stamp: '2026-10-27 12:34:56.123456', nullable: null, empty: '', payload: { type: 'binary', base64: 'AP+AAA==' }, emptyPayload: { type: 'binary', base64: '' }, json: ' { "n": 900719925474099312345, "neg": -0, "k": null } ', negativeZero: -0, flag: true } },
      { kind: 'update', before: { id: '2', text: '旧原值', payload: { type: 'binary', base64: 'AP8=' }, nullable: null, negativeZero: -0 }, values: { text: '新值', nullable: '', negativeZero: -0 } },
      { kind: 'delete', before: { id: '3', text: '', nullable: null, json: '{"nested":[1,2,3]}' } },
    ] };
    let directory = '', path = '', directoryIdentity: { dev: number; ino: number } | undefined, originalBytes: Buffer | undefined, answer: string | undefined, armed = false, exited = false;
    try {
      // 公开ProcessMetric证明实际renderer的OS沙箱；不把静态配置或新建world的隔离性冒充运行事实。
      // Electron44.7.0文档：docs/api/structures/process-metric.md；本地electron.d.ts同样声明Windows/macOS的sandboxed。
      const rendererMetrics = await step(() => application.evaluate(({ BrowserWindow, app }) => {
        const windows = BrowserWindow.getAllWindows(); if (windows.length !== 1) throw Error('离线草稿窗口数量不唯一');
        const window = windows[0], contents = window.webContents, frame = contents.mainFrame, pid = contents.getOSProcessId();
        const matches = app.getAppMetrics().filter(metric => metric.pid === pid);
        if (!Number.isSafeInteger(pid) || pid <= 0 || matches.length !== 1 || matches[0].type !== 'Tab' || matches[0].sandboxed !== true) throw Error('原renderer的唯一OS沙箱事实未确认');
        if (window.isDestroyed() || contents.isDestroyed() || contents.getOSProcessId() !== pid || contents.mainFrame !== frame || BrowserWindow.getAllWindows().length !== 1 || BrowserWindow.getAllWindows()[0] !== window) throw Error('原renderer安全探针所有权已变化');
        return { rendererPid: pid, rendererType: matches[0].type, sandboxed: matches[0].sandboxed };
      }));
      expect(rendererMetrics.sandboxed).toBe(true); expect(rendererMetrics.rendererType).toBe('Tab');
      // 固定生产preload仅contextBridge.exposeInMainWorld导出dbark；官方44.7.0实现先拒绝未启用contextIsolation。
      // https://github.com/electron/electron/blob/v44.7.0/lib/renderer/api/context-bridge.ts
      // 结合真实桥对象与本例后续正式Main IPC回包证明桥接；不伪造process.contextIsolated布尔值。
      const bridge = await step(() => page.evaluate(() => {
        const api = window.dbark, descriptor = Object.getOwnPropertyDescriptor(window, 'dbark');
        if (!api || typeof api !== 'object' || !descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.value !== api) throw Error('原预载桥对象缺失或不是自有数据属性');
        const bridgeMethods = Object.fromEntries(['invoke', 'onTask', 'onMenu'].map(name => {
          const method = Object.getOwnPropertyDescriptor(api, name);
          if (!method || !Object.hasOwn(method, 'value')) throw Error('原预载桥方法缺失或不是数据属性');
          return [name, { type: typeof method.value, frozen: Object.isFrozen(method.value) }];
        }));
        return { mainWorldNodeGlobals: { process: typeof process, require: typeof require, module: typeof module }, bridgeFrozen: Object.isFrozen(api), bridgeDescriptor: { writable: descriptor.writable, configurable: descriptor.configurable }, bridgeMethods };
      }));
      expect(bridge.mainWorldNodeGlobals).toEqual({ process: 'undefined', require: 'undefined', module: 'undefined' });
      expect(bridge.bridgeFrozen).toBe(true); expect(bridge.bridgeDescriptor).toEqual({ writable: false, configurable: false });
      expect(bridge.bridgeMethods).toEqual({ invoke: { type: 'function', frozen: true }, onTask: { type: 'function', frozen: true }, onMenu: { type: 'function', frozen: true } });
      const security = { ...rendererMetrics, ...bridge };
      await step(async () => { directory = await mkdtemp(join(tmpdir(), 'dbark-draft-offline-')); path = join(directory, 'synthetic.dbark-draft'); });
      expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory)).toMatch(/^dbark-draft-offline-/);
      const directoryStat = await step(() => lstat(directory)); expect(directoryStat.isDirectory() && !directoryStat.isSymbolicLink()).toBe(true); directoryIdentity = { dev: directoryStat.dev, ino: directoryStat.ino };
      armed = true; await step(() => installAudit(application, profileId));
      expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; }))))).toEqual([]);
      const savedProfile = await step(() => page.evaluate(profile => window.dbark.invoke('connections.save', profile).then(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; }), profile));
      expect(savedProfile).toMatchObject({ id: profileId, host: profile.host, port: 1, user: profile.user });
      expect(savedProfile.password).toBeUndefined(); expect(savedProfile.ssh).toBeUndefined(); expect(savedProfile.tls).toBeUndefined();

      answer = randomUUID(); await step(() => installTableDraftFileAnswer(application, { nonce: answer!, path, mode: 'save' }));
      const saved = await step(() => page.evaluate(async payload => {
        const inserted = payload.changes[0]; if (inserted.kind !== 'insert' || !Object.is(inserted.values.negativeZero, -0) || Object.hasOwn(inserted.values, 'defaulted')) throw Error('离线草稿原输入未保持负零或DEFAULT省略');
        return window.dbark.invoke('tableDraftFiles.save', { payload });
      }, source));
      expect(saved).toEqual({ name: basename(path) });
      expect(await step(() => finishTableDraftFileAnswer(application, answer!))).toEqual({ calls: 1, originalRestored: true, nativeInputVerified: false }); answer = undefined;
      originalBytes = await step(() => readFile(path));
      const document: TableDraftDocument = decodeTableDraft(new TextDecoder('utf-8', { fatal: true }).decode(originalBytes));
      expect(document).toMatchObject({ kind: 'dbark.table-draft', version: 1, target, metadataKey: source.metadataKey, changes: source.changes });
      expect(document.endpointKey).toMatch(/^[a-f0-9]{64}$/); expect(Object.keys(document).sort()).toEqual(['changes', 'endpointKey', 'kind', 'metadataKey', 'target', 'version']);
      expect(originalBytes.toString('utf8')).not.toContain(profile.host); expect(originalBytes.toString('utf8')).not.toContain(profile.user);
      const inserted = document.changes[0]; if (inserted.kind !== 'insert') throw Error('离线草稿操作顺序变化');
      expect(Object.is(inserted.values.negativeZero, -0)).toBe(true); expect(Object.hasOwn(inserted.values, 'defaulted')).toBe(false);
      expect(inserted.values.nullable).toBeNull(); expect(inserted.values.payload).toEqual({ type: 'binary', base64: 'AP+AAA==' }); expect(inserted.values.emptyPayload).toEqual({ type: 'binary', base64: '' });
      expect(inserted.values.json).toBe(' { "n": 900719925474099312345, "neg": -0, "k": null } ');

      answer = randomUUID(); await step(() => installTableDraftFileAnswer(application, { nonce: answer!, path, mode: 'open' }));
      const opened = await step(() => page.evaluate(async target => {
        const result = await window.dbark.invoke('tableDraftFiles.open', { target }); if (!result) throw Error('离线草稿原打开被取消');
        const inserted = result.document.changes.find(change => change.kind === 'insert');
        return { ...result, negativeZero: inserted?.kind === 'insert' && Object.is(inserted.values.negativeZero, -0), defaultOmitted: inserted?.kind === 'insert' && !Object.hasOwn(inserted.values, 'defaulted') };
      }, target));
      expect(await step(() => finishTableDraftFileAnswer(application, answer!))).toEqual({ calls: 1, originalRestored: true, nativeInputVerified: false }); answer = undefined;
      expect(opened).toEqual({ name: basename(path), document, negativeZero: true, defaultOmitted: true });
      expect((await step(() => readFile(path))).equals(originalBytes)).toBe(true);

      const changed = { ...profile, host: 'dbark-changed-' + nonceHost + '.invalid' };
      expect(await step(() => page.evaluate(profile => window.dbark.invoke('connections.save', profile).then(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; }), changed))).toMatchObject({ id: profileId, host: changed.host });
      answer = randomUUID(); await step(() => installTableDraftFileAnswer(application, { nonce: answer!, path, mode: 'open' }));
      const rejected = await step(() => page.evaluate(async target => { try { await window.dbark.invoke('tableDraftFiles.open', { target }); return { rejected: false, error: '' }; } catch (reason) { return { rejected: true, error: reason instanceof Error ? reason.message : String(reason) }; } }, target));
      expect(await step(() => finishTableDraftFileAnswer(application, answer!))).toEqual({ calls: 1, originalRestored: true, nativeInputVerified: false }); answer = undefined;
      expect(rejected.rejected).toBe(true); expect(rejected.error).toContain('草稿不属于当前连接目标或表');
      expect((await step(() => readFile(path))).equals(originalBytes)).toBe(true);
      expect(await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})))).toEqual([]);
      const facts = await step(() => audit(application)); expect(facts.pending).toBe(0); expect(facts.denied).toEqual([]); expect(facts.forks).toBe(0);
      expect(facts.calls.filter(call => call.command === 'connections.save')).toEqual([{ command: 'connections.save', ok: true }, { command: 'connections.save', ok: true }]);
      expect(facts.calls.filter(call => call.command === 'tableDraftFiles.save')).toEqual([{ command: 'tableDraftFiles.save', ok: true }]);
      expect(facts.calls.filter(call => call.command === 'tableDraftFiles.open')).toEqual([{ command: 'tableDraftFiles.open', ok: true }, { command: 'tableDraftFiles.open', ok: false }]);
      expect(facts.calls.some(call => call.command === 'connections.open' || call.command.startsWith('query.') || call.command.startsWith('table.'))).toBe(false); expect(runtime.pageErrors).toEqual([]);
      await step(() => info.attach('离线正式Main草稿文件证据', { body: JSON.stringify({ facts, security, changes: document.changes.map(change => change.kind), bytes: originalBytes!.length, sha256: createHash('sha256').update(originalBytes!).digest('hex'), negativeZero: true, defaultOmitted: true, fileAnswers: 3, nativeFileInputVerified: false, databaseConnected: false }, null, 2), contentType: 'application/json' }));
      await step(() => application.evaluate(() => (globalThis as any).__dbarkTableDraftOffline.restore())); armed = false;
      await step(() => runtime.confirmOwnedDesktopExit(info)); exited = true; expect(runtime.ownedDesktopResources(info).closed).toBe(true);
      // 只删本例独占文件与空目录；准确字节和目录内容均在删除前再次核对。
      expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory)).toMatch(/^dbark-draft-offline-/);
      expect(resolve(path)).toBe(join(resolve(directory), 'synthetic.dbark-draft'));
      const currentDirectory = await step(() => lstat(directory)); expect(currentDirectory.isDirectory() && !currentDirectory.isSymbolicLink()).toBe(true); expect({ dev: currentDirectory.dev, ino: currentDirectory.ino }).toEqual(directoryIdentity);
      const stat = await step(() => lstat(path)); expect(stat.isFile() && !stat.isSymbolicLink()).toBe(true); expect((await step(() => readFile(path))).equals(originalBytes)).toBe(true); expect(await step(() => readdir(directory))).toEqual(['synthetic.dbark-draft']);
      await step(() => unlink(path)); await step(() => rmdir(directory));
      completionCheck = () => { clock.assertCurrent(); if (!exited || !runtime.ownedDesktopResources(info).closed || armed || answer) throw Error('离线草稿退出或适配门未闭合'); };
      complete = true; completionCheck();
    } catch (reason) {
      clock.retain(); runtime.retainOwnedDesktopResources(info);
      try { await info.attach('离线草稿失败保留现场', { body: JSON.stringify({ directory, path, armed, fileAnswer: answer, exited, bytesKnown: originalBytes?.length, autoRetry: false }), contentType: 'application/json' }); } catch { /* 不覆盖原失败。 */ }
      throw reason;
    }
  });
}