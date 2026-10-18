import { lstat, realpath, mkdir, open, readdir, unlink, rmdir } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TestInfo } from '@playwright/test';
import type { EditorIndentNativeRun, IndentNativeOwner } from './editor-indentation-native-owner';
import { assertQueryFileNativeKeyApproval, queryFileNativeKeyProtocol as protocol, type QueryFileNativeKeyStage } from './query-file-native-key-protocol';
import { observeQueryFileNativeDocument } from './query-file-native-document-observer';

type Guard = () => void;
/** 关闭已取得句柄是撤销后的唯一例外；其他每个异步操作前后都核原门。 */
async function checked<T>(guard: Guard, action: () => Promise<T>): Promise<T> { guard(); const value = await action(); guard(); return value; }
/** 目录固定设备/inode，文件额外拒绝硬链接；自然目录mtime变化不视作换目录。 */
function identity(value: BigIntStats, directory = false): string {
  if (value.isSymbolicLink() || (directory ? !value.isDirectory() : !value.isFile() || value.nlink !== 1n) || typeof value.dev !== 'bigint' || value.dev < 0n || typeof value.ino !== 'bigint' || value.ino <= 0n) throw Error('按键桥物理身份或链接未知');
  return JSON.stringify([String(value.dev), String(value.ino)]);
}
/** 已知文件用有界大小和纳秒版本封存，之后不为被重写的回执重新签名。 */
function version(value: BigIntStats): string {
  identity(value);
  if (typeof value.size !== 'bigint' || value.size < 0n || value.size > BigInt(protocol.requestLimit) || typeof value.mtimeNs !== 'bigint' || typeof value.ctimeNs !== 'bigint') throw Error('按键桥文件版本或大小未知');
  return JSON.stringify([identity(value), String(value.size), String(value.mtimeNs), String(value.ctimeNs)]);
}
/** 对象键顺序不授予权限，字段集合及所有值须逐项等于原请求。 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'undefined';
}

/** 仅在原case门内为本run新建独占桥目录；没有环境路径、服务器、launcher或新期限。 */
export async function createQueryFileNativeKeyBridge(run: EditorIndentNativeRun, scope: { assertCurrent(): void }, info: TestInfo, currentInfo: () => TestInfo) {
  assertQueryFileNativeKeyApproval(process.env, process.platform);
  const origin = info as TestInfo & { _startWallTime?: number; startTime?: Date };
  const start = Object.hasOwn(info, '_startWallTime') ? origin._startWallTime! : Number(origin.startTime);
  const deadline = start + 120000, caseId = info.testId, caseNonce = randomUUID(), root = run.path;
  const base = () => { scope.assertCurrent(); run.assert(); if (currentInfo() !== info || info.testId !== caseId || !root || run.path !== root || root !== resolve(root) || !basename(root).startsWith('dbark-indent-') || !caseId || !Number.isFinite(start) || info.timeout !== 120000) throw Error('按键桥原case或userdata归属未知'); };
  base(); const directory = join(root!, protocol.directory), known = new Map<string, string>(), observations = new Map<IndentNativeOwner, { owner: unknown; released: boolean }>();
  const diagnostics: unknown[] = []; let sequence = 0, pending = false, failed = false, removed = false, originalTab: string | undefined, originalSource: string | undefined;
  /** 任何桥异常都永久停链，不重发，不把未知回执降格为继续等待。 */
  const guard = (owner?: IndentNativeOwner) => { base(); if (failed || removed) throw Error('按键桥已停链或清理'); if (owner) run.assert(owner); };
  const parent = identity(await checked(() => guard(), () => lstat(root!, { bigint: true })), true);
  if (await checked(() => guard(), () => realpath(root!)) !== root) throw Error('按键桥userdata真实路径未知');
  await checked(() => guard(), () => mkdir(directory, { recursive: false, mode: 0o700 }));
  const ownDirectory = identity(await checked(() => guard(), () => lstat(directory, { bigint: true })), true);
  /** 固定父目录及独占子目录inode；已接受文件版本不允许被重复回执覆盖后重新签名。 */
  async function own(check: Guard, allowed: string[] = []) {
    check();
    for (const [path, stamp] of [[root!, parent], [directory, ownDirectory]]) {
      if (identity(await checked(check, () => lstat(path, { bigint: true })), true) !== stamp || await checked(check, () => realpath(path)) !== path) throw Error('按键桥目录身份已变化');
    }
    const names = await checked(check, () => readdir(directory));
    if (names.some(name => !known.has(name) && !allowed.includes(name)) || [...known.keys()].some(name => !names.includes(name))) throw Error('按键桥出现未知或消失的文件');
    for (const name of allowed.filter(name => names.includes(name))) {
      try { version(await checked(check, () => lstat(join(directory, name), { bigint: true }))); }
      catch (reason) { check(); if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason; }
      // Root可在readdir之后原子发布pending；消失只表示本次未取得它，最终回执仍须完整核验。
    }
    for (const [name, stamp] of known) if (version(await checked(check, () => lstat(join(directory, name), { bigint: true }))) !== stamp || await checked(check, () => realpath(join(directory, name))) !== join(directory, name)) throw Error('按键桥文件被重复、替换或改写');
    check();
  }
  /** 撤销后仍须关闭原句柄，但关闭完成不能把迟到结果重新授予权限。 */
  async function close(file: Awaited<ReturnType<typeof open>>, check: Guard) { let reason: unknown; try { check(); } catch (error) { reason = error; } await file.close(); if (reason) throw reason; check(); }
  /** 独占写请求，只接受新普通文件；完整文件封存后才向Root发布路径。 */
  async function publish(name: string, value: unknown, check: Guard) {
    await own(check); check(); const file = await open(join(directory, name), 'wx', 0o600);
    try {
      check(); identity(await checked(check, () => file.stat({ bigint: true })));
      await checked(check, () => file.writeFile(JSON.stringify(value))); await checked(check, () => file.sync());
      const stamp = version(await checked(check, () => file.stat({ bigint: true })));
      if (version(await checked(check, () => lstat(join(directory, name), { bigint: true }))) !== stamp || await checked(check, () => realpath(join(directory, name))) !== join(directory, name)) throw Error('按键请求路径与句柄不一致');
      known.set(name, stamp);
    } finally { await close(file, check); }
    await own(check);
  }
  /** 回执通过同一有界只读句柄读取，先核身份再读字节，读取后仍核原版本与路径。 */
  async function receipt(name: string, check: Guard, allowed: string[]): Promise<unknown | undefined> {
    await own(check, allowed); const path = join(directory, name);
    let named: BigIntStats;
    try { named = await checked(check, () => lstat(path, { bigint: true })); }
    catch (reason) { check(); if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw reason; }
    const stamp = version(named); if (named.size === 0n || await checked(check, () => realpath(path)) !== path) throw Error('按键回执为空或真实路径未知');
    check(); const file = await open(path, 'r');
    try {
      check(); if (version(await checked(check, () => file.stat({ bigint: true }))) !== stamp) throw Error('按键回执打开期间身份变化');
      await own(check, allowed);
      const bytes = Buffer.alloc(Number(named.size)); let offset = 0;
      while (offset < bytes.length) { const read = await checked(check, () => file.read(bytes, offset, bytes.length - offset, offset)); if (read.bytesRead <= 0 || read.bytesRead > bytes.length - offset) throw Error('按键回执截断'); offset += read.bytesRead; }
      const end = await checked(check, () => file.read(Buffer.alloc(1), 0, 1, bytes.length));
      if (end.bytesRead !== 0 || version(await checked(check, () => file.stat({ bigint: true }))) !== stamp || version(await checked(check, () => lstat(path, { bigint: true }))) !== stamp || await checked(check, () => realpath(path)) !== path) throw Error('按键回执读取期间版本变化');
      await own(check, allowed); check(); const value: unknown = JSON.parse(bytes.toString('utf8')); check(); known.set(name, stamp); return value;
    } finally { await close(file, check); }
  }
  /** 只观察所属窗口/菜单接收/编辑器焦点，不发菜单事件、不修改模型或临时标题。 */
  async function observe(owner: IndentNativeOwner, install: boolean, release: boolean, check: Guard) {
    const handle = await checked(check, () => owner.application.browserWindow(owner.page));
    const actualWindow = await checked(check, () => handle.evaluate(value => ({ windowId: value.id, contentsId: value.webContents.id, rendererPid: value.webContents.getOSProcessId(), nativeHandle: value.getNativeWindowHandle().toString('hex'), windowFocused: value.isFocused(), contentsFocused: value.webContents.isFocused(), destroyed: value.isDestroyed() })));
    const main = await checked(check, () => owner.application.evaluate(({ app, BrowserWindow }) => ({ mainPid: process.pid, userdata: app.getPath('userData'), focusedWindow: BrowserWindow.getFocusedWindow()?.id ?? null, windows: BrowserWindow.getAllWindows().filter(window => !window.isDestroyed()).map(window => window.id) })));
    if (actualWindow.destroyed || main.userdata !== root || !main.windows.includes(actualWindow.windowId) || !owner.ids.has(main.mainPid) || !owner.ids.has(actualWindow.rendererPid) || ![main.mainPid, actualWindow.windowId, actualWindow.contentsId, actualWindow.rendererPid].every(value => Number.isSafeInteger(value) && value > 0) || !/^(?:[a-f0-9]{2})+$/.test(actualWindow.nativeHandle) || /^0+$/.test(actualWindow.nativeHandle)) throw Error('按键桥实际owner或原生窗口身份未知');
    const fixed = { ordinal: run.owners.indexOf(owner) + 1, mainPid: main.mainPid, windowId: actualWindow.windowId, contentsId: actualWindow.contentsId, rendererPid: actualWindow.rendererPid, nativeHandle: actualWindow.nativeHandle };
    const prior = observations.get(owner); if (prior && canonical(prior.owner) !== canonical(fixed)) throw Error('按键桥原owner窗口身份变化');
    const renderer = await checked(check, () => owner.page.evaluate(({ install, release }) => {
      const root = window as Window & { __queryFileNativeKeys?: { count: number; dispose: () => void }; monaco?: typeof import('monaco-editor') };
      if (install) { if (root.__queryFileNativeKeys) throw Error('已有按键观察器，不覆盖'); const state = { count: 0, dispose: () => {} }; state.dispose = window.dbark.onMenu(action => { if (action === 'save-query') state.count++; }); root.__queryFileNativeKeys = state; }
      const state = root.__queryFileNativeKeys; if (!state) throw Error('按键观察器缺失');
      const value = { menuReceived: state.count, documentFocused: document.hasFocus(), activeElement: { tag: document.activeElement?.tagName, class: document.activeElement?.className }, dialogs: document.querySelectorAll('[role="dialog"]').length, editors: root.monaco?.editor.getEditors().filter(editor => editor.getContainerDomNode().getClientRects().length > 0).map(editor => ({ textFocus: editor.hasTextFocus(), widgetFocus: editor.hasWidgetFocus() })) ?? [] };
      if (release) { state.dispose(); delete root.__queryFileNativeKeys; } return value;
    }, { install, release }));
    check(); observations.set(owner, { owner: fixed, released: release }); return { owner: fixed, focus: { window: actualWindow, main, renderer } };
  }
  /** 当前请求独立观察UI；每次settings读取及renderer核对都在原门内，发布后允许正常修订增长。 */
  async function inspectDocument(owner: IndentNativeOwner, token: string, action: 'begin' | 'check' | 'end', expected: { tabId: string; sourceId: string; revision: number }, allowRevisionGrowth: boolean, check: Guard) {
    if (action === 'begin') await checked(check, () => owner.page.evaluate(observeQueryFileNativeDocument, { action: 'begin' as const, token, expected }));
    const settings = await checked(check, () => owner.page.evaluate(() => window.dbark.invoke('settings.get', {})));
    return checked(check, () => owner.page.evaluate(observeQueryFileNativeDocument, { action: action === 'begin' ? 'check' : action, token, settings, allowRevisionGrowth }));
  }
  return {
    /** 仅缓存供失败附件使用；停链后不得借诊断再次连接窗口或读取路径。 */
    diagnostics,
    async request(owner: IndentNativeOwner, stage: QueryFileNativeKeyStage, tabId: string, ref: { id: string; revision: number }) {
      const check = () => guard(owner);
      try {
        check(); const sourceId = ref?.id, revision = ref?.revision;
        if (pending || protocol.stages[sequence] !== stage || !tabId || originalTab !== undefined && originalTab !== tabId || !sourceId || originalSource !== undefined && originalSource !== sourceId || !Number.isSafeInteger(revision) || revision < 1 || (sequence < 3 ? run.owners.indexOf(owner) !== 0 : run.owners.indexOf(owner) !== 1) || observations.get(owner)?.released) throw Error('按键请求重复、错序或owner阶段未知');
        originalTab ??= tabId; originalSource ??= sourceId;
        pending = true; await own(check);
        const token = randomUUID(), expected = { tabId, sourceId, revision };
        const activeDocument = await inspectDocument(owner, token, 'begin', expected, false, check); check();
        const before = await observe(owner, !observations.has(owner), false, check); check(); const number = sequence + 1, suffix = String(number).padStart(2, '0');
        const request = { protocol: protocol.version, caseId, caseNonce, start, deadline, owner: before.owner, stage, tabId, sourceId, revision, sequence: number, nonce: token, key: protocol.key };
        const requestName = `request-${suffix}.json`, receiptName = `receipt-${suffix}.json`, pendingName = `receipt-${suffix}.pending`;
        await publish(requestName, request, check); await inspectDocument(owner, token, 'check', expected, false, check); check(); diagnostics.push({ phase: '请求前', request, activeDocument, focus: before.focus });
        check(); console.log('DBARK_QUERY_FILE_NATIVE_KEY_REQUEST ' + JSON.stringify({ requestPath: join(directory, requestName), receiptPath: join(directory, receiptName), pendingPath: join(directory, pendingName), request })); check();
        let value: unknown;
        do {
          await inspectDocument(owner, token, 'check', expected, true, check);
          value = await receipt(receiptName, check, [receiptName, pendingName]);
          await inspectDocument(owner, token, 'check', expected, true, check);
          if (value === undefined) await checked(check, () => new Promise<void>(done => setTimeout(done, 25)));
        } while (value === undefined);
        check();
        if (canonical(value) !== canonical({ ...request, status: 'sent' })) throw Error('按键回执未知、重复、错序或身份不符，禁止重发');
        await own(check); const completedDocument = await inspectDocument(owner, token, 'end', expected, true, check); check();
        const after = await observe(owner, false, false, check); check(); diagnostics.push({ phase: '已收到发送回执', request, activeDocument: completedDocument, focus: after.focus });
        sequence = number; pending = false;
      } catch (reason) { failed = true; run.retained = true; throw reason; }
    },
    /** 第一owner三阶段、第二owner一阶段后移除被动订阅，不改变任何保存或退出状态。 */
    async release(owner: IndentNativeOwner) {
      const check = () => guard(owner);
      try { check(); if (pending || !observations.has(owner) || observations.get(owner)!.released || (run.owners.indexOf(owner) === 0 ? sequence !== 3 : sequence !== 4)) throw Error('按键观察器释放阶段未知'); await own(check); const value = await observe(owner, false, true, check); check(); diagnostics.push({ phase: '退出前观察', ...value }); }
      catch (reason) { failed = true; run.retained = true; throw reason; }
    },
    /** 两owner正常退出/PID闭合后仅精确删除八个已封存文件；未知文件及pending一律保留。 */
    async cleanup(stoppedPath: string) {
      const check = () => guard();
      try {
        check(); if (stoppedPath !== root || pending || sequence !== 4 || known.size !== 8 || observations.size !== 2 || [...observations.values()].some(value => !value.released) || run.owners.length !== 2 || run.owners.some(owner => !owner.confirmed || !owner.closed || !owner.ready || !owner.ids.size)) throw Error('按键桥清理缺少四阶段及两owner正常退出证明');
        await own(check);
        for (const name of [...known.keys()]) { await own(check); await checked(check, () => unlink(join(directory, name))); known.delete(name); }
        await own(check); await checked(check, () => rmdir(directory));
        try { await checked(check, () => lstat(directory, { bigint: true })); } catch (reason) { check(); if ((reason as NodeJS.ErrnoException).code === 'ENOENT') { removed = true; return; } throw reason; }
        throw Error('按键桥目录仍存在，未完成清理');
      } catch (reason) { failed = true; run.retained = true; throw reason; }
    },
  };
}
