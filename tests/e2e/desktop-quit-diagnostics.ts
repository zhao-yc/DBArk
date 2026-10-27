import type { ElectronApplication, Page, TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDesktopQuitDiagnostics, type DesktopQuitDiagnosticEvent, type DesktopQuitDiagnosticPayload } from '../helpers/desktopQuitDiagnostics';

/** 只记录本次launch的事件，不持有退出、强停、删除或重新启动端口。 */
export interface DesktopQuitTrace {
  record(event: DesktopQuitDiagnosticEvent, payload?: DesktopQuitDiagnosticPayload): void;
  arm(): Promise<void>;
  current(): boolean;
}

interface DesktopQuitArchiveRecord {
  generation: number; mainPid: number;
  arming: 'not-started' | 'pending' | 'armed' | 'unavailable';
  fileWritten: boolean; bodyAttached: boolean; incomplete: boolean;
}

/** 旁观原公开方法的原Promise和异常；不改调用参数、this、等待期限或返回值。 */
export function observeDesktopQuitMethods(application: ElectronApplication, trace: DesktopQuitTrace, readClosed: () => boolean): () => void {
  const names = ['evaluate', 'waitForEvent', 'close'] as const;
  const before = Object.fromEntries(names.map(name => [name, { descriptor: Object.getOwnPropertyDescriptor(application, name), value: application[name] }]));
  const installed = new Map<string, unknown>();
  const record = (event: DesktopQuitDiagnosticEvent, payload?: DesktopQuitDiagnosticPayload) => { try { trace.record(event, payload); } catch { /* 旁观错误不能改原方法结果。 */ } };
  const closed = (): DesktopQuitDiagnosticPayload => { try { return { closed: readClosed() }; } catch { record('observer-unavailable', { ok: false }); return {}; } };
  /** 只增设旁听，不返回派生Promise；原方法的拒绝仍由原调用方消费。 */
  const observe = (result: unknown, success: DesktopQuitDiagnosticEvent, failure: DesktopQuitDiagnosticEvent, payload?: DesktopQuitDiagnosticPayload) => {
    try { void Promise.resolve(result).then(() => record(success, { ...payload, ...closed() }), () => record(failure, closed())); }
    catch { record('observer-unavailable', { ok: false }); }
  };
  const wrappers = {
    evaluate(this: unknown, ...args: unknown[]) {
      const method = this === application && (args[1] === 'app' || args[1] === 'window') ? args[1] : undefined;
      if (method) record('quit-requested', { method, ...closed() });
      try {
        const result = Reflect.apply(before.evaluate.value, this, args);
        if (method) observe(result, 'quit-request-returned', 'quit-failed', { method });
        return result;
      } catch (error) { if (method) record('quit-failed', closed()); throw error; }
    },
    waitForEvent(this: unknown, ...args: unknown[]) {
      const watched = this === application && args[0] === 'close';
      if (watched) record('close-wait-started', closed());
      try {
        const result = Reflect.apply(before.waitForEvent.value, this, args);
        if (watched) observe(result, 'close-wait-resolved', 'close-wait-rejected');
        return result;
      } catch (error) { if (watched) record('close-wait-rejected', closed()); throw error; }
    },
    close(this: unknown, ...args: unknown[]) {
      if (this === application) record('desktop-close-started', closed());
      try {
        const result = Reflect.apply(before.close.value, this, args);
        if (this === application) observe(result, 'desktop-close-resolved', 'desktop-close-rejected');
        return result;
      } catch (error) { if (this === application) record('desktop-close-rejected', closed()); throw error; }
    },
  };
  /** 只恢复仍属于本层的属性描述符，不覆盖后来安装的其他旁观器。 */
  const restore = () => {
    for (const name of names) {
      if (!installed.has(name)) continue;
      try {
        if (application[name] !== installed.get(name)) { record('observer-unavailable', { ok: false }); continue; }
        const descriptor = before[name].descriptor;
        if (descriptor) Object.defineProperty(application, name, descriptor); else Reflect.deleteProperty(application, name);
      } catch { record('observer-unavailable', { ok: false }); }
      installed.delete(name);
    }
  };
  try { for (const name of names) { Object.defineProperty(application, name, { configurable: true, writable: true, value: wrappers[name] }); installed.set(name, wrappers[name]); } }
  catch { record('observer-unavailable', { ok: false }); restore(); }
  return restore;
}

/** 每个用例限定八个原应用；必须同时核对归档摘要，不能单凭旧快照宣称完整。 */
export function createDesktopQuitDiagnosticContext(info: TestInfo) {
  const owned = new Map<ElectronApplication, { trace: DesktopQuitTrace; finish(): Promise<void> }>();
  const archives: DesktopQuitArchiveRecord[] = [];
  let active = true, omitted = 0, ioFailures = 0, finishPromise: Promise<void> | undefined;
  /** 只累加有界计数，不保存异常正文、SQL、路径或任意调用参数。 */
  const missing = () => { omitted = Math.min(omitted + 1, Number.MAX_SAFE_INTEGER); };
  const ioFailed = () => { ioFailures = Math.min(ioFailures + 1, Number.MAX_SAFE_INTEGER); };
  const unavailable = () => { try { console.log('DBARK_QUIT_DIAGNOSTIC_ARCHIVAL_UNAVAILABLE'); } catch { /* 不覆盖原用例结果。 */ } };
  /** Main旁观器跟随原进程寿命；这里只移除测试侧监听，不声称恢复Main处理器。 */
  const manifest = () => ({
    version: 1, mainObserver: 'followProcessLifetime', omitted, ioFailures,
    incomplete: omitted > 0 || ioFailures > 0 || archives.some(value => value.incomplete),
    archivalComplete: omitted === 0 && ioFailures === 0 && archives.every(value => value.fileWritten && value.bodyAttached),
    records: archives.map(value => ({ ...value })),
  });
  /** 摘要优先附内存正文，失败才落独立文件；成功后不再写可能过期的第二份摘要。 */
  const archiveManifest = async () => {
    try { await info.attach('退出阶段归档摘要', { body: Buffer.from(JSON.stringify(manifest(), null, 2)), contentType: 'application/json' }); return; }
    catch { ioFailed(); }
    try { const file = info.outputPath('quit-diagnostic-manifest.json'); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(manifest(), null, 2)); return; }
    catch { ioFailed(); }
    unavailable();
  };
  return {
    /** 同一应用多次退出共用原记录，不重复安装Main旁观器。 */
    begin(application: ElectronApplication, page: Page): DesktopQuitTrace | undefined {
      if (!active) return;
      const existing = owned.get(application); if (existing) return existing.trace;
      if (owned.size >= 8) { missing(); return; }
      let detach = () => {};
      try {
        const process = application.process(), mainPid = process?.pid;
        if (!Number.isSafeInteger(mainPid) || !mainPid || mainPid <= 0) { missing(); return; }
        const generation = owned.size + 1, token = randomUUID(), prefix = 'DBARK_QUIT_DIAGNOSTIC:' + token + ':';
        const recorder = createDesktopQuitDiagnostics({ token, generation, mainPid });
        const file = info.outputPath(`quit-diagnostic-${generation}.json`);
        const archive: DesktopQuitArchiveRecord = { generation, mainPid, arming: 'not-started', fileWritten: false, bodyAttached: false, incomplete: false };
        let disposed = false, armPromise: Promise<void> | undefined;
        const current = () => active && !disposed && owned.get(application)?.trace === trace;
        /** 文件仅含记录器白名单快照；写入失败不覆盖原用例结果。 */
        const persist = () => {
          try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(recorder.snapshot(), null, 2)); archive.fileWritten = true; }
          catch { archive.fileWritten = false; archive.incomplete = true; ioFailed(); recorder.record(token, 'observer-unavailable', { ok: false }); }
        };
        const record = (event: DesktopQuitDiagnosticEvent, payload?: DesktopQuitDiagnosticPayload) => {
          if (!current()) return;
          try { recorder.record(token, event, payload); persist(); } catch { /* 诊断不替代原退出错误。 */ }
        };
        const onApplicationClose = () => record('application-close', { closed: true });
        const onPageClose = () => record('page-close', { pageClosed: true });
        /** Node信号仅保留已知枚举；未知值标记缺证，不回显任意错误正文。 */
        const processPayload = (code: number | null, signal: NodeJS.Signals | null): DesktopQuitDiagnosticPayload => {
          if (signal !== null && !['SIGTERM', 'SIGKILL', 'SIGINT'].includes(signal)) { record('observer-unavailable', { ok: false }); return { exitCode: code }; }
          return { exitCode: code, signal: signal as 'SIGTERM' | 'SIGKILL' | 'SIGINT' | null };
        };
        const onExit = (code: number | null, signal: NodeJS.Signals | null) => record('process-exit', processPayload(code, signal));
        const onProcessClose = (code: number | null, signal: NodeJS.Signals | null) => record('process-close', processPayload(code, signal));
        const onConsole = (message: { text(): string }) => {
          try {
            const text = message.text();
            if (text.startsWith(prefix)) {
              const body = text.slice(prefix.length); if (body.length > 512) { record('observer-unavailable', { ok: false }); return; }
              const value = JSON.parse(body) as { event: DesktopQuitDiagnosticEvent; payload?: DesktopQuitDiagnosticPayload };
              record(value.event, value.payload);
            } else if (text.startsWith('DBARK_E2E_DIALOG:')) {
              if (text.length > 4096) { record('observer-unavailable', { ok: false }); return; }
              const value = JSON.parse(text.slice('DBARK_E2E_DIALOG:'.length)) as { title?: string; response?: number };
              const dialogKind = value.title === '仍有待完成的工作' ? 'pending-work' : value.title === '退出前保存或收尾失败' ? 'shutdown-failed' : 'other';
              if (Number.isInteger(value.response) && value.response! >= 0 && value.response! <= 32) record('dialog-response', { dialogKind, response: value.response });
              else record('observer-unavailable', { ok: false });
            }
          } catch { record('observer-unavailable', { ok: false }); }
        };
        detach = () => {
          application.off('close', onApplicationClose); application.off('console', onConsole); page.off('close', onPageClose);
          process.off('exit', onExit); process.off('close', onProcessClose);
        };
        application.on('close', onApplicationClose); application.on('console', onConsole); page.on('close', onPageClose);
        process.on('exit', onExit); process.on('close', onProcessClose);
        const trace: DesktopQuitTrace = { record, current,
          /** 只旁观原Main事件及settings.save的原Promise；不读取保存内容或改回包。 */
          arm() {
            if (armPromise) return armPromise;
            if (!current()) return Promise.resolve();
            archive.arming = 'pending';
            armPromise = (async () => { try {
              const result = await application.evaluate(({ app, ipcMain }, marker) => {
                const emit = (event: string, payload?: { ok: boolean }) => { try { console.log(marker + JSON.stringify({ event, ...(payload ? { payload } : {}) })); } catch { /* 只读旁观失败不改业务。 */ } };
                app.on('before-quit', () => emit('before-quit')); app.on('quit', () => emit('app-quit'));
                // 此测试端口已在Main旁观专项使用；不可用只记缺证，不安装替代业务处理器。
                const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, (...args: unknown[]) => unknown> })._invokeHandlers;
                const original = handlers?.get('dbark:request'); if (!handlers || typeof original !== 'function') return false;
                handlers.set('dbark:request', function (this: unknown, ...args: unknown[]) {
                  const payload = args[1] as { command?: unknown } | undefined;
                  if (payload?.command !== 'settings.save') return Reflect.apply(original, this, args);
                  emit('settings-save-started');
                  try {
                    const result = Reflect.apply(original, this, args);
                    void Promise.resolve(result).then(value => {
                      const ok = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'ok') : undefined;
                      if (ok && 'value' in ok && typeof ok.value === 'boolean') emit('settings-save-finished', { ok: ok.value });
                      else emit('observer-unavailable', { ok: false });
                    }, () => emit('settings-save-finished', { ok: false }));
                    return result;
                  } catch (error) { emit('settings-save-finished', { ok: false }); throw error; }
                });
                return true;
              }, prefix);
              if (!current()) return;
              archive.arming = result ? 'armed' : 'unavailable';
              record(result ? 'observer-armed' : 'observer-unavailable', { ok: result });
            } catch { if (current()) { archive.arming = 'unavailable'; record('observer-unavailable', { ok: false }); } } })();
            return armPromise;
          },
        };
        owned.set(application, { trace, async finish() {
          if (disposed) return;
          // 尚无原进程终态时明确缺证；不尝试再次读取Main、退出或补偿原用例。
          if (archive.arming !== 'armed' || process.exitCode === null && process.signalCode === null) recorder.record(token, 'observer-unavailable', { ok: false });
          disposed = true;
          try { detach(); } catch { recorder.record(token, 'observer-unavailable', { ok: false }); }
          recorder.dispose(); persist();
          archive.incomplete ||= recorder.snapshot().incomplete;
          // 直接附内存原件，不依赖可能过期或写失败的trace文件。
          try { await info.attach(`退出阶段原件-${generation}`, { body: Buffer.from(JSON.stringify(recorder.snapshot(), null, 2)), contentType: 'application/json' }); archive.bodyAttached = true; }
          catch { archive.incomplete = true; ioFailed(); }
          if (!archive.fileWritten && !archive.bodyAttached) unavailable();
        } });
        archives.push(archive);
        persist(); return trace;
      } catch { missing(); try { detach(); } catch { /* 缺证只进摘要。 */ } return; }
    },
    /** 只释放本诊断监听并归档，不介入原夹具的任何退出或清理决策。 */
    finish(): Promise<void> {
      if (finishPromise) return finishPromise;
      active = false;
      finishPromise = (async () => {
        for (const value of owned.values()) {
          try { await value.finish(); }
          catch { missing(); }
        }
        await archiveManifest();
      })();
      return finishPromise;
    },
  };
}
